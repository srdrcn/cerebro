import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  viewChild,
} from '@angular/core';
import { ClipboardService } from '../core/clipboard.service';
import { DialogService } from '../core/dialog.service';
import { CodeEditorComponent } from './code-editor.component';
import { PluralPipe } from './format.pipes';
import { ModalDialogDirective } from './modal-dialog.directive';

/** Renders confirmation and JSON dialogs requested through DialogService. */
@Component({
  selector: 'cerebro-dialog-host',
  imports: [CodeEditorComponent, ModalDialogDirective, PluralPipe],
  template: `
    <dialog
      cerebroModal="manual"
      class="dialog"
      [class.dialog--wide]="state()?.kind === 'json'"
      [class.dialog--fit]="state()?.kind === 'json' && !longJson()"
      aria-labelledby="cerebro-dialog-title"
      (dismiss)="dialogs.close()"
    >
      @if (state(); as dialog) {
        @if (dialog.kind === 'confirm') {
          <header class="dialog__header">
            <span
              class="dialog__icon"
              [class.dialog__icon--danger]="dialog.tone === 'danger'"
              [class.dialog__icon--warning]="dialog.tone === 'warning'"
              aria-hidden="true"
            >
              <i
                class="bi"
                [class.bi-exclamation-triangle]="dialog.tone !== 'default'"
                [class.bi-question-lg]="dialog.tone === 'default'"
              ></i>
            </span>
            <div class="min-w-0">
              <h2 id="cerebro-dialog-title" class="dialog__title">{{ dialog.title }}</h2>
              @if (dialog.message) {
                <p class="dialog__subtitle confirm-message">{{ dialog.message }}</p>
              }
            </div>
          </header>
          @if (dialog.items.length > 0) {
            <div class="dialog__body">
              <ul class="confirm-items">
                @for (item of visibleItems(); track item) {
                  <li class="mono">{{ item }}</li>
                }
                @if (dialog.items.length > visibleItems().length) {
                  <li class="confirm-items__more">
                    and {{ dialog.items.length - visibleItems().length }} more…
                  </li>
                }
              </ul>
            </div>
          }
          <footer class="dialog__footer">
            <button #cancelButton type="button" class="btn" (click)="dialogs.close()">
              {{ dialog.cancelLabel }}
            </button>
            <button
              #confirmButton
              type="button"
              class="btn"
              [class.btn-danger]="dialog.tone === 'danger'"
              [class.btn-primary]="dialog.tone !== 'danger'"
              (click)="dialogs.accept()"
            >
              {{ dialog.confirmLabel }}
            </button>
          </footer>
        } @else {
          <header class="dialog__header">
            <span class="dialog__icon" aria-hidden="true"><i class="bi bi-braces"></i></span>
            <div class="min-w-0 json-heading">
              <h2 id="cerebro-dialog-title" class="dialog__title truncate">{{ dialog.title }}</h2>
              @if (dialog.subtitle) {
                <p class="dialog__subtitle truncate">{{ dialog.subtitle }}</p>
              } @else {
                <p class="dialog__subtitle">{{ lineCount() }} {{ lineCount() | plural: 'line' }}</p>
              }
            </div>
            <div class="row">
              <button type="button" class="btn btn-sm" (click)="copy(dialog.text)">
                <i class="bi bi-clipboard" aria-hidden="true"></i> Copy
              </button>
              <button
                type="button"
                class="btn btn-ghost btn-icon btn-sm"
                aria-label="Close dialog"
                (click)="dialogs.close()"
              >
                <i class="bi bi-x-lg" aria-hidden="true"></i>
              </button>
            </div>
          </header>
          <div class="dialog__body dialog__body--flush json-body">
            @defer (on immediate) {
              <!-- Long documents fill the tall dialog; short ones size it to their lines. -->
              @if (longJson()) {
                <cerebro-code-editor
                  [value]="dialog.text"
                  [readOnly]="true"
                  [fill]="true"
                  [flush]="true"
                  ariaLabel="JSON document"
                />
              } @else {
                <cerebro-code-editor
                  [value]="dialog.text"
                  [readOnly]="true"
                  [minLines]="minJsonLines"
                  [maxLines]="maxFitLines"
                  [flush]="true"
                  ariaLabel="JSON document"
                />
              }
            } @placeholder {
              <pre class="json-fallback">{{ dialog.text }}</pre>
            }
          </div>
        }
      }
    </dialog>
  `,
  styles: `
    .confirm-message {
      color: var(--text-2);
      font-size: var(--text-base);
      white-space: pre-line;
    }

    .confirm-items {
      max-height: 220px;
      overflow: auto;
      margin: 0 0 0 48px;
      padding: 8px 12px;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      background: var(--surface-2);
      list-style: none;
      font-size: var(--text-sm);
    }

    .confirm-items li {
      padding: 2px 0;
      color: var(--text);
    }

    .confirm-items__more {
      color: var(--text-3) !important;
    }

    .json-heading {
      flex: 1;
    }

    .json-body {
      display: flex;
    }

    .json-body > * {
      flex: 1;
    }

    /* Short documents: the dialog shrinks to the editor instead of the
       fixed tall size of .dialog--wide. */
    .dialog--fit {
      height: fit-content;
    }

    .dialog--fit .json-body {
      flex: none;
    }

    .json-fallback {
      overflow: auto;
      padding: 14px 18px;
      color: var(--code-text);
      font-size: 12.5px;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DialogHostComponent {
  readonly dialogs = inject(DialogService);
  private readonly clipboard = inject(ClipboardService);
  private readonly modal = viewChild.required(ModalDialogDirective);
  private readonly confirmButton = viewChild<ElementRef<HTMLButtonElement>>('confirmButton');
  private readonly cancelButton = viewChild<ElementRef<HTMLButtonElement>>('cancelButton');

  readonly state = this.dialogs.state;
  readonly visibleItems = computed(() => {
    const state = this.state();
    return state?.kind === 'confirm' ? state.items.slice(0, 50) : [];
  });
  readonly lineCount = computed(() => {
    const state = this.state();
    return state?.kind === 'json' ? state.text.split('\n').length : 0;
  });
  /** Short JSON documents get a compact dialog sized to their lines. */
  readonly maxFitLines = 30;
  readonly minJsonLines = 3;
  readonly longJson = computed(() => this.lineCount() > this.maxFitLines);

  constructor() {
    effect(() => {
      if (this.state()) {
        this.modal().open();
      } else {
        this.modal().close();
      }
    });

    effect(() => {
      // Focus the primary action of confirmations for quick keyboard use,
      // except destructive ones: there a stray Enter must not delete anything.
      const state = this.state();
      if (state?.kind === 'confirm') {
        const target = state.tone === 'danger' ? this.cancelButton() : this.confirmButton();
        target?.nativeElement.focus();
      }
    });
  }

  async copy(text: string): Promise<void> {
    await this.clipboard.copyAndNotify(text, 'JSON document');
  }
}
