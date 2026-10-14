import { Directive, ElementRef, afterNextRender, inject, input, output } from '@angular/core';

/**
 * Modal behaviour for a native `<dialog>`: Escape and a click on the backdrop
 * emit `dismiss`, and the owner decides whether to close (for example not
 * while a request is running).
 *
 * Page-owned dialogs that exist only while shown open themselves after the
 * first render and report it through `opened` (focus a field there):
 *
 *   <dialog cerebroModal class="dialog" aria-labelledby="…" (opened)="focusName()" (dismiss)="close()">
 *
 * Dialogs that stay rendered and open on demand use `cerebroModal="manual"`
 * with the exported `open()` / `close()` (`#modal="cerebroModal"`).
 *
 * `[dismissible]="false"` (for example while a request runs) ignores Escape
 * and the backdrop, and reopens the dialog when the browser closes it anyway
 * (Chrome does after a second Escape without a click in between).
 */
@Directive({
  selector: 'dialog[cerebroModal]',
  exportAs: 'cerebroModal',
  host: {
    '(cancel)': 'onCancel($event)',
    '(click)': 'onClick($event)',
    '(close)': 'onClose()',
  },
})
export class ModalDialogDirective {
  private readonly dialog = inject<ElementRef<HTMLDialogElement>>(ElementRef).nativeElement;
  private closing = false;

  /** `"manual"` keeps the dialog closed until `open()` is called. */
  readonly mode = input<'' | 'auto' | 'manual'>('', { alias: 'cerebroModal' });

  readonly dismissible = input(true);

  /** Escape was pressed or the backdrop was clicked. */
  readonly dismiss = output<void>();

  /** The dialog was opened as a modal. */
  readonly opened = output<void>();

  constructor() {
    afterNextRender(() => {
      if (this.mode() !== 'manual') {
        this.open();
      }
    });
  }

  open(): void {
    if (!this.dialog.open) {
      this.dialog.showModal();
      this.opened.emit();
    }
  }

  close(): void {
    if (this.dialog.open) {
      this.closing = true;
      this.dialog.close();
      this.closing = false;
    }
  }

  onCancel(event: Event): void {
    event.preventDefault();
    if (this.dismissible()) {
      this.dismiss.emit();
    }
  }

  /** A close that did not come from `close()` was forced by the browser. */
  onClose(): void {
    if (!this.closing && !this.dismissible() && this.dialog.isConnected) {
      this.dialog.showModal();
    }
  }

  /** Clicks on the dialog element itself outside its box hit the backdrop. */
  onClick(event: MouseEvent): void {
    if (event.target !== this.dialog) {
      return;
    }
    const rect = this.dialog.getBoundingClientRect();
    const inside =
      event.clientX >= rect.left &&
      event.clientX <= rect.right &&
      event.clientY >= rect.top &&
      event.clientY <= rect.bottom;
    if (!inside && this.dismissible()) {
      this.dismiss.emit();
    }
  }
}
