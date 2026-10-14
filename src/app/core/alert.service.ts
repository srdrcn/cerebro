import { Injectable, signal } from '@angular/core';
import { stringifyForDisplay } from './dialog.service';

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

const DEFAULT_TIMEOUTS: Readonly<Record<AlertLevel, number>> = {
  error: 8_000,
  info: 3_500,
  success: 3_500,
  warn: 6_000,
};

/**
 * Toast notifications. Identical alerts raised while one is still visible
 * (typically a failing request repeated by auto-refresh) are folded together
 * instead of stacking up.
 */
@Injectable({ providedIn: 'root' })
export class AlertService {
  readonly maxAlerts = 4;
  private readonly alertsState = signal<readonly CerebroAlert[]>([]);
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private nextId = 0;

  readonly alerts = this.alertsState.asReadonly();

  success(message: string, response?: unknown, timeoutMs?: number): string {
    return this.add('success', message, response, timeoutMs);
  }

  error(message: string, response?: unknown, timeoutMs?: number): string {
    return this.add('error', message, response, timeoutMs);
  }

  info(message: string, response?: unknown, timeoutMs?: number): string {
    return this.add('info', message, response, timeoutMs);
  }

  warn(message: string, response?: unknown, timeoutMs?: number): string {
    return this.add('warn', message, response, timeoutMs);
  }

  remove(id: string): void {
    const timer = this.timers.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.timers.delete(id);
    }
    this.alertsState.update((alerts) => alerts.filter((alert) => alert.id !== id));
  }

  /** Cancels the auto-dismiss timer of an alert. */
  pin(id: string): void {
    const timer = this.timers.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.timers.delete(id);
    }
  }

  clear(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
    this.alertsState.set([]);
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
    if (delay > 0) {
      this.timers.set(
        id,
        setTimeout(() => this.remove(id), delay),
      );
    }
  }
}
