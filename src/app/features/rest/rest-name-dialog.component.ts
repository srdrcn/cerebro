import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { ModalDialogDirective } from '../../shared/modal-dialog.directive';
import type { SavedRequest } from './rest-saved.models';
import {
  bodySummary,
  nameProblem,
  nameProblemText,
  normalizeName,
} from './rest-saved.utils';
import type { RestDraft } from './rest.models';
import { requestPath } from './rest.utils';

export type NameDialogMode = 'save' | 'rename';

export interface NameDialogResult {
  readonly name: string;
  /** True when an existing saved request with this name is replaced. */
  readonly overwrite: boolean;
}

/**
 * Asks for the name of a saved request: when saving the editor's request
 * ("Save request") or renaming one ("Rename saved request"). Saving under a
 * name that is taken offers to replace it; renaming onto one is refused.
 */
@Component({
  selector: 'cerebro-rest-name-dialog',
  imports: [ModalDialogDirective],
  template: `
    <dialog
      cerebroModal
      class="dialog name-dialog"
      aria-labelledby="rest-name-dialog-title"
      aria-describedby="rest-name-dialog-subtitle"
      (opened)="onOpened()"
      (dismiss)="close()"
    >
      <form novalidate (submit)="$event.preventDefault(); submit()">
        <header class="dialog__header">
          <span class="dialog__icon" aria-hidden="true">
            <i class="bi" [class]="mode() === 'save' ? 'bi bi-bookmark-plus' : 'bi bi-pencil'"></i>
          </span>
          <div class="min-w-0 name-dialog__heading">
            <h2 id="rest-name-dialog-title" class="dialog__title">
              {{ mode() === 'save' ? 'Save request' : 'Rename saved request' }}
            </h2>
            <p id="rest-name-dialog-subtitle" class="dialog__subtitle">
              @if (mode() === 'save') {
                Saved requests are kept in this browser and work with every cluster.
              } @else {
                Currently named <strong class="name-dialog__current">{{ renaming() }}</strong>
              }
            </p>
          </div>
          <button
            type="button"
            class="btn btn-ghost btn-icon btn-sm"
            aria-label="Close"
            title="Close"
            (click)="close()"
          >
            <i class="bi bi-x-lg" aria-hidden="true"></i>
          </button>
        </header>

        <div class="dialog__body stack">
          <div class="field">
            <label class="field-label" for="rest-saved-name">Name</label>
            <input
              #nameInput
              id="rest-saved-name"
              class="input"
              type="text"
              autocomplete="off"
              spellcheck="false"
              [class.is-invalid]="visibleError() !== null"
              [attr.aria-invalid]="visibleError() !== null ? true : null"
              [attr.aria-describedby]="visibleError() !== null ? 'rest-saved-name-error' : 'rest-saved-name-help'"
              [value]="name()"
              (input)="onInput(nameInput.value)"
            />
            <div id="rest-saved-name-help">
              @if (visibleError(); as error) {
                <p id="rest-saved-name-error" class="field-error" role="alert">
                  <i class="bi bi-exclamation-circle" aria-hidden="true"></i> {{ error }}
                </p>
              } @else if (replaces(); as existing) {
                <div class="callout callout-warning name-dialog__callout" role="status">
                  <i class="bi bi-exclamation-triangle" aria-hidden="true"></i>
                  <div>
                    <strong>“{{ existing }}” already exists.</strong>
                    Saving replaces its method, path and body with this request.
                  </div>
                </div>
              } @else {
                <p class="field-hint">A short, unique name, for example “Slow searches on products”.</p>
              }
            </div>
          </div>

          <div class="name-dialog__request" aria-label="Request to save">
            <span class="method" [class]="'method method-' + request().method">{{ request().method }}</span>
            <span class="mono truncate name-dialog__path" [title]="path()">{{ path() || '(no path)' }}</span>
            <span class="name-dialog__body">{{ summary() }}</span>
          </div>

          @if (mode() === 'save') {
            <p class="name-dialog__note">
              <i class="bi bi-shield-lock" aria-hidden="true"></i>
              Only the method, path and body are saved — never the host or credentials.
            </p>
          }
        </div>

        <footer class="dialog__footer">
          <button type="button" class="btn" (click)="close()">Cancel</button>
          <button type="submit" class="btn" [class.btn-primary]="!replaces()" [class.btn-danger]="replaces() !== null">
            <i class="bi" [class]="submitIcon()" aria-hidden="true"></i>
            {{ submitLabel() }}
          </button>
        </footer>
      </form>
    </dialog>
  `,
  styles: `
    .name-dialog {
      width: min(500px, calc(100vw - 32px));
    }

    .name-dialog__heading {
      flex: 1;
    }

    .name-dialog__current {
      color: var(--text-2);
      font-weight: 600;
      overflow-wrap: anywhere;
    }

    .name-dialog__callout {
      margin-top: 2px;
    }

    .name-dialog__request {
      min-width: 0;
      display: flex;
      align-items: center;
      gap: var(--space-2);
      padding: 9px 12px;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      background: var(--surface-2);
      font-size: var(--text-sm);
    }

    .name-dialog__path {
      min-width: 0;
      flex: 1;
      color: var(--text);
    }

    .name-dialog__body {
      flex: none;
      color: var(--text-3);
      font-size: var(--text-xs);
      white-space: nowrap;
    }

    .name-dialog__note {
      display: flex;
      align-items: center;
      gap: 6px;
      color: var(--text-3);
      font-size: var(--text-xs);
    }

    @media (max-width: 480px) {
      .name-dialog__request {
        flex-wrap: wrap;
      }

      .name-dialog__body {
        width: 100%;
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RestNameDialogComponent {
  readonly mode = input<NameDialogMode>('save');
  readonly initialName = input('');
  /** Every saved request: used to check that the name is free. */
  readonly requests = input<readonly SavedRequest[]>([]);
  /** Rename mode: the current name of the request. */
  readonly renaming = input('');
  /** The request that is saved (or renamed). */
  readonly request = input.required<RestDraft>();

  readonly submitted = output<NameDialogResult>();
  readonly closed = output<void>();

  private readonly modal = viewChild.required(ModalDialogDirective);
  private readonly nameInput = viewChild.required<ElementRef<HTMLInputElement>>('nameInput');

  readonly name = signal('');
  private readonly touched = signal(false);
  private readonly attempted = signal(false);

  readonly path = computed(() => requestPath(this.request().path));
  readonly summary = computed(() => bodySummary(this.request().path, this.request().body));

  private readonly problem = computed(() =>
    nameProblem(this.name(), this.requests(), this.mode() === 'rename' ? this.renaming() : undefined),
  );

  /** Saving onto an existing name replaces it (after a clear warning). */
  readonly replaces = computed(() => {
    const problem = this.problem();
    return this.mode() === 'save' && problem?.kind === 'duplicate' ? problem.existing : null;
  });

  readonly visibleError = computed(() => {
    const problem = this.problem();
    if (problem === null || this.replaces() !== null) {
      return null;
    }
    // A cleared field is only an error once the user typed or submitted.
    if (problem.kind === 'empty' && !this.touched() && !this.attempted()) {
      return null;
    }
    return nameProblemText(problem);
  });

  readonly submitLabel = computed(() => {
    if (this.replaces() !== null) {
      return 'Replace saved request';
    }
    return this.mode() === 'save' ? 'Save request' : 'Rename';
  });

  readonly submitIcon = computed(() =>
    this.replaces() !== null ? 'bi bi-arrow-repeat' : this.mode() === 'save' ? 'bi bi-bookmark-check' : 'bi bi-check2',
  );

  /** Starts from the suggested name, selected so typing replaces it. */
  onOpened(): void {
    this.name.set(this.initialName());
    const field = this.nameInput().nativeElement;
    field.value = this.initialName();
    field.focus();
    field.select();
  }

  onInput(value: string): void {
    this.name.set(value);
    this.touched.set(true);
  }

  submit(): void {
    this.attempted.set(true);
    const problem = this.problem();
    if (problem !== null && this.replaces() === null) {
      this.nameInput().nativeElement.focus();
      return;
    }
    this.submitted.emit({ name: normalizeName(this.name()), overwrite: this.replaces() !== null });
    this.close();
  }

  close(): void {
    this.modal().close();
    this.closed.emit();
  }
}
