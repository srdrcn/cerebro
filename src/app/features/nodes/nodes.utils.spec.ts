import { describe, expect, it } from 'vitest';
import { NodeCounters, buildHistory } from '../../core/metrics';
import { NodesNode } from './nodes.models';
import {
  attributeEntries,
  filterNodes,
  findNodeByName,
  matchesNode,
  nodeCharts,
  threadPoolRows,
  nodeRoles,
  withLiveGauges,
  prettyByteString,
  sortNodes,
  summarizeNodes,
} from './nodes.utils';

function node(
  name: string,
  overrides: Partial<NodesNode> = {},
): NodesNode {
  return {
    id: name,
    name,
    host: null,
    current_master: false,
    master: false,
    data: false,
    ingest: false,
    coordinating: false,
    cpu: { load: 0, process: 0, os: 0 },
    heap: { percent: 0, used: '0b', max: '0b' },
    disk: null,
    uptime: 0,
    jvm: null,
    version: '8.0.0',
    attributes: {},
    ...overrides,
  };
}

describe('node filtering and sorting', () => {
  it('combines a case-insensitive name match with the selected roles', () => {
    const candidate = node('Warm-Node-01', { data: true, ingest: true });

    expect(
      matchesNode(candidate, {
        name: 'warm',
        master: false,
        data: true,
        ingest: false,
        coordinating: false,
      }),
    ).toBe(true);
    expect(
      matchesNode(candidate, {
        name: 'cold',
        master: false,
        data: true,
        ingest: true,
        coordinating: false,
      }),
    ).toBe(false);
  });

  it('filters names with the app-wide regex-or-substring semantics', () => {
    const roles = { master: true, data: true, ingest: true, coordinating: true };
    const nodes = [node('es-hot-1', { data: true }), node('es-warm-1', { data: true }), node('kibana', { data: true })];

    expect(filterNodes(nodes, { ...roles, name: '^es-' }).map((item) => item.name)).toEqual(['es-hot-1', 'es-warm-1']);
    expect(filterNodes(nodes, { ...roles, name: 'hot|warm' }).map((item) => item.name)).toEqual(['es-hot-1', 'es-warm-1']);
    // An invalid expression falls back to a plain substring.
    expect(filterNodes(nodes, { ...roles, name: 'es-[' }).map((item) => item.name)).toEqual([]);
    expect(filterNodes(nodes, { ...roles, name: '' })).toHaveLength(3);
  });

  it('sorts nested numeric fields in both directions', () => {
    const nodes = [
      node('node-b', { cpu: { load: 8, process: 3, os: 4 } }),
      node('node-a', { cpu: { load: 2, process: 1, os: 2 } }),
    ];

    expect(sortNodes(nodes, 'cpu.load', false).map((item) => item.name)).toEqual([
      'node-a',
      'node-b',
    ]);
    expect(sortNodes(nodes, 'cpu.load', true).map((item) => item.name)).toEqual([
      'node-b',
      'node-a',
    ]);
  });
});

describe('node presentation helpers', () => {
  it('hides built-in attributes unless requested', () => {
    const attributes = { zone: 'a', 'ml.config_version': '12', rack: 'r1', 'xpack.installed': 'true' };
    expect(attributeEntries(attributes)).toEqual([
      ['rack', 'r1'],
      ['zone', 'a'],
    ]);
    expect(attributeEntries(attributes, true)).toHaveLength(4);
  });

  it('lists roles with the elected master marked', () => {
    expect(
      nodeRoles(node('n', { master: true, current_master: true, data: true })).map((role) => role.label),
    ).toEqual(['master ★', 'data']);
  });

  it('summarizes the cluster', () => {
    const summary = summarizeNodes([
      node('a', {
        current_master: true,
        heap: { percent: 20, used: '1gb', max: '5gb' },
        cpu: { load: 1, process: 10, os: 5 },
        disk: { percent: 50, available: 50, total: 100 },
      }),
      node('b', {
        version: '8.1.0',
        heap: { percent: 40, used: '2gb', max: '5gb' },
        cpu: { load: 1, process: null, os: 5 },
        disk: null,
      }),
    ]);
    expect(summary).toEqual({
      total: 2,
      master: 'a',
      versions: ['8.0.0', '8.1.0'],
      averageHeap: 30,
      diskUsed: 50,
      diskTotal: 100,
    });
  });

  it('prettifies Elasticsearch byte strings', () => {
    expect(prettyByteString('274mb')).toBe('274 MB');
    expect(prettyByteString('1.5gb')).toBe('1.5 GB');
    expect(prettyByteString('weird')).toBe('weird');
    expect(prettyByteString(null)).toBe('–');
  });
});

describe('findNodeByName', () => {
  it('matches the exact name only', () => {
    const nodes = [node('es-node-1'), node('es-node-10')];
    expect(findNodeByName(nodes, 'es-node-1')?.name).toBe('es-node-1');
    expect(findNodeByName(nodes, 'es-node')).toBeUndefined();
    expect(findNodeByName(nodes, 'ES-NODE-1')).toBeUndefined();
  });
});

describe('live activity of a node', () => {
  function counters(time: number, overrides: Partial<NodeCounters> = {}): NodeCounters {
    return {
      id: 'n1',
      name: 'es-node-1',
      roles: ['data'],
      timestamp: time,
      indexTotal: time / 100,
      indexTimeMs: time / 1000,
      queryTotal: time / 1000,
      queryTimeMs: time / 500,
      fetchTotal: 0,
      getTotal: 0,
      docsCount: 0,
      storeBytes: 0,
      heapPercent: 40,
      osCpuPercent: 30,
      processCpuPercent: 12,
      load1m: 1.25,
      uptimeMs: null,
      pressureRejected: null,
      write: { threads: 4, active: 1, queue: 2, rejected: 3, completed: 100, largest: 4 },
      search: { threads: 7, active: 0, queue: 0, rejected: 0, completed: 100, largest: 7 },
      ...overrides,
    };
  }

  // 10 seconds apart: 100 documents (10/s) at 0.1 ms each, 10 queries (1/s) at 2 ms each.
  const samples = [
    { time: 10_000, nodes: [counters(10_000, { heapPercent: 30 })] },
    { time: 20_000, nodes: [counters(20_000, { heapPercent: 80, write: { threads: 4, active: 3, queue: 9, rejected: 3, completed: 200, largest: 4 } })] },
    {
      time: 30_000,
      nodes: [counters(30_000, { heapPercent: 92, write: { threads: 4, active: 2, queue: 1, rejected: 8, completed: 300, largest: 4 } })],
    },
  ];
  const history = buildHistory(samples);
  const series = history.nodes[0];

  it('lists the charts with the latest value, unit, range and tone', () => {
    const charts = nodeCharts(series);
    expect(charts.map((chart) => chart.key)).toEqual([
      'processCpu',
      'heap',
      'load',
      'getRate',
      'indexingRate',
      'indexingLatency',
      'searchRate',
      'searchLatency',
    ]);
    const byKey = new Map(charts.map((chart) => [chart.key, chart]));
    // Heap peaks at 92% but fell to 30% after a collection: not under pressure.
    expect(byKey.get('heap')).toMatchObject({ value: '92', unit: '%', range: 'low 30% · high 92%', tone: 'accent', domainMax: 100 });
    expect(byKey.get('indexingRate')).toMatchObject({ value: '10', unit: 'docs/s', range: 'low 10/s · high 10/s', tone: 'accent' });
    expect(byKey.get('indexingRate')?.domainMax).toBeUndefined();
    expect(byKey.get('indexingRate')?.minDomain).toBe(1);
    expect(byKey.get('getRate')?.minDomain).toBe(1);
    expect(byKey.get('indexingLatency')).toMatchObject({ value: '0.1', unit: 'ms' });
    expect(byKey.get('searchRate')).toMatchObject({ value: '1', unit: 'shard queries/s' });
    expect(byKey.get('searchLatency')).toMatchObject({ value: '2', unit: 'ms' });
    expect(byKey.get('load')).toMatchObject({ value: '1.25', unit: '' });
  });

  it('has empty charts before the first sample', () => {
    const charts = nodeCharts(undefined);
    expect(charts).toHaveLength(8);
    expect(charts.every((chart) => chart.value === '–' && chart.unit === '' && chart.range === '' && chart.points.length === 0)).toBe(true);
  });

  it('summarizes the thread pools: current state, peak queue and rejections', () => {
    const latest = samples[2]!.nodes[0];
    expect(threadPoolRows(series, latest)).toEqual([
      { name: 'Write', active: 2, threads: 4, queue: 1, peakQueue: 9, rejectedInWindow: 5, rejectedTotal: 8 },
      { name: 'Search', active: 0, threads: 7, queue: 0, peakQueue: 0, rejectedInWindow: 0, rejectedTotal: 0 },
    ]);
    expect(threadPoolRows(series, latest)).toHaveLength(2);
    expect(threadPoolRows(undefined, undefined)[0]).toEqual({
      name: 'Write',
      active: null,
      threads: null,
      queue: null,
      peakQueue: null,
      rejectedInWindow: null,
      rejectedTotal: null,
    });
  });

  it('adds indexing pressure rejections when the node reports them', () => {
    const pressured = buildHistory([
      { time: 10_000, nodes: [counters(10_000, { pressureRejected: 100 })] },
      { time: 20_000, nodes: [counters(20_000, { pressureRejected: 140 })] },
    ]);
    const rows = threadPoolRows(pressured.nodes[0], { ...counters(20_000), pressureRejected: 140 });
    expect(rows.map((row) => row.name)).toEqual(['Write', 'Search', 'Indexing pressure']);
    expect(rows[2]).toEqual({
      name: 'Indexing pressure',
      active: null,
      threads: null,
      queue: null,
      peakQueue: null,
      rejectedInWindow: 40,
      rejectedTotal: 140,
    });
    // The write pool itself rejected nothing in the window.
    expect(rows[0]?.rejectedInWindow).toBe(0);
  });

  it('shows the gauges of the latest metrics sample so cells and sparklines agree', () => {
    const nodes = [
      node('es-node-1', { id: 'n1', cpu: { load: 2, process: 1, os: 16 }, heap: { percent: 40, used: '400mb', max: '1gb' } }),
      node('es-node-2', { id: 'n2', cpu: { load: 3, process: 7, os: 20 }, heap: { percent: 50, used: '500mb', max: '1gb' } }),
    ];
    const latest = new Map([['n1', counters(1, { processCpuPercent: 2, heapPercent: 61, osCpuPercent: null })]]);
    const [first, second] = withLiveGauges(nodes, latest);
    expect(first).toMatchObject({ cpu: { load: 1.25, process: 2, os: 16 }, heap: { percent: 61, used: '400mb' } });
    // Not in the sample: the nodes request's values.
    expect(second).toBe(nodes[1]);
    expect(withLiveGauges(nodes, new Map())).toBe(nodes);
  });
});
