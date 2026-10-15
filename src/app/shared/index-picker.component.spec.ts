import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AlertService } from '../core/alert.service';
import { ClusterApiError } from '../core/api-envelope';
import { ClusterApiService } from '../core/cluster-api.service';
import { ConnectionService } from '../core/connection.service';
import { RefreshService } from '../core/refresh.service';
import { IndexPickerComponent } from './index-picker.component';

@Component({
  imports: [IndexPickerComponent],
  template: `<cerebro-index-picker #picker inputId="test-picker" [index]="index()" (picked)="picked.push($event)" />`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class HostComponent {
  readonly index = signal('');
  readonly picked: string[] = [];
}

describe('IndexPickerComponent', () => {
  const post = vi.fn();
  const alerts = { error: vi.fn() };
  const host = signal<string | undefined>('http://localhost:9200');
  const tick = signal(0);

  beforeEach(() => {
    post.mockReset();
    alerts.error.mockReset();
    host.set('http://localhost:9200');
    TestBed.configureTestingModule({
      providers: [
        { provide: ClusterApiService, useValue: { post } },
        { provide: AlertService, useValue: alerts },
        { provide: ConnectionService, useValue: { host } },
        { provide: RefreshService, useValue: { tick } },
      ],
    });
  });

  async function render(index = '') {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.index.set(index);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    const select = element.querySelector('select') as HTMLSelectElement;
    const picker = fixture.debugElement.children[0]?.componentInstance as IndexPickerComponent;
    return { fixture, element, select, picker };
  }

  it('groups the loaded indices and labels the select', async () => {
    post.mockResolvedValue(['orders', '.kibana', 'customers']);
    const { element, select, picker } = await render();

    expect(post).toHaveBeenCalledWith('commons/indices');
    expect(picker.indices()).toEqual(['orders', '.kibana', 'customers']);
    expect(element.querySelector('label')?.getAttribute('for')).toBe('test-picker');
    expect(select.id).toBe('test-picker');
    expect([...element.querySelectorAll('optgroup')].map((group) => group.label)).toEqual([
      'Indices',
      'System and hidden indices',
    ]);
    expect(select.options[0]?.textContent?.trim()).toBe('Choose an index…');
  });

  it('keeps an index the list does not have (an alias) selectable', async () => {
    post.mockResolvedValue(['orders']);
    const { select, picker } = await render('orders-alias');

    expect(picker.extra()).toBe('orders-alias');
    expect(select.value).toBe('orders-alias');
  });

  it('emits picks and can put the current index back', async () => {
    post.mockResolvedValue(['customers', 'orders']);
    const { fixture, select, picker } = await render('orders');

    select.value = 'customers';
    select.dispatchEvent(new Event('change'));
    expect(fixture.componentInstance.picked).toEqual(['customers']);

    picker.revert();
    expect(select.value).toBe('orders');
  });

  it('reports a failed list with the Elasticsearch reason and retries', async () => {
    post.mockRejectedValueOnce(
      new ClusterApiError(500, { error: { reason: 'cluster is blocked' } }),
    );
    const { fixture, select, picker } = await render();

    expect(picker.failed()).toBe(true);
    expect(picker.loadError()).toBe('Cluster is blocked');
    expect(alerts.error).toHaveBeenCalledWith('Could not load the index list: cluster is blocked', expect.any(ClusterApiError));
    expect(select.options[0]?.textContent?.trim()).toBe('Indices unavailable');

    post.mockResolvedValue(['orders']);
    picker.retry();
    await fixture.whenStable();
    expect(picker.failed()).toBe(false);
    expect(picker.indices()).toEqual(['orders']);
  });

  it('refreshes on ticks only once the list is a minute old, and on focus after a few seconds', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    post.mockResolvedValue(['orders']);
    const { fixture, select } = await render();
    expect(post).toHaveBeenCalledTimes(1);

    tick.update((value) => value + 1);
    await fixture.whenStable();
    select.dispatchEvent(new Event('focus'));
    expect(post).toHaveBeenCalledTimes(1);

    now.mockReturnValue(1_011_000);
    select.dispatchEvent(new Event('focus'));
    await fixture.whenStable();
    expect(post).toHaveBeenCalledTimes(2);

    now.mockReturnValue(1_080_000);
    tick.update((value) => value + 1);
    await fixture.whenStable();
    expect(post).toHaveBeenCalledTimes(3);
    now.mockRestore();
  });

  it('keeps the list already shown when a background refresh fails', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    post.mockResolvedValue(['orders']);
    const { fixture, picker } = await render();
    expect(picker.indices()).toEqual(['orders']);

    now.mockReturnValue(1_100_000);
    post.mockRejectedValue(new ClusterApiError(500, { error: { reason: 'cluster is blocked' } }));
    tick.update((value) => value + 1);
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve));

    expect(post).toHaveBeenCalledTimes(2);
    expect(picker.indices()).toEqual(['orders']);
    expect(picker.failed()).toBe(false);
    expect(alerts.error).not.toHaveBeenCalled();
    now.mockRestore();
  });

  it('forgets the list of the previous cluster', async () => {
    post.mockResolvedValue(['orders']);
    const { fixture, picker } = await render();
    expect(picker.indices()).toEqual(['orders']);

    post.mockReturnValue(new Promise(() => undefined));
    host.set('http://other:9200');
    await fixture.whenStable();
    expect(picker.indices()).toBeUndefined();
  });
});
