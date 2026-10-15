import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RestSavedStore, SAVED_LINK_KEY, SAVED_REQUESTS_KEY } from './rest-saved.store';
import { MAX_STORED_BODY_LENGTH } from './rest.utils';

const DRAFT = { method: 'GET' as const, path: '_cluster/health', body: '' };

describe('RestSavedStore', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({ providers: [RestSavedStore] });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function store(): RestSavedStore {
    return TestBed.inject(RestSavedStore);
  }

  function storedNames(): string[] {
    const document = JSON.parse(localStorage.getItem(SAVED_REQUESTS_KEY) ?? 'null') as {
      version: number;
      requests: { name: string }[];
    };
    expect(document.version).toBe(1);
    return document.requests.map((request) => request.name);
  }

  it('reads saved requests defensively from storage', () => {
    localStorage.setItem(
      SAVED_REQUESTS_KEY,
      JSON.stringify({ version: 1, requests: [{ name: 'A', method: 'GET', path: 'x' }, { name: 3 }] }),
    );
    localStorage.setItem(SAVED_LINK_KEY, 'a');
    const target = store();
    expect(target.requests().map((request) => request.name)).toEqual(['A']);
    expect(target.linked()?.name).toBe('A');
  });

  it('ignores storage that is not a saved requests document', () => {
    localStorage.setItem(SAVED_REQUESTS_KEY, '{oops');
    localStorage.setItem(SAVED_LINK_KEY, 'Missing');
    const target = store();
    expect(target.requests()).toEqual([]);
    expect(target.linked()).toBeNull();
  });

  it('saves, links and persists', () => {
    const target = store();
    const { saved, stored } = target.save(' Health ', DRAFT, 1);
    expect(stored).toBe(true);
    expect(saved.name).toBe('Health');
    expect(target.linked()?.name).toBe('Health');
    expect(localStorage.getItem(SAVED_LINK_KEY)).toBe('Health');
    expect(storedNames()).toEqual(['Health']);
    expect(localStorage.getItem(SAVED_REQUESTS_KEY)).not.toContain('localhost');

    // Saving again under the same name replaces it.
    target.save('HEALTH', { ...DRAFT, path: '_cat/health' }, 2);
    expect(target.requests()).toHaveLength(1);
    expect(target.requests()[0]).toMatchObject({ name: 'HEALTH', path: '_cat/health', createdAt: 1 });
  });

  it('keeps the link through a rename and drops it on delete', () => {
    const target = store();
    target.save('Health', DRAFT);
    target.save('Other', DRAFT);
    target.link('Health');
    expect(target.rename('Health', 'Cluster health')).toBe(true);
    expect(target.linked()?.name).toBe('Cluster health');
    expect(storedNames()).toEqual(['Cluster health', 'Other']);

    target.remove('Other');
    expect(target.linked()?.name).toBe('Cluster health');
    target.remove('cluster health');
    expect(target.linked()).toBeNull();
    expect(localStorage.getItem(SAVED_LINK_KEY)).toBeNull();
    expect(storedNames()).toEqual([]);
  });

  it('duplicates and marks requests as used', () => {
    const target = store();
    target.save('Health', DRAFT, 1);
    const { copy } = target.duplicate('Health', 2);
    expect(copy?.name).toBe('Health (copy)');
    target.markUsed('Health (copy)', 3);
    expect(target.find('health (COPY)')?.lastUsedAt).toBe(3);
    expect(target.duplicate('missing').copy).toBeNull();
  });

  it('imports with the chosen strategy', () => {
    const target = store();
    target.save('Health', DRAFT, 1);
    const incoming = [
      { ...target.requests()[0]!, path: '_cat/health' },
      { ...target.requests()[0]!, name: 'New' },
    ];
    const skipped = target.import(incoming, 'skip', 5);
    expect(skipped.outcome).toMatchObject({ added: 1, overwritten: 0, skipped: 1 });
    expect(target.find('Health')?.path).toBe('_cluster/health');
    const replaced = target.import(incoming, 'overwrite', 6);
    expect(replaced.outcome).toMatchObject({ added: 0, overwritten: 1, skipped: 1 });
    expect(target.find('Health')?.path).toBe('_cat/health');
    expect(storedNames()).toEqual(['Health', 'New']);
  });

  it('reports when the browser does not store a change', () => {
    const target = store();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    const { stored } = target.save('Health', DRAFT);
    expect(stored).toBe(false);
    // The page still shows it until it is reloaded.
    expect(target.requests()).toHaveLength(1);
  });

  it('follows changes made in another tab', () => {
    const target = store();
    localStorage.setItem(
      SAVED_REQUESTS_KEY,
      JSON.stringify({ version: 1, requests: [{ name: 'From another tab', method: 'GET', path: 'x' }] }),
    );
    window.dispatchEvent(new StorageEvent('storage', { key: SAVED_REQUESTS_KEY }));
    expect(target.requests().map((request) => request.name)).toEqual(['From another tab']);
    window.dispatchEvent(new StorageEvent('storage', { key: 'cerebro.theme' }));
    expect(target.count()).toBe(1);
  });

  it('never writes an entry that would be dropped when read back', () => {
    const target = store();
    target.save('Small', DRAFT, 1);
    const before = localStorage.getItem(SAVED_REQUESTS_KEY);
    const { stored } = target.save('Big bulk', { method: 'POST', path: '_bulk', body: 'x'.repeat(MAX_STORED_BODY_LENGTH + 1) }, 2);
    expect(stored).toBe(false);
    // Storage keeps the previous, valid document.
    expect(localStorage.getItem(SAVED_REQUESTS_KEY)).toBe(before);
    expect(storedNames()).toEqual(['Small']);
  });

  it('does not rewrite saved requests stored by a newer version', () => {
    const document = JSON.stringify({
      format: 'cerebro-saved-requests',
      version: 7,
      requests: [{ name: 'A', method: 'GET', path: 'x', folder: 'Ops' }],
    });
    localStorage.setItem(SAVED_REQUESTS_KEY, document);
    const target = store();
    expect(target.readOnly()).toBe(true);
    expect(target.requests().map((request) => request.name)).toEqual(['A']);
    expect(target.notStoredDetail()).toContain('newer version of Cerebro (format version 7)');

    const { stored } = target.save('B', DRAFT);
    expect(stored).toBe(false);
    expect(target.markUsed('A')).toBe(false);
    // Shown on the page, but storage (and the unknown "folder") is untouched.
    expect(target.requests()).toHaveLength(2);
    expect(localStorage.getItem(SAVED_REQUESTS_KEY)).toBe(document);
  });

  it('explains a storage failure when the document is current', () => {
    expect(store().readOnly()).toBe(false);
    expect(store().notStoredDetail()).toContain('Local storage is full or disabled');
  });
});
