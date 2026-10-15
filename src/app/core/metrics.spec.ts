import { describe, expect, it } from 'vitest';
import {
  MAX_SAMPLES,
  METRICS,
  MetricSeries,
  MetricsSample,
  NodeCounters,
  STALE_HISTORY_MS,
  answeredLabel,
  appendSample,
  buildHistory,
  busiestNode,
  currentValue,
  formatLatency,
  formatMetric,
  formatRate,
  latestValue,
  metricFormatter,
  metricParts,
  metricTone,
  nodeInterval,
  parseNodeMetrics,
  sampleGaps,
  seriesTone,
  seriesTotal,
  summarizeSeries,
} from './metrics';

/* Two `POST metrics/nodes` responses of the demo cluster, 5s apart, while
   bulk indexing and searching tmp-metrics-load (data tier roles trimmed; the
   `_nodes`, uptime and indexing pressure fields are the ones the backend is
   asked to add). Node timestamps differ by a few milliseconds, as on a real
   cluster: es-node-2 took its first statistics 23ms late and es-node-3 its
   second 20ms early, so their intervals are 5,027ms and 5,030ms. */
const SAMPLE_1 = {
  _nodes: { total: 3, successful: 3, failed: 0 },
  nodes: {
    "wEqTWTA0T2CktRBr56viXg": {"timestamp": 1792013375294, "name": "es-node-2", "roles": ["data", "ingest", "master"], "indices": {"docs": {"count": 46797}, "store": {"size_in_bytes": 6489331}, "indexing": {"index_total": 40311, "index_time_in_millis": 1701}, "get": {"total": 1}, "search": {"query_total": 5998, "query_time_in_millis": 81854, "fetch_total": 557}}, "os": {"cpu": {"percent": 13, "load_average": {"1m": 2.09, "5m": 1.77, "15m": 1.27}}}, "process": {"cpu": {"percent": 4}}, "jvm": {"uptime_in_millis": 24055094, "mem": {"heap_used_percent": 40}}, "indexing_pressure": {"memory": {"total": {"coordinating_rejections": 0, "primary_rejections": 0, "replica_rejections": 0}}}, "thread_pool": {"search": {"threads": 7, "queue": 0, "active": 0, "rejected": 0, "largest": 7, "completed": 7023}, "write": {"threads": 4, "queue": 0, "active": 0, "rejected": 0, "largest": 4, "completed": 1968}}},
    "dmdk_a7-TrKWtlTZ9-ZHzQ": {"timestamp": 1792013375271, "name": "es-node-3", "roles": ["data", "ingest", "master"], "indices": {"docs": {"count": 47883}, "store": {"size_in_bytes": 6290962}, "indexing": {"index_total": 31738, "index_time_in_millis": 1721}, "get": {"total": 0}, "search": {"query_total": 7211, "query_time_in_millis": 65585, "fetch_total": 288}}, "os": {"cpu": {"percent": 13, "load_average": {"1m": 2.09, "5m": 1.77, "15m": 1.27}}}, "process": {"cpu": {"percent": 2}}, "jvm": {"uptime_in_millis": 24054984, "mem": {"heap_used_percent": 57}}, "indexing_pressure": {"memory": {"total": {"coordinating_rejections": 0, "primary_rejections": 0, "replica_rejections": 0}}}, "thread_pool": {"search": {"threads": 7, "queue": 0, "active": 0, "rejected": 0, "largest": 7, "completed": 7968}, "write": {"threads": 4, "queue": 0, "active": 0, "rejected": 0, "largest": 4, "completed": 1772}}},
    "I7MELLk0RvSiAPhRW6211Q": {"timestamp": 1792013375271, "name": "es-node-1", "roles": ["data", "ingest", "master"], "indices": {"docs": {"count": 37903}, "store": {"size_in_bytes": 5077796}, "indexing": {"index_total": 23258, "index_time_in_millis": 1445}, "get": {"total": 2}, "search": {"query_total": 7147, "query_time_in_millis": 99778, "fetch_total": 301}}, "os": {"cpu": {"percent": 13, "load_average": {"1m": 2.09, "5m": 1.77, "15m": 1.27}}}, "process": {"cpu": {"percent": 4}}, "jvm": {"uptime_in_millis": 24055044, "mem": {"heap_used_percent": 23}}, "indexing_pressure": {"memory": {"total": {"coordinating_rejections": 0, "primary_rejections": 0, "replica_rejections": 0}}}, "thread_pool": {"search": {"threads": 7, "queue": 1, "active": 0, "rejected": 0, "largest": 7, "completed": 11536}, "write": {"threads": 4, "queue": 0, "active": 1, "rejected": 0, "largest": 4, "completed": 1784}}},
  },
};

const SAMPLE_2 = {
  _nodes: { total: 3, successful: 3, failed: 0 },
  nodes: {
    "wEqTWTA0T2CktRBr56viXg": {"timestamp": 1792013380321, "name": "es-node-2", "roles": ["data", "ingest", "master"], "indices": {"docs": {"count": 53197}, "store": {"size_in_bytes": 6489331}, "indexing": {"index_total": 46711, "index_time_in_millis": 1770}, "get": {"total": 1}, "search": {"query_total": 6224, "query_time_in_millis": 82050, "fetch_total": 643}}, "os": {"cpu": {"percent": 35, "load_average": {"1m": 2.56, "5m": 1.87, "15m": 1.31}}}, "process": {"cpu": {"percent": 12}}, "jvm": {"uptime_in_millis": 24060144, "mem": {"heap_used_percent": 24}}, "indexing_pressure": {"memory": {"total": {"coordinating_rejections": 0, "primary_rejections": 0, "replica_rejections": 0}}}, "thread_pool": {"search": {"threads": 7, "queue": 0, "active": 0, "rejected": 0, "largest": 7, "completed": 7335}, "write": {"threads": 4, "queue": 0, "active": 0, "rejected": 0, "largest": 4, "completed": 2160}}},
    "dmdk_a7-TrKWtlTZ9-ZHzQ": {"timestamp": 1792013380301, "name": "es-node-3", "roles": ["data", "ingest", "master"], "indices": {"docs": {"count": 52021}, "store": {"size_in_bytes": 6290962}, "indexing": {"index_total": 35983, "index_time_in_millis": 1762}, "get": {"total": 0}, "search": {"query_total": 7440, "query_time_in_millis": 65765, "fetch_total": 348}}, "os": {"cpu": {"percent": 35, "load_average": {"1m": 2.56, "5m": 1.87, "15m": 1.31}}}, "process": {"cpu": {"percent": 9}}, "jvm": {"uptime_in_millis": 24060034, "mem": {"heap_used_percent": 32}}, "indexing_pressure": {"memory": {"total": {"coordinating_rejections": 0, "primary_rejections": 0, "replica_rejections": 0}}}, "thread_pool": {"search": {"threads": 7, "queue": 0, "active": 0, "rejected": 0, "largest": 7, "completed": 8257}, "write": {"threads": 4, "queue": 0, "active": 0, "rejected": 0, "largest": 4, "completed": 1900}}},
    "I7MELLk0RvSiAPhRW6211Q": {"timestamp": 1792013380321, "name": "es-node-1", "roles": ["data", "ingest", "master"], "indices": {"docs": {"count": 40025}, "store": {"size_in_bytes": 5077796}, "indexing": {"index_total": 25413, "index_time_in_millis": 1463}, "get": {"total": 2}, "search": {"query_total": 7352, "query_time_in_millis": 99955, "fetch_total": 375}}, "os": {"cpu": {"percent": 35, "load_average": {"1m": 2.56, "5m": 1.87, "15m": 1.31}}}, "process": {"cpu": {"percent": 12}}, "jvm": {"uptime_in_millis": 24060094, "mem": {"heap_used_percent": 70}}, "indexing_pressure": {"memory": {"total": {"coordinating_rejections": 0, "primary_rejections": 0, "replica_rejections": 0}}}, "thread_pool": {"search": {"threads": 7, "queue": 2, "active": 0, "rejected": 0, "largest": 7, "completed": 12255}, "write": {"threads": 4, "queue": 0, "active": 0, "rejected": 0, "largest": 4, "completed": 1879}}},
  },
};

/** Browser receive times of the two samples. */
const T1 = 1_792_013_375_400;
const T2 = T1 + 5_050;

function counters(overrides: Partial<NodeCounters> = {}): NodeCounters {
  return {
    id: 'n1',
    name: 'node-1',
    roles: ['data'],
    timestamp: 1_000_000,
    indexTotal: 1_000,
    indexTimeMs: 500,
    queryTotal: 2_000,
    queryTimeMs: 4_000,
    fetchTotal: 300,
    getTotal: 10,
    docsCount: 5_000,
    storeBytes: 1_024,
    heapPercent: 40,
    osCpuPercent: 20,
    processCpuPercent: 10,
    load1m: 1.5,
    uptimeMs: null,
    pressureRejected: null,
    write: { threads: 4, active: 1, queue: 0, rejected: 2, completed: 900, largest: 4 },
    search: { threads: 7, active: 0, queue: 3, rejected: 5, completed: 1_800, largest: 7 },
    ...overrides,
  };
}

/** A sample of the given nodes, each advanced by `step` seconds of activity. */
function sample(time: number, nodes: readonly NodeCounters[]): MetricsSample {
  return { time, nodes };
}

function values(series: MetricSeries): (number | null)[] {
  return series.map((point) => (point.value === null ? null : Math.round(point.value * 1000) / 1000));
}

describe('parseNodeMetrics', () => {
  it('reads the counters of every node, sorted by name', () => {
    const parsed = parseNodeMetrics(SAMPLE_1, T1);

    expect(parsed.time).toBe(T1);
    expect(parsed.nodes.map((node) => node.name)).toEqual(['es-node-1', 'es-node-2', 'es-node-3']);
    expect(parsed.nodes[0]).toEqual({
      id: 'I7MELLk0RvSiAPhRW6211Q',
      name: 'es-node-1',
      roles: ['data', 'ingest', 'master'],
      timestamp: 1792013375271,
      indexTotal: 23258,
      indexTimeMs: 1445,
      queryTotal: 7147,
      queryTimeMs: 99778,
      fetchTotal: 301,
      getTotal: 2,
      docsCount: 37903,
      storeBytes: 5077796,
      heapPercent: 23,
      osCpuPercent: 13,
      processCpuPercent: 4,
      load1m: 2.09,
      uptimeMs: 24055044,
      write: { threads: 4, active: 1, queue: 0, rejected: 0, completed: 1784, largest: 4 },
      search: { threads: 7, active: 0, queue: 1, rejected: 0, completed: 11536, largest: 7 },
      pressureRejected: 0,
    });
    expect(parsed.totalNodes).toBe(3);
    expect(parsed.failedNodes).toBe(0);
    expect(parsed.expected).toBeUndefined();
    expect(parseNodeMetrics(SAMPLE_1, T1, 5_000).expected).toBe(5_000);
  });

  it('tolerates missing sections, old load averages and the 6.x bulk pool', () => {
    const parsed = parseNodeMetrics(
      {
        nodes: {
          a: { name: 'old', os: { cpu: { load_average: [0.5, 0.4, 0.3] } }, thread_pool: { bulk: { queue: 4 } } },
          b: { os: { cpu: { load_average: '1.25' } } },
          c: 'not a node',
          d: { name: 'ancient', os: { load_average: [3, 2, 1] } },
          e: { name: 'pressure', indexing_pressure: { memory: { total: { primary_rejections: 4, replica_rejections: 3 } } } },
        },
      },
      1,
    );

    expect(parsed.nodes).toHaveLength(4);
    expect(parsed.totalNodes).toBeNull();
    const [ancient, b, old, pressure] = parsed.nodes;
    expect(ancient?.load1m).toBe(3);
    expect(pressure?.pressureRejected).toBe(7);
    expect(old?.pressureRejected).toBeNull();
    expect(old?.uptimeMs).toBeNull();
    expect(old?.load1m).toBe(0.5);
    expect(old?.write?.queue).toBe(4);
    expect(old?.search).toBeNull();
    expect(old?.timestamp).toBeNull();
    expect(old?.indexTotal).toBeNull();
    expect(b?.name).toBe('b');
    expect(b?.load1m).toBe(1.25);
  });

  it('gives no nodes for an unexpected body', () => {
    expect(parseNodeMetrics(null, 1).nodes).toEqual([]);
    expect(parseNodeMetrics({}, 1).nodes).toEqual([]);
    expect(parseNodeMetrics({ nodes: [] }, 1).nodes).toEqual([]);
  });
});

describe('appendSample', () => {
  it('keeps at most the limit, dropping the oldest', () => {
    let samples: readonly MetricsSample[] = [];
    for (let index = 1; index <= MAX_SAMPLES + 5; index++) {
      samples = appendSample(samples, sample(index * 1000, []));
    }
    expect(samples).toHaveLength(MAX_SAMPLES);
    expect(samples[0]?.time).toBe(6000);
    expect(appendSample([sample(1, []), sample(2, []), sample(3, [])], sample(4, []), 2).map((s) => s.time)).toEqual([3, 4]);
  });

  it('ignores a sample that is not newer and starts over after a long pause', () => {
    const samples = [sample(10_000, []), sample(20_000, [])];
    expect(appendSample(samples, sample(20_000, []))).toBe(samples);
    expect(appendSample(samples, sample(5_000, []))).toBe(samples);
    expect(appendSample(samples, sample(20_000 + STALE_HISTORY_MS + 1, [])).map((s) => s.time)).toEqual([
      20_000 + STALE_HISTORY_MS + 1,
    ]);
    expect(appendSample(samples, sample(20_000 + STALE_HISTORY_MS, []))).toHaveLength(3);
  });
});

describe('nodeInterval', () => {
  it('measures the deltas over the node timestamps', () => {
    const before = counters();
    const after = counters({
      timestamp: 1_010_000,
      indexTotal: 1_500,
      indexTimeMs: 750,
      queryTotal: 2_100,
      queryTimeMs: 4_300,
      fetchTotal: 350,
      getTotal: 12,
      write: { threads: 4, active: 0, queue: 0, rejected: 7, completed: 1_000, largest: 4 },
    });

    expect(nodeInterval(before, after)).toEqual({
      seconds: 10,
      indexed: 500,
      indexTimeMs: 250,
      queries: 100,
      queryTimeMs: 300,
      fetches: 50,
      gets: 2,
      writeRejected: 5,
      searchRejected: 0,
      writeCompleted: 100,
      searchCompleted: 0,
      pressureRejected: null,
    });
  });

  it('measures indexing pressure rejections when the node reports them', () => {
    const interval = nodeInterval(
      counters({ pressureRejected: 10 }),
      counters({ timestamp: 1_005_000, pressureRejected: 25 }),
    );
    expect(interval?.pressureRejected).toBe(15);
  });

  it('has no interval when the node restarted in between, even if counters grew', () => {
    const before = counters({ uptimeMs: 600_000, getTotal: 2 });
    // Restarted 4s ago: get.total went 2 → 15 since the restart.
    const restarted = counters({ timestamp: 1_010_000, uptimeMs: 4_000, getTotal: 15 });
    expect(nodeInterval(before, restarted)).toBeNull();
    // Up for longer than the old uptime, but for less than the interval.
    const quick = counters({ uptimeMs: 1_000 });
    expect(nodeInterval(quick, counters({ timestamp: 1_010_000, uptimeMs: 5_000 }))).toBeNull();
    expect(nodeInterval(before, counters({ timestamp: 1_010_000, uptimeMs: 610_000, getTotal: 2 }))?.gets).toBe(0);
  });

  it('skips a counter group that went backwards (restart) and keeps the others', () => {
    const interval = nodeInterval(
      counters(),
      counters({ timestamp: 1_005_000, indexTotal: 20, indexTimeMs: 3, queryTotal: 2_010, queryTimeMs: 4_020 }),
    );
    expect(interval?.indexed).toBeNull();
    expect(interval?.indexTimeMs).toBeNull();
    expect(interval?.queries).toBe(10);
    expect(interval?.queryTimeMs).toBe(20);
  });

  it('has no interval without time passing', () => {
    expect(nodeInterval(counters(), counters())).toBeNull();
    expect(nodeInterval(counters(), counters({ timestamp: 999_000 }))).toBeNull();
  });

  it('falls back to the sample spacing when a node has no timestamp', () => {
    const interval = nodeInterval(counters({ timestamp: null }), counters({ timestamp: null, indexTotal: 1_100 }), 4);
    expect(interval?.seconds).toBe(4);
    expect(interval?.indexed).toBe(100);
    expect(nodeInterval(counters({ timestamp: null }), counters({ timestamp: null }))).toBeNull();
  });

  it('treats a missing counter as unmeasurable', () => {
    const interval = nodeInterval(counters({ getTotal: null }), counters({ timestamp: 1_001_000 }));
    expect(interval?.gets).toBeNull();
    expect(interval?.indexed).toBe(0);
  });
});

describe('sampleGaps', () => {
  it('breaks the line when samples are much further apart than usual', () => {
    const times = [0, 15_000, 30_000, 45_000, 200_000, 215_000];
    expect(sampleGaps(times)).toEqual([false, false, false, false, true, false]);
  });

  it('never calls a short pause a gap', () => {
    expect(sampleGaps([0, 5_000, 10_000, 35_000])).toEqual([false, false, false, false]);
    expect(sampleGaps([0, 5_000, 10_000, 41_000])).toEqual([false, false, false, true]);
  });

  it('has no gap before two samples', () => {
    expect(sampleGaps([])).toEqual([]);
    expect(sampleGaps([5])).toEqual([false]);
  });

  /** Times and intervals of `count` samples at `every` ms after `from`. */
  function run(from: number, every: number, count: number): { times: number[]; expected: number[] } {
    return {
      times: Array.from({ length: count }, (_, index) => from + (index + 1) * every),
      expected: Array.from({ length: count }, () => every),
    };
  }

  it.each([
    [5_000, 60_000],
    [15_000, 60_000],
    [5_000, 30_000],
  ])('keeps joining samples after auto refresh switches from %ims to %ims', (before, after) => {
    const first = run(0, before, 60);
    const second = run(first.times.at(-1)!, after, 20);
    const gaps = sampleGaps([...first.times, ...second.times], [...first.expected, ...second.expected]);
    expect(gaps.filter(Boolean)).toEqual([]);
  });

  it('marks a hidden tab or a sleeping laptop as a gap at the interval the samples were taken at', () => {
    // Every 5s, then the catch-up tick of a tab hidden for 40s.
    expect(sampleGaps([0, 5_000, 10_000, 50_000, 55_000], [5_000, 5_000, 5_000, 5_000, 5_000])).toEqual([
      false,
      false,
      false,
      true,
      false,
    ]);
    // Every 1m: 2.5 minutes is not a gap, 4 minutes is.
    expect(sampleGaps([0, 60_000, 210_000, 450_000], [60_000, 60_000, 60_000, 60_000])).toEqual([
      false,
      false,
      false,
      true,
    ]);
  });

  it('applies the 30s rule to samples taken while paused', () => {
    expect(sampleGaps([0, 20_000, 60_000], [0, 0, 0])).toEqual([false, false, true]);
    // Paused after sampling every minute: the sample before the pause still counts.
    expect(sampleGaps([0, 60_000, 150_000], [60_000, 60_000, 0])).toEqual([false, false, false]);
  });

  it('falls back to the recent spacing when the samples do not say their interval', () => {
    // Without `expected`, a switch to 1m costs a few intervals, not half the buffer.
    const first = run(0, 5_000, 60).times;
    const second = run(first.at(-1)!, 60_000, 6).times;
    const gaps = sampleGaps([...first, ...second]);
    expect(gaps.slice(60)).toEqual([true, true, true, false, false, false]);
  });
});

describe('buildHistory', () => {
  const live = [parseNodeMetrics(SAMPLE_1, T1), parseNodeMetrics(SAMPLE_2, T2)];

  it('computes per-node rates and latencies from the live samples', () => {
    const history = buildHistory(live);

    expect(history.ready).toBe(true);
    expect(history.times).toEqual([T1, T2]);
    expect(history.span).toBe(5_050);
    expect(history.nodes.map((node) => node.name)).toEqual(['es-node-1', 'es-node-2', 'es-node-3']);
    const [node1, node2, node3] = history.nodes;
    // es-node-1: 2,155 documents and 205 queries in 5.05s.
    expect(values(node1!.series.indexingRate)).toEqual([null, 426.733]);
    expect(values(node1!.series.indexingLatency)).toEqual([null, 0.008]);
    expect(values(node1!.series.searchRate)).toEqual([null, 40.594]);
    expect(values(node1!.series.searchLatency)).toEqual([null, 0.863]);
    expect(values(node1!.series.fetchRate)).toEqual([null, 14.653]);
    expect(values(node1!.series.getRate)).toEqual([null, 0]);
    // Each node over its own interval: 6,400 documents in 5.027s, 229
    // queries in 5.03s (not the 5.05s between the browser's two samples).
    expect(values(node2!.series.indexingRate)).toEqual([null, 1273.125]);
    expect(values(node3!.series.searchRate)).toEqual([null, 45.527]);
    expect(values(node3!.series.searchRate)).not.toEqual([null, Math.round((229 / 5.05) * 1000) / 1000]);
    // Gauges are read at every sample, including the first.
    expect(values(node1!.series.heap)).toEqual([23, 70]);
    expect(values(node1!.series.cpu)).toEqual([13, 35]);
    expect(values(node1!.series.processCpu)).toEqual([4, 12]);
    expect(values(node1!.series.load)).toEqual([2.09, 2.56]);
    expect(values(node1!.series.searchQueue)).toEqual([1, 2]);
    expect(values(node1!.series.writeActive)).toEqual([1, 0]);
    expect(values(node1!.series.writeRejected)).toEqual([null, 0]);
  });

  it('sums rates, averages gauges and weights latencies by counts for the cluster', () => {
    const { cluster } = buildHistory(live);

    // 12,800 documents (2,155 + 6,400 + 4,245), each node over its own
    // interval; 128ms spent indexing them.
    expect(values(cluster.indexingRate)).toEqual([null, 2543.794]);
    expect(values(cluster.indexingLatency)).toEqual([null, 0.01]);
    // 660 queries (205 + 226 + 229), 553ms in the query phase.
    expect(values(cluster.searchRate)).toEqual([null, 131.078]);
    expect(values(cluster.searchLatency)).toEqual([null, 0.838]);
    expect(values(cluster.heap)).toEqual([40, 42]);
    expect(values(cluster.cpu)).toEqual([13, 35]);
    expect(values(cluster.processCpu)).toEqual([3.333, 11]);
    expect(values(cluster.searchQueue)).toEqual([1, 2]);
    expect(values(cluster.writeRejected)).toEqual([null, 0]);
  });

  it('weights the cluster latency by each node’s count, not by node', () => {
    const busy = counters({ id: 'a', name: 'a', timestamp: 10_000, queryTotal: 1_000, queryTimeMs: 0 });
    const idle = counters({ id: 'b', name: 'b', timestamp: 10_000, queryTotal: 1_000, queryTimeMs: 0 });
    const history = buildHistory([
      sample(10_000, [busy, idle]),
      sample(20_000, [
        { ...busy, timestamp: 20_000, queryTotal: 1_900, queryTimeMs: 900 },
        { ...idle, timestamp: 20_000, queryTotal: 1_100, queryTimeMs: 1_000 },
      ]),
    ]);
    // Per node 1ms and 10ms per query; 1,900ms for 1,000 queries overall.
    expect(values(history.nodes[0]!.series.searchLatency)).toEqual([null, 1]);
    expect(values(history.nodes[1]!.series.searchLatency)).toEqual([null, 10]);
    expect(values(history.cluster.searchLatency)).toEqual([null, 1.9]);
  });

  it('has no latency in an interval without queries', () => {
    const history = buildHistory([
      sample(10_000, [counters({ timestamp: 10_000 })]),
      sample(20_000, [counters({ timestamp: 20_000 })]),
    ]);
    expect(values(history.cluster.searchRate)).toEqual([null, 0]);
    expect(values(history.cluster.searchLatency)).toEqual([null, null]);
    expect(values(history.cluster.indexingLatency)).toEqual([null, null]);
  });

  it('skips the interval of a restarted node and resumes after it', () => {
    const history = buildHistory([
      sample(10_000, [counters({ timestamp: 10_000, indexTotal: 5_000 })]),
      sample(20_000, [counters({ timestamp: 20_000, indexTotal: 40, indexTimeMs: 4 })]),
      sample(30_000, [counters({ timestamp: 30_000, indexTotal: 140, indexTimeMs: 14 })]),
    ]);
    expect(values(history.nodes[0]!.series.indexingRate)).toEqual([null, null, 10]);
    expect(values(history.cluster.indexingRate)).toEqual([null, null, 10]);
    expect(values(history.cluster.indexingLatency)).toEqual([null, null, 0.1]);
  });

  it('follows nodes that join and leave', () => {
    const a = (time: number, total: number) => counters({ id: 'a', name: 'node-a', timestamp: time, indexTotal: total });
    const b = (time: number, total: number) => counters({ id: 'b', name: 'node-b', timestamp: time, indexTotal: total });
    const history = buildHistory([
      sample(10_000, [a(10_000, 0)]),
      sample(20_000, [a(20_000, 100), b(20_000, 0)]),
      sample(30_000, [b(30_000, 300)]),
    ]);
    const [nodeA, nodeB] = history.nodes;
    expect(nodeA?.present).toBe(false);
    expect(nodeB?.present).toBe(true);
    expect(values(nodeA!.series.indexingRate)).toEqual([null, 10, null]);
    expect(values(nodeA!.series.heap)).toEqual([40, 40, null]);
    expect(values(nodeB!.series.indexingRate)).toEqual([null, null, 30]);
    expect(values(history.cluster.indexingRate)).toEqual([null, 10, 30]);
    expect(values(history.cluster.heap)).toEqual([40, 40, 40]);
  });

  it('does not measure rates across a gap but keeps the gauges', () => {
    const at = (time: number, total: number, heap: number) =>
      counters({ timestamp: time, indexTotal: total, heapPercent: heap });
    const history = buildHistory([
      sample(0, [at(0, 0, 10)]),
      sample(15_000, [at(15_000, 150, 20)]),
      sample(30_000, [at(30_000, 300, 30)]),
      sample(300_000, [at(300_000, 9_000, 40)]),
      sample(315_000, [at(315_000, 9_300, 50)]),
    ]);
    expect(history.gaps).toEqual([false, false, false, true, false]);
    expect(values(history.cluster.indexingRate)).toEqual([null, 10, 10, null, 20]);
    expect(values(history.cluster.heap)).toEqual([10, 20, 30, 40, 50]);
    expect(history.cluster.heap.map((point) => point.gap)).toEqual([false, false, false, true, false]);
  });

  it('measures a node that missed a sample over both intervals', () => {
    const a = (time: number, total: number) => counters({ id: 'a', name: 'node-a', timestamp: time, indexTotal: total });
    const b = (time: number, total: number) => counters({ id: 'b', name: 'node-b', timestamp: time, indexTotal: total });
    const history = buildHistory([
      sample(10_000, [a(10_000, 0), b(10_000, 0)]),
      sample(20_000, [a(20_000, 100)]),
      sample(30_000, [a(30_000, 200), b(30_000, 600)]),
    ]);
    // node-b: 600 documents in 20s.
    expect(values(history.nodes[1]!.series.indexingRate)).toEqual([null, null, 30]);
    expect(values(history.cluster.indexingRate)).toEqual([null, 10, 40]);
  });

  it('does not measure a node across a gap, even when it missed the samples in between', () => {
    const a = (time: number, total: number) => counters({ id: 'a', name: 'node-a', timestamp: time, indexTotal: total });
    const b = (time: number, total: number) => counters({ id: 'b', name: 'node-b', timestamp: time, indexTotal: total });
    const history = buildHistory([
      { time: 0, nodes: [a(0, 0), b(0, 0)], expected: 5_000 },
      { time: 5_000, nodes: [a(5_000, 50)], expected: 5_000 },
      { time: 100_000, nodes: [a(100_000, 1_000)], expected: 5_000 },
      { time: 105_000, nodes: [a(105_000, 1_050), b(105_000, 5_000)], expected: 5_000 },
    ]);
    expect(history.gaps).toEqual([false, false, true, false]);
    expect(values(history.nodes[1]!.series.indexingRate)).toEqual([null, null, null, null]);
  });

  it('leaves the cluster sums out of a sample some nodes did not answer', () => {
    const a = (time: number, total: number) => counters({ id: 'a', name: 'node-a', timestamp: time, indexTotal: total });
    const b = (time: number, total: number) => counters({ id: 'b', name: 'node-b', timestamp: time, indexTotal: total });
    const history = buildHistory([
      { time: 10_000, nodes: [a(10_000, 0), b(10_000, 0)], totalNodes: 2, failedNodes: 0 },
      { time: 20_000, nodes: [a(20_000, 100)], totalNodes: 2, failedNodes: 1 },
      { time: 30_000, nodes: [a(30_000, 200), b(30_000, 400)], totalNodes: 2, failedNodes: 0 },
    ]);
    expect(history.partial).toEqual([false, true, false]);
    expect(values(history.cluster.indexingRate)).toEqual([null, null, 30]);
    expect(values(history.cluster.heap)).toEqual([40, 40, 40]);
    expect(values(history.nodes[0]!.series.indexingRate)).toEqual([null, 10, 10]);
    expect(history.answered).toEqual({ answered: 2, total: 2 });
    expect(buildHistory(history.times.slice(0, 2).map((time, index) => ({
      time,
      nodes: [a(time, index * 100)],
      totalNodes: 2,
      failedNodes: index,
    }))).answered).toEqual({ answered: 1, total: 2 });
  });

  it('counts indexing pressure rejections apart from the write pool', () => {
    const history = buildHistory([
      sample(10_000, [counters({ timestamp: 10_000, pressureRejected: 5 })]),
      sample(20_000, [counters({ timestamp: 20_000, pressureRejected: 45 })]),
    ]);
    // The write pool rejected nothing (2 → 2), indexing pressure 40.
    expect(values(history.cluster.writeRejected)).toEqual([null, 0]);
    expect(values(history.cluster.pressureRejected)).toEqual([null, 40]);
    // Not reported (before 7.9, or not requested): no value at all.
    expect(values(buildHistory([sample(1, [counters({ timestamp: 1 })]), sample(2, [counters({ timestamp: 2 })])]).cluster.pressureRejected)).toEqual([null, null]);
  });

  it('is empty and not ready before two samples', () => {
    expect(buildHistory([])).toMatchObject({ times: [], ready: false, span: 0, nodes: [], answered: null });
    const one = buildHistory([parseNodeMetrics(SAMPLE_1, T1)]);
    expect(one.ready).toBe(false);
    expect(values(one.cluster.heap)).toEqual([40]);
    expect(values(one.cluster.indexingRate)).toEqual([null]);
  });
});

describe('reading series', () => {
  const series: MetricSeries = [
    { time: 1, value: 4, gap: false },
    { time: 2, value: 10, gap: false },
    { time: 3, value: 1, gap: false },
    { time: 4, value: null, gap: false },
  ];

  it('summarizes the window', () => {
    expect(summarizeSeries(series)).toEqual({ current: 1, min: 1, max: 10, average: 5, count: 3 });
    expect(summarizeSeries([])).toEqual({ current: null, min: null, max: null, average: null, count: 0 });
    expect(summarizeSeries(undefined).count).toBe(0);
  });

  it('tells the latest value from the value of the latest sample', () => {
    expect(latestValue(series)).toBe(1);
    expect(currentValue(series)).toBeNull();
    expect(latestValue(undefined)).toBeNull();
    expect(currentValue([])).toBeNull();
  });

  it('totals counts over the window', () => {
    expect(seriesTotal(series)).toBe(15);
    expect(seriesTotal([{ time: 1, value: null, gap: false }])).toBeNull();
  });

  it('finds the busiest node that is still in the cluster', () => {
    const history = buildHistory([parseNodeMetrics(SAMPLE_1, T1), parseNodeMetrics(SAMPLE_2, T2)]);
    expect(busiestNode(history.nodes, 'heap')).toEqual({ name: 'es-node-1', value: 70, low: 23 });
    expect(busiestNode(history.nodes, 'processCpu')).toEqual({ name: 'es-node-1', value: 12, low: 4 });
    expect(busiestNode([], 'heap')).toBeNull();
    expect(busiestNode(history.nodes.map((node) => ({ ...node, present: false })), 'heap')).toBeNull();
  });
});

describe('metricTone', () => {
  it('colours percentages by severity and everything else with the accent', () => {
    expect(metricTone('heap', 60)).toBe('accent');
    expect(metricTone('heap', 75)).toBe('yellow');
    expect(metricTone('cpu', 93)).toBe('red');
    expect(metricTone('heap', null)).toBe('accent');
    expect(metricTone('indexingRate', 95)).toBe('accent');
  });

  const points = (...values: (number | null)[]): MetricSeries =>
    values.map((value, index) => ({ time: index, value, gap: false }));

  it('colours heap by the lowest reading of the window, not the sawtooth peaks', () => {
    expect(seriesTone('heap', points(29, 55, 78))).toBe('accent');
    expect(seriesTone('heap', points(80, 88, 79))).toBe('yellow');
    expect(seriesTone('heap', points(91, 96))).toBe('red');
    expect(seriesTone('heap', points(null, null))).toBe('accent');
    expect(seriesTone('cpu', points(10, 95))).toBe('red');
    expect(seriesTone('cpu', points(95, 10))).toBe('accent');
    expect(seriesTone('heap', undefined)).toBe('accent');
  });
});

describe('formatting', () => {
  it('formats rates with sensible precision', () => {
    expect(formatRate(0)).toBe('0');
    expect(formatRate(0.004)).toBe('<0.01');
    expect(formatRate(0.27)).toBe('0.27');
    expect(formatRate(4.567)).toBe('4.57');
    expect(formatRate(23.44)).toBe('23.4');
    expect(formatRate(812.6)).toBe('813');
    expect(formatRate(2534.65)).toBe('2,535');
    expect(formatRate(12_345)).toBe('12.3K');
    expect(formatRate(null)).toBe('–');
    expect(formatRate(Number.NaN)).toBe('–');
  });

  it('formats latencies in ms and seconds', () => {
    expect(formatLatency(0)).toBe('0 ms');
    expect(formatLatency(0.0042)).toBe('4.2 µs');
    expect(formatLatency(0.00987)).toBe('9.9 µs');
    expect(formatLatency(0.000_87)).toBe('0.87 µs');
    expect(formatLatency(0.000_001)).toBe('<0.01 µs');
    expect(formatLatency(0.042)).toBe('0.042 ms');
    expect(formatLatency(0.838)).toBe('0.84 ms');
    expect(formatLatency(3.14159)).toBe('3.14 ms');
    expect(formatLatency(12.34)).toBe('12.3 ms');
    expect(formatLatency(186.4)).toBe('186 ms');
    expect(formatLatency(1_240)).toBe('1.24 s');
    expect(formatLatency(undefined)).toBe('–');
  });

  it('splits values and units for every kind of metric', () => {
    expect(metricParts('indexingRate', 2534.65)).toEqual({ value: '2,535', unit: '/s' });
    expect(metricParts('searchLatency', 0.838)).toEqual({ value: '0.84', unit: 'ms' });
    expect(metricParts('indexingLatency', 0.0042)).toEqual({ value: '4.2', unit: 'µs' });
    expect(metricParts('searchLatency', 1_500)).toEqual({ value: '1.5', unit: 's' });
    expect(metricParts('heap', 41.6)).toEqual({ value: '42', unit: '%' });
    expect(metricParts('load', 2.5)).toEqual({ value: '2.50', unit: '' });
    expect(metricParts('writeQueue', 3)).toEqual({ value: '3', unit: '' });
    expect(metricParts('heap', null)).toEqual({ value: '–', unit: '' });
  });

  it('formats a metric as one string', () => {
    expect(formatMetric('searchRate', 130.69)).toBe('131/s');
    expect(formatMetric('indexingLatency', 0.01)).toBe('0.01 ms');
    expect(formatMetric('indexingLatency', 0.008)).toBe('8 µs');
    expect(formatMetric('cpu', 35)).toBe('35%');
    expect(formatMetric('load', 2.56)).toBe('2.56');
    expect(formatMetric('searchRejected', 12)).toBe('12');
    expect(formatMetric('heap', null)).toBe('–');
  });

  it('describes every metric', () => {
    for (const definition of Object.values(METRICS)) {
      expect(definition.label).toMatch(/^[A-Z]/);
      expect(definition.description).not.toMatch(/\.$/);
      // Charts that scale to their data have a floor; percentages a fixed top.
      expect(definition.domainMax ?? definition.minDomain).toBeGreaterThan(0);
    }
    expect(METRICS.getRate.minDomain).toBe(1);
    expect(METRICS.searchRate.unit).toBe('shard queries/s');
  });
});

describe('shared presentation helpers', () => {
  it('says how many nodes answered only when some did not', () => {
    expect(answeredLabel({ answered: { answered: 2, total: 3 } })).toBe('2 of 3 nodes answered');
    expect(answeredLabel({ answered: { answered: 0, total: 1 } })).toBe('0 of 1 node answered');
    expect(answeredLabel({ answered: { answered: 3, total: 3 } })).toBeUndefined();
    expect(answeredLabel({ answered: null })).toBeUndefined();
  });

  it('keeps one formatter per metric', () => {
    const heap = metricFormatter('heap');
    expect(metricFormatter('heap')).toBe(heap);
    expect(heap(59.4)).toBe('59%');
    expect(metricFormatter('indexingLatency')(3.1)).toBe(formatMetric('indexingLatency', 3.1));
  });
});
