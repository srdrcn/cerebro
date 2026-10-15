import { ChangeDetectionStrategy, Component, computed, input, output, signal, viewChild } from '@angular/core';
import { pluralize } from '../../core/format';
import { PluralPipe } from '../../shared/format.pipes';
import { ModalDialogDirective } from '../../shared/modal-dialog.directive';
import type { ImportPlan, ImportStrategy } from './rest-saved.models';

const MAX_LISTED_CONFLICTS = 8;

/**
 * Shown when an imported file holds requests whose names are already saved
 * with a different request: the user keeps the saved versions or replaces
 * them. Files without such conflicts are imported right away.
 */
@Component({
  selector: 'cerebro-rest-import-dialog',
  imports: [ModalDialogDirective, PluralPipe],
  template: `
    <dialog
      cerebroModal
      class="dialog import-dialog"
      aria-labelledby="rest-import-title"
      aria-describedby="rest-import-subtitle"
      (dismiss)="close()"
    >
      <form novalidate (submit)="$event.preventDefault(); confirm()">
        <header class="dialog__header">
          <span class="dialog__icon" aria-hidden="true"><i class="bi bi-box-arrow-in-down"></i></span>
          <div class="min-w-0 import-dialog__heading">
            <h2 id="rest-import-title" class="dialog__title">Import saved requests</h2>
            <p id="rest-import-subtitle" class="dialog__subtitle truncate" [title]="fileName()">
              {{ pluralize(plan().incoming.length, 'request') }} in <span class="mono">{{ fileName() }}</span>
            </p>
          </div>
          <button type="button" class="btn btn-ghost btn-icon btn-sm" aria-label="Close" title="Close" (click)="close()">
            <i class="bi bi-x-lg" aria-hidden="true"></i>
          </button>
        </header>

        <div class="dialog__body stack">
          <ul class="import-summary" aria-label="What the file contains">
            @if (plan().added.length > 0) {
              <li>
                <span class="dot dot-green" aria-hidden="true"></span>
                <span><strong class="tabular">{{ plan().added.length }}</strong> new</span>
              </li>
            }
            <li>
              <span class="dot dot-yellow" aria-hidden="true"></span>
              <span>
                <strong class="tabular">{{ plan().conflicts.length }}</strong>
                {{ plan().conflicts.length | plural: 'uses a name that is' : 'use names that are' }} already saved with a different request
              </span>
            </li>
            @if (plan().identical.length > 0) {
              <li>
                <span class="dot dot-gray" aria-hidden="true"></span>
                <span><strong class="tabular">{{ plan().identical.length }}</strong> already saved, unchanged</span>
              </li>
            }
            @if (plan().invalid > 0) {
              <li>
                <span class="dot dot-red" aria-hidden="true"></span>
                <span>{{ pluralize(plan().invalid, 'invalid entry', 'invalid entries') }} will be ignored</span>
              </li>
            }
          </ul>

          <div class="import-conflicts" aria-label="Names already in use">
            @for (name of listedConflicts(); track name) {
              <span class="tag" [title]="name"><i class="bi bi-bookmark" aria-hidden="true"></i> <span class="truncate">{{ name }}</span></span>
            }
            @if (hiddenConflicts() > 0) {
              <span class="text-muted text-sm">and {{ hiddenConflicts() }} more</span>
            }
          </div>

          <fieldset class="import-choice">
            <legend class="field-label">Requests with a name that is already used</legend>
            <label class="check import-choice__option" [class.is-checked]="strategy() === 'skip'">
              <input type="radio" name="rest-import-strategy" value="skip" [checked]="strategy() === 'skip'" (change)="strategy.set('skip')" />
              <span>
                Keep my saved versions
                <span class="check-description">The imported requests with these names are skipped.</span>
              </span>
            </label>
            <label class="check import-choice__option" [class.is-checked]="strategy() === 'overwrite'">
              <input type="radio" name="rest-import-strategy" value="overwrite" [checked]="strategy() === 'overwrite'" (change)="strategy.set('overwrite')" />
              <span>
                Replace them with the imported ones
                <span class="check-description">Their method, path and body are overwritten.</span>
              </span>
            </label>
          </fieldset>
        </div>

        <footer class="dialog__footer">
          <button type="button" class="btn" (click)="close()">Cancel</button>
          <button type="submit" class="btn btn-primary">
            <i class="bi bi-box-arrow-in-down" aria-hidden="true"></i>
            {{ submitLabel() }}
          </button>
        </footer>
      </form>
    </dialog>
  `,
  styles: `
    .import-dialog {
      width: min(520px, calc(100vw - 32px));
    }

    .import-dialog__heading {
      flex: 1;
    }

    .import-summary {
      display: grid;
      gap: 6px;
      margin: 0;
      padding: 0;
      color: var(--text-2);
      font-size: var(--text-sm);
      list-style: none;
    }

    .import-summary li {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .import-summary strong {
      color: var(--text);
    }

    .import-conflicts {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px;
    }

    .import-conflicts .tag {
      max-width: 100%;
      min-width: 0;
    }

    .import-choice {
      display: grid;
      gap: var(--space-2);
      margin: 0;
      padding: 0;
      border: 0;
    }

    .import-choice legend {
      margin-bottom: var(--space-2);
      padding: 0;
    }

    .import-choice__option {
      align-items: flex-start;
      padding: 10px 12px;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      background: var(--surface);
      transition:
        border-color var(--duration-fast) ease,
        background var(--duration-fast) ease;
    }

    .import-choice__option input {
      margin-top: 2px;
    }

    .import-choice__option:hover {
      border-color: var(--border-strong);
    }

    .import-choice__option.is-checked {
      border-color: color-mix(in srgb, var(--accent) 55%, var(--border));
      background: var(--accent-soft);
    }

    .import-choice__option:focus-within {
      box-shadow: var(--focus-ring);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RestImportDialogComponent {
  readonly plan = input.required<ImportPlan>();
  readonly fileName = input('');

  readonly confirmed = output<ImportStrategy>();
  readonly closed = output<void>();

  private readonly modal = viewChild.required(ModalDialogDirective);

  readonly strategy = signal<ImportStrategy>('skip');
  readonly pluralize = pluralize;

  readonly listedConflicts = computed(() => this.plan().conflicts.slice(0, MAX_LISTED_CONFLICTS));
  readonly hiddenConflicts = computed(() =>
    Math.max(0, this.plan().conflicts.length - MAX_LISTED_CONFLICTS),
  );
  readonly importCount = computed(
    () => this.plan().added.length + (this.strategy() === 'overwrite' ? this.plan().conflicts.length : 0),
  );
  readonly submitLabel = computed(() => {
    const count = this.importCount();
    return count === 0 ? 'Keep saved versions' : `Import ${pluralize(count, 'request')}`;
  });

  /** With nothing to add, confirming keeps the saved versions (the page says so). */
  confirm(): void {
    this.confirmed.emit(this.strategy());
    this.close();
  }

  close(): void {
    this.modal().close();
    this.closed.emit();
  }
}
