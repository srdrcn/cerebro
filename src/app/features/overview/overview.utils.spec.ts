import { describe, expect, it } from 'vitest';
import { NodeCounters, buildHistory } from '../../core/metrics';
import {
  OverviewData,
  OverviewIndex,
  OverviewIndexFilter,
  OverviewNode,
  OverviewShard,
} from './overview.models';
import {
  OPERATIONS,
  allocationExplainParams,
  canReceiveShard,
  describeShard,
  filterOverviewIndices,
  hasShardActivity,
  shardActivityLabel,
  escapeRegExp,
  indexBreakdown,
  indexSummary,
  indicesPayload,
  liveActivityTiles,
  loadPercent,
  matchesOverviewIndex,
  nodeAttributes,
  nodeRoleIcons,
  normalizeOverview,
  operationConfirmation,
  operationFailure,
  operationSuccess,
  operationTargets,
  pageOfIndex,
  primaryStoreSize,
  revealFlags,
  revealIndexFilter,
  shardChipClass,
  shardHeading,
  shardMapLayout,
  shardsOn,
  stillRelocatable,
  visibleDataNodes,
} from './overview.utils';

const defaultFilter: OverviewIndexFilter = {
  name: '',
  closed: false,
  special: false,
  healthy: true,
  ascending: true,
};

function index(
  name: string,
  overrides: Partial<OverviewIndex> = {},
): OverviewIndex {
  return {
    name,
    aliases: [],
    closed: false,
    special: false,
    unhealthy: false,
    doc_count: 0,
    size_in_bytes: 0,
    num_shards: 1,
    num_replicas: 0,
    shards: {},
    ...overrides,
  };
}

describe('overview index filtering and bulk payloads', () => {
  it('matches aliases and preserves the legacy closed/special/health switches', () => {
    const indices = [
      index('logs-current', { aliases: ['production'] }),
      index('logs-closed', { closed: true, aliases: ['production'] }),
      index('.logs-internal', { special: true, aliases: ['production'] }),
      index('logs-healthy'),
      index('logs-affected', { unhealthy: true }),
    ];

    expect(
      filterOverviewIndices(indices, {
        ...defaultFilter,
        name: 'production',
      }).map((item) => item.name),
    ).toEqual(['logs-current']);
    expect(
      filterOverviewIndices(indices, {
        ...defaultFilter,
        name: 'logs',
        healthy: false,
      }).map((item) => item.name),
    ).toEqual(['logs-affected']);
  });

  it('builds one comma-separated payload from the full filtered result, not a page', () => {
    const indices = [
      index('logs-03'),
      index('metrics-01'),
      index('logs-01'),
      index('logs-02'),
    ];
    const names = filterOverviewIndices(indices, { ...defaultFilter, name: '^logs-' }).map((item) => item.name);

    expect(indicesPayload(names)).toEqual({ indices: 'logs-01,logs-02,logs-03' });
    expect(indicesPayload(['products'])).toEqual({ indices: 'products' });
  });

  it('falls back to literal case-insensitive matching for an invalid regexp', () => {
    expect(
      matchesOverviewIndex(index('Prefix[Logs-Suffix'), {
        ...defaultFilter,
        name: '[logs-',
      }),
    ).toBe(true);
  });
});

describe('shard relocation eligibility', () => {
  const selected: OverviewShard = {
    shard: 1,
    index: 'logs',
    node: 'node-a',
    state: 'STARTED',
    primary: true,
  };

  it('allows a different node without another copy of the selected shard', () => {
    const targetIndex = index('logs', {
      shards: {
        'node-a': [selected],
        'node-b': [{ ...selected, shard: 2, node: 'node-b' }],
      },
    });

    expect(canReceiveShard(selected, targetIndex, 'node-b')).toBe(true);
    expect(canReceiveShard(selected, targetIndex, 'node-c')).toBe(true);
  });

  it('rejects the source node, another index, and a node with the same shard copy', () => {
    const targetIndex = index('logs', {
      shards: {
        'node-b': [{ ...selected, node: 'node-b', primary: false }],
      },
    });

    expect(canReceiveShard(selected, targetIndex, 'node-a')).toBe(false);
    expect(canReceiveShard(selected, index('metrics'), 'node-b')).toBe(false);
    expect(canReceiveShard(selected, targetIndex, 'node-b')).toBe(false);
    expect(canReceiveShard(undefined, targetIndex, 'node-c')).toBe(false);
  });
});

describe('overview helpers', () => {
  const node = (overrides: Partial<OverviewNode> = {}): OverviewNode => ({
    id: 'n1',
    current_master: false,
    name: 'es-node-1',
    host: '127.0.0.1',
    es_version: '8.15.3',
    jvm_version: '22',
    load_average: 2,
    available_processors: 4,
    cpu_percent: 10,
    master: true,
    data: true,
    coordinating: false,
    ingest: false,
    heap: { used: 1, committed: 2, used_percent: 50, max: 2 },
    disk: { total: 10, free: 5, used_percent: 50 },
    attributes: {},
    ...overrides,
  });

  it('normalizes legacy closed indices without a routing table', () => {
    const data = normalizeOverview({
      cluster_name: 'c',
      status: 'green',
      number_of_nodes: 1,
      active_primary_shards: 0,
      active_shards: 0,
      relocating_shards: 0,
      initializing_shards: 0,
      unassigned_shards: 0,
      docs_count: 0,
      size_in_bytes: 0,
      total_indices: 1,
      closed_indices: 1,
      special_indices: 0,
      shard_allocation: true,
      indices: [{ name: 'old', closed: true, special: false }],
    });
    expect(data.nodes).toEqual([]);
    expect(data.indices[0]).toMatchObject({ aliases: [], shards: {}, num_shards: 0, unhealthy: false });
    expect(indexSummary(data.indices[0]!)).toBe('0 × 1 shards');
  });

  it('derives the number of index columns from the grid width', () => {
    expect(shardMapLayout(1130)).toEqual({ nodeColumn: 248, columns: 4, columnWidth: 220, scroll: false });
    expect(shardMapLayout(356)).toEqual({ nodeColumn: 136, columns: 1, columnWidth: 220, scroll: false });
    expect(shardMapLayout(200).scroll).toBe(true);
    expect(shardMapLayout(0).columns).toBe(1);
    const wide = shardMapLayout(2400);
    expect(wide.columns).toBe(10);
    expect(wide.nodeColumn + wide.columns * wide.columnWidth).toBeLessThanOrEqual(2400);
  });

  it('describes shards and builds chip classes', () => {
    const names = new Map([['n2', 'es-node-2']]);
    const relocating: OverviewShard = {
      shard: 1,
      index: 'logs',
      node: 'n1',
      relocating_node: 'n2',
      state: 'RELOCATING',
      primary: true,
    };
    expect(describeShard(relocating, names)).toBe('Shard 1 of logs · primary · relocating to es-node-2');
    expect(describeShard({ ...relocating, primary: false, state: 'STARTED' }, names, true)).toBe(
      'Shard 1 of logs · replica · closed',
    );
    expect(shardChipClass(relocating, false, true)).toBe('shard-chip is-relocating is-primary is-selected');
    expect(shardChipClass({ ...relocating, state: 'weird', primary: false }, false)).toBe(
      'shard-chip is-unknown is-replica',
    );
    expect(shardHeading({ ...relocating, state: 'STARTED' })).toBe('Shard 1 · primary');
    expect(shardHeading(relocating)).toBe('Shard 1 · primary · relocating');
    expect(shardHeading({ ...relocating, node: null, state: 'UNASSIGNED', primary: false })).toBe(
      'Shard 1 · replica · unassigned',
    );
    expect(shardHeading({ ...relocating, state: 'STARTED' }, true)).toBe('Shard 1 · primary · closed');
    expect(shardHeading({ ...relocating, node: null, state: 'UNASSIGNED', primary: false }, true)).toBe(
      'Shard 1 · replica · unassigned (closed index)',
    );
  });

  it('builds allocation explain links for every kind of shard copy', () => {
    const shard = (overrides: Partial<OverviewShard>): OverviewShard => ({
      shard: 2,
      index: 'overflow-test',
      node: 'n1',
      state: 'STARTED',
      primary: false,
      ...overrides,
    });
    // An assigned replica names its node so the explanation is about that copy.
    expect(allocationExplainParams(shard({}))).toEqual({
      index: 'overflow-test',
      shard: '2',
      primary: 'false',
      node: 'n1',
    });
    // Initializing and relocating replicas are assigned too.
    expect(allocationExplainParams(shard({ state: 'RELOCATING', relocating_node: 'n2' }))['node']).toBe('n1');
    expect(allocationExplainParams(shard({ state: 'INITIALIZING' }))['node']).toBe('n1');
    // A primary is unique: no node needed.
    expect(allocationExplainParams(shard({ primary: true }))).toEqual({
      index: 'overflow-test',
      shard: '2',
      primary: 'true',
    });
    // Unassigned copies leave the node out so Elasticsearch picks the unassigned one.
    expect(allocationExplainParams(shard({ node: null, state: 'UNASSIGNED' }))).toEqual({
      index: 'overflow-test',
      shard: '2',
      primary: 'false',
    });
    expect(allocationExplainParams(shard({ node: 'n1', state: 'UNASSIGNED' }))).not.toHaveProperty('node');
    expect(allocationExplainParams(shard({ node: undefined, state: 'UNASSIGNED', primary: true }))).toEqual({
      index: 'overflow-test',
      shard: '2',
      primary: 'true',
    });
  });

  it('sorts shards of a node with primaries first', () => {
    const shard = (number: number, primary: boolean): OverviewShard => ({
      shard: number,
      index: 'logs',
      node: 'n1',
      state: 'STARTED',
      primary,
    });
    const target = index('logs', { shards: { n1: [shard(2, false), shard(0, false), shard(0, true)] } });
    expect(shardsOn(target, 'n1').map((item) => `${item.shard}${item.primary ? 'p' : 'r'}`)).toEqual([
      '0p',
      '0r',
      '2r',
    ]);
    expect(shardsOn(target, 'missing')).toEqual([]);
  });

  it('keeps a selected shard only while it is still started on its node', () => {
    const started: OverviewShard = { shard: 0, index: 'logs', node: 'n1', state: 'STARTED', primary: true };
    const data = (shards: OverviewShard[], closed = false): OverviewData => ({
      cluster_name: 'c',
      status: 'green',
      number_of_nodes: 1,
      active_primary_shards: 1,
      active_shards: 1,
      relocating_shards: 0,
      initializing_shards: 0,
      unassigned_shards: 0,
      docs_count: 0,
      size_in_bytes: 0,
      total_indices: 1,
      closed_indices: 0,
      special_indices: 0,
      shard_allocation: true,
      nodes: [],
      indices: [index('logs', { closed, shards: { n1: shards } })],
    });
    expect(stillRelocatable(data([started]), started)).toEqual(started);
    expect(stillRelocatable(data([{ ...started, state: 'RELOCATING' }]), started)).toBeUndefined();
    expect(stillRelocatable(data([started], true), started)).toBeUndefined();
    expect(stillRelocatable(data([]), started)).toBeUndefined();
    expect(stillRelocatable(data([started]), undefined)).toBeUndefined();
  });

  it('filters data nodes by name with regex support', () => {
    const nodes = [
      node({ id: 'b', name: 'es-node-2' }),
      node({ id: 'a', name: 'es-node-1' }),
      node({ id: 'c', name: 'coordinator', data: false }),
    ];
    expect(visibleDataNodes(nodes, '').map((item) => item.id)).toEqual(['a', 'b']);
    expect(visibleDataNodes(nodes, '-2$').map((item) => item.id)).toEqual(['b']);
    expect(visibleDataNodes(nodes, 'coord')).toEqual([]);
  });

  it('describes node roles, attributes and load', () => {
    expect(nodeRoleIcons(node({ current_master: true, ingest: true })).map((role) => role.icon)).toEqual([
      'bi-star-fill',
      'bi-hdd',
      'bi-funnel',
    ]);
    expect(nodeAttributes({ 'ml.config_version': '1', zone: 'z1', rack: 'r1' })).toEqual([
      ['rack', 'r1'],
      ['zone', 'z1'],
    ]);
    expect(loadPercent(node())).toBe(50);
    expect(loadPercent(node({ available_processors: 0 }))).toBe(0);
  });

  it('summarizes sizes and shard activity', () => {
    expect(
      primaryStoreSize([index('a', { size_in_bytes: 10 }), index('b', { size_in_bytes: 5, closed: true })]),
    ).toBe(10);
    expect(hasShardActivity({ unassigned: 0, relocating: 0, initializing: 1 })).toBe(true);
    expect(hasShardActivity({ unassigned: 0, relocating: 0, initializing: 0 })).toBe(false);
    expect(shardActivityLabel({ unassigned: 0, relocating: 0, initializing: 1 })).toBe('1 initializing shard');
    expect(shardActivityLabel({ unassigned: 1200, relocating: 1, initializing: 0 })).toBe('1,200 unassigned · 1 relocating shards');
    expect(pageOfIndex([index('a'), index('b'), index('c')], 'c', 2)).toBe(2);
    expect(pageOfIndex([index('a')], 'z', 2)).toBeUndefined();
  });

  it('reveals closed or special indices linked from the command palette', () => {
    const indices = [index('archive', { closed: true }), index('.kibana', { special: true }), index('logs')];
    expect(revealFlags(indices, 'archive')).toEqual({ closed: true, special: false });
    expect(revealFlags(indices, ' .kibana ')).toEqual({ closed: false, special: true });
    expect(revealFlags(indices, 'log')).toEqual({ closed: false, special: false });
  });

  it('builds specific confirmations and success messages for index operations', () => {
    expect(operationConfirmation('delete', ['products'])).toEqual({
      title: 'Delete index products?',
      message: OPERATIONS.delete.message,
      confirmLabel: 'Delete index',
      tone: 'danger',
    });
    expect(operationConfirmation('close', ['a', 'b'])).toMatchObject({
      title: 'Close 2 indices?',
      items: ['a', 'b'],
      confirmLabel: 'Close 2 indices',
      tone: 'danger',
    });
    expect(operationConfirmation('cache', ['a', 'b'])).toMatchObject({
      title: 'Clear the cache of 2 indices?',
      confirmLabel: 'Clear 2 caches',
      tone: 'default',
    });
    expect(operationConfirmation('merge', ['a']).tone).toBe('warning');
    expect(operationSuccess('refresh', ['a', 'b', 'c'])).toBe('3 indices refreshed');
    expect(operationSuccess('close', ['products'])).toBe('Index products closed');
    expect(operationFailure('close', ['products'])).toBe('Could not close index products');
    expect(operationFailure('merge', ['a', 'b'])).toBe('Could not force merge 2 indices');
    expect(operationFailure('cache', ['a', 'b', 'c'])).toBe('Could not clear the cache of 3 indices');
  });

  it('leaves closed indices out of operations that fail on them', () => {
    const indices = [index('a'), index('b', { closed: true }), index('c', { closed: true })];
    for (const operation of ['merge', 'refresh', 'flush', 'cache'] as const) {
      expect(operationTargets(operation, indices)).toEqual({ names: ['a'], skipped: 2 });
    }
    for (const operation of ['open', 'close', 'delete'] as const) {
      expect(operationTargets(operation, indices)).toEqual({ names: ['a', 'b', 'c'], skipped: 0 });
    }
    expect(operationTargets('refresh', [index('b', { closed: true })])).toEqual({ names: [], skipped: 1 });

    expect(operationConfirmation('refresh', ['a'], 2).message).toBe(
      `${OPERATIONS.refresh.message} 2 closed indices are skipped.`,
    );
    expect(operationConfirmation('flush', ['a', 'd'], 1)).toMatchObject({
      title: 'Flush 2 indices?',
      message: `${OPERATIONS.flush.message} 1 closed index is skipped.`,
      items: ['a', 'd'],
    });
    expect(operationSuccess('refresh', ['a', 'd'], 1)).toBe('2 indices refreshed, 1 closed index skipped');
    expect(operationSuccess('cache', ['a'], 2)).toBe('Index a cache cleared, 2 closed indices skipped');
  });

  it('summarizes the index breakdown briefly with the full text as a title', () => {
    expect(indexBreakdown(18, 1, 3)).toEqual({
      short: '1 closed · 3 special',
      full: '17 open · 1 closed · 3 special',
    });
    expect(indexBreakdown(4, 0, 0)).toEqual({ short: 'all open', full: '4 open · 0 closed · 0 special' });
    expect(indexBreakdown(4, 0, 1).short).toBe('1 special');
  });
});

describe('revealing the index of a selected shard', () => {
  const indices = [
    index('audit-trail'),
    index('logs-1', { unhealthy: true }),
    index('.kibana', { special: true }),
    index('archive', { closed: true }),
    index('a.b+c'),
  ];
  const names = (filter: OverviewIndexFilter) =>
    filterOverviewIndices(indices, filter).map((item) => item.name);

  it('keeps the filter when the index is already visible or unknown', () => {
    expect(revealIndexFilter(indices, defaultFilter, 'audit-trail')).toBe(defaultFilter);
    expect(revealIndexFilter(indices, defaultFilter, 'missing')).toBe(defaultFilter);
  });

  it('turns Affected only off but keeps a text filter that matches', () => {
    const filter = { ...defaultFilter, name: 'audit', healthy: false };
    const revealed = revealIndexFilter(indices, filter, 'audit-trail');
    expect(revealed).toEqual({ ...filter, healthy: true });
    expect(names(revealed)).toContain('audit-trail');
  });

  it('switches on the Special and Closed chips when needed', () => {
    expect(revealIndexFilter(indices, defaultFilter, '.kibana')).toMatchObject({ special: true, name: '' });
    expect(revealIndexFilter(indices, { ...defaultFilter, healthy: false }, 'archive')).toMatchObject({
      closed: true,
      healthy: true,
    });
  });

  it('narrows the text filter to the index only when the text hides it', () => {
    const revealed = revealIndexFilter(indices, { ...defaultFilter, name: 'logs', healthy: false }, 'a.b+c');
    expect(revealed.name).toBe('^a\\.b\\+c$');
    expect(revealed.healthy).toBe(true);
    expect(names(revealed)).toEqual(['a.b+c']);
    expect(escapeRegExp('x(1)')).toBe('x\\(1\\)');
  });
});

describe('liveActivityTiles', () => {
  function counters(id: string, time: number, overrides: Partial<NodeCounters> = {}): NodeCounters {
    return {
      id,
      name: id,
      roles: ['data'],
      timestamp: time,
      indexTotal: 0,
      indexTimeMs: 0,
      queryTotal: 0,
      queryTimeMs: 0,
      fetchTotal: 0,
      getTotal: 0,
      docsCount: 0,
      storeBytes: 0,
      heapPercent: 40,
      osCpuPercent: 20,
      processCpuPercent: 5,
      load1m: 1,
      uptimeMs: null,
      pressureRejected: null,
      write: null,
      search: null,
      ...overrides,
    };
  }

  it('shows gauges at once and rates as collecting until two samples', () => {
    const tiles = liveActivityTiles(
      buildHistory([{ time: 1_000, nodes: [counters('a', 1_000, { heapPercent: 30 }), counters('b', 1_000, { heapPercent: 50 })] }]),
    );
    expect(tiles.map((tile) => [tile.label, tile.value, tile.unit, tile.meta])).toEqual([
      ['Indexing rate', '–', '', 'Collecting samples…'],
      ['Search rate', '–', '', 'Collecting samples…'],
      ['Search latency', '–', '', 'Collecting samples…'],
      ['Avg. heap', '40', '%', 'max 50% on b'],
      ['Avg. OS CPU', '20', '%', 'max 20% on a'],
    ]);
    expect(tiles[3]?.domainMax).toBe(100);
    const paused = liveActivityTiles(buildHistory([{ time: 1_000, nodes: [counters('a', 1_000)] }]), 'Refresh to measure rates');
    expect(paused.map((tile) => tile.meta).slice(0, 3)).toEqual(Array(3).fill('Refresh to measure rates'));
    expect(tiles[0]?.domainMax).toBeUndefined();
    expect(tiles[0]?.minDomain).toBe(1);
  });

  it('shows every tile as pending before the first sample', () => {
    const tiles = liveActivityTiles(buildHistory([]), 'No sample yet');
    expect(tiles.map((tile) => [tile.value, tile.meta])).toEqual(Array(5).fill(['–', 'No sample yet']));
  });

  it('says a rate is not measured, not zero, when the latest sample follows a gap', () => {
    // Indexing 2,000 docs/s every 5s, then the catch-up sample of a tab hidden for 40s.
    const at = (time: number) =>
      counters('a', time, { indexTotal: time * 2, indexTimeMs: time / 100, queryTotal: time / 10, queryTimeMs: time / 5 });
    const history = buildHistory([
      { time: 0, nodes: [at(0)], expected: 5_000 },
      { time: 5_000, nodes: [at(5_000)], expected: 5_000 },
      { time: 45_000, nodes: [at(45_000)], expected: 5_000 },
    ]);
    expect(history.gaps.at(-1)).toBe(true);
    const [indexing, search, latency, heap] = liveActivityTiles(history);
    expect(indexing).toMatchObject({ value: '–', meta: 'Collecting samples…' });
    expect(search).toMatchObject({ value: '–', meta: 'Collecting samples…' });
    expect(latency).toMatchObject({ value: '–', meta: 'Collecting samples…' });
    expect(heap).toMatchObject({ value: '40', meta: '1 node' });
    expect(indexing?.points.map((point) => point.value)).toEqual([null, 2_000, null]);
  });

  it('sums rates and weights the search latency across nodes', () => {
    const history = buildHistory([
      { time: 0, nodes: [counters('a', 0), counters('b', 0)] },
      {
        time: 10_000,
        nodes: [
          counters('a', 10_000, { indexTotal: 1_000, indexTimeMs: 200, queryTotal: 90, queryTimeMs: 90, fetchTotal: 40, heapPercent: 95 }),
          counters('b', 10_000, { indexTotal: 500, indexTimeMs: 100, queryTotal: 10, queryTimeMs: 910, fetchTotal: 10 }),
        ],
      },
    ]);
    const [indexing, search, latency, heap] = liveActivityTiles(history);
    expect(indexing).toMatchObject({ value: '150', unit: 'docs/s', meta: '0.2 ms per document', tone: 'accent' });
    expect(search).toMatchObject({ value: '10', unit: 'shard queries/s', meta: '5 fetches/s' });
    // 1,000ms over 100 queries, not the average of 1ms and 91ms.
    expect(latency).toMatchObject({ value: '10', unit: 'ms', meta: 'Query phase, per shard' });
    // Heap colour follows the window's low (40%), the meta the busiest node's range.
    expect(heap).toMatchObject({ value: '68', unit: '%', meta: 'max 95% on a (low 40%)', tone: 'accent' });
    expect(indexing?.points.map((point) => point.value)).toEqual([null, 150]);
  });

  it('says when nothing was indexed or searched and names a single node', () => {
    const history = buildHistory([
      { time: 0, nodes: [counters('solo', 0, { heapPercent: 91 })] },
      { time: 10_000, nodes: [counters('solo', 10_000, { heapPercent: 91 })] },
    ]);
    const [indexing, search, latency, heap] = liveActivityTiles(history);
    expect(indexing).toMatchObject({ value: '0', meta: 'No documents indexed' });
    expect(search).toMatchObject({ value: '0', meta: '0 fetches/s' });
    expect(latency).toMatchObject({ value: '–', unit: '', meta: 'No queries in the last interval' });
    expect(heap).toMatchObject({ meta: '1 node', tone: 'red' });
  });
});
