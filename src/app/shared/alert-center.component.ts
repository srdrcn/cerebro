import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { AlertService, CerebroAlert } from '../core/alert.service';

@Component({
  selector: 'cerebro-alert-center',
  template: `
    <section class="alert-center" aria-label="Notifications" aria-live="polite">
      @for (alert of alerts.alerts(); track alert.id) {
        <article class="cerebro-alert" [class]="'cerebro-alert alert-' + alert.level">
          <span class="cerebro-alert__icon" aria-hidden="true">
            <i [class]="icon(alert)"></i>
          </span>
          <div class="cerebro-alert__content">
            @if (alert.response !== undefined) {
              <button
                type="button"
                class="cerebro-alert__message cerebro-alert__details-toggle"
                [attr.aria-expanded]="expanded() === alert.id"
                (click)="toggle(alert.id)"
              >
                {{ alert.message }}
              </button>
              @if (expanded() === alert.id) {
                <pre>{{ alerts.formatResponse(alert.response) }}</pre>
              }
            } @else {
              <span class="cerebro-alert__message">{{ alert.message }}</span>
            }
          </div>
          <button
            type="button"
            class="cerebro-alert__dismiss"
            aria-label="Dismiss notification"
            (click)="alerts.remove(alert.id)"
          >
            <i class="bi bi-x-lg" aria-hidden="true"></i>
          </button>
        </article>
      }
    </section>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AlertCenterComponent {
  readonly expanded = signal<string | undefined>(undefined);

  constructor(readonly alerts: AlertService) {}

  toggle(id: string): void {
    this.expanded.update((current) => (current === id ? undefined : id));
  }

  icon(alert: CerebroAlert): string {
    switch (alert.level) {
      case 'success':
        return 'bi bi-check-circle-fill';
      case 'error':
        return 'bi bi-exclamation-triangle-fill';
      case 'warn':
        return 'bi bi-exclamation-circle-fill';
      case 'info':
        return 'bi bi-info-circle-fill';
    }
  }
}
