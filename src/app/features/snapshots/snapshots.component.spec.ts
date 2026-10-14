import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Router, provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AlertService } from '../../core/alert.service';
import { ClusterApiError } from '../../core/api-envelope';
import { ClusterApiService } from '../../core/cluster-api.service';
import { DialogService } from '../../core/dialog.service';
import { readPreference, removePreference, writePreference } from '../../core/preferences';
import { MenuComponent } from '../../shared/menu.component';
import { SnapshotsComponent } from './snapshots.component';
import { SnapshotLandingData, SnapshotRecord } from './snapshots.models';

const PREFERENCE = 'cerebro.snapshots.repository';

const landing: SnapshotLandingData = {
  indices: [
    { name: 'logs', special: false },
    { name: 'products', special: false },
    { name: '.kibana', special: true },
  ],
  repositories: ['beta', 'alpha'],
};

function snapshot(name: string, extra: Partial<SnapshotRecord> = {}): SnapshotRecord {
  return { snapshot: name, uuid: `${name}-uuid`, state: 'SUCCESS', indices: ['logs'], ...extra };
}

describe('SnapshotsComponent', () => {
  const post = vi.fn();
  const alerts = { error: vi.fn(), success: vi.fn(), info: vi.fn(), warn: vi.fn() };
  const dialogs = { confirm: vi.fn(), showJson: vi.fn() };

  beforeEach(() => {
    post.mockReset();
    Object.values(alerts).forEach((mock) => mock.mockReset());
    dialogs.confirm.mockReset();
    dialogs.showJson.mockReset();
    removePreference(PREFERENCE);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: ClusterApiService, useValue: { post } },
        { provide: AlertService, useValue: alerts },
        { provide: DialogService, useValue: dialogs },
      ],
    });
  });

  afterEach(() => removePreference(PREFERENCE));

  function component(): SnapshotsComponent {
    return TestBed.runInInjectionContext(() => new SnapshotsComponent());
  }

  function respond(snapshots: Record<string, SnapshotRecord[]>): void {
    post.mockImplementation(async (path: string, body?: { repository?: string }) => {
      if (path === 'snapshots') {
        return landing;
      }
      if (path === 'snapshots/load') {
        return snapshots[body?.repository ?? ''] ?? [];
      }
      return { accepted: true };
    });
  }

  it('sorts repositories and opens the first one by default', async () => {
    respond({ alpha: [snapshot('one')] });
    const target = component();

    await target.load();

    expect(target.repositories()).toEqual(['alpha', 'beta']);
    expect(target.repository()).toBe('alpha');
    expect(post).toHaveBeenCalledWith('snapshots/load', { repository: 'alpha' });
    expect(target.snapshots()?.map((item) => item.snapshot)).toEqual(['one']);
    expect(target.createRepository()).toBe('alpha');
  });

  it('puts the automatically picked repository in the URL and remembers it', async () => {
    respond({ alpha: [] });
    const router = TestBed.inject(Router);
    const target = component();

    await target.load();

    await vi.waitFor(() => expect(router.url).toContain('repository=alpha'));
    expect(readPreference(PREFERENCE)).toBe('alpha');
  });

  it('starts every repository with a clean filter', async () => {
    respond({ alpha: [snapshot('one')], beta: [snapshot('two')] });
    const router = TestBed.inject(Router);
    const target = component();
    await target.load();
    target.setQuery('one');
    target.toggleState('SUCCESS');

    target.selectRepository('beta');

    expect(target.query()).toBe('');
    expect(target.hiddenStates().size).toBe(0);
    expect(readPreference(PREFERENCE)).toBe('beta');
    await vi.waitFor(() => expect(router.url).toContain('repository=beta'));
  });

  it('holds back reloads while a row menu is open', async () => {
    respond({ alpha: [snapshot('one')] });
    const fixture = TestBed.createComponent(SnapshotsComponent);
    const target = fixture.componentInstance;
    await target.load();
    await fixture.whenStable();
    const menu = fixture.debugElement.query(By.directive(MenuComponent)).componentInstance as MenuComponent;

    menu.open.set(true);
    respond({ alpha: [snapshot('one'), snapshot('two')] });
    await target.loadSnapshots('alpha');
    await fixture.whenStable();
    expect(target.snapshots()?.map((item) => item.snapshot)).toEqual(['one']);

    menu.open.set(false);
    await fixture.whenStable();
    expect(target.snapshots()?.map((item) => item.snapshot)).toEqual(['one', 'two']);
  });

  it('opens the remembered repository', async () => {
    writePreference(PREFERENCE, 'beta');
    respond({ beta: [snapshot('two')] });
    const target = component();

    await target.load();

    expect(target.repository()).toBe('beta');
    expect(target.snapshots()?.map((item) => item.snapshot)).toEqual(['two']);
  });

  it('follows ?repository= when it changes while the page is open', async () => {
    respond({ alpha: [snapshot('one')], beta: [snapshot('two')] });
    const router = TestBed.inject(Router);
    const target = component();
    await target.load();
    await vi.waitFor(() => expect(router.url).toContain('repository=alpha'));
    // The page's own URL update is not mistaken for a navigation.
    expect(target.repository()).toBe('alpha');

    await router.navigateByUrl('/?repository=beta');
    expect(target.repository()).toBe('beta');
    await vi.waitFor(() => expect(target.snapshots()?.map((item) => item.snapshot)).toEqual(['two']));

    // An unknown repository reloads the list and puts the shown one back.
    const landingCalls = post.mock.calls.filter(([path]) => path === 'snapshots').length;
    await router.navigateByUrl('/?repository=gone');
    await vi.waitFor(() => expect(router.url).toContain('repository=beta'));
    expect(post.mock.calls.filter(([path]) => path === 'snapshots').length).toBe(landingCalls + 1);
    expect(target.repository()).toBe('beta');
  });

  it('opens a repository from the URL once it shows up in the list', async () => {
    respond({ alpha: [] });
    const router = TestBed.inject(Router);
    const target = component();
    await target.load();

    post.mockImplementation(async (path: string, body?: { repository?: string }) => {
      if (path === 'snapshots') {
        return { ...landing, repositories: [...landing.repositories, 'fresh'] };
      }
      return body?.repository === 'fresh' ? [snapshot('new')] : [];
    });
    await router.navigateByUrl('/?repository=fresh');

    await vi.waitFor(() => expect(target.repository()).toBe('fresh'));
    await vi.waitFor(() => expect(target.snapshots()?.map((item) => item.snapshot)).toEqual(['new']));
    expect(router.url).toContain('repository=fresh');
  });

  it('never shows the snapshots of a repository that is no longer selected', async () => {
    respond({});
    const target = component();
    await target.load();

    let resolveAlpha: (value: SnapshotRecord[]) => void = () => undefined;
    post.mockImplementation((path: string, body?: { repository?: string }) => {
      if (body?.repository === 'alpha') {
        return new Promise<SnapshotRecord[]>((resolve) => (resolveAlpha = resolve));
      }
      return Promise.resolve([snapshot('from-beta')]);
    });
    const slow = target.loadSnapshots('alpha');
    target.selectRepository('beta');
    await Promise.resolve();
    resolveAlpha([snapshot('from-alpha')]);
    await slow;
    await vi.waitFor(() => expect(target.snapshots()?.[0]?.snapshot).toBe('from-beta'));
    expect(target.repository()).toBe('beta');
  });

  it('filters, sorts newest first and summarises the list', async () => {
    respond({
      alpha: [
        snapshot('old', { start_time_in_millis: 1_000, state: 'FAILED' }),
        snapshot('new', { start_time_in_millis: 9_000, indices: ['products'] }),
      ],
    });
    const target = component();
    await target.load();

    expect(target.rows().map((row) => row.record.snapshot)).toEqual(['new', 'old']);
    expect(target.summary().problems).toBe(1);
    expect(target.stateChips().map((chip) => chip.state)).toEqual(['SUCCESS', 'FAILED']);

    target.setQuery('products');
    expect(target.rows().map((row) => row.record.snapshot)).toEqual(['new']);

    target.setQuery('');
    target.toggleState('SUCCESS');
    expect(target.rows().map((row) => row.record.snapshot)).toEqual(['old']);
    expect(target.filtersActive()).toBe(true);
  });

  it('sorts names alphabetically first and counts largest first', async () => {
    respond({
      alpha: [
        snapshot('b', { start_time_in_millis: 1_000, indices: ['x', 'y'] }),
        snapshot('a', { start_time_in_millis: 9_000, indices: ['x'] }),
      ],
    });
    const target = component();
    await target.load();
    expect(target.sort.ariaSort('start')).toBe('descending');

    target.sort.sortBy('name');
    expect(target.rows().map((row) => row.record.snapshot)).toEqual(['a', 'b']);
    expect(target.sort.ariaSort('name')).toBe('ascending');
    expect(target.sortDescription()).toBe('Sorted by name, A to Z');

    target.sort.sortBy('indices');
    expect(target.rows().map((row) => row.record.snapshot)).toEqual(['b', 'a']);
    expect(target.sort.ariaSort('indices')).toBe('descending');
  });

  it('creates a snapshot of the chosen visible indices only', async () => {
    respond({ alpha: [] });
    const target = component();
    await target.load();

    target.createName.set('nightly-1');
    target.createScope.set('selected');
    target.createSelected.set(new Set(['logs', '.kibana']));
    target.createIncludeGlobalState.set(false);
    await target.create();

    expect(post).toHaveBeenCalledWith('snapshots/create', {
      repository: 'alpha',
      snapshot: 'nightly-1',
      ignoreUnavailable: false,
      includeGlobalState: false,
      indices: ['logs'],
    });
    expect(alerts.success).toHaveBeenCalledOnce();
    expect(target.createName()).not.toBe('nightly-1');
  });

  it('snapshots every index when the scope is "all"', async () => {
    respond({ alpha: [] });
    const target = component();
    await target.load();
    target.createName.set('full');
    target.createSelected.set(new Set(['logs']));

    await target.create();

    expect(post).toHaveBeenCalledWith('snapshots/create', {
      repository: 'alpha',
      snapshot: 'full',
      ignoreUnavailable: false,
      includeGlobalState: true,
    });
  });

  it('does not send invalid or duplicate names', async () => {
    respond({ alpha: [snapshot('taken')] });
    const target = component();
    await target.load();

    const nameField = document.body.appendChild(document.createElement('input'));
    nameField.id = 'create-snapshot-name';
    target.createName.set('Taken Name');
    await target.create();
    expect(document.activeElement).toBe(nameField);
    nameField.remove();
    target.createName.set('taken');
    expect(target.nameError()).toMatch(/already exists/);
    await target.create();

    expect(post).not.toHaveBeenCalledWith('snapshots/create', expect.anything());
    expect(target.createSubmitted()).toBe(true);
  });

  it('deletes a snapshot only after confirmation', async () => {
    respond({ alpha: [snapshot('one')] });
    const target = component();
    await target.load();
    const record = target.snapshots()![0]!;

    dialogs.confirm.mockResolvedValueOnce(false);
    await target.remove(record);
    expect(post).not.toHaveBeenCalledWith('snapshots/delete', expect.anything());

    dialogs.confirm.mockResolvedValueOnce(true);
    await target.remove(record);
    expect(dialogs.confirm).toHaveBeenLastCalledWith(
      expect.objectContaining({ tone: 'danger', confirmLabel: 'Delete snapshot' }),
    );
    expect(post).toHaveBeenCalledWith('snapshots/delete', { repository: 'alpha', snapshot: 'one' });
    expect(target.deleting().size).toBe(0);
  });

  it('polls the repository until running snapshots finish', async () => {
    vi.useFakeTimers();
    try {
      let listings = 0;
      post.mockImplementation(async (path: string) => {
        if (path === 'snapshots') {
          return landing;
        }
        listings += 1;
        return [snapshot('run', { state: listings === 1 ? 'IN_PROGRESS' : 'SUCCESS' })];
      });
      const target = component();
      await target.load();
      expect(target.summary().running).toBe(1);

      await vi.advanceTimersByTimeAsync(3_000);
      expect(listings).toBe(2);
      expect(target.snapshots()?.[0]?.state).toBe('SUCCESS');

      await vi.advanceTimersByTimeAsync(10_000);
      expect(listings).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports a failed snapshot listing without hiding the repositories', async () => {
    post.mockImplementation(async (path: string) => {
      if (path === 'snapshots') {
        return landing;
      }
      throw new ClusterApiError(404, { error: 'missing' });
    });
    const target = component();

    await target.load();

    expect(target.landing()).toBeDefined();
    expect(target.snapshotsFailed()).toBe(true);
    expect(target.snapshots()).toBeUndefined();
    expect(alerts.error).toHaveBeenCalledWith('Could not load the snapshots of alpha', expect.any(ClusterApiError));
  });
});
