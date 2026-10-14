import { DOCUMENT } from '@angular/common';
import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { readPreference, writePreference } from './preferences';

/** Auto-refresh intervals in milliseconds. `0` pauses automatic refresh. */
export const REFRESH_INTERVALS = [0, 5_000, 10_000, 15_000, 30_000, 60_000] as const;
export type RefreshInterval = (typeof REFRESH_INTERVALS)[number];

export const DEFAULT_REFRESH_INTERVAL: RefreshInterval = 15_000;
export const REFRESH_STORAGE_KEY = 'cerebro.refresh-interval';

export function isRefreshInterval(value: number): value is RefreshInterval {
  return REFRESH_INTERVALS.some((candidate) => candidate === value);
}

export function refreshIntervalLabel(interval: number): string {
  if (interval === 0) {
    return 'Off';
  }
  return interval >= 60_000 ? `${interval / 60_000}m` : `${interval / 1_000}s`;
}

/**
 * Emits a monotonically increasing `tick` that data views read inside an
 * effect to reload. Automatic ticks are skipped while the tab is hidden and a
 * catch-up tick fires as soon as it becomes visible again.
 */
@Injectable({ providedIn: 'root' })
export class RefreshService {
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
  private readonly tickState = signal(Date.now());
  private readonly intervalState = signal<RefreshInterval>(this.initialInterval());
  private timer: number | undefined;
  private missedWhileHidden = false;

  readonly tick = this.tickState.asReadonly();
  readonly interval = this.intervalState.asReadonly();
  readonly paused = computed(() => this.intervalState() === 0);
  readonly intervals = REFRESH_INTERVALS;

  constructor() {
    this.schedule();
    const onVisibility = () => {
      if (!this.document.hidden && this.missedWhileHidden) {
        this.missedWhileHidden = false;
        this.refresh();
        this.schedule();
      }
    };
    this.document.addEventListener('visibilitychange', onVisibility);
    this.destroyRef.onDestroy(() => {
      this.cancelTimer();
      this.document.removeEventListener('visibilitychange', onVisibility);
    });
  }

  setInterval(interval: number): void {
    if (!isRefreshInterval(interval)) {
      throw new RangeError(`Unsupported refresh interval: ${interval}`);
    }
    const previous = this.intervalState();
    this.intervalState.set(interval);
    writePreference(REFRESH_STORAGE_KEY, String(interval));
    if (interval !== 0 && (previous === 0 || interval < previous)) {
      this.refresh();
    }
    this.schedule();
  }

  /** Requests an immediate reload of every view bound to `tick`. */
  refresh(): void {
    this.tickState.update((last) => Math.max(last, Date.now()) + 1);
  }

  getInterval(): number {
    return this.intervalState();
  }

  lastUpdate(): number {
    return this.tickState();
  }

  private initialInterval(): RefreshInterval {
    const stored = Number(readPreference(REFRESH_STORAGE_KEY));
    return readPreference(REFRESH_STORAGE_KEY) !== null && isRefreshInterval(stored)
      ? stored
      : DEFAULT_REFRESH_INTERVAL;
  }

  private schedule(): void {
    this.cancelTimer();
    const view = this.document.defaultView;
    const interval = this.intervalState();
    if (!view || interval === 0) {
      return;
    }
    this.timer = view.setTimeout(() => {
      if (this.document.hidden) {
        this.missedWhileHidden = true;
      } else {
        this.refresh();
      }
      this.schedule();
    }, interval);
  }

  private cancelTimer(): void {
    const view = this.document.defaultView;
    if (view && this.timer !== undefined) {
      view.clearTimeout(this.timer);
    }
    this.timer = undefined;
  }
}
