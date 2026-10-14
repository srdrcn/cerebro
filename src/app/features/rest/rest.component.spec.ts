import { ElementRef, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AlertService } from '../../core/alert.service';
import { ClipboardService } from '../../core/clipboard.service';
import { ClusterApiService } from '../../core/cluster-api.service';
import { ConnectionService } from '../../core/connection.service';
import { DialogService } from '../../core/dialog.service';
import { RestSavedStore } from './rest-saved.store';
import { RestComponent } from './rest.component';
import { MAX_STORED_BODY_LENGTH } from './rest.utils';

describe('RestComponent', () => {
  const post = vi.fn();
  const rawPost = vi.fn();
  const confirm = vi.fn();
  const copy = vi.fn();
  const alerts = { error: vi.fn(), info: vi.fn(), warn: vi.fn(), success: vi.fn() };
  const host = signal('http://localhost:9200');

  beforeEach(() => {
    for (const mock of [post, rawPost, confirm, copy, ...Object.values(alerts)]) {
      mock.mockReset();
    }
    host.set('http://localhost:9200');
    try {
      localStorage.clear();
    } catch {
      // ignore
    }
    post.mockImplementation(async (path: string) => {
      if (path === 'rest') {
        return { host: 'http://localhost:9200', indices: ['products'] };
      }
      if (path === 'rest/history') {
        return [];
      }
      throw new Error(`Unexpected path ${path}`);
    });
    TestBed.configureTestingModule({
      providers: [
        { provide: ElementRef, useValue: new ElementRef(document.createElement('cerebro-rest')) },
        { provide: ClusterApiService, useValue: { post, rawPost } },
        { provide: AlertService, useValue: alerts },
        { provide: ClipboardService, useValue: { copy } },
        { provide: DialogService, useValue: { confirm } },
        RestSavedStore,
        {
          provide: ConnectionService,
          useValue: { host, connected: signal(true) },
        },
      ],
    });
  });

  function component(): RestComponent {
    return TestBed.runInInjectionContext(() => new RestComponent());
  }

  it('sends the request without a body when the editor is empty', async () => {
    rawPost.mockResolvedValue({ status: 200, body: { status: 'green' } });
    const target = component();
    target.path.set('/_cluster/health');
    const before = post.mock.calls.length;

    await target.send();

    expect(rawPost).toHaveBeenCalledWith('rest/request', { method: 'GET', path: '_cluster/health' });
    const response = target.response();
    expect(response?.status).toBe(200);
    expect(response?.json).toBe(true);
    expect(response?.text).toContain('"status": "green"');
    // The stored history is reloaded after a successful request.
    expect(post.mock.calls.slice(before)).toEqual([['rest/history']]);
    expect(target.sending()).toBe(false);
  });

  it('shows Elasticsearch errors with their status and does not record them', async () => {
    rawPost.mockResolvedValue({ status: 404, body: { error: 'index_not_found_exception' } });
    const target = component();
    target.method.set('POST');
    target.path.set('missing/_search');
    target.body.set('{"size":1}');
    const historyLoads = () => post.mock.calls.filter(([path]) => path === 'rest/history').length;
    const before = historyLoads();

    await target.send();

    expect(rawPost).toHaveBeenCalledWith('rest/request', {
      method: 'POST',
      path: 'missing/_search',
      data: { size: 1 },
    });
    expect(target.response()?.status).toBe(404);
    expect(historyLoads()).toBe(before);
  });

  it('refuses an empty path and asks before sending invalid JSON as raw text', async () => {
    const target = component();
    await target.send();
    expect(alerts.warn).toHaveBeenCalledTimes(1);

    target.path.set('_search');
    target.body.set('{oops');
    confirm.mockResolvedValueOnce(false);
    await target.send();
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ confirmLabel: 'Send as raw text' }));
    expect(rawPost).not.toHaveBeenCalled();

    rawPost.mockResolvedValue({ status: 400, body: { error: 'parse' } });
    confirm.mockResolvedValueOnce(true);
    await target.send();
    expect(rawPost).toHaveBeenCalledWith('rest/request', { method: 'GET', path: '_search', data: '{oops' });
  });

  it('retries the failed _cat request, not the edited one, with format=json', async () => {
    rawPost.mockResolvedValueOnce({ status: 500, body: { error: 'Unexpected character' } });
    const target = component();
    target.path.set('_cat/health');
    await target.send();
    expect(target.canUseJsonFormat()).toBe(true);

    target.method.set('POST');
    target.path.set('products/_count');
    rawPost.mockResolvedValueOnce({ status: 200, body: [] });
    await target.useJsonFormat();

    expect(rawPost).toHaveBeenLastCalledWith('rest/request', {
      method: 'GET',
      path: '_cat/health?format=json',
    });
    expect(target.path()).toBe('_cat/health?format=json');
  });

  it('does not ask for confirmation when deleting a wildcard alias', async () => {
    rawPost.mockResolvedValue({ status: 200, body: { acknowledged: true } });
    const target = component();
    target.method.set('DELETE');
    target.path.set('tmp-rest-*/_alias/x');

    await target.send();

    expect(confirm).not.toHaveBeenCalled();
    expect(rawPost).toHaveBeenCalled();
  });

  it('falls back to GET for history entries with an unknown method', () => {
    const target = component();
    target.restore({ method: 'HEAD', path: 'products', body: '{}', created_at: '' });
    expect(target.method()).toBe('GET');
  });

  it('confirms DELETE requests that drop whole indices', async () => {
    confirm.mockResolvedValue(false);
    const target = component();
    target.method.set('DELETE');
    target.path.set('tmp-rest-*');

    await target.send();

    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ tone: 'danger', items: ['tmp-rest-*'] }));
    expect(rawPost).not.toHaveBeenCalled();
  });

  it('reports unreachable servers without a status', async () => {
    rawPost.mockRejectedValue({ message: 'Http failure response for rest/request: 0 Unknown Error' });
    const target = component();
    target.path.set('_cat/indices?format=json');

    await target.send();

    expect(target.response()?.status).toBeNull();
    expect(target.response()?.hint).toContain('could not reach');
    expect(target.sending()).toBe(false);
  });

  it('restores history entries into the editor', () => {
    const target = component();
    target.tab.set('history');
    target.restore({ method: 'POST', path: '_bulk', body: '{"index":{}}\n{"a":1}', created_at: '' });

    expect(target.method()).toBe('POST');
    expect(target.path()).toBe('_bulk');
    expect(target.body()).toBe('{"index":{}}\n{"a":1}\n');
    expect(target.tab()).toBe('body');
  });

  it('copies the request as cURL using the endpoint host', async () => {
    const target = component();
    await target.loadIndex();
    target.path.set('products/_search');
    target.body.set('{"size":1}');

    await target.copyAsCurl();

    expect(copy).toHaveBeenCalledWith(
      expect.stringContaining("--url 'http://localhost:9200/products/_search'"),
      expect.any(Function),
      expect.any(Function),
    );
  });

  it('closes the path suggestions on Tab and lets focus move on', () => {
    const target = component();
    target.openSuggestions();
    expect(target.showSuggestions()).toBe(true);

    const tab = new KeyboardEvent('keydown', { key: 'Tab', cancelable: true });
    target.onPathKeydown(tab);

    expect(tab.defaultPrevented).toBe(false);
    expect(target.showSuggestions()).toBe(false);
  });

  it('accepts the highlighted path suggestion on Tab', () => {
    const target = component();
    target.openSuggestions();
    target.onPathKeydown(new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true }));
    const option = target.suggestions()[0];

    const tab = new KeyboardEvent('keydown', { key: 'Tab', cancelable: true });
    target.onPathKeydown(tab);

    expect(tab.defaultPrevented).toBe(true);
    expect(target.path()).toBe(option);
  });

  it('forgets the previous cluster when the host changes', async () => {
    const target = component();
    TestBed.tick();
    await target.loadIndex();
    expect(target.endpoint()).toBe('http://localhost:9200');
    rawPost.mockResolvedValue({ status: 200, body: {} });
    target.path.set('_cluster/health');
    await target.send();
    expect(target.response()).not.toBeNull();

    post.mockImplementation(async (path: string) => {
      if (path === 'rest') {
        throw new Error('forbidden');
      }
      return [];
    });
    host.set('http://other:9200');
    TestBed.tick();
    await Promise.resolve();

    expect(target.response()).toBeNull();
    expect(target.endpoint()).toBe('');
    expect(target.prefix()).toBe('other:9200/');
  });

  describe('saved requests', () => {
    function file(name: string, text: string): HTMLInputElement {
      const input = document.createElement('input');
      input.type = 'file';
      const value = new File([text], name, { type: 'application/json' });
      Object.defineProperty(input, 'files', { value: [value], configurable: true });
      return input;
    }

    it('asks for a name pre-filled from the method and path', () => {
      const target = component();
      target.openSaveDialog();
      expect(alerts.warn).toHaveBeenCalledWith('Enter a request path before saving the request');
      expect(target.nameDialog()).toBeNull();

      target.method.set('POST');
      target.path.set('products/_search?size=1');
      target.openSaveDialog();
      expect(target.nameDialog()).toMatchObject({ mode: 'save', initialName: 'POST products/_search' });
    });

    it('saves, links and tracks unsaved changes', () => {
      const target = component();
      target.path.set('_cluster/health');
      target.openSaveDialog();
      const dialog = target.nameDialog()!;
      target.onNameSubmitted(dialog, { name: 'Health', overwrite: false });

      expect(alerts.success).toHaveBeenCalledWith('Saved “Health”');
      expect(target.linked()?.name).toBe('Health');
      expect(target.linkedDirty()).toBe(false);
      expect(localStorage.getItem('cerebro.rest-saved')).toContain('"Health"');

      target.path.set('_cluster/health?level=indices');
      expect(target.linkedDirty()).toBe(true);
      target.onSaveShortcut();
      expect(alerts.success).toHaveBeenLastCalledWith('Updated “Health”');
      expect(target.linked()?.path).toBe('_cluster/health?level=indices');
      expect(target.linkedDirty()).toBe(false);

      // Nothing to update: a hint instead of a dialog.
      target.nameDialog.set(null);
      target.onSaveShortcut();
      expect(alerts.info).toHaveBeenCalledWith('“Health” has no unsaved changes');
      expect(target.nameDialog()).toBeNull();
    });

    it('reverts to the saved version and stops tracking on request', () => {
      const target = component();
      target.path.set('_cluster/health');
      target.onNameSubmitted(
        { mode: 'save', initialName: '', renaming: '', request: target.draft() },
        { name: 'Health', overwrite: false },
      );
      target.body.set('{"x":1}');
      target.revertLinked();
      expect(target.body()).toBe('');
      expect(target.linkedDirty()).toBe(false);
      target.unlink();
      expect(target.linked()).toBeNull();
      // Ctrl+S without a link opens the save dialog.
      target.onSaveShortcut();
      expect(target.nameDialog()?.mode).toBe('save');
    });

    it('loads a saved request and marks it as used', async () => {
      const store = TestBed.inject(RestSavedStore);
      const target = component();
      store.save('Search', { method: 'POST', path: 'products/_search', body: '{"size":1}' }, 1);
      store.link(null);
      target.tab.set('saved');

      await target.loadSaved(store.find('Search')!);

      expect(target.method()).toBe('POST');
      expect(target.path()).toBe('products/_search');
      expect(target.body()).toBe('{"size":1}');
      expect(target.tab()).toBe('body');
      expect(target.linked()?.name).toBe('Search');
      expect(store.find('Search')!.lastUsedAt).toBeGreaterThan(1);
    });

    it('asks before loading over unsaved changes', async () => {
      const store = TestBed.inject(RestSavedStore);
      const target = component();
      store.save('A', { method: 'GET', path: 'a', body: '' });
      store.save('B', { method: 'GET', path: 'b', body: '' });
      store.link(null);
      await target.loadSaved(store.find('A')!);
      expect(confirm).not.toHaveBeenCalled();
      target.path.set('a/changed');

      confirm.mockResolvedValueOnce(false);
      await target.loadSaved(store.find('B')!);
      expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ confirmLabel: 'Discard and load' }));
      expect(target.path()).toBe('a/changed');

      confirm.mockResolvedValueOnce(true);
      await target.loadSaved(store.find('B')!);
      expect(target.path()).toBe('b');
      expect(target.linked()?.name).toBe('B');
    });

    it('stops tracking when a history entry or example replaces the request', () => {
      const store = TestBed.inject(RestSavedStore);
      const target = component();
      store.save('Health', { method: 'GET', path: '_cluster/health', body: '' });
      expect(target.linked()?.name).toBe('Health');
      target.useExample({ label: 'Health', method: 'GET', path: '_cluster/health', body: '' });
      expect(target.linked()?.name).toBe('Health');
      target.restore({ method: 'GET', path: '_nodes', body: '{}', created_at: '' });
      expect(target.linked()).toBeNull();
    });

    it('renames a saved request', () => {
      const store = TestBed.inject(RestSavedStore);
      const target = component();
      store.save('Health', { method: 'GET', path: '_cluster/health', body: '' });
      target.openRenameDialog(store.find('Health')!);
      const dialog = target.nameDialog()!;
      expect(dialog).toMatchObject({ mode: 'rename', initialName: 'Health', renaming: 'Health' });
      target.onNameSubmitted(dialog, { name: 'Cluster health', overwrite: false });
      expect(store.find('Cluster health')).toBeDefined();
      expect(target.linked()?.name).toBe('Cluster health');
      expect(alerts.success).toHaveBeenLastCalledWith('Renamed to “Cluster health”');
    });

    it('imports files without conflicts right away', async () => {
      const target = component();
      await target.onImportFile(
        file('saved.json', JSON.stringify([{ name: 'A', method: 'GET', path: 'x' }, { name: 1 }])),
      );
      expect(target.importState()).toBeNull();
      expect(alerts.success).toHaveBeenCalledWith('Imported 1 saved request', '1 invalid entry ignored');
      expect(target.tab()).toBe('saved');
    });

    it('lets the user decide about conflicting names', async () => {
      const store = TestBed.inject(RestSavedStore);
      const target = component();
      store.save('A', { method: 'GET', path: 'old', body: '' });
      await target.onImportFile(file('saved.json', JSON.stringify([{ name: 'a', method: 'GET', path: 'new' }])));
      const state = target.importState();
      expect(state?.plan.conflicts).toEqual(['A']);
      expect(state?.fileName).toBe('saved.json');

      target.onImportConfirmed(state!, 'overwrite');
      expect(store.find('A')?.path).toBe('new');
      expect(alerts.success).toHaveBeenLastCalledWith('Imported 1 saved request', '1 replaced');
    });

    it('explains files that cannot be imported', async () => {
      const target = component();
      await target.onImportFile(file('notes.json', 'not json'));
      expect(alerts.error).toHaveBeenCalledWith('“notes.json” cannot be imported', 'The file is not valid JSON.');
      expect(TestBed.inject(RestSavedStore).count()).toBe(0);
    });

    it('exports saved requests as a JSON download', async () => {
      const store = TestBed.inject(RestSavedStore);
      const target = component();
      target.exportSaved();
      expect(alerts.info).toHaveBeenCalledWith('There are no saved requests to export yet');

      store.save('A', { method: 'GET', path: 'x', body: '' });
      const createObjectURL = vi.fn((blob: Blob) => {
        void blob;
        return 'blob:saved';
      });
      const revokeObjectURL = vi.fn();
      Object.assign(URL, { createObjectURL, revokeObjectURL });
      const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

      target.exportSaved();

      expect(click).toHaveBeenCalledTimes(1);
      const blob = createObjectURL.mock.calls[0]![0];
      const document = JSON.parse(await blob.text()) as { version: number; requests: { name: string }[] };
      expect(document.version).toBe(1);
      expect(document.requests.map((request) => request.name)).toEqual(['A']);
      expect(alerts.success).toHaveBeenLastCalledWith(
        'Exported 1 saved request',
        expect.stringMatching(/^cerebro-saved-requests-\d{4}-\d{2}-\d{2}\.json$/),
      );
      click.mockRestore();
    });

    it('refuses to save a body that storage would not keep', () => {
      const store = TestBed.inject(RestSavedStore);
      const target = component();
      target.method.set('POST');
      target.path.set('_bulk');
      target.body.set('x'.repeat(MAX_STORED_BODY_LENGTH + 1));

      target.openSaveDialog();
      expect(target.nameDialog()).toBeNull();
      expect(alerts.warn).toHaveBeenCalledWith(
        'The body is too large to save',
        expect.stringContaining('at most 200,000 characters'),
      );

      // Updating a linked request (button or Ctrl+S) is refused the same way.
      store.save('Bulk', { method: 'POST', path: '_bulk', body: '' });
      alerts.warn.mockReset();
      target.onSaveShortcut();
      expect(alerts.warn).toHaveBeenCalledWith('The body is too large to save', expect.any(String));
      expect(alerts.success).not.toHaveBeenCalled();
      expect(store.find('Bulk')?.body).toBe('');
    });

    it('asks before reloading the loaded request over unsaved changes', async () => {
      const store = TestBed.inject(RestSavedStore);
      const target = component();
      store.save('Health', { method: 'GET', path: '_cluster/health', body: '' });
      target.path.set('_cluster/health?level=indices');
      expect(target.linkedDirty()).toBe(true);

      confirm.mockResolvedValueOnce(false);
      await target.loadSaved(store.find('Health')!);
      expect(confirm).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Discard the changes to “Health”?',
          confirmLabel: 'Discard changes',
          cancelLabel: 'Keep editing',
        }),
      );
      expect(target.path()).toBe('_cluster/health?level=indices');

      confirm.mockResolvedValueOnce(true);
      await target.loadSaved(store.find('Health')!);
      expect(target.path()).toBe('_cluster/health');
      expect(target.linkedDirty()).toBe(false);

      // Without changes it loads right away.
      confirm.mockReset();
      await target.loadSaved(store.find('Health')!);
      expect(confirm).not.toHaveBeenCalled();
    });

    describe('Ctrl/⌘+S', () => {
      function press(init: KeyboardEventInit = {}): KeyboardEvent {
        const event = new KeyboardEvent('keydown', {
          key: 's',
          code: 'KeyS',
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
          ...init,
        });
        document.body.dispatchEvent(event);
        return event;
      }

      it('opens the save dialog instead of the browser one', () => {
        const target = component();
        target.path.set('_cluster/health');
        const event = press();
        expect(event.defaultPrevented).toBe(true);
        expect(target.nameDialog()?.mode).toBe('save');
      });

      it('updates the linked request when it has changes, and says so when it has none', () => {
        const store = TestBed.inject(RestSavedStore);
        const target = component();
        store.save('Health', { method: 'GET', path: '_cluster/health', body: '' });
        target.path.set('_cluster/health');

        press({ ctrlKey: false, metaKey: true });
        expect(alerts.info).toHaveBeenCalledWith('“Health” has no unsaved changes');
        expect(target.nameDialog()).toBeNull();

        target.path.set('_cluster/health?local=true');
        press();
        expect(alerts.success).toHaveBeenCalledWith('Updated “Health”');
        expect(store.find('Health')?.path).toBe('_cluster/health?local=true');
      });

      it('works with non-Latin keyboard layouts', () => {
        const target = component();
        target.path.set('_cat/indices');
        const event = press({ key: 'ы', code: 'KeyS' });
        expect(event.defaultPrevented).toBe(true);
        expect(target.nameDialog()).not.toBeNull();
      });

      it('is ignored while a dialog is open, and leaves other shortcuts alone', () => {
        const target = component();
        target.path.set('_cluster/health');
        const dialog = document.createElement('dialog');
        dialog.setAttribute('open', '');
        document.body.appendChild(dialog);
        try {
          const event = press();
          // The browser's own "Save page" still does not open.
          expect(event.defaultPrevented).toBe(true);
          expect(target.nameDialog()).toBeNull();
        } finally {
          dialog.remove();
        }

        expect(press({ shiftKey: true }).defaultPrevented).toBe(false);
        expect(press({ ctrlKey: false }).defaultPrevented).toBe(false);
        expect(press({ key: 'd', code: 'KeyD' }).defaultPrevented).toBe(false);
        expect(target.nameDialog()).toBeNull();
      });
    });

    it('cycles through the three tabs with the arrow keys', () => {
      const target = component();
      const press = (key: string) =>
        target.onTabKeydown(new KeyboardEvent('keydown', { key, cancelable: true }));
      press('ArrowRight');
      expect(target.tab()).toBe('history');
      press('ArrowRight');
      expect(target.tab()).toBe('saved');
      press('ArrowRight');
      expect(target.tab()).toBe('body');
      press('ArrowLeft');
      expect(target.tab()).toBe('saved');
      press('Home');
      expect(target.tab()).toBe('body');
      press('End');
      expect(target.tab()).toBe('saved');
    });
  });
});
