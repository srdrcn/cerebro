import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AlertService } from '../../core/alert.service';
import { ClusterApiService } from '../../core/cluster-api.service';
import { IndexChecklistComponent } from './index-checklist.component';
import { SnapshotRestoreComponent } from './snapshot-restore.component';
import { SnapshotRecord } from './snapshots.models';

const snapshot: SnapshotRecord = {
  snapshot: 'nightly',
  state: 'SUCCESS',
  include_global_state: true,
  indices: ['logs-b', 'logs-a', 'orders'],
};

describe('SnapshotRestoreComponent', () => {
  const post = vi.fn();
  const alerts = { error: vi.fn(), success: vi.fn() };
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

  beforeEach(() => {
    post.mockReset();
    alerts.error.mockReset();
    alerts.success.mockReset();
    TestBed.configureTestingModule({
      providers: [
        { provide: ClusterApiService, useValue: { post } },
        { provide: AlertService, useValue: alerts },
      ],
    });
  });

  /** Routes `cat` (index statuses, aliases) and `snapshots/restore` calls. */
  function api(
    options: {
      cat?: unknown;
      catError?: Error;
      aliases?: unknown;
      restore?: unknown;
      restoreError?: Error;
    } = {},
  ): void {
    post.mockImplementation(async (path: string, body?: { api?: string }) => {
      if (path === 'cat') {
        if (options.catError) {
          throw options.catError;
        }
        return (body?.api === 'aliases' ? options.aliases : options.cat) ?? [];
      }
      if (options.restoreError) {
        throw options.restoreError;
      }
      return options.restore ?? { accepted: true };
    });
  }

  function enter(target: Element | null): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    target?.dispatchEvent(event);
    return event;
  }

  async function render(clusterIndices: string[] = []): Promise<ComponentFixture<SnapshotRestoreComponent>> {
    const fixture = TestBed.createComponent(SnapshotRestoreComponent);
    fixture.componentRef.setInput('repository', 'backups');
    fixture.componentRef.setInput('snapshot', snapshot);
    fixture.componentRef.setInput('clusterIndices', clusterIndices);
    await fixture.whenStable();
    // Let the index status request settle.
    await new Promise((resolve) => setTimeout(resolve));
    await fixture.whenStable();
    return fixture;
  }

  it('selects every index and restores the whole snapshot without the global state', async () => {
    api();
    const fixture = await render();
    const component = fixture.componentInstance;
    const restored = vi.fn();
    component.restored.subscribe(restored);

    expect(component.selectedNames()).toEqual(['logs-a', 'logs-b', 'orders']);
    expect(component.submitLabel()).toBe('Restore all 3 indices');

    await component.restore();

    expect(post).toHaveBeenCalledWith('snapshots/restore', {
      repository: 'backups',
      snapshot: 'nightly',
      ignoreUnavailable: true,
      includeAliases: true,
      includeGlobalState: false,
    });
    expect(restored).toHaveBeenCalledWith('nightly');
    expect(alerts.success).toHaveBeenCalledOnce();
  });

  it('restores a renamed subset and flags conflicts with existing indices', async () => {
    api({ cat: [{ index: 'logs-a', status: 'open' }, { index: 'restored-orders', status: 'open' }] });
    const fixture = await render(['logs-a', 'restored-orders']);
    const component = fixture.componentInstance;

    expect(post).toHaveBeenCalledWith('cat', { api: 'indices' });
    expect(component.conflicts().map((option) => option.name)).toEqual(['logs-a']);

    component.usePrefix();
    expect(component.conflicts().map((option) => option.name)).toEqual(['orders']);
    expect(component.options().find((option) => option.name === 'logs-a')?.detail).toBe('restored-logs-a');

    component.selected.set(new Set(['logs-a', 'logs-b']));
    component.includeGlobalState.set(true);
    await component.restore();

    expect(post).toHaveBeenCalledWith('snapshots/restore', {
      repository: 'backups',
      snapshot: 'nightly',
      renamePattern: '(.+)',
      renameReplacement: 'restored-$1',
      ignoreUnavailable: true,
      // Renamed copies must not join the aliases of the originals.
      includeAliases: false,
      includeGlobalState: true,
      indices: ['logs-a', 'logs-b'],
    });
  });

  it('leaves aliases out while renaming unless the user asks for them', async () => {
    api({
      aliases: [
        { alias: 'logs', index: 'logs-a', is_write_index: '-' },
        { alias: 'logs', index: 'logs-b', is_write_index: 'true' },
        { alias: 'sales', index: 'orders', is_write_index: '-' },
      ],
    });
    const fixture = await render(['logs-a', 'logs-b', 'orders']);
    const component = fixture.componentInstance;
    const element: HTMLElement = fixture.nativeElement;
    const aliasSwitch = () => element.querySelector<HTMLInputElement>('input[name=includeAliases]');

    expect(post).toHaveBeenCalledWith('cat', { api: 'aliases' });
    expect(component.includeAliases()).toBe(true);
    expect(component.aliasWarning()).toBe(false);

    component.usePrefix();
    await fixture.whenStable();
    expect(component.includeAliases()).toBe(false);
    expect(component.aliasesSkippedForRename()).toBe(true);
    expect(aliasSwitch()?.checked).toBe(false);
    expect(element.textContent).toContain('Off while renaming');

    // Clearing the rename brings the default back.
    component.clearRename();
    expect(component.includeAliases()).toBe(true);

    // An explicit choice sticks, and renaming with aliases is called out.
    component.usePrefix();
    component.setIncludeAliases(true);
    component.selected.set(new Set(['logs-a', 'logs-b']));
    await fixture.whenStable();
    expect(component.aliasWarning()).toBe(true);
    expect(component.joinedAliases()).toEqual([{ alias: 'logs', write: true }]);
    const callout = element.querySelector('.restore-side .callout-danger');
    expect(callout?.textContent).toContain('join the aliases of the original indices');
    expect(callout?.querySelector('.tag')?.textContent).toContain('logs');

    component.renamePattern.set('');
    component.renamePattern.set('(.+)');
    expect(component.includeAliases()).toBe(true);

    (callout?.querySelector('.link-button') as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(component.includeAliases()).toBe(false);
    expect(element.querySelector('.restore-side .callout-danger')).toBeNull();
  });

  it('treats closed indices as replaced, not as conflicts', async () => {
    api({ cat: [{ index: 'orders', status: 'close' }, { index: 'logs-a', status: 'open' }] });
    const fixture = await render(['orders', 'logs-a']);
    const component = fixture.componentInstance;

    expect(component.conflicts().map((target) => target.name)).toEqual(['logs-a']);
    expect(component.replacements().map((target) => target.name)).toEqual(['orders']);
    const orders = component.options().find((option) => option.name === 'orders');
    expect(orders).toMatchObject({ note: 'replaces closed' });
    expect(orders?.warn).toBeUndefined();
  });

  it('falls back to the known index names when the statuses cannot be read', async () => {
    api({ catError: new Error('forbidden') });
    const fixture = await render(['orders']);
    const component = fixture.componentInstance;

    expect(component.indexStatus()).toBeNull();
    expect(component.conflicts().map((target) => target.name)).toEqual(['orders']);
    expect(alerts.error).not.toHaveBeenCalled();
  });

  it('does not treat a pattern without a replacement as a rename', async () => {
    api({ cat: [{ index: 'logs-a', status: 'open' }] });
    const fixture = await render(['logs-a']);
    const component = fixture.componentInstance;

    component.renamePattern.set('logs-');
    expect(component.renaming()).toBe(false);
    // Elasticsearch would restore under the original names: keep the preview and the conflict.
    expect(component.options().find((option) => option.name === 'logs-a')?.detail).toBeUndefined();
    expect(component.conflicts().map((target) => target.name)).toEqual(['logs-a']);
    expect(component.replacementError()).toMatch(/ignores a pattern without one/);
    expect(component.showReplacementError()).toBe(false);

    await component.restore();
    expect(component.showReplacementError()).toBe(true);
    expect(post).not.toHaveBeenCalledWith('snapshots/restore', expect.anything());

    component.renameReplacement.set('old-');
    expect(component.renaming()).toBe(true);
    expect(component.options().find((option) => option.name === 'logs-a')?.detail).toBe('old-a');
    expect(component.conflicts()).toEqual([]);
  });

  it('never submits the restore when Enter is pressed in a text field', async () => {
    api();
    const fixture = await render();
    const element: HTMLElement = fixture.nativeElement;

    const filter = element.querySelector('cerebro-index-checklist cerebro-search input');
    expect(filter).not.toBeNull();
    expect(enter(filter).defaultPrevented).toBe(true);
    expect(enter(element.querySelector('#restore-rename-pattern')).defaultPrevented).toBe(true);
    // Buttons keep their keyboard activation.
    expect(enter(element.querySelector('button[type=submit]')).defaultPrevented).toBe(false);
    expect(post).not.toHaveBeenCalledWith('snapshots/restore', expect.anything());
  });

  it('blocks the request while the form is invalid', async () => {
    api();
    const fixture = await render();
    const component = fixture.componentInstance;

    component.selected.set(new Set());
    await component.restore();
    expect(component.selectionError()).toMatch(/at least one/);

    component.selected.set(new Set(['orders']));
    component.renamePattern.set('([');
    await component.restore();
    expect(component.patternError()).toMatch(/not a valid/);

    component.renamePattern.set('');
    component.renameReplacement.set('copy-$1');
    await component.restore();
    expect(component.replacementError()).toMatch(/pattern/);

    expect(post).not.toHaveBeenCalledWith('snapshots/restore', expect.anything());
  });

  it('keeps the dialog open when the restore fails', async () => {
    api({ restoreError: new Error('cannot restore') });
    const fixture = await render();
    const component = fixture.componentInstance;
    const closed = vi.fn();
    component.closed.subscribe(closed);

    await component.restore();

    expect(alerts.error).toHaveBeenCalledWith('Could not restore snapshot nightly: cannot restore', expect.any(Error));
    expect(component.failure()).toBe('cannot restore');
    expect(closed).not.toHaveBeenCalled();
    expect(component.restoring()).toBe(false);
  });
});

describe('IndexChecklistComponent', () => {
  it('selects and clears only the indices that match the filter', async () => {
    const fixture = TestBed.createComponent(IndexChecklistComponent);
    fixture.componentRef.setInput('options', [{ name: 'logs-1' }, { name: 'logs-2' }, { name: 'orders' }]);
    await fixture.whenStable();
    const checklist = fixture.componentInstance;

    checklist.query.set('logs');
    checklist.selectVisible(true);
    expect([...checklist.selected()].sort()).toEqual(['logs-1', 'logs-2']);

    checklist.query.set('');
    checklist.toggle('orders');
    checklist.query.set('2');
    expect(checklist.hiddenSelectedCount()).toBe(2);
    checklist.selectVisible(false);
    expect([...checklist.selected()].sort()).toEqual(['logs-1', 'orders']);
    expect(checklist.selectedCount()).toBe(2);
  });

  it('filters on Enter instead of submitting the surrounding form', async () => {
    const fixture = TestBed.createComponent(IndexChecklistComponent);
    fixture.componentRef.setInput('options', [{ name: 'logs-1' }]);
    await fixture.whenStable();
    const input = (fixture.nativeElement as HTMLElement).querySelector('cerebro-search input');
    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });

    input?.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
  });
});
