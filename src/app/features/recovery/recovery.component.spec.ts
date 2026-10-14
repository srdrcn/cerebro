import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AlertService } from '../../core/alert.service';
import { ClusterApiService } from '../../core/cluster-api.service';
import { DialogService } from '../../core/dialog.service';
import { RefreshService } from '../../core/refresh.service';
import { RawRecoveryRow } from './recovery.models';
import { RecoveryComponent } from './recovery.component';

function row(index: string, stage: string, recovered = '0'): RawRecoveryRow {
  return {
    index,
    shard: '0',
    time: '1000',
    type: 'peer',
    stage,
    source_node: 'es-node-1',
    target_node: 'es-node-2',
    files: '2',
    files_recovered: '1',
    files_percent: '50%',
    files_total: '2',
    bytes: '1000',
    bytes_recovered: recovered,
    bytes_percent: `${Number(recovered) / 10}%`,
    bytes_total: '1000',
    translog_ops: '0',
    translog_ops_recovered: '0',
    translog_ops_percent: '100%',
  };
}

describe('RecoveryComponent', () => {
  const post = vi.fn();
  const alerts = { error: vi.fn(), success: vi.fn(), info: vi.fn(), warn: vi.fn() };
  const dialogs = { confirm: vi.fn(), showJson: vi.fn() };
  let destroy: (() => void) | undefined;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    post.mockReset();
    alerts.error.mockReset();
    dialogs.showJson.mockReset();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: ClusterApiService, useValue: { post } },
        { provide: AlertService, useValue: alerts },
        { provide: DialogService, useValue: dialogs },
      ],
    });
  });

  afterEach(() => {
    destroy?.();
    destroy = undefined;
    vi.useRealTimers();
  });

  function component(): RecoveryComponent {
    TestBed.inject(RefreshService).setInterval(15_000);
    const target = TestBed.runInInjectionContext(() => new RecoveryComponent());
    destroy = () => TestBed.resetTestingModule();
    return target;
  }

  it('loads active recoveries and groups them by index', async () => {
    post.mockResolvedValue([row('logs', 'index', '250'), row('metrics', 'translog', '1000')]);
    const target = component();

    await target.load();

    expect(post).toHaveBeenCalledWith('recovery', { active_only: true });
    expect(target.groups().map((group) => group.index)).toEqual(['logs', 'metrics']);
    expect(target.summary()).toMatchObject({ active: 2, bytesRemaining: 750 });
    expect(target.live()).toBe(true);
    expect(target.throughput()).toBeNull();
  });

  it('measures throughput between polls and keeps polling while recoveries run', async () => {
    post.mockResolvedValueOnce([row('logs', 'index', '100')]).mockResolvedValue([row('logs', 'index', '600')]);
    const target = component();

    await target.load();
    await vi.advanceTimersByTimeAsync(2_000);

    expect(post).toHaveBeenCalledTimes(2);
    expect(target.throughput()).toBe(250);
    expect(target.eta()).toBe(1_600);
  });

  it('stops fast polling when nothing is running', async () => {
    post.mockResolvedValue([row('logs', 'done', '1000')]);
    const target = component();

    await target.load();
    await vi.advanceTimersByTimeAsync(5_000);

    expect(target.live()).toBe(false);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('switches to all recoveries and resets the data', async () => {
    post.mockResolvedValue([]);
    const target = component();
    await target.load();
    expect(target.recoveries()).toEqual([]);

    target.setMode('all');
    expect(target.recoveries()).toBeUndefined();
    await vi.waitFor(() => expect(post).toHaveBeenLastCalledWith('recovery', { active_only: false }));
  });

  it('filters by index and type and reports errors', async () => {
    post.mockResolvedValue([row('logs', 'index'), row('metrics', 'index')]);
    const target = component();
    await target.load();

    target.setQuery('met');
    expect(target.groups().map((group) => group.index)).toEqual(['metrics']);
    target.toggleType('peer');
    expect(target.groups()).toEqual([]);
    target.resetFilters();
    expect(target.groups()).toHaveLength(2);

    post.mockRejectedValue(new Error('down'));
    await target.load();
    expect(target.failed()).toBe(true);
    expect(alerts.error).toHaveBeenCalledWith('Could not load shard recoveries', expect.any(Error));
    // Data from the previous successful load stays on screen.
    expect(target.recoveries()).toHaveLength(2);
  });

  it('stops fast polling after a failure, alerts once and keeps the reason', async () => {
    post.mockResolvedValueOnce([row('logs', 'index', '100')]);
    const target = component();
    await target.load();
    expect(target.live()).toBe(true);

    post.mockRejectedValue({ status: 500, body: { error: { type: 'x', reason: 'master not discovered' } } });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(post).toHaveBeenCalledTimes(2);
    expect(target.failed()).toBe(true);
    expect(target.live()).toBe(false);
    expect(target.failure()).toBe('Master not discovered');

    await vi.advanceTimersByTimeAsync(10_000);
    expect(post).toHaveBeenCalledTimes(2);
    await target.load();
    expect(alerts.error).toHaveBeenCalledTimes(1);
    expect(target.recoveries()).toHaveLength(1);
  });

  it('only fast-polls in "In progress" mode', async () => {
    post.mockResolvedValue([row('logs', 'index', '100'), row('old', 'done', '1000')]);
    const target = component();
    await target.load();
    target.setMode('all');
    await vi.waitFor(() => expect(post).toHaveBeenLastCalledWith('recovery', { active_only: false }));
    const calls = post.mock.calls.length;
    await vi.advanceTimersByTimeAsync(6_000);
    expect(target.live()).toBe(false);
    expect(post).toHaveBeenCalledTimes(calls);
  });

  it('pauses fast polling while the tab is hidden and resumes when it is visible', async () => {
    let hidden = false;
    const spy = vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
    try {
      post.mockResolvedValue([row('logs', 'index', '100')]);
      const target = component();
      hidden = true;
      await target.load();
      await vi.advanceTimersByTimeAsync(6_000);
      expect(post).toHaveBeenCalledTimes(1);

      hidden = false;
      document.dispatchEvent(new Event('visibilitychange'));
      await vi.waitFor(() => expect(post).toHaveBeenCalledTimes(2));
      expect(target.live()).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it('keeps the summary tiles cluster-wide while the list is filtered', async () => {
    post.mockResolvedValue([row('logs', 'index'), row('metrics', 'index')]);
    const target = component();
    await target.load();
    target.setQuery('zzz');
    expect(target.groups()).toEqual([]);
    expect(target.summary()).toMatchObject({ active: 2, indices: 2 });
  });

  it('describes where a recovery copies from', async () => {
    post.mockResolvedValue([
      row('logs', 'index'),
      { ...row('restored', 'index'), type: 'snapshot', repository: 'backups', snapshot: 'nightly' },
      { ...row('local', 'index'), type: 'existing_store' },
    ]);
    const target = component();
    await target.load();
    const sources = (target.recoveries() ?? []).map((recovery) => target.source(recovery));
    expect(sources).toEqual(['es-node-1', 'backups / nightly', 'Local data']);
  });
});
