import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AlertService } from '../../core/alert.service';
import { ClusterApiService } from '../../core/cluster-api.service';
import { DialogService } from '../../core/dialog.service';
import { IndexSettingsComponent } from './index-settings.component';
import { buildIndexSettingRows } from './index-settings.models';

describe('IndexSettingsComponent', () => {
  const alerts = { error: vi.fn(), success: vi.fn(), info: vi.fn(), warn: vi.fn() };
  const dialogs = { confirm: vi.fn(), showJson: vi.fn() };

  beforeEach(() => {
    Object.values(alerts).forEach((mock) => mock.mockReset());
    dialogs.confirm.mockReset();
    dialogs.confirm.mockResolvedValue(true);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: ClusterApiService, useValue: { post: vi.fn(async () => ({})) } },
        { provide: AlertService, useValue: alerts },
        { provide: DialogService, useValue: dialogs },
      ],
    });
  });

  function component(): IndexSettingsComponent {
    const target = TestBed.runInInjectionContext(() => new IndexSettingsComponent());
    target.resolvedIndex.set('products');
    target.rows.set(
      buildIndexSettingRows({ defaults: { 'index.refresh_interval': '1s' }, settings: { 'index.number_of_replicas': '1' } }),
    );
    return target;
  }

  it('lets the route leave without a dialog when nothing is pending', async () => {
    await expect(component().confirmDiscard()).resolves.toBe(true);
    expect(dialogs.confirm).not.toHaveBeenCalled();
  });

  it('asks once before discarding pending edits and lists them', async () => {
    const target = component();
    target.drafts.set({ 'index.number_of_replicas': { value: '2', scope: 'persistent' } });

    await expect(target.confirmDiscard()).resolves.toBe(true);

    expect(dialogs.confirm).toHaveBeenCalledTimes(1);
    expect(dialogs.confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Discard unsaved changes?',
        message: '1 unsaved change to products will be lost if you leave this page.',
        tone: 'danger',
        items: ['index.number_of_replicas'],
      }),
    );
  });

  it('lists the pending edits when switching index with the picker', async () => {
    const target = component();
    target.drafts.set({ 'index.number_of_replicas': { value: '2', scope: 'persistent' } });
    const select = document.createElement('select');
    select.append(new Option('customers', 'customers'));
    select.value = 'customers';

    await target.pick(select);

    expect(dialogs.confirm).toHaveBeenCalledWith(
      expect.objectContaining({ confirmLabel: 'Discard and switch', items: ['index.number_of_replicas'] }),
    );
    expect(target.drafts()).toEqual({});
  });
});
