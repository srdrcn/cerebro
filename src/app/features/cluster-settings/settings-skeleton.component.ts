import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** Placeholder mimicking the settings editor while the settings load. */
@Component({
  selector: 'cerebro-settings-skeleton',
  host: { role: 'status', '[attr.aria-label]': 'label()' },
  template: `
    <div class="card skeleton-toolbar" aria-hidden="true">
      <span class="skeleton" style="width: min(340px, 100%); height: 34px"></span>
      <span class="skeleton" style="width: 150px; height: 16px"></span>
      <span class="skeleton" style="width: 130px; height: 16px"></span>
    </div>
    @for (card of cards; track card) {
      <div class="card" aria-hidden="true">
        <div class="card-header">
          <div class="skeleton-title">
            <span class="skeleton" style="width: 150px; height: 15px"></span>
            <span class="skeleton" style="width: 90px; height: 11px"></span>
          </div>
        </div>
        @for (row of rows; track row) {
          <div class="skeleton-row">
            <span class="skeleton" [style.width.%]="row"></span>
            <span class="skeleton skeleton-input"></span>
          </div>
        }
      </div>
    }
    <span class="visually-hidden">{{ label() }}</span>
  `,
  styles: `
    :host {
      display: grid;
      gap: var(--space-4);
    }

    .skeleton-toolbar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-4);
      padding: 10px var(--space-4);
    }

    .skeleton-title {
      display: grid;
      gap: 6px;
    }

    .skeleton-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(180px, 360px) 64px;
      gap: var(--space-4);
      align-items: center;
      padding: 12px var(--space-5);
      border-bottom: 1px solid var(--border-subtle);
    }

    .skeleton-row:last-child {
      border-bottom: 0;
    }

    .skeleton-row .skeleton:first-child {
      height: 13px;
    }

    .skeleton-input {
      height: 28px;
    }

    @media (max-width: 760px) {
      .skeleton-row {
        grid-template-columns: minmax(0, 1fr);
        gap: var(--space-2);
        padding: 12px var(--space-4);
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsSkeletonComponent {
  readonly label = input('Loading settings');
  readonly cards = [1, 2];
  readonly rows = [62, 48, 70, 55];
}
