import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { RestImportDialogComponent } from './rest-import-dialog.component';
import type { ImportPlan, SavedRequest } from './rest-saved.models';

function saved(name: string): SavedRequest {
  return {
    name,
    method: 'GET',
    path: name.toLowerCase(),
    body: '',
    createdAt: 1,
    updatedAt: 1,
    lastUsedAt: null,
  };
}

function plan(overrides: Partial<ImportPlan> = {}): ImportPlan {
  return {
    incoming: [saved('New'), saved('Health'), saved('Same')],
    added: ['New'],
    identical: ['Same'],
    conflicts: ['Health'],
    invalid: 2,
    ...overrides,
  };
}

describe('RestImportDialogComponent', () => {
  const prototype = HTMLDialogElement.prototype as Partial<HTMLDialogElement>;
  const originalShowModal = prototype.showModal;
  const originalClose = prototype.close;

  beforeAll(() => {
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

  async function render(value: ImportPlan): Promise<ComponentFixture<RestImportDialogComponent>> {
    const fixture = TestBed.createComponent(RestImportDialogComponent);
    fixture.componentRef.setInput('plan', value);
    fixture.componentRef.setInput('fileName', 'saved.json');
    await fixture.whenStable();
    return fixture;
  }

  function element(fixture: ComponentFixture<RestImportDialogComponent>): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function submitButton(fixture: ComponentFixture<RestImportDialogComponent>): HTMLButtonElement {
    return element(fixture).querySelector<HTMLButtonElement>('button[type="submit"]')!;
  }

  it('summarises the file and keeps the saved versions by default', async () => {
    const fixture = await render(plan());
    const text = element(fixture).textContent ?? '';
    expect(element(fixture).querySelector('dialog')?.hasAttribute('open')).toBe(true);
    expect(text).toContain('3 requests in saved.json');
    expect(text).toContain('1 new');
    expect(text).toContain('uses a name that is already saved');
    expect(text).toContain('1 already saved, unchanged');
    expect(text).toContain('2 invalid entries will be ignored');
    expect(fixture.componentInstance.strategy()).toBe('skip');
    expect(fixture.componentInstance.importCount()).toBe(1);
    expect(submitButton(fixture).textContent?.trim()).toBe('Import 1 request');
  });

  it('counts the conflicts when they are replaced', async () => {
    const fixture = await render(plan());
    const confirmed = vi.fn();
    fixture.componentInstance.confirmed.subscribe(confirmed);
    const overwrite = element(fixture).querySelector<HTMLInputElement>('input[value="overwrite"]')!;
    overwrite.checked = true;
    overwrite.dispatchEvent(new Event('change'));
    await fixture.whenStable();

    expect(fixture.componentInstance.importCount()).toBe(2);
    expect(submitButton(fixture).textContent?.trim()).toBe('Import 2 requests');
    submitButton(fixture).click();
    expect(confirmed).toHaveBeenCalledWith('overwrite');
    expect(element(fixture).querySelector('dialog')?.hasAttribute('open')).toBe(false);
  });

  it('keeps the saved versions when only conflicts would be skipped', async () => {
    const fixture = await render(plan({ added: [], incoming: [saved('Health')], identical: [], invalid: 0 }));
    const confirmed = vi.fn();
    fixture.componentInstance.confirmed.subscribe(confirmed);

    expect(fixture.componentInstance.importCount()).toBe(0);
    expect(submitButton(fixture).disabled).toBe(false);
    expect(submitButton(fixture).textContent?.trim()).toBe('Keep saved versions');

    fixture.componentInstance.strategy.set('overwrite');
    await fixture.whenStable();
    expect(submitButton(fixture).textContent?.trim()).toBe('Import 1 request');

    fixture.componentInstance.strategy.set('skip');
    await fixture.whenStable();
    submitButton(fixture).click();
    expect(confirmed).toHaveBeenCalledWith('skip');
  });

  it('lists a few conflicting names and counts the rest', async () => {
    const conflicts = Array.from({ length: 11 }, (_, index) => `Request ${index + 1}`);
    const fixture = await render(plan({ conflicts, incoming: conflicts.map(saved) }));
    expect(element(fixture).querySelectorAll('.import-conflicts .tag')).toHaveLength(8);
    expect(element(fixture).querySelector('.import-conflicts')?.textContent).toContain('and 3 more');
  });

  it('closes without importing', async () => {
    const fixture = await render(plan());
    const confirmed = vi.fn();
    const closed = vi.fn();
    fixture.componentInstance.confirmed.subscribe(confirmed);
    fixture.componentInstance.closed.subscribe(closed);
    element(fixture).querySelector<HTMLButtonElement>('.dialog__footer button[type="button"]')!.click();
    expect(closed).toHaveBeenCalledOnce();
    expect(confirmed).not.toHaveBeenCalled();
  });
});
