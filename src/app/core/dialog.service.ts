import { Injectable, signal } from '@angular/core';

export type DialogTone = 'default' | 'warning' | 'danger';

export interface ConfirmOptions {
  readonly title: string;
  readonly message?: string;
  /** Optional list (for example the indices an operation will touch). */
  readonly items?: readonly string[];
  readonly confirmLabel?: string;
  readonly cancelLabel?: string;
  readonly tone?: DialogTone;
}

export type DialogState =
  | Readonly<{
      kind: 'confirm';
      title: string;
      message?: string;
      items: readonly string[];
      confirmLabel: string;
      cancelLabel: string;
      tone: DialogTone;
    }>
  | Readonly<{ kind: 'json'; title: string; subtitle?: string; text: string }>;

export function stringifyForDisplay(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

/** Drives the single <cerebro-dialog-host> mounted by the app root. */
@Injectable({ providedIn: 'root' })
export class DialogService {
  private readonly stateValue = signal<DialogState | undefined>(undefined);
  private confirmationResolver: ((confirmed: boolean) => void) | undefined;

  readonly state = this.stateValue.asReadonly();

  confirm(options: ConfirmOptions | string): Promise<boolean> {
    const config: ConfirmOptions =
      typeof options === 'string' ? { title: options } : options;
    this.settleConfirmation(false);
    this.stateValue.set({
      kind: 'confirm',
      title: config.title,
      ...(config.message ? { message: config.message } : {}),
      items: config.items ?? [],
      confirmLabel: config.confirmLabel ?? 'Confirm',
      cancelLabel: config.cancelLabel ?? 'Cancel',
      tone: config.tone ?? 'default',
    });
    return new Promise<boolean>((resolve) => {
      this.confirmationResolver = resolve;
    });
  }

  showJson(title: string, value: unknown, subtitle?: string): void {
    this.settleConfirmation(false);
    this.stateValue.set({
      kind: 'json',
      title,
      ...(subtitle ? { subtitle } : {}),
      text: stringifyForDisplay(value),
    });
  }

  accept(): void {
    this.settleConfirmation(true);
    this.stateValue.set(undefined);
  }

  close(): void {
    this.settleConfirmation(false);
    this.stateValue.set(undefined);
  }

  private settleConfirmation(confirmed: boolean): void {
    const resolver = this.confirmationResolver;
    this.confirmationResolver = undefined;
    resolver?.(confirmed);
  }
}
