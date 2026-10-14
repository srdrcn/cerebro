import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
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
    <section class="toasts" aria-label="Notifications" aria-live="polite">
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
            (click)="alerts.remove(alert.id)"
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
  readonly expanded = signal<string | undefined>(undefined);
  readonly pinned = signal<string | undefined>(undefined);

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
