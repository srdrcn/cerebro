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
 */
@Directive({
  selector: 'dialog[cerebroModal]',
  exportAs: 'cerebroModal',
  host: {
    '(cancel)': 'onCancel($event)',
    '(click)': 'onClick($event)',
  },
})
export class ModalDialogDirective {
  private readonly dialog = inject<ElementRef<HTMLDialogElement>>(ElementRef).nativeElement;

  /** `"manual"` keeps the dialog closed until `open()` is called. */
  readonly mode = input<'' | 'auto' | 'manual'>('', { alias: 'cerebroModal' });

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
      this.dialog.close();
    }
  }

  onCancel(event: Event): void {
    event.preventDefault();
    this.dismiss.emit();
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
    if (!inside) {
      this.dismiss.emit();
    }
  }
}
