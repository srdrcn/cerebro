import { Injectable, signal } from '@angular/core';

export type ModalState =
  | Readonly<{ kind: 'confirmation'; message: string }>
  | Readonly<{ kind: 'json'; title: string; text: string }>;

@Injectable({ providedIn: 'root' })
export class ModalService {
  private readonly stateValue = signal<ModalState | undefined>(undefined);
  private confirmationResolver: ((confirmed: boolean) => void) | undefined;

  readonly state = this.stateValue.asReadonly();

  confirm(message: string): Promise<boolean> {
    this.settleConfirmation(false);
    this.stateValue.set({ kind: 'confirmation', message });
    return new Promise<boolean>((resolve) => {
      this.confirmationResolver = resolve;
    });
  }

  showJson(title: string, value: unknown): void {
    this.settleConfirmation(false);
    this.stateValue.set({ kind: 'json', title, text: this.stringify(value) });
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

  private stringify(value: unknown): string {
    if (typeof value === 'string') {
      return value;
    }
    try {
      return JSON.stringify(value, null, 2) ?? String(value);
    } catch {
      return String(value);
    }
  }
}
