import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, ParamMap, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AlertService } from '../../core/alert.service';
import { ClusterApiError } from '../../core/api-envelope';
import { ClusterApiService } from '../../core/cluster-api.service';
import { ConnectionService } from '../../core/connection.service';
import { DialogService } from '../../core/dialog.service';
import { AllocationComponent } from './allocation.component';
import { RawAllocationExplain } from './allocation.models';

const UNASSIGNED: RawAllocationExplain = {
  index: 'overflow-test',
  shard: 1,
  primary: false,
  current_state: 'unassigned',
  can_allocate: 'no',
  node_allocation_decisions: [
    { node_id: 'n1', node_name: 'es-node-1', node_decision: 'no', deciders: [{ decider: 'same_shard', decision: 'NO', explanation: 'x' }] },
  ],
};

const NO_UNASSIGNED = new ClusterApiError(400, {
  error: { type: 'illegal_argument_exception', reason: 'unable to find any unassigned shards to explain' },
});

describe('AllocationComponent', () => {
  const post = vi.fn();
  const alerts = { error: vi.fn(), success: vi.fn(), info: vi.fn(), warn: vi.fn() };
  const dialogs = { confirm: vi.fn(), showJson: vi.fn() };

  beforeEach(() => {
    post.mockReset();
    alerts.error.mockReset();
    dialogs.showJson.mockReset();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: ClusterApiService, useValue: { post } },
        { provide: AlertService, useValue: alerts },
        { provide: DialogService, useValue: dialogs },
        { provide: ConnectionService, useValue: { connected: () => true, hostQuery: () => ({}) } },
      ],
    });
  });

  function respond(explain: (payload: Record<string, unknown>) => Promise<unknown>): void {
    post.mockImplementation(async (path: string, payload: Record<string, unknown> = {}) => {
      if (path === 'allocation/explain') {
        return explain(payload);
      }
      if (path === 'commons/indices') {
        return ['products', 'overflow-test'];
      }
      if (path === 'cat') {
        return [{ index: 'overflow-test', shard: '1', prirep: 'r', state: 'UNASSIGNED', node: null }];
      }
      return {};
    });
  }

  /** Creates the page and runs its first refresh tick, which explains the requested shard. */
  function component(): AllocationComponent {
    const target = TestBed.runInInjectionContext(() => new AllocationComponent());
    TestBed.tick();
    return target;
  }

  it('explains the next unassigned shard on landing and fills the form with it', async () => {
    respond(async () => UNASSIGNED);
    const target = component();

    await vi.waitFor(() => expect(target.state().kind).toBe('done'));

    expect(post).toHaveBeenCalledWith('allocation/explain', {});
    expect(target.view()?.verdict.title).toBe('Cannot be allocated');
    expect(target.formIndex()).toBe('overflow-test');
    expect(target.formShard()).toBe(1);
    expect(target.formPrimary()).toBe(false);
    // Few nodes: the objections start expanded.
    expect(target.expanded().has('n1')).toBe(true);
  });

  it('shows the "all shards are assigned" state for a healthy cluster', async () => {
    respond(async () => {
      throw NO_UNASSIGNED;
    });
    const target = component();

    await vi.waitFor(() => expect(target.state().kind).toBe('all-assigned'));
    expect(alerts.error).not.toHaveBeenCalled();
  });

  it('turns Elasticsearch errors into a plain-language error state', async () => {
    respond(async (payload) => {
      if (payload['index'] === 'nope') {
        throw new ClusterApiError(404, { error: { type: 'index_not_found_exception', reason: 'no such index [nope]', index: 'nope' } });
      }
      return UNASSIGNED;
    });
    const target = component();
    await vi.waitFor(() => expect(target.state().kind).toBe('done'));

    await target.explain({ index: 'nope', shard: 0, primary: true });

    const state = target.state();
    expect(state.kind).toBe('error');
    if (state.kind === 'error') {
      expect(state.failure).toEqual({ title: 'Index not found', message: 'There is no index named "nope".' });
    }
    target.viewJson();
    expect(dialogs.showJson).toHaveBeenCalledWith('Elasticsearch response', expect.anything(), 'Index not found');
  });

  it('keeps the last explanation when a silent refresh fails', async () => {
    let fail = false;
    respond(async () => {
      if (fail) {
        throw new ClusterApiError(500, { error: 'boom' });
      }
      return UNASSIGNED;
    });
    const target = component();
    await vi.waitFor(() => expect(target.state().kind).toBe('done'));

    fail = true;
    await target.explain({ index: 'overflow-test', shard: 1, primary: false }, true);

    expect(target.state().kind).toBe('done');
    expect(target.explainStale()).toBe('Boom');

    fail = false;
    await target.explain({ index: 'overflow-test', shard: 1, primary: false }, true);
    expect(target.explainStale()).toBeUndefined();
  });

  it('explains once when the query params emit again for the same shard', async () => {
    const params = new BehaviorSubject<ParamMap>(
      convertToParamMap({ index: 'overflow-test', shard: '1', primary: 'false' }),
    );
    TestBed.overrideProvider(ActivatedRoute, { useValue: { queryParamMap: params, snapshot: {} } });
    respond(async () => UNASSIGNED);
    const target = component();
    await vi.waitFor(() => expect(target.state().kind).toBe('done'));

    // The host is written to the URL while connecting.
    params.next(
      convertToParamMap({ index: 'overflow-test', shard: '1', primary: 'false', host: 'http://localhost:9200' }),
    );
    await Promise.resolve();
    const explains = () => post.mock.calls.filter(([path]) => path === 'allocation/explain').length;
    expect(explains()).toBe(1);

    params.next(convertToParamMap({ index: 'overflow-test', shard: '0', primary: 'true' }));
    await vi.waitFor(() => expect(explains()).toBe(2));
  });

  it('waits for the first refresh tick before explaining', () => {
    respond(async () => UNASSIGNED);
    // The shell may create the page and drop it again before it ever renders.
    TestBed.runInInjectionContext(() => new AllocationComponent());
    expect(post).not.toHaveBeenCalledWith('allocation/explain', expect.anything());
  });

  it('marks the shard list as stale when a refresh fails', async () => {
    let fail = false;
    post.mockImplementation(async (path: string) => {
      if (path === 'cat') {
        if (fail) {
          throw new ClusterApiError(500, { error: { type: 'x', reason: 'cat failed' } });
        }
        return [{ index: 'overflow-test', shard: '1', prirep: 'r', state: 'UNASSIGNED', node: null }];
      }
      return path === 'commons/indices' ? ['overflow-test'] : UNASSIGNED;
    });
    const target = component();
    await target.loadClusterData();
    expect(target.copiesStale()).toBeUndefined();

    fail = true;
    await target.loadClusterData();
    expect(target.unassignedCount()).toBe(1);
    expect(target.copiesStale()).toBe('Cat failed');
    expect(alerts.error).not.toHaveBeenCalled();
  });

  it('ignores answers to superseded requests', async () => {
    let resolveFirst: (value: unknown) => void = () => undefined;
    respond((payload) =>
      payload['index'] === 'slow'
        ? new Promise((resolve) => {
            resolveFirst = resolve;
          })
        : Promise.resolve({ ...UNASSIGNED, index: 'fast' }),
    );
    const target = component();
    await vi.waitFor(() => expect(target.state().kind).toBe('done'));

    const slow = target.explain({ index: 'slow', shard: 0, primary: true });
    await target.explain({ index: 'fast', shard: 0, primary: true });
    resolveFirst({ ...UNASSIGNED, index: 'slow' });
    await slow;

    expect(target.view()?.index).toBe('fast');
  });

  it('announces meaningful changes only, not silent refreshes', async () => {
    let state: 'unassigned' | 'assigned' = 'unassigned';
    respond(async () =>
      state === 'unassigned'
        ? UNASSIGNED
        : { ...UNASSIGNED, current_state: 'started', current_node: { id: 'n2', name: 'es-node-2' }, can_remain_on_current_node: 'yes' },
    );
    const target = component();
    await vi.waitFor(() => expect(target.state().kind).toBe('done'));
    expect(target.announcement()).toBe('Explanation loaded for overflow-test shard 1 replica: Cannot be allocated.');

    target.announcement.set('');
    await target.explain({ index: 'overflow-test', shard: 1, primary: false }, true);
    expect(target.announcement()).toBe('');

    state = 'assigned';
    await target.explain({ index: 'overflow-test', shard: 1, primary: false }, true);
    expect(target.announcement()).toBe('Explanation loaded for overflow-test shard 1 replica: Allocated to es-node-2.');
  });

  it('names a requested node from the node list when the explanation fails', async () => {
    post.mockImplementation(async (path: string) => {
      if (path === 'nodes') {
        return [{ id: 'I7MELLk0RvSiAPhRW6211Q', name: 'es-node-1' }];
      }
      if (path === 'allocation/explain') {
        throw new ClusterApiError(400, { error: { type: 'illegal_argument_exception', reason: 'unable to find a replica shard assigned to node [I7MELLk0RvSiAPhRW6211Q]' } });
      }
      return [];
    });
    const target = component();
    target.request.set({ index: 'overflow-test', shard: 0, primary: false, node: 'I7MELLk0RvSiAPhRW6211Q' });
    expect(target.requestNodeName()).toBe('I7MELLk0RvSiAPhRW6211Q');
    await target['loadNodeNames']();
    expect(target.requestNodeName()).toBe('es-node-1');
  });

  it('names the requested node even when the link carries its id', async () => {
    respond(async () => ({
      ...UNASSIGNED,
      current_state: 'started',
      current_node: { id: 'n2', name: 'es-node-2' },
      can_remain_on_current_node: 'yes',
    }));
    const target = component();
    const request = { index: 'overflow-test', shard: 1, primary: false, node: 'n2' };
    target.request.set(request);
    expect(target.requestNodeName()).toBe('n2');
    await target.explain(request);
    expect(target.requestNodeName()).toBe('es-node-2');
  });

  it('offers to drop an unknown node from the request', async () => {
    respond(async (payload) => {
      if (payload['current_node'] === 'es-node-9') {
        throw new ClusterApiError(400, { error: { type: 'illegal_argument_exception', reason: 'failed to resolve [es-node-9], no matching nodes' } });
      }
      return UNASSIGNED;
    });
    const target = component();
    await vi.waitFor(() => expect(target.state().kind).toBe('done'));

    const request = { index: 'overflow-test', shard: 1, primary: false, node: 'es-node-9' };
    target.request.set(request);
    await target.explain(request);
    const state = target.state();
    expect(state.kind === 'error' && state.failure.unknownNode).toBe('es-node-9');
    expect(target.announcement()).toMatch(/^Node not found\./);
  });

  it('validates the form against the known shard count', async () => {
    respond(async () => UNASSIGNED);
    const target = component();
    await target.loadClusterData();

    target.formIndex.set('overflow-test');
    target.setShard('5');
    target.submit();

    expect(target.submitted()).toBe(true);
    expect(target.formError()).toBe('overflow-test has 2 shards (0–1)');
    target.setShard('');
    expect(target.formError()).toBe('The shard number is a whole number starting at 0');
  });

  it('lists unassigned shards from _cat/shards', async () => {
    respond(async () => UNASSIGNED);
    const target = component();
    await target.loadClusterData();

    expect(target.unassignedCount()).toBe(1);
    expect(target.unassigned()[0]?.index).toBe('overflow-test');
    expect(target.indexOptions()).toEqual(['overflow-test', 'products']);
  });
});
