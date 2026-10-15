import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { pluralize } from '../../../core/format';
import { Check, CheckFix, CheckStatus } from '../index-ops.models';
import { summarizeChecks } from '../index-ops.utils';

const STATUS: Readonly<Record<CheckStatus, { readonly tone: string; readonly icon: string; readonly label: string }>> = {
  pass: { tone: 'green', icon: 'bi-check-circle-fill', label: 'Passed' },
  warn: { tone: 'yellow', icon: 'bi-exclamation-triangle-fill', label: 'Warning' },
  fail: { tone: 'red', icon: 'bi-x-circle-fill', label: 'Failed' },
  pending: { tone: 'blue', icon: 'bi-hourglass-split', label: 'In progress' },
};

const FIX_LABELS: Readonly<Record<CheckFix, string>> = {
  'write-block': 'Block writes',
  prepare: 'Prepare source',
  'create-destination': 'Create index',
  'open-index': 'Open index',
  'make-write-index': 'Make it the write index',
};

/** Preflight checks with their state and the action that fixes them. */
@Component({
  selector: 'cerebro-ops-checks',
  template: `
    <section class="ops-section" aria-labelledby="ops-checks-title">
      <div class="ops-section__head">
        <h3 id="ops-checks-title" class="section-title" tabindex="-1">
          <i class="bi bi-clipboard-check" aria-hidden="true"></i> Checks
        </h3>
        <span class="count-label">{{ summaryText() }}</span>
      </div>
      @if (checks().length === 0) {
        <p class="ops-section__hint">Choose the options above to run the checks.</p>
      } @else {
        <ul class="ops-checks">
          @for (check of checks(); track check.id) {
            <li class="ops-check" [class]="'ops-check tone-' + status[check.status].tone">
              <span class="ops-check__icon" aria-hidden="true">
                @if (check.status === 'pending') {
                  <span class="spinner ops-check__spinner"></span>
                } @else {
                  <i class="bi" [class]="'bi ' + status[check.status].icon"></i>
                }
              </span>
              <div class="ops-check__body">
                <p class="ops-check__title">
                  <span class="visually-hidden">{{ status[check.status].label }}: </span>{{ check.title }}
                </p>
                <p class="ops-check__detail">{{ check.detail }}</p>
              </div>
              @if (check.fix && check.status !== 'pass') {
                <button
                  type="button"
                  class="btn btn-sm ops-check__fix"
                  [class.is-loading]="busy() === check.fix"
                  [disabled]="busy() !== null"
                  (click)="fix.emit(check.fix)"
                >
                  {{ fixLabels[check.fix] }}
                </button>
              }
            </li>
          }
        </ul>
      }
    </section>
  `,
  styleUrls: ['./ops-steps.css'],
  styles: `
    .ops-checks {
      display: grid;
      margin: 0;
      padding: 0;
      overflow: hidden;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      list-style: none;
    }

    .ops-check {
      position: relative;
      display: grid;
      grid-template-columns: auto minmax(0, 1fr) auto;
      align-items: start;
      gap: 4px 12px;
      padding: 11px 14px 11px 16px;
      background: var(--surface);
    }

    .ops-check + .ops-check {
      border-top: 1px solid var(--border-subtle);
    }

    .ops-check::before {
      position: absolute;
      inset: 0 auto 0 0;
      width: 3px;
      background: var(--tone);
      content: '';
      opacity: 0.85;
    }

    .ops-check.tone-green::before {
      opacity: 0;
    }

    .ops-check__icon {
      display: grid;
      width: 18px;
      height: 20px;
      place-items: center;
      color: var(--tone);
      font-size: 15px;
    }

    .ops-check__spinner {
      width: 14px;
      height: 14px;
      border-width: 1.5px;
    }

    .ops-check__title {
      color: var(--text);
      font-size: var(--text-sm);
      font-weight: 600;
      overflow-wrap: anywhere;
    }

    .ops-check.tone-red .ops-check__title {
      color: var(--tone-text);
    }

    .ops-check__detail {
      margin-top: 2px;
      color: var(--text-2);
      font-size: var(--text-sm);
      line-height: 1.45;
      overflow-wrap: anywhere;
    }

    .ops-check__fix {
      align-self: center;
    }

    @media (max-width: 560px) {
      .ops-check {
        grid-template-columns: auto minmax(0, 1fr);
      }

      .ops-check__fix {
        grid-column: 2;
        justify-self: start;
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OpsChecksComponent {
  readonly checks = input.required<readonly Check[]>();
  /** The fix whose request is in flight. */
  readonly busy = input<CheckFix | null>(null);
  readonly fix = output<CheckFix>();

  readonly status = STATUS;
  readonly fixLabels = FIX_LABELS;

  readonly summaryText = computed(() => {
    const summary = summarizeChecks(this.checks());
    const total = this.checks().length;
    if (total === 0) {
      return '';
    }
    if (summary.fail > 0) {
      return `${summary.fail} of ${pluralize(total, 'check')} failed`;
    }
    if (summary.pending > 0) {
      return `${summary.pending} of ${pluralize(total, 'check')} in progress`;
    }
    return summary.warn > 0 ? `${summary.pass} of ${total} passed, ${pluralize(summary.warn, 'warning')}` : `All ${pluralize(total, 'check')} passed`;
  });
}
