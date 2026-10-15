import { ChangeDetectionStrategy, Component, inject, output } from '@angular/core';
import { OPERATION_KINDS, OperationKind } from '../index-ops.models';
import { IndexOpsStore } from '../index-ops.store';
import { OPERATIONS } from '../index-ops.utils';

/** Step 1: one card per operation (what it does, when to use it, requirements). */
@Component({
  selector: 'cerebro-ops-operation-step',
  template: `
    <ul class="ops-operations" aria-label="Operations">
      @for (kind of kinds; track kind) {
        @let info = operations[kind];
        <li class="ops-operation" [class.is-selected]="store.operation() === kind">
          <div class="ops-operation__head">
            <span class="card-icon" aria-hidden="true"><i class="bi" [class]="'bi ' + info.icon"></i></span>
            <h3 class="ops-operation__title">
              <button
                type="button"
                class="ops-operation__button"
                [attr.aria-pressed]="store.operation() === kind"
                [attr.aria-describedby]="'ops-op-' + kind"
                (click)="choose(kind)"
              >
                {{ info.label }}
              </button>
            </h3>
            @if (store.operation() === kind) {
              <span class="badge badge-accent ops-operation__badge">Selected</span>
            }
          </div>
          <div [id]="'ops-op-' + kind" class="ops-operation__body">
            <p class="ops-operation__summary">{{ info.summary }}</p>
            <p class="ops-operation__when"><span class="ops-operation__label">When to use it</span> {{ info.whenToUse }}</p>
            <p class="ops-operation__label">Requirements</p>
            <ul class="ops-operation__requirements">
              @for (requirement of info.requirements; track requirement) {
                <li>{{ requirement }}</li>
              }
            </ul>
          </div>
        </li>
      }
    </ul>
  `,
  styleUrls: ['./ops-steps.css'],
  styles: `
    .ops-operations {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(290px, 1fr));
      gap: var(--space-3);
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .ops-operation {
      position: relative;
      display: flex;
      flex-direction: column;
      gap: 10px;
      padding: 16px;
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      background: var(--surface);
      transition:
        border-color var(--duration-fast) var(--ease-out),
        background var(--duration-fast) var(--ease-out),
        box-shadow var(--duration-fast) var(--ease-out);
    }

    .ops-operation:hover {
      border-color: var(--border-strong);
      box-shadow: var(--shadow-sm);
    }

    .ops-operation.is-selected {
      border-color: color-mix(in srgb, var(--accent) 60%, var(--border));
      background: color-mix(in srgb, var(--accent-soft) 45%, var(--surface));
    }

    .ops-operation:has(.ops-operation__button:focus-visible) {
      box-shadow: var(--focus-ring);
    }

    .ops-operation__head {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .ops-operation__title {
      color: var(--text);
      font-size: var(--text-md);
      font-weight: 650;
    }

    .ops-operation__button {
      padding: 0;
      border: 0;
      background: none;
      color: inherit;
      font: inherit;
      cursor: pointer;
    }

    .ops-operation__button:focus-visible {
      outline: none;
    }

    /* The whole card is the button's hit area. */
    .ops-operation__button::after {
      position: absolute;
      inset: 0;
      border-radius: inherit;
      content: '';
    }

    .ops-operation__badge {
      margin-left: auto;
    }

    .ops-operation__body {
      display: grid;
      gap: 8px;
      color: var(--text-2);
      font-size: var(--text-sm);
      line-height: 1.5;
    }

    .ops-operation__summary {
      color: var(--text);
    }

    .ops-operation__label {
      display: block;
      color: var(--text-3);
      font-size: var(--text-xs);
      font-weight: 620;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }

    .ops-operation__requirements {
      display: grid;
      gap: 3px;
      margin: -2px 0 0;
      padding-left: 18px;
    }

    .ops-operation__requirements li::marker {
      color: var(--text-3);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OpsOperationStepComponent {
  readonly store = inject(IndexOpsStore);
  readonly chosen = output<OperationKind>();

  readonly kinds = OPERATION_KINDS;
  readonly operations = OPERATIONS;

  async choose(kind: OperationKind): Promise<void> {
    await this.store.chooseOperation(kind);
    this.chosen.emit(kind);
  }
}
