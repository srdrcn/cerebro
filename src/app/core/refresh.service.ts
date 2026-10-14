import { DOCUMENT } from '@angular/common';
import { DestroyRef, inject, Injectable, signal } from '@angular/core';

export const REFRESH_INTERVALS = [5_000, 10_000, 15_000, 30_000, 60_000] as const;
export type RefreshInterval = (typeof REFRESH_INTERVALS)[number];

@Injectable({ providedIn: 'root' })
export class RefreshService {
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
  private readonly tickState = signal(Date.now());
  private readonly intervalState = signal<RefreshInterval>(15_000);
  private timer: number | undefined;

  readonly tick = this.tickState.asReadonly();
  readonly interval = this.intervalState.asReadonly();
  readonly intervals = REFRESH_INTERVALS;

  constructor() {
    this.schedule();
    this.destroyRef.onDestroy(() => this.cancelTimer());
  }

  setInterval(interval: number): void {
    if (!this.isRefreshInterval(interval)) {
      throw new RangeError(`Unsupported refresh interval: ${interval}`);
    }

    if (interval < this.intervalState()) {
      this.refresh();
    }
    this.intervalState.set(interval);
    this.schedule();
  }

  refresh(): void {
    this.tickState.update((last) => Math.max(last, Date.now()) + 1);
  }

  getInterval(): number {
    return this.intervalState();
  }

  lastUpdate(): number {
    return this.tickState();
  }

  private schedule(): void {
    this.cancelTimer();
    const view = this.document.defaultView;
    if (!view) {
      return;
    }
    this.timer = view.setTimeout(() => {
      this.refresh();
      this.schedule();
    }, this.intervalState());
  }

  private cancelTimer(): void {
    const view = this.document.defaultView;
    if (view && this.timer !== undefined) {
      view.clearTimeout(this.timer);
    }
    this.timer = undefined;
  }

  private isRefreshInterval(interval: number): interval is RefreshInterval {
    return REFRESH_INTERVALS.some((candidate) => candidate === interval);
  }
}
