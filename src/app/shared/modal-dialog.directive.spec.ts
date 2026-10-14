import { ChangeDetectionStrategy, Component, signal, viewChild } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ModalDialogDirective } from './modal-dialog.directive';

@Component({
  imports: [ModalDialogDirective],
  template: `
    <dialog [cerebroModal]="mode" (opened)="openedCount.set(openedCount() + 1)" (dismiss)="dismissed.set(dismissed() + 1)">
      <button type="button">Inside</button>
    </dialog>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class HostComponent {
  mode: '' | 'manual' = '';
  readonly openedCount = signal(0);
  readonly dismissed = signal(0);
  readonly modal = viewChild.required(ModalDialogDirective);
}

describe('ModalDialogDirective', () => {
  const prototype = HTMLDialogElement.prototype as Partial<HTMLDialogElement>;
  const originalShowModal = prototype.showModal;
  const originalClose = prototype.close;

  beforeAll(() => {
    // jsdom has no modal dialog support.
    prototype.showModal = function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    };
    prototype.close = function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    };
  });

  afterAll(() => {
    prototype.showModal = originalShowModal;
    prototype.close = originalClose;
  });

  async function render(mode: '' | 'manual' = '') {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.mode = mode;
    await fixture.whenStable();
    const dialog = (fixture.nativeElement as HTMLElement).querySelector('dialog') as HTMLDialogElement;
    return { fixture, host: fixture.componentInstance, dialog };
  }

  it('opens after the first render and reports it', async () => {
    const { host, dialog } = await render();
    expect(dialog.open).toBe(true);
    expect(host.openedCount()).toBe(1);
  });

  it('stays closed in manual mode until opened', async () => {
    const { host, dialog } = await render('manual');
    expect(dialog.open).toBe(false);
    host.modal().open();
    host.modal().open();
    expect(dialog.open).toBe(true);
    expect(host.openedCount()).toBe(1);
    host.modal().close();
    expect(dialog.open).toBe(false);
  });

  it('turns Escape into a dismiss request without closing', async () => {
    const { host, dialog } = await render();
    const cancel = new Event('cancel', { cancelable: true });
    dialog.dispatchEvent(cancel);
    expect(cancel.defaultPrevented).toBe(true);
    expect(host.dismissed()).toBe(1);
    expect(dialog.open).toBe(true);
  });

  it('dismisses on backdrop clicks only', async () => {
    const { host, dialog } = await render();
    dialog.getBoundingClientRect = () => new DOMRect(100, 100, 300, 200);
    (dialog.querySelector('button') as HTMLButtonElement).click();
    dialog.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 150, clientY: 150 }));
    expect(host.dismissed()).toBe(0);
    dialog.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 20, clientY: 20 }));
    expect(host.dismissed()).toBe(1);
  });
});
