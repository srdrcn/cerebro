import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AlertService } from '../../core/alert.service';
import { DialogService } from '../../core/dialog.service';
import { RestSavedComponent } from './rest-saved.component';
import { RestSavedStore, SAVED_REQUESTS_KEY } from './rest-saved.store';

const SORT_KEY = 'cerebro.rest.saved-sort';

describe('RestSavedComponent', () => {
  const confirm = vi.fn();
  const showJson = vi.fn();
  const alerts = { error: vi.fn(), info: vi.fn(), warn: vi.fn(), success: vi.fn() };

  beforeEach(() => {
    for (const mock of [confirm, showJson, ...Object.values(alerts)]) {
      mock.mockReset();
    }
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        RestSavedStore,
        { provide: DialogService, useValue: { confirm, showJson } },
        { provide: AlertService, useValue: alerts },
      ],
    });
  });

  function seed(): RestSavedStore {
    const store = TestBed.inject(RestSavedStore);
    store.save('Beta health', { method: 'GET', path: '_cluster/health', body: '' }, 1);
    store.save('Alpha search', { method: 'POST', path: 'products/_search', body: '{"size":1}' }, 2);
    store.save('Nodes', { method: 'GET', path: '_nodes', body: '' }, 3);
    store.markUsed('Beta health', 10);
    store.markUsed('Alpha search', 5);
    store.import(
      [
        {
          name: 'Imported',
          method: 'GET',
          path: '_cat/indices',
          body: '',
          createdAt: 20,
          updatedAt: 20,
          lastUsedAt: null,
        },
      ],
      'skip',
    );
    store.link(null);
    return store;
  }

  async function render(): Promise<ComponentFixture<RestSavedComponent>> {
    const fixture = TestBed.createComponent(RestSavedComponent);
    await fixture.whenStable();
    return fixture;
  }

  function element(fixture: ComponentFixture<RestSavedComponent>): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function names(fixture: ComponentFixture<RestSavedComponent>): string[] {
    return [...element(fixture).querySelectorAll('.saved-item__name > .truncate')].map(
      (node) => node.textContent?.trim() ?? '',
    );
  }

  it('explains the feature when nothing is saved yet', async () => {
    const fixture = await render();
    const saveCurrent = vi.fn();
    const importFile = vi.fn();
    fixture.componentInstance.saveCurrent.subscribe(saveCurrent);
    fixture.componentInstance.importFile.subscribe(importFile);
    const text = element(fixture).textContent ?? '';
    expect(text).toContain('No saved requests yet');
    expect(text).toContain('work with every cluster');
    expect(element(fixture).querySelector('cerebro-search')).toBeNull();

    const buttons = [...element(fixture).querySelectorAll<HTMLButtonElement>('.saved-empty__actions button')];
    buttons[0]!.click();
    buttons[1]!.click();
    expect(saveCurrent).toHaveBeenCalledOnce();
    expect(importFile).toHaveBeenCalledOnce();
  });

  it('disables saving from the empty state while there is no path', async () => {
    const fixture = TestBed.createComponent(RestSavedComponent);
    fixture.componentRef.setInput('canSaveCurrent', false);
    await fixture.whenStable();
    const save = element(fixture).querySelector<HTMLButtonElement>('.saved-empty__actions .btn-primary')!;
    expect(save.disabled).toBe(true);
    expect(save.title).toBe('Enter a request path first');
  });

  it('lists the saved requests by name and remembers the chosen sort', async () => {
    seed();
    const fixture = await render();
    expect(names(fixture)).toEqual(['Alpha search', 'Beta health', 'Imported', 'Nodes']);
    expect(element(fixture).querySelector('.saved-item__path')?.textContent).toBe('products/_search');
    expect(element(fixture).querySelector('[aria-label="Sort by name"]')?.getAttribute('aria-pressed')).toBe('true');

    element(fixture).querySelector<HTMLButtonElement>('[aria-label="Sort by most recently used"]')!.click();
    await fixture.whenStable();
    // Most recently used first; the imported, never loaded one last.
    expect(names(fixture)).toEqual(['Beta health', 'Alpha search', 'Nodes', 'Imported']);
    expect(localStorage.getItem(SORT_KEY)).toBe('recent');

    // A new page starts with the remembered order.
    const again = await render();
    expect(again.componentInstance.sort()).toBe('recent');
  });

  it('ignores an unknown stored sort', async () => {
    localStorage.setItem(SORT_KEY, 'size');
    const fixture = await render();
    expect(fixture.componentInstance.sort()).toBe('name');
  });

  it('filters and shows a dedicated state when nothing matches', async () => {
    seed();
    const fixture = await render();
    fixture.componentInstance.query.set('products');
    await fixture.whenStable();
    expect(names(fixture)).toEqual(['Alpha search']);
    expect(element(fixture).querySelector('.saved-count')?.textContent?.replace(/\s+/g, ' ').trim()).toBe('1 of 4');

    fixture.componentInstance.query.set('nothing-like-this');
    await fixture.whenStable();
    expect(element(fixture).textContent).toContain('No matching saved requests');
    const clear = [...element(fixture).querySelectorAll<HTMLButtonElement>('button')].find(
      (button) => button.textContent?.trim() === 'Clear filter',
    )!;
    clear.click();
    await fixture.whenStable();
    expect(names(fixture)).toHaveLength(4);
  });

  it('loads a request when its row is clicked and marks the loaded one', async () => {
    const store = seed();
    const fixture = await render();
    const load = vi.fn();
    fixture.componentInstance.load.subscribe(load);
    element(fixture).querySelector<HTMLButtonElement>('.saved-item__main')!.click();
    expect(load).toHaveBeenCalledWith(expect.objectContaining({ name: 'Alpha search' }));

    store.link('Alpha search');
    fixture.componentRef.setInput('dirty', true);
    await fixture.whenStable();
    const row = element(fixture).querySelector('.saved-item.is-selected');
    expect(row?.querySelector('[aria-current="true"]')).not.toBeNull();
    expect(row?.textContent).toContain('Edited');
  });

  it('asks before deleting, with a specific danger action', async () => {
    const store = seed();
    const fixture = await render();
    const request = store.find('Beta health')!;

    confirm.mockResolvedValueOnce(false);
    await fixture.componentInstance.remove(request);
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Delete “Beta health”?',
        tone: 'danger',
        confirmLabel: 'Delete saved request',
        items: ['GET _cluster/health'],
      }),
    );
    expect(store.find('Beta health')).toBeDefined();

    confirm.mockResolvedValueOnce(true);
    await fixture.componentInstance.remove(request);
    expect(store.find('Beta health')).toBeUndefined();
    expect(alerts.success).toHaveBeenCalledWith('Deleted “Beta health”');
    expect(localStorage.getItem(SAVED_REQUESTS_KEY)).not.toContain('Beta health');
  });

  it('duplicates and shows the raw JSON', async () => {
    const store = seed();
    const fixture = await render();
    fixture.componentInstance.duplicate(store.find('Alpha search')!);
    expect(store.find('Alpha search (copy)')).toBeDefined();
    expect(alerts.success).toHaveBeenCalledWith('Duplicated as “Alpha search (copy)”');

    fixture.componentInstance.viewJson(store.find('Alpha search')!);
    expect(showJson).toHaveBeenCalledWith(
      'Alpha search',
      expect.objectContaining({ method: 'POST', path: 'products/_search' }),
      'POST products/_search',
    );
  });

  it('warns that changes are not stored when a newer version wrote the list', async () => {
    localStorage.setItem(
      SAVED_REQUESTS_KEY,
      JSON.stringify({ version: 2, requests: [{ name: 'A', method: 'GET', path: 'x' }] }),
    );
    const fixture = await render();
    expect(element(fixture).querySelector('.saved-readonly')?.textContent).toContain(
      'Stored by a newer version of Cerebro.',
    );
    fixture.componentInstance.duplicate(TestBed.inject(RestSavedStore).find('A')!);
    expect(alerts.warn).toHaveBeenCalledWith(
      'Duplicated as “A (copy)”, but the browser did not store it',
      expect.stringContaining('newer version of Cerebro'),
    );
  });
});
