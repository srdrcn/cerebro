import { Injectable, signal } from '@angular/core';

export type AlertLevel = 'success' | 'error' | 'info' | 'warn';

export interface CerebroAlert {
  readonly id: string;
  readonly level: AlertLevel;
  readonly message: string;
  readonly response?: unknown;
  readonly timestamp: Date;
}

const DEFAULT_TIMEOUTS: Readonly<Record<AlertLevel, number>> = {
  error: 7_500,
  info: 2_500,
  success: 2_500,
  warn: 5_000,
};

@Injectable({ providedIn: 'root' })
export class AlertService {
  readonly maxAlerts = 3;
  private readonly alertsState = signal<readonly CerebroAlert[]>([]);
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
    this.alertsState.update((alerts) =>
      alerts.filter((alert) => alert.id !== id),
    );
  }

  clear(): void {
    this.alertsState.set([]);
  }

  formatResponse(response: unknown): string {
    if (typeof response === 'string') {
      return response;
    }
    try {
      return JSON.stringify(response, null, 2) ?? '';
    } catch {
      return String(response);
    }
  }

  private add(
    level: AlertLevel,
    message: string,
    response?: unknown,
    timeoutMs?: number,
  ): string {
    const id = `alert_box_${Date.now()}_${this.nextId++}`;
    const alert: CerebroAlert = {
      id,
      level,
      message,
      ...(response === undefined ? {} : { response }),
      timestamp: new Date(),
    };

    this.alertsState.update((alerts) =>
      [alert, ...alerts].slice(0, this.maxAlerts),
    );

    const delay = timeoutMs ?? DEFAULT_TIMEOUTS[level];
    if (delay > 0) {
      globalThis.setTimeout(() => this.remove(id), delay);
    }
    return id;
  }
}
