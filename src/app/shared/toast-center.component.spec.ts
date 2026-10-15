import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AlertService } from '../core/alert.service';
import { ToastCenterComponent } from './toast-center.component';

describe('ToastCenterComponent', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  async function render() {
    const fixture = TestBed.createComponent(ToastCenterComponent);
    const alerts = TestBed.inject(AlertService);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    return { fixture, alerts, element };
  }

  it('pauses the countdowns while a toast is hovered', async () => {
    const { fixture, alerts, element } = await render();
    alerts.success('Saved', undefined, 1_000);
    await fixture.whenStable();

    const toast = element.querySelector('.toast') as HTMLElement;
    toast.dispatchEvent(new Event('pointerenter'));
    expect(alerts.paused()).toBe(true);

    toast.dispatchEvent(new Event('pointerleave'));
    expect(alerts.paused()).toBe(false);
  });

  it('resumes once the hovered toast is dismissed with its close button', async () => {
    const { fixture, alerts, element } = await render();
    alerts.success('Copied', undefined, 1_000);
    await fixture.whenStable();

    const toast = element.querySelector('.toast') as HTMLElement;
    toast.dispatchEvent(new Event('pointerenter'));
    (toast.querySelector('.toast__close') as HTMLButtonElement).click();
    await fixture.whenStable();

    expect(alerts.alerts()).toEqual([]);
    expect(alerts.paused()).toBe(false);
    expect(element.querySelector('.toasts')?.classList.contains('is-paused')).toBe(false);

    // The next toast times out again.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    alerts.success('Saved', undefined, 1_000);
    TestBed.tick();
    expect(alerts.alerts()).toHaveLength(1);
    vi.advanceTimersByTime(1_500);
    expect(alerts.alerts()).toEqual([]);
  });

  it('keeps the pause while another toast is still hovered', async () => {
    const { fixture, alerts, element } = await render();
    alerts.success('First', undefined, 1_000);
    alerts.success('Second', undefined, 1_000);
    await fixture.whenStable();

    const [newest, older] = Array.from(element.querySelectorAll<HTMLElement>('.toast'));
    newest.dispatchEvent(new Event('pointerenter'));
    (older.querySelector('.toast__close') as HTMLButtonElement).click();
    await fixture.whenStable();

    expect(alerts.alerts()).toHaveLength(1);
    expect(alerts.paused()).toBe(true);
  });
});
