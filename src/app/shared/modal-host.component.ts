import { ChangeDetectionStrategy, Component, HostListener } from '@angular/core';
import { ModalService } from '../core/modal.service';

@Component({
  selector: 'cerebro-modal-host',
  template: `
    @if (modal.state(); as dialog) {
      <div
        class="modal-backdrop-shell"
        role="presentation"
        (mousedown)="closeFromBackdrop($event)"
      >
        <section
          class="cerebro-modal"
          role="dialog"
          aria-modal="true"
          [attr.aria-labelledby]="dialog.kind === 'json' ? 'modal-title' : null"
          [attr.aria-describedby]="dialog.kind === 'confirmation' ? 'modal-message' : null"
        >
          <header class="cerebro-modal__header">
            @if (dialog.kind === 'json') {
              <h2 id="modal-title">{{ dialog.title }}</h2>
            } @else {
              <h2>Confirm action</h2>
            }
            <button
              type="button"
              class="icon-button"
              aria-label="Close dialog"
              (click)="modal.close()"
            >
              <i class="bi bi-x-lg" aria-hidden="true"></i>
            </button>
          </header>

          <div class="cerebro-modal__body">
            @if (dialog.kind === 'confirmation') {
              <p id="modal-message">{{ dialog.message }}</p>
            } @else {
              <pre class="modal-json">{{ dialog.text }}</pre>
            }
          </div>

          <footer class="cerebro-modal__footer">
            <button type="button" class="button-secondary" (click)="modal.close()">
              Close
            </button>
            @if (dialog.kind === 'confirmation') {
              <button type="button" class="button-warning" (click)="modal.accept()">
                Confirm
              </button>
            }
          </footer>
        </section>
      </div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ModalHostComponent {
  constructor(readonly modal: ModalService) {}

  @HostListener('document:keydown.escape')
  closeFromKeyboard(): void {
    if (this.modal.state()) {
      this.modal.close();
    }
  }

  closeFromBackdrop(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.modal.close();
    }
  }
}
