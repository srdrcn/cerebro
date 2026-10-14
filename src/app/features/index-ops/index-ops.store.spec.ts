import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AlertService } from '../../core/alert.service';
import { ClusterApiService } from '../../core/cluster-api.service';
import { ClusterChangesService } from '../../core/cluster-changes.service';
import { ConnectionService } from '../../core/connection.service';
import { DialogService } from '../../core/dialog.service';
import { RefreshService } from '../../core/refresh.service';
import { ClusterApiError } from '../../core/api-envelope';
import {
  ALIAS_ROWS,
  DATA_STREAMS,
  DETAIL_PREPARED,
  DETAIL_SHRUNK_TWO,
  DETAIL_TARGET_INITIALIZING,
  LOOKUP_INDICES,
  NODES,
  REINDEX_STARTED,
  RESIZE_RESPONSE,
  ROLLOVER_DRY_RUN,
  TASK_DONE,
  TASK_LOST_ERROR,
  TASK_RUNNING,
  TASK_SIX_SLICES,
  TASK_SIX_SLICES_CHILDREN,
} from './index-ops.fixtures';
import { CatShardRow, IndexDetailResponse, RawNode } from './index-ops.models';
import { IndexOpsStore } from './index-ops.store';

type Responder = (payload: Record<string, unknown>) => unknown;

/** The shrunken index once its replicas started. */
function greenTarget(): IndexDetailResponse {
  return {
    ...DETAIL_TARGET_INITIALIZING,
    shards: (DETAIL_TARGET_INITIALIZING.shards ?? []).map((row) => ({ ...row, state: 'STARTED', node: row.node ?? 'es-node-3' })),
  };
}

/** `_cat/shards` rows (the `cat` endpoint) of an `index_detail` answer. */
function catShards(detail: IndexDetailResponse): readonly CatShardRow[] {
  return detail.shards ?? [];
}

describe('IndexOpsStore', () => {
  const routes = new Map<string, Responder>();
  const post = vi.fn((path: string, payload: Record<string, unknown> = {}) => {
    const responder = routes.get(path);
    return responder ? Promise.resolve(responder(payload)) : Promise.reject(new Error(`unexpected ${path}`));
  });
  const alerts = { error: vi.fn(), success: vi.fn(), info: vi.fn(), warn: vi.fn() };
  const dialogs = { confirm: vi.fn(), showJson: vi.fn() };
  const changes = { expect: vi.fn() };
  const host = signal<string | undefined>('http://localhost:9200');

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    sessionStorage.clear();
    post.mockClear();
    alerts.error.mockReset();
    alerts.success.mockReset();
    dialogs.confirm.mockReset();
    changes.expect.mockReset();
    routes.clear();
    routes.set('commons/indices', () => ['tmp-index-ops-src', 'orders-v2', 'tmp-index-ops-roll-000001']);
    routes.set('aliases/get_aliases', () => ALIAS_ROWS);
    routes.set('data_streams', () => DATA_STREAMS);
    routes.set('nodes', () => NODES);
    routes.set('index_detail', () => DETAIL_PREPARED);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        IndexOpsStore,
        { provide: ClusterApiService, useValue: { post } },
        { provide: AlertService, useValue: alerts },
        { provide: DialogService, useValue: dialogs },
        { provide: ClusterChangesService, useValue: changes },
        { provide: ConnectionService, useValue: { host, connected: () => true, hostQuery: () => ({ host: host() ?? null }) } },
      ],
    });
    TestBed.inject(RefreshService).setInterval(0);
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.useRealTimers();
  });

  async function store(): Promise<IndexOpsStore> {
    const target = TestBed.inject(IndexOpsStore);
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(0);
    return target;
  }

  function calls(path: string): Record<string, unknown>[] {
    return post.mock.calls.filter(([called]) => called === path).map(([, payload]) => payload ?? {});
  }

  it('loads the source of a deep link and fills in the defaults', async () => {
    const target = await store();
    target.applyParams('shrink', 'tmp-index-ops-src');
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(0);

    expect(target.step()).toBe('options');
    expect(target.sourceIndex()?.name).toBe('tmp-index-ops-src');
    expect(target.target()).toBe('tmp-index-ops-src-shrunk');
    expect(target.shards()).toBe(1);
    expect(target.replicas()).toBe('1');
    expect(target.shrinkNode()).toBe('es-node-1');
    expect(target.checkSummary()).toMatchObject({ fail: 0, pending: 0, ready: true });
    expect(target.hasFieldErrors()).toBe(false);
    expect(target.requests()[0]?.preview.path).toBe('/tmp-index-ops-src/_shrink/tmp-index-ops-src-shrunk');
    // Picking a source is cheap to redo: only edits ask before leaving.
    expect(target.dirty()).toBe(false);
  });

  it('runs a shrink, follows the target until green and lifts the block afterwards', async () => {
    const target = await store();
    target.applyParams('shrink', 'tmp-index-ops-src');
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(0);
    target.shards.set(2);
    // The name the fixtures were captured with.
    target.setTarget('tmp-index-ops-shrunk');

    let targetDetail: IndexDetailResponse = DETAIL_TARGET_INITIALIZING;
    routes.set('index_ops/resize', () => RESIZE_RESPONSE);
    routes.set('index_detail', (payload) => (payload['index'] === 'tmp-index-ops-shrunk' ? targetDetail : DETAIL_PREPARED));
    // The target is followed through _cat/shards only.
    routes.set('cat', (payload) => (payload['api'] === 'shards/tmp-index-ops-shrunk' ? catShards(targetDetail) : []));
    routes.set('index_settings/update', () => ({ acknowledged: true }));
    // The fixture was prepared outside the wizard; the wizard sets the write block itself here.
    dialogs.confirm.mockResolvedValue(true);
    expect(await target.blockWrites()).toBe(true);
    expect(target.sourceChanged()).toEqual({ index: 'tmp-index-ops-src', writeBlock: true, requiredNode: null });

    await target.execute();
    await vi.advanceTimersByTimeAsync(0);

    expect(changes.expect).toHaveBeenCalledWith({ created: ['tmp-index-ops-shrunk'] });
    expect(calls('index_ops/resize')[0]).toEqual({
      kind: 'shrink',
      index: 'tmp-index-ops-src',
      target: 'tmp-index-ops-shrunk',
      body: {
        settings: {
          'index.number_of_shards': 2,
          'index.number_of_replicas': 1,
          'index.routing.allocation.require._name': null,
          'index.blocks.write': null,
        },
      },
    });
    const recovering = target.run();
    expect(recovering.kind === 'resize' && recovering.phase).toBe('recovering');
    expect(recovering.kind === 'resize' && recovering.recovery).toMatchObject({ started: 2, total: 4 });

    targetDetail = greenTarget();
    await vi.advanceTimersByTimeAsync(2_000);
    const done = target.run();
    expect(done.kind === 'resize' && done.phase).toBe('done');
    expect(target.announcement()).toBe('tmp-index-ops-shrunk is green');

    expect(calls('index_detail').filter((payload) => payload['index'] === 'tmp-index-ops-shrunk')).toEqual([]);
    // The block holds the page until it is lifted.
    expect(target.dirty()).toBe(true);

    // Only what the wizard set is lifted: the node requirement was there before.
    await target.releaseFinishedSource();
    expect(calls('index_settings/update').at(-1)).toEqual({ index: 'tmp-index-ops-src', settings: { 'index.blocks.write': null } });
    expect(target.sourceChanged()).toBeNull();
    expect(target.dirty()).toBe(false);
  });

  it('offers to lift the write block it set before switching the operation', async () => {
    routes.set('index_settings/update', () => ({ acknowledged: true }));
    const target = await store();
    target.applyParams('clone', 'tmp-index-ops-src');
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(0);
    dialogs.confirm.mockResolvedValueOnce(true);
    await target.blockWrites();
    expect(target.dirty()).toBe(true);
    expect(JSON.parse(sessionStorage.getItem('cerebro.index-ops.changes') ?? 'null')).toEqual({
      host: 'http://localhost:9200',
      changes: { index: 'tmp-index-ops-src', writeBlock: true, requiredNode: null },
    });

    // Same source, other resize: nothing to ask.
    await target.chooseOperation('split');
    expect(dialogs.confirm).toHaveBeenCalledTimes(1);
    expect(target.sourceChanged()?.index).toBe('tmp-index-ops-src');

    // Another operation: lift it first.
    dialogs.confirm.mockResolvedValueOnce(true);
    await target.chooseOperation('reindex');
    expect(dialogs.confirm).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Allow writes to tmp-index-ops-src again?' }));
    expect(calls('index_settings/update').at(-1)).toEqual({ index: 'tmp-index-ops-src', settings: { 'index.blocks.write': null } });
    expect(target.sourceChanged()).toBeNull();
    expect(sessionStorage.getItem('cerebro.index-ops.changes')).toBeNull();
    expect(target.operation()).toBe('reindex');
  });

  it('forgets the block when the user keeps it, and restores it after a reload', async () => {
    routes.set('index_settings/update', () => ({ acknowledged: true }));
    const target = await store();
    target.applyParams('split', 'tmp-index-ops-src');
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(0);
    dialogs.confirm.mockResolvedValueOnce(true);
    await target.blockWrites();
    const updates = calls('index_settings/update').length;

    // A reload (new store) picks the record up again: DETAIL_PREPARED still has the block.
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        IndexOpsStore,
        { provide: ClusterApiService, useValue: { post } },
        { provide: AlertService, useValue: alerts },
        { provide: DialogService, useValue: dialogs },
        { provide: ClusterChangesService, useValue: changes },
        { provide: ConnectionService, useValue: { host, connected: () => true, hostQuery: () => ({ host: host() ?? null }) } },
      ],
    });
    const reloaded = await store();
    reloaded.applyParams('split', 'tmp-index-ops-src');
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(0);
    expect(reloaded.sourceChanged()).toEqual({ index: 'tmp-index-ops-src', writeBlock: true, requiredNode: null });

    // Picking another source and keeping the block: no request, no more reminders.
    dialogs.confirm.mockResolvedValueOnce(false);
    await reloaded.chooseSource('orders-v2');
    expect(calls('index_settings/update')).toHaveLength(updates);
    expect(reloaded.sourceChanged()).toBeNull();
    expect(reloaded.dirty()).toBe(false);
  });

  it('keeps the rollover dry run idle until a required name is typed', async () => {
    routes.set('index_detail', () => ({ settings: {}, stats: null, aliases: null, shards: null }));
    routes.set('index_ops/rollover', () => ROLLOVER_DRY_RUN);
    const target = await store();
    // logs-2026.10.14 does not end in -N: Elasticsearch cannot name the next index.
    target.applyParams('rollover', 'logs-current');
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(calls('index_ops/rollover')).toEqual([]);
    expect(target.dryRun()).toEqual({ state: 'idle' });
    expect(target.checks().map((check) => check.id)).toEqual(['write-index', 'alias-moves', 'new-index']);

    target.newIndex.set('logs-2026.10.15');
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(500);
    expect(calls('index_ops/rollover')).toEqual([{ alias: 'logs-current', body: {}, dry_run: true, new_index: 'logs-2026.10.15' }]);
    expect(target.announcement()).toMatch(/^Dry run: /);
  });

  it('resolves reindex sources with the index lookup, not on every refresh', async () => {
    routes.set('commons/indices/lookup', () => LOOKUP_INDICES);
    const target = await store();
    target.applyParams('reindex', 'logs-*,archive*');
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(400);
    expect(calls('commons/indices/lookup')).toEqual([{ expression: 'logs-*,archive*' }]);
    const lookup = target.sourcesLookup();
    // The closed archive only matched a pattern: the reindex skips it.
    expect(lookup.state === 'ready' && lookup.indices.map((index) => index.name)).toEqual([
      '.ds-app-events-web-2026.10.14-000001',
      '.ds-app-events-web-2026.10.14-000002',
      '.kibana-demo',
      'logs-2026.10.13',
      'metrics-app',
    ]);
    expect(lookup.state === 'ready' && lookup.skipped?.map((index) => index.name)).toEqual(['archive-2025']);
    expect(lookup.state === 'ready' && lookup.indices.find((index) => index.name === 'logs-2026.10.13')?.primarySize).toBe(1_649_378);
    TestBed.inject(RefreshService).refresh();
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(calls('commons/indices/lookup')).toHaveLength(1);
    expect(calls('index_detail')).toEqual([]);
    expect(calls('cat')).toEqual([]);
  });

  it('looks the destination up with its blocks, and treats a 404 as a new index', async () => {
    routes.set('commons/indices/lookup', (payload) =>
      payload['expression'] === 'tmp-index-ops-dst'
        ? [{ index: 'tmp-index-ops-dst', status: 'open', health: 'green', pri: '1', rep: '0', 'docs.count': '3', 'pri.store.size': '6000', 'store.size': '6000' }]
        : Promise.reject(new ClusterApiError(404, { error: { type: 'index_not_found_exception', reason: 'no such index [tmp-index-ops-new]' } })),
    );
    routes.set('commons/get_index_settings', (payload) =>
      payload['index'] === 'tmp-index-ops-dst'
        ? { 'tmp-index-ops-dst': { settings: { index: { blocks: { write: 'true' } } } } }
        : Promise.reject(new ClusterApiError(404, {})),
    );
    const target = await store();
    target.applyParams('reindex', 'logs-*');
    target.reindex.update((options) => ({ ...options, dest: 'tmp-index-ops-dst' }));
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(400);
    expect(calls('commons/get_index_settings')).toEqual([{ index: 'tmp-index-ops-dst' }]);
    const dest = target.destLookup();
    expect(dest.state === 'ready' && dest.indices[0]).toMatchObject({ docs: 3, writeBlocked: true, blockSettings: ['index.blocks.write'] });
    expect(target.checks().find((check) => check.id === 'dest-writable')?.status).toBe('fail');

    target.reindex.update((options) => ({ ...options, dest: 'tmp-index-ops-new' }));
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(400);
    expect(target.destLookup()).toEqual({ state: 'missing' });
    expect(calls('index_detail')).toEqual([]);
  });

  it('offers the exact split choices of the cluster state', async () => {
    routes.set('index_detail', () => DETAIL_SHRUNK_TWO);
    const target = await store();
    target.applyParams('split', 'tmp-index-ops-two');
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(0);
    expect(target.sourceIndex()?.routingShards).toEqual({ value: 768, origin: 'metadata' });
    expect(target.shardOptions().slice(0, 5)).toEqual([4, 6, 8, 12, 16]);
    expect(target.shards()).toBe(4);
    target.shards.set(6);
    expect(target.fieldErrors()['shards']).toBeUndefined();
    target.shards.set(10);
    expect(target.fieldErrors()['shards']).toMatch(/^10 does not divide the 768 routing shards/);
  });

  it('only offers shrink nodes of the preferred tier', async () => {
    const tiers: Record<string, string[]> = { 'es-node-1': ['data_hot'], 'es-node-2': ['data_warm'], 'es-node-3': ['data_warm'] };
    routes.set('nodes', () => NODES.map((node): RawNode => ({ ...node, roles: [...(tiers[node.name] ?? []), 'master'] })));
    routes.set('index_detail', () => ({
      ...DETAIL_SHRUNK_TWO,
      // Spread over the three nodes, as before a preparation.
      shards: (DETAIL_SHRUNK_TWO.shards ?? []).map((row, position) => ({ ...row, node: position === 0 ? 'es-node-1' : 'es-node-3' })),
    }));
    const target = await store();
    target.applyParams('shrink', 'tmp-index-ops-two');
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(0);
    expect(target.nodeOptions()?.map((option) => option.excluded === null)).toEqual([false, true, true]);
    // es-node-1 holds a shard but is in the hot tier: the warm node with a shard is suggested.
    expect(target.shrinkNode()).toBe('es-node-3');
    expect(target.checks().find((check) => check.id === 'nodes')).toMatchObject({ status: 'pass', title: '2 of 3 data nodes can gather the copies' });
  });

  it('follows a reindex again after a reload and stops once the task is lost', async () => {
    let lost = false;
    routes.set('tasks/get', () => (lost ? Promise.reject(new ClusterApiError(404, TASK_LOST_ERROR)) : TASK_RUNNING));
    const target = await store();
    target.resumeReindex('I7MELLk0RvSiAPhRW6211Q:96204', '');
    await vi.advanceTimersByTimeAsync(0);
    const running = target.run();
    expect(running).toMatchObject({ kind: 'reindex', phase: 'running', dest: 'tmp-index-ops-dst' });
    expect(target.step()).toBe('run');
    expect(target.reindex()).toMatchObject({ sources: 'tmp-index-ops-src', dest: 'tmp-index-ops-dst' });

    lost = true;
    await vi.advanceTimersByTimeAsync(1_500);
    expect(target.run()).toMatchObject({ kind: 'reindex', phase: 'lost' });
    expect(target.announcement()).toBe('Elasticsearch no longer knows the reindex task');
    const polls = calls('tasks/get').length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(calls('tasks/get')).toHaveLength(polls);
  });

  it('reads the slices of a sliced reindex by parent task on each poll', async () => {
    const taskId = 'I7MELLk0RvSiAPhRW6211Q:511584';
    routes.set('index_ops/reindex', () => ({ task: taskId }));
    routes.set('tasks/get', () => TASK_SIX_SLICES);
    routes.set('tasks', () => TASK_SIX_SLICES_CHILDREN);
    const target = await store();
    target.applyParams('reindex', 'tmp-index-ops-six');
    target.reindex.update((options) => ({ ...options, dest: 'tmp-index-ops-sliced', slicesMode: 'auto' }));
    TestBed.tick();
    await target.execute();
    await vi.advanceTimersByTimeAsync(3_100);
    // Polls at 0, 1.5 and 3 s, each with the sub-tasks of this task only.
    expect(calls('tasks/get')).toHaveLength(3);
    expect(calls('tasks')).toEqual([{ parent_task_id: taskId }, { parent_task_id: taskId }, { parent_task_id: taskId }]);
    const run = target.run();
    expect(run.kind === 'reindex' && run.progress).toMatchObject({ total: 600, processed: 60, slices: 6, pendingSlices: 0 });

    // A failed read of the slices keeps the progress (it never goes back).
    routes.set('tasks', () => Promise.reject(new Error('boom')));
    await vi.advanceTimersByTimeAsync(1_500);
    const kept = target.run();
    expect(kept.kind === 'reindex' && kept.progress).toMatchObject({ processed: 60, pendingSlices: 6 });
    expect(kept.kind === 'reindex' && kept.stale).toBeNull();

    // After a minute the polls slow down to every 5 s.
    await vi.advanceTimersByTimeAsync(60_000);
    const polls = calls('tasks/get').length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(calls('tasks/get').length - polls).toBe(2);
  });

  it('resumes a resize after a reload and gives up when the new index is gone', async () => {
    routes.set('cat', () => Promise.reject(new ClusterApiError(404, { error: { type: 'index_not_found_exception', reason: 'no such index [gone]' } })));
    const target = await store();
    await target.resumeResize('shrink', 'tmp-index-ops-src', 'gone');
    expect(target.finishedSource()?.name).toBe('tmp-index-ops-src');
    await vi.advanceTimersByTimeAsync(5_000);
    expect(target.run()).toMatchObject({ kind: 'resize', phase: 'failed', error: 'gone does not exist (any more).' });
  });

  it('asks for a dry run once the rollover conditions settle', async () => {
    routes.set('index_detail', () => ({ settings: {}, stats: null, aliases: null, shards: null }));
    routes.set('index_ops/rollover', () => ROLLOVER_DRY_RUN);
    const target = await store();
    target.applyParams('rollover', 'tmp-index-ops-roll');
    target.conditions.update((conditions) => ({ ...conditions, maxDocs: '3' }));
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(500);

    expect(calls('index_ops/rollover')).toEqual([{ alias: 'tmp-index-ops-roll', body: { conditions: { max_docs: 3 } }, dry_run: true }]);
    const dry = target.dryRun();
    expect(dry.state === 'ready' && dry.preview.metCount).toBe(1);
    expect(target.checkSummary().ready).toBe(true);
    expect(target.requests()[0]?.payload).toEqual({ alias: 'tmp-index-ops-roll', body: { conditions: { max_docs: 3 } }, dry_run: false });
  });

  it('starts a reindex, follows its task and cancels it on request', async () => {
    let task = TASK_RUNNING;
    routes.set('index_ops/reindex', () => REINDEX_STARTED);
    routes.set('tasks/get', () => task);
    routes.set('tasks/cancel', () => ({}));
    const target = await store();
    target.applyParams('reindex', 'tmp-index-ops-src');
    target.reindex.update((options) => ({ ...options, dest: 'tmp-index-ops-dst', throttled: true, requestsPerSecond: '500' }));
    TestBed.tick();

    await target.execute();
    await vi.advanceTimersByTimeAsync(0);

    expect(calls('index_ops/reindex')[0]).toEqual({
      body: { source: { index: 'tmp-index-ops-src' }, dest: { index: 'tmp-index-ops-dst' } },
      requests_per_second: '500',
    });
    const running = target.run();
    expect(running.kind === 'reindex' && running.progress).toMatchObject({ processed: 600, total: 3000, outcome: 'running' });

    dialogs.confirm.mockResolvedValue(true);
    await target.cancelTask();
    expect(calls('tasks/cancel')).toEqual([{ task_id: 'I7MELLk0RvSiAPhRW6211Q:96204' }]);

    task = TASK_DONE;
    await vi.advanceTimersByTimeAsync(1_500);
    const done = target.run();
    expect(done.kind === 'reindex' && done.phase).toBe('done');
    expect(target.announcement()).toBe('Reindex finished: 3,000 documents');
    const polls = calls('tasks/get').length;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(calls('tasks/get')).toHaveLength(polls);
  });

  it('reports a refused request and lets the user go back to the review', async () => {
    routes.set('index_ops/resize', () => Promise.reject(new Error('resource_already_exists_exception')));
    const target = await store();
    target.applyParams('clone', 'tmp-index-ops-src');
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(0);

    await target.execute();
    const failed = target.run();
    expect(failed.kind === 'resize' && failed.phase).toBe('failed');
    expect(alerts.error).toHaveBeenCalled();

    target.backToReview();
    expect(target.run().kind).toBe('idle');
    expect(target.step()).toBe('review');
  });
});
