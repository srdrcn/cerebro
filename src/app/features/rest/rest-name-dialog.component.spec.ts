import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { SavedRequest } from './rest-saved.models';
import { MAX_SAVED_NAME_LENGTH } from './rest-saved.utils';
import { NameDialogMode, RestNameDialogComponent } from './rest-name-dialog.component';

function saved(name: string): SavedRequest {
  return {
    name,
    method: 'GET',
    path: '_cluster/health',
    body: '',
    createdAt: 1,
    updatedAt: 1,
    lastUsedAt: null,
  };
}

describe('RestNameDialogComponent', () => {
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

  async function render(options: {
    mode?: NameDialogMode;
    initialName?: string;
    renaming?: string;
    requests?: SavedRequest[];
  } = {}): Promise<ComponentFixture<RestNameDialogComponent>> {
    const fixture = TestBed.createComponent(RestNameDialogComponent);
    fixture.componentRef.setInput('mode', options.mode ?? 'save');
    fixture.componentRef.setInput('initialName', options.initialName ?? 'GET _cluster/health');
    fixture.componentRef.setInput('renaming', options.renaming ?? '');
    fixture.componentRef.setInput('requests', options.requests ?? []);
    fixture.componentRef.setInput('request', { method: 'POST', path: '/products/_search', body: '{"size":1}' });
    document.body.appendChild(fixture.nativeElement as HTMLElement);
    await fixture.whenStable();
    return fixture;
  }

  function element(fixture: ComponentFixture<RestNameDialogComponent>): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function field(fixture: ComponentFixture<RestNameDialogComponent>): HTMLInputElement {
    return element(fixture).querySelector<HTMLInputElement>('#rest-saved-name')!;
  }

  async function type(fixture: ComponentFixture<RestNameDialogComponent>, value: string): Promise<void> {
    const input = field(fixture);
    input.value = value;
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();
  }

  function submitButton(fixture: ComponentFixture<RestNameDialogComponent>): HTMLButtonElement {
    return element(fixture).querySelector<HTMLButtonElement>('button[type="submit"]')!;
  }

  it('opens with the suggested name selected and describes the request', async () => {
    const fixture = await render();
    expect(element(fixture).querySelector('dialog')?.hasAttribute('open')).toBe(true);
    expect(field(fixture).value).toBe('GET _cluster/health');
    expect(document.activeElement).toBe(field(fixture));
    const request = element(fixture).querySelector('.name-dialog__request')?.textContent ?? '';
    expect(request).toContain('POST');
    expect(request).toContain('products/_search');
    expect(request).toContain('JSON body');
    expect(submitButton(fixture).textContent?.trim()).toBe('Save request');
    fixture.destroy();
  });

  it('only flags an empty name once the field was touched or submitted', async () => {
    const fixture = await render({ initialName: '' });
    const component = fixture.componentInstance;
    const submitted = vi.fn();
    component.submitted.subscribe(submitted);
    expect(component.visibleError()).toBeNull();

    component.submit();
    await fixture.whenStable();
    expect(component.visibleError()).toBe('Enter a name for the request.');
    expect(element(fixture).querySelector('.field-error')?.textContent).toContain('Enter a name');
    expect(field(fixture).getAttribute('aria-invalid')).toBe('true');
    expect(submitted).not.toHaveBeenCalled();
    // Focus returns to the field so the user can fix it.
    expect(document.activeElement).toBe(field(fixture));
    fixture.destroy();
  });

  it('flags a whitespace-only name as soon as the user types', async () => {
    const fixture = await render();
    await type(fixture, '   ');
    expect(fixture.componentInstance.visibleError()).toBe('Enter a name for the request.');
    fixture.destroy();
  });

  it('refuses names that are too long', async () => {
    const fixture = await render();
    const submitted = vi.fn();
    fixture.componentInstance.submitted.subscribe(submitted);
    await type(fixture, 'x'.repeat(MAX_SAVED_NAME_LENGTH + 1));
    expect(fixture.componentInstance.visibleError()).toBe(`Use at most ${MAX_SAVED_NAME_LENGTH} characters.`);
    fixture.componentInstance.submit();
    expect(submitted).not.toHaveBeenCalled();
    fixture.destroy();
  });

  it('saves under the normalised name and closes', async () => {
    const fixture = await render();
    const component = fixture.componentInstance;
    const submitted = vi.fn();
    const closed = vi.fn();
    component.submitted.subscribe(submitted);
    component.closed.subscribe(closed);
    await type(fixture, '  Slow   searches ');

    submitButton(fixture).click();
    await fixture.whenStable();

    expect(submitted).toHaveBeenCalledWith({ name: 'Slow searches', overwrite: false });
    expect(closed).toHaveBeenCalledOnce();
    expect(element(fixture).querySelector('dialog')?.hasAttribute('open')).toBe(false);
    fixture.destroy();
  });

  it('offers to replace a saved request with the same name, regardless of case', async () => {
    const fixture = await render({ requests: [saved('Health')] });
    const component = fixture.componentInstance;
    const submitted = vi.fn();
    component.submitted.subscribe(submitted);
    await type(fixture, 'health');

    expect(component.replaces()).toBe('Health');
    expect(component.visibleError()).toBeNull();
    expect(element(fixture).querySelector('.callout-warning')?.textContent).toContain('“Health” already exists.');
    expect(submitButton(fixture).textContent?.trim()).toBe('Replace saved request');
    expect(submitButton(fixture).classList).toContain('btn-danger');

    component.submit();
    expect(submitted).toHaveBeenCalledWith({ name: 'health', overwrite: true });
    fixture.destroy();
  });

  it('refuses to rename onto another saved request', async () => {
    const fixture = await render({
      mode: 'rename',
      initialName: 'Health',
      renaming: 'Health',
      requests: [saved('Health'), saved('Nodes')],
    });
    const component = fixture.componentInstance;
    const submitted = vi.fn();
    component.submitted.subscribe(submitted);
    expect(element(fixture).textContent).toContain('Rename saved request');
    expect(submitButton(fixture).textContent?.trim()).toBe('Rename');

    await type(fixture, 'NODES');
    expect(component.replaces()).toBeNull();
    expect(component.visibleError()).toBe('A saved request named “Nodes” already exists.');
    component.submit();
    expect(submitted).not.toHaveBeenCalled();
    fixture.destroy();
  });

  it('allows a rename that only changes the case', async () => {
    const fixture = await render({
      mode: 'rename',
      initialName: 'Health',
      renaming: 'Health',
      requests: [saved('Health')],
    });
    const submitted = vi.fn();
    fixture.componentInstance.submitted.subscribe(submitted);
    await type(fixture, 'HEALTH');
    expect(fixture.componentInstance.visibleError()).toBeNull();
    fixture.componentInstance.submit();
    expect(submitted).toHaveBeenCalledWith({ name: 'HEALTH', overwrite: false });
    fixture.destroy();
  });

  it('closes on Escape without submitting', async () => {
    const fixture = await render();
    const submitted = vi.fn();
    const closed = vi.fn();
    fixture.componentInstance.submitted.subscribe(submitted);
    fixture.componentInstance.closed.subscribe(closed);
    const cancel = new Event('cancel', { cancelable: true });
    element(fixture).querySelector('dialog')!.dispatchEvent(cancel);
    expect(cancel.defaultPrevented).toBe(true);
    expect(closed).toHaveBeenCalledOnce();
    expect(submitted).not.toHaveBeenCalled();
    fixture.destroy();
  });
});
