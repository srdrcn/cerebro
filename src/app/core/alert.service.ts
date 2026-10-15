import { Injectable, signal } from '@angular/core';
import { stringifyForDisplay } from './json';

export type AlertLevel = 'success' | 'error' | 'info' | 'warn';

export interface CerebroAlert {
  readonly id: string;
  readonly level: AlertLevel;
  readonly message: string;
  readonly response?: unknown;
  readonly timestamp: Date;
  /** Auto-dismiss delay in milliseconds; `0` keeps the toast until closed. */
  readonly timeoutMs: number;
  /** Number of identical alerts folded into this one. */
  readonly count: number;
}

const reportedErrors = new WeakSet<object>();

/**
 * Records that the user has already been told about `error` (for example
 * ClusterApiService's "Error connecting to the server" toast), so a later
 * `AlertService.error(message, error)` for the same failure is not shown twice.
 */
export function markErrorReported(error: unknown): void {
  if (typeof error === 'object' && error !== null) {
    reportedErrors.add(error);
  }
}

export function isErrorReported(error: unknown): boolean {
  return typeof error === 'object' && error !== null && reportedErrors.has(error);
}

/**
 * Errors stay until they are dismissed: they are often the only place a
 * failure reason is shown, and keyboard users need time to reach them.
 */
const DEFAULT_TIMEOUTS: Readonly<Record<AlertLevel, number>> = {
  error: 0,
  info: 3_500,
  success: 3_500,
  warn: 6_000,
};

interface Countdown {
  /** Milliseconds left before the toast is dismissed. */
  remaining: number;
  startedAt: number;
  handle?: ReturnType<typeof setTimeout>;
}

/**
 * Toast notifications. Identical alerts raised while one is still visible
 * (typically a failing request repeated by auto-refresh) are folded together
 * instead of stacking up. `error()` ignores errors that were already reported
 * (see `markErrorReported`), so pages can pass every caught error without
 * doubling the network failure toast.
 *
 * Auto-dismiss countdowns stop while the user hovers or focuses the toasts
 * (`pauseAll()` / `resumeAll()`, WCAG 2.2.1) and continue with the time left.
 */
@Injectable({ providedIn: 'root' })
export class AlertService {
  readonly maxAlerts = 4;
  private readonly alertsState = signal<readonly CerebroAlert[]>([]);
  private readonly countdowns = new Map<string, Countdown>();
  private readonly pausedState = signal(false);
  private nextId = 0;

  readonly alerts = this.alertsState.asReadonly();
  /** True while auto-dismiss countdowns are suspended. */
  readonly paused = this.pausedState.asReadonly();

  success(message: string, response?: unknown, timeoutMs?: number): string {
    return this.add('success', message, response, timeoutMs);
  }

  /** Returns the toast id, or `''` when `response` was already reported. */
  error(message: string, response?: unknown, timeoutMs?: number): string {
    if (isErrorReported(response)) {
      return '';
    }
    return this.add('error', message, response, timeoutMs);
  }

  info(message: string, response?: unknown, timeoutMs?: number): string {
    return this.add('info', message, response, timeoutMs);
  }

  warn(message: string, response?: unknown, timeoutMs?: number): string {
    return this.add('warn', message, response, timeoutMs);
  }

  remove(id: string): void {
    this.cancel(id);
    this.alertsState.update((alerts) => alerts.filter((alert) => alert.id !== id));
  }

  /** Cancels the auto-dismiss timer of an alert. */
  pin(id: string): void {
    this.cancel(id);
  }

  /** Suspends every auto-dismiss countdown, keeping the time left. */
  pauseAll(): void {
    if (this.pausedState()) {
      return;
    }
    this.pausedState.set(true);
    const now = Date.now();
    for (const countdown of this.countdowns.values()) {
      if (countdown.handle !== undefined) {
        clearTimeout(countdown.handle);
        countdown.handle = undefined;
        countdown.remaining = Math.max(0, countdown.remaining - (now - countdown.startedAt));
      }
    }
  }

  /** Continues the countdowns suspended by `pauseAll()`. */
  resumeAll(): void {
    if (!this.pausedState()) {
      return;
    }
    this.pausedState.set(false);
    for (const [id, countdown] of this.countdowns) {
      this.start(id, countdown);
    }
  }

  formatResponse(response: unknown): string {
    return stringifyForDisplay(response);
  }

  private add(
    level: AlertLevel,
    message: string,
    response?: unknown,
    timeoutMs?: number,
  ): string {
    const delay = timeoutMs ?? DEFAULT_TIMEOUTS[level];
    const duplicate = this.alertsState().find(
      (alert) => alert.level === level && alert.message === message,
    );

    if (duplicate) {
      const id = `alert_${Date.now()}_${this.nextId++}`;
      const merged: CerebroAlert = {
        ...duplicate,
        id,
        ...(response === undefined ? {} : { response }),
        timestamp: new Date(),
        timeoutMs: delay,
        count: duplicate.count + 1,
      };
      this.remove(duplicate.id);
      this.alertsState.update((alerts) => [merged, ...alerts]);
      this.schedule(id, delay);
      return id;
    }

    const id = `alert_${Date.now()}_${this.nextId++}`;
    const alert: CerebroAlert = {
      id,
      level,
      message,
      ...(response === undefined ? {} : { response }),
      timestamp: new Date(),
      timeoutMs: delay,
      count: 1,
    };

    const kept = [alert, ...this.alertsState()];
    for (const dropped of kept.slice(this.maxAlerts)) {
      this.remove(dropped.id);
    }
    this.alertsState.set(kept.slice(0, this.maxAlerts));
    this.schedule(id, delay);
    return id;
  }

  private schedule(id: string, delay: number): void {
    if (delay <= 0) {
      return;
    }
    const countdown: Countdown = { remaining: delay, startedAt: Date.now() };
    this.countdowns.set(id, countdown);
    if (!this.pausedState()) {
      this.start(id, countdown);
    }
  }

  private start(id: string, countdown: Countdown): void {
    countdown.startedAt = Date.now();
    countdown.handle = setTimeout(() => this.remove(id), countdown.remaining);
  }

  private cancel(id: string): void {
    const countdown = this.countdowns.get(id);
    if (countdown?.handle !== undefined) {
      clearTimeout(countdown.handle);
    }
    this.countdowns.delete(id);
  }
}
