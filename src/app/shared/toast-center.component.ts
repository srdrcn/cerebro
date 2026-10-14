import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  inject,
  signal,
} from '@angular/core';
import { AlertService, CerebroAlert } from '../core/alert.service';

const ICONS: Readonly<Record<CerebroAlert['level'], string>> = {
  success: 'bi-check-lg',
  error: 'bi-exclamation-lg',
  warn: 'bi-exclamation-triangle',
  info: 'bi-info-lg',
};

@Component({
  selector: 'cerebro-toast-center',
  template: `
    <!-- Each toast is its own live region (role alert / status); hovering or
         focusing the stack pauses the auto-dismiss countdowns. -->
    <section
      class="toasts"
      aria-label="Notifications"
      [class.is-paused]="alerts.paused()"
      (mouseenter)="setHovered(true)"
      (mouseleave)="setHovered(false)"
      (focusin)="setFocused(true)"
      (focusout)="onFocusOut($event)"
    >
      @for (alert of alerts.alerts(); track alert.id) {
        <article
          class="toast"
          [class]="'toast toast--' + alert.level"
          [attr.role]="alert.level === 'error' ? 'alert' : 'status'"
        >
          <span class="toast__icon" aria-hidden="true">
            <i class="bi" [class]="'bi ' + icon(alert)"></i>
          </span>
          <div class="min-w-0">
            <div class="toast__message">
              {{ alert.message }}
              @if (alert.count > 1) {
                <span class="badge">×{{ alert.count }}</span>
              }
            </div>
            @if (alert.response !== undefined) {
              <button
                type="button"
                class="toast__toggle"
                [attr.aria-expanded]="expanded() === alert.id"
                (click)="toggle(alert)"
              >
                {{ expanded() === alert.id ? 'Hide details' : 'Show details' }}
                <i
                  class="bi"
                  [class.bi-chevron-down]="expanded() !== alert.id"
                  [class.bi-chevron-up]="expanded() === alert.id"
                  aria-hidden="true"
                ></i>
              </button>
              @if (expanded() === alert.id) {
                <pre class="toast__details">{{ alerts.formatResponse(alert.response) }}</pre>
              }
            }
          </div>
          <button
            type="button"
            class="toast__close"
            aria-label="Dismiss notification"
            (click)="dismiss(alert)"
          >
            <i class="bi bi-x-lg" aria-hidden="true"></i>
          </button>
          @if (alert.timeoutMs > 0 && pinned() !== alert.id) {
            <span
              class="toast__progress"
              aria-hidden="true"
              [style.animation-duration.ms]="alert.timeoutMs"
            ></span>
          }
        </article>
      }
    </section>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ToastCenterComponent {
  readonly alerts = inject(AlertService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  readonly expanded = signal<string | undefined>(undefined);
  readonly pinned = signal<string | undefined>(undefined);
  private hovered = false;
  private focused = false;

  setHovered(hovered: boolean): void {
    this.hovered = hovered;
    this.syncPause();
  }

  setFocused(focused: boolean): void {
    this.focused = focused;
    this.syncPause();
  }

  onFocusOut(event: FocusEvent): void {
    const next = event.relatedTarget;
    if (!(next instanceof Node) || !this.host.nativeElement.contains(next)) {
      this.setFocused(false);
    }
  }

  /**
   * Removing the focused toast does not fire focusout, so move focus to the
   * next toast's dismiss button, or let the countdowns continue.
   */
  dismiss(alert: CerebroAlert): void {
    const position = this.alerts.alerts().findIndex((candidate) => candidate.id === alert.id);
    this.alerts.remove(alert.id);
    if (!this.focused) {
      return;
    }
    afterNextRender(
      () => {
        const buttons = this.host.nativeElement.querySelectorAll<HTMLButtonElement>('.toast__close');
        const next = buttons[Math.min(position, buttons.length - 1)];
        if (next) {
          next.focus();
        } else {
          this.setFocused(false);
        }
      },
      { injector: this.injector },
    );
  }

  private syncPause(): void {
    if (this.hovered || this.focused) {
      this.alerts.pauseAll();
    } else {
      this.alerts.resumeAll();
    }
  }

  icon(alert: CerebroAlert): string {
    return ICONS[alert.level];
  }

  toggle(alert: CerebroAlert): void {
    const opening = this.expanded() !== alert.id;
    this.expanded.set(opening ? alert.id : undefined);
    if (opening) {
      // Reading details should not be interrupted by the auto-dismiss timer.
      this.alerts.pin(alert.id);
      this.pinned.set(alert.id);
    }
  }
}
