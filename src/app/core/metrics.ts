/**
 * Live node metrics computed in the browser.
 *
 * `POST metrics/nodes` returns cumulative per-node counters (documents
 * indexed, queries run, time spent, thread pool rejections) plus a few gauges
 * (heap, CPU, load). Successive samples are kept in a bounded ring buffer and
 * turned into per-node series: a rate is Δcount / Δtime between two samples
 * of the same node, using the node's own `timestamp`; a latency is Δtime spent
 * / Δcount. Everything here is pure so it can be tested without a cluster.
 */
import { formatCompact, formatNumber, plural, severity } from './format';
import { isRecord, stringList } from './json';

/** Samples kept per host (60 × the refresh interval: 15 minutes at 15s). */
export const MAX_SAMPLES = 60;
/** History older than this is not "live": the buffer starts over after such a pause. */
export const STALE_HISTORY_MS = 10 * 60_000;
/**
 * Two samples further apart than this, and than 3 × the interval they were
 * taken at, are not joined (a hidden tab, a laptop that slept).
 */
export const MIN_GAP_MS = 30_000;
const GAP_FACTOR = 3;
/** Deltas the usual spacing is measured over when samples do not say their interval. */
const RECENT_DELTAS = 5;

/* ------------------------------------------------------------------ */
/* Raw samples                                                         */
/* ------------------------------------------------------------------ */

export interface ThreadPoolCounters {
  readonly threads: number | null;
  readonly active: number | null;
  readonly queue: number | null;
  readonly rejected: number | null;
  readonly completed: number | null;
  readonly largest: number | null;
}

/** One node in one sample: cumulative counters and current gauges. */
export interface NodeCounters {
  readonly id: string;
  readonly name: string;
  readonly roles: readonly string[];
  /** Time the node took its statistics (epoch milliseconds). */
  readonly timestamp: number | null;
  readonly indexTotal: number | null;
  readonly indexTimeMs: number | null;
  readonly queryTotal: number | null;
  readonly queryTimeMs: number | null;
  readonly fetchTotal: number | null;
  readonly getTotal: number | null;
  readonly docsCount: number | null;
  readonly storeBytes: number | null;
  readonly heapPercent: number | null;
  /** `os.cpu.percent`: the whole machine (what the overview shows). */
  readonly osCpuPercent: number | null;
  /** `process.cpu.percent`: the Elasticsearch process (what the nodes page shows). */
  readonly processCpuPercent: number | null;
  readonly load1m: number | null;
  /** `jvm.uptime_in_millis`: drops when the node restarts. */
  readonly uptimeMs: number | null;
  readonly write: ThreadPoolCounters | null;
  readonly search: ThreadPoolCounters | null;
  /**
   * Write requests rejected by indexing pressure (7.9+: coordinating, primary
   * and replica rejections), which turns bulk requests away before the write
   * thread pool sees them. `null` when the node does not report it.
   */
  readonly pressureRejected: number | null;
}

export interface MetricsSample {
  /** Browser time the sample was received; the shared x axis of every chart. */
  readonly time: number;
  readonly nodes: readonly NodeCounters[];
  /**
   * Auto refresh interval the sample was taken at (0 while paused); samples
   * much further apart than it are not joined. Unknown for older samples.
   */
  readonly expected?: number;
  /** `_nodes.total` / `_nodes.failed` of the response, when reported. */
  readonly totalNodes?: number | null;
  readonly failedNodes?: number | null;
}

function numberAt(value: unknown, ...path: readonly string[]): number | null {
  let current: unknown = value;
  for (const key of path) {
    if (!isRecord(current)) {
      return null;
    }
    current = current[key];
  }
  if (typeof current === 'number' && Number.isFinite(current)) {
    return current;
  }
  if (typeof current === 'string' && current.trim() !== '' && Number.isFinite(Number(current))) {
    return Number(current);
  }
  return null;
}

function threadPool(value: unknown): ThreadPoolCounters | null {
  if (!isRecord(value)) {
    return null;
  }
  return {
    threads: numberAt(value, 'threads'),
    active: numberAt(value, 'active'),
    queue: numberAt(value, 'queue'),
    rejected: numberAt(value, 'rejected'),
    completed: numberAt(value, 'completed'),
    largest: numberAt(value, 'largest'),
  };
}

/**
 * `os.cpu.load_average` is an object since 5.0 and a plain number or list
 * before; 2.x reported it as `os.load_average`.
 */
function loadAverage(os: unknown): number | null {
  const load = !isRecord(os)
    ? undefined
    : isRecord(os['cpu']) && os['cpu']['load_average'] !== undefined
      ? os['cpu']['load_average']
      : os['load_average'];
  if (Array.isArray(load)) {
    return numberAt({ value: load[0] }, 'value');
  }
  if (isRecord(load)) {
    return numberAt(load, '1m');
  }
  return numberAt({ value: load }, 'value');
}

/** Sum of the indexing pressure rejections, `null` when none is reported. */
function pressureRejections(node: Record<string, unknown>): number | null {
  const counts = ['coordinating_rejections', 'primary_rejections', 'replica_rejections']
    .map((key) => numberAt(node, 'indexing_pressure', 'memory', 'total', key))
    .filter((value): value is number => value !== null);
  return counts.length === 0 ? null : counts.reduce((total, value) => total + value, 0);
}

/**
 * Parses the body of `metrics/nodes` (`{ _nodes?: {...}, nodes: { <id>: {...} } }`);
 * unknown shapes give no nodes. `expected` is the refresh interval in effect.
 */
export function parseNodeMetrics(body: unknown, time: number, expected?: number): MetricsSample {
  const nodes = isRecord(body) && isRecord(body['nodes']) ? body['nodes'] : {};
  const header = isRecord(body) ? body['_nodes'] : undefined;
  const parsed = Object.entries(nodes)
    .filter((entry): entry is [string, Record<string, unknown>] => isRecord(entry[1]))
    .map(([id, node]): NodeCounters => {
      const name = node['name'];
      const threadPools = isRecord(node['thread_pool']) ? node['thread_pool'] : {};
      return {
        id,
        name: typeof name === 'string' && name ? name : id,
        roles: stringList(node['roles']),
        timestamp: numberAt(node, 'timestamp'),
        indexTotal: numberAt(node, 'indices', 'indexing', 'index_total'),
        indexTimeMs: numberAt(node, 'indices', 'indexing', 'index_time_in_millis'),
        queryTotal: numberAt(node, 'indices', 'search', 'query_total'),
        queryTimeMs: numberAt(node, 'indices', 'search', 'query_time_in_millis'),
        fetchTotal: numberAt(node, 'indices', 'search', 'fetch_total'),
        getTotal: numberAt(node, 'indices', 'get', 'total'),
        docsCount: numberAt(node, 'indices', 'docs', 'count'),
        storeBytes: numberAt(node, 'indices', 'store', 'size_in_bytes'),
        heapPercent: numberAt(node, 'jvm', 'mem', 'heap_used_percent'),
        osCpuPercent: numberAt(node, 'os', 'cpu', 'percent'),
        processCpuPercent: numberAt(node, 'process', 'cpu', 'percent'),
        load1m: loadAverage(node['os']),
        uptimeMs: numberAt(node, 'jvm', 'uptime_in_millis'),
        write: threadPool(threadPools['write'] ?? threadPools['bulk']),
        search: threadPool(threadPools['search']),
        pressureRejected: pressureRejections(node),
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true }));
  return {
    time,
    nodes: parsed,
    ...(expected !== undefined ? { expected } : {}),
    totalNodes: numberAt(header, 'total'),
    failedNodes: numberAt(header, 'failed'),
  };
}

/**
 * Adds a sample to the ring buffer (a new array, at most `limit` samples).
 * A sample that is not newer than the last one is ignored; after a pause
 * longer than `STALE_HISTORY_MS` the history starts over.
 */
export function appendSample(
  samples: readonly MetricsSample[],
  sample: MetricsSample,
  limit = MAX_SAMPLES,
): readonly MetricsSample[] {
  const last = samples[samples.length - 1];
  if (last && sample.time <= last.time) {
    return samples;
  }
  if (last && sample.time - last.time > STALE_HISTORY_MS) {
    return [sample];
  }
  const next = [...samples, sample];
  return next.length > limit ? next.slice(next.length - limit) : next;
}

/* ------------------------------------------------------------------ */
/* Intervals                                                           */
/* ------------------------------------------------------------------ */

/**
 * What a node did between two samples. A counter group is `null` when it went
 * backwards or is missing: that interval cannot be measured and is skipped.
 * A node that restarted in between (its uptime dropped, or is shorter than
 * the interval) has no interval at all, even where a small counter has
 * already grown past its old value.
 */
export interface NodeInterval {
  readonly seconds: number;
  readonly indexed: number | null;
  readonly indexTimeMs: number | null;
  readonly queries: number | null;
  readonly queryTimeMs: number | null;
  readonly fetches: number | null;
  readonly gets: number | null;
  readonly writeRejected: number | null;
  readonly searchRejected: number | null;
  readonly writeCompleted: number | null;
  readonly searchCompleted: number | null;
  /** Rejected by indexing pressure, `null` when not reported. */
  readonly pressureRejected: number | null;
}

/** Δ of each counter, or `null` for the whole group when one is missing or went backwards. */
function groupDelta(pairs: readonly (readonly [number | null, number | null])[]): (number | null)[] {
  const deltas = pairs.map(([before, after]) =>
    before === null || after === null ? null : after - before,
  );
  return deltas.some((delta) => delta === null || delta < 0) ? deltas.map(() => null) : deltas;
}

export function nodeInterval(
  previous: NodeCounters,
  current: NodeCounters,
  fallbackSeconds: number | null = null,
): NodeInterval | null {
  const milliseconds =
    previous.timestamp !== null && current.timestamp !== null
      ? current.timestamp - previous.timestamp
      : fallbackSeconds === null
        ? null
        : fallbackSeconds * 1000;
  if (milliseconds === null || milliseconds <= 0) {
    return null;
  }
  if (
    previous.uptimeMs !== null &&
    current.uptimeMs !== null &&
    (current.uptimeMs < previous.uptimeMs || current.uptimeMs < milliseconds)
  ) {
    return null;
  }
  const [indexed, indexTimeMs] = groupDelta([
    [previous.indexTotal, current.indexTotal],
    [previous.indexTimeMs, current.indexTimeMs],
  ]);
  const [queries, queryTimeMs, fetches] = groupDelta([
    [previous.queryTotal, current.queryTotal],
    [previous.queryTimeMs, current.queryTimeMs],
    [previous.fetchTotal, current.fetchTotal],
  ]);
  const [gets] = groupDelta([[previous.getTotal, current.getTotal]]);
  const [writeRejected, writeCompleted] = groupDelta([
    [previous.write?.rejected ?? null, current.write?.rejected ?? null],
    [previous.write?.completed ?? null, current.write?.completed ?? null],
  ]);
  const [searchRejected, searchCompleted] = groupDelta([
    [previous.search?.rejected ?? null, current.search?.rejected ?? null],
    [previous.search?.completed ?? null, current.search?.completed ?? null],
  ]);
  const [pressureRejected] = groupDelta([[previous.pressureRejected, current.pressureRejected]]);
  return {
    seconds: milliseconds / 1000,
    indexed: indexed ?? null,
    indexTimeMs: indexTimeMs ?? null,
    queries: queries ?? null,
    queryTimeMs: queryTimeMs ?? null,
    fetches: fetches ?? null,
    gets: gets ?? null,
    writeRejected: writeRejected ?? null,
    searchRejected: searchRejected ?? null,
    writeCompleted: writeCompleted ?? null,
    searchCompleted: searchCompleted ?? null,
    pressureRejected: pressureRejected ?? null,
  };
}

/* ------------------------------------------------------------------ */
/* Series                                                              */
/* ------------------------------------------------------------------ */

export type MetricKey =
  | 'indexingRate'
  | 'indexingLatency'
  | 'searchRate'
  | 'searchLatency'
  | 'fetchRate'
  | 'getRate'
  | 'heap'
  | 'cpu'
  | 'processCpu'
  | 'load'
  | 'writeQueue'
  | 'searchQueue'
  | 'writeActive'
  | 'searchActive'
  | 'writeRejected'
  | 'searchRejected'
  | 'pressureRejected';

export type MetricKind = 'rate' | 'latency' | 'percent' | 'load' | 'count';

export interface MetricDefinition {
  readonly key: MetricKey;
  readonly label: string;
  readonly kind: MetricKind;
  /** Unit shown after the value ("docs/s", "ms/query", "%"). */
  readonly unit: string;
  /** How the cluster figure combines the nodes. */
  readonly aggregate: 'sum' | 'average' | 'weighted';
  /** Fixed top of the y axis (100 for percentages); others scale to the data. */
  readonly domainMax?: number;
  /**
   * Lowest top of the y axis of a chart that scales to its data, so a little
   * noise (0.2 gets/s, a few µs of latency) is not drawn full height.
   */
  readonly minDomain?: number;
  readonly description: string;
}

export const METRICS: Readonly<Record<MetricKey, MetricDefinition>> = {
  indexingRate: {
    key: 'indexingRate',
    label: 'Indexing rate',
    kind: 'rate',
    unit: 'docs/s',
    aggregate: 'sum',
    minDomain: 1,
    description: 'Documents indexed per second, primaries and replicas',
  },
  indexingLatency: {
    key: 'indexingLatency',
    label: 'Indexing latency',
    kind: 'latency',
    unit: 'ms/doc',
    aggregate: 'weighted',
    minDomain: 0.1,
    description: 'Average time spent indexing one document',
  },
  searchRate: {
    key: 'searchRate',
    label: 'Search rate',
    kind: 'rate',
    unit: 'shard queries/s',
    aggregate: 'sum',
    minDomain: 1,
    description: 'Shard queries per second (one search runs a query on every shard it targets)',
  },
  searchLatency: {
    key: 'searchLatency',
    label: 'Search latency',
    kind: 'latency',
    unit: 'ms/query',
    aggregate: 'weighted',
    minDomain: 1,
    description: 'Average time of the query phase on one shard',
  },
  fetchRate: {
    key: 'fetchRate',
    label: 'Fetch rate',
    kind: 'rate',
    unit: 'fetches/s',
    aggregate: 'sum',
    minDomain: 1,
    description: 'Fetch phases per second',
  },
  getRate: {
    key: 'getRate',
    label: 'Get rate',
    kind: 'rate',
    unit: 'gets/s',
    aggregate: 'sum',
    minDomain: 1,
    description: 'Real-time document gets per second',
  },
  heap: {
    key: 'heap',
    label: 'Heap',
    kind: 'percent',
    unit: '%',
    aggregate: 'average',
    domainMax: 100,
    description: 'JVM heap used, garbage included; the colour follows the lowest reading of the window (what is left after collections)',
  },
  cpu: {
    key: 'cpu',
    label: 'OS CPU',
    kind: 'percent',
    unit: '%',
    aggregate: 'average',
    domainMax: 100,
    description: 'CPU usage of the machine (os.cpu.percent)',
  },
  processCpu: {
    key: 'processCpu',
    label: 'Process CPU',
    kind: 'percent',
    unit: '%',
    aggregate: 'average',
    domainMax: 100,
    description: 'CPU usage of the Elasticsearch process',
  },
  load: {
    key: 'load',
    label: 'Load',
    kind: 'load',
    unit: '',
    aggregate: 'average',
    minDomain: 1,
    description: '1 minute load average',
  },
  writeQueue: {
    key: 'writeQueue',
    label: 'Write queue',
    kind: 'count',
    unit: 'queued',
    aggregate: 'sum',
    minDomain: 1,
    description: 'Write requests waiting for a thread',
  },
  searchQueue: {
    key: 'searchQueue',
    label: 'Search queue',
    kind: 'count',
    unit: 'queued',
    aggregate: 'sum',
    minDomain: 1,
    description: 'Search requests waiting for a thread',
  },
  writeActive: {
    key: 'writeActive',
    label: 'Active write threads',
    kind: 'count',
    unit: 'active',
    aggregate: 'sum',
    minDomain: 1,
    description: 'Write threads busy when the sample was taken',
  },
  searchActive: {
    key: 'searchActive',
    label: 'Active search threads',
    kind: 'count',
    unit: 'active',
    aggregate: 'sum',
    minDomain: 1,
    description: 'Search threads busy when the sample was taken',
  },
  writeRejected: {
    key: 'writeRejected',
    label: 'Write rejections',
    kind: 'count',
    unit: 'rejected',
    aggregate: 'sum',
    minDomain: 1,
    description: 'Write requests the write thread pool rejected since the previous sample',
  },
  searchRejected: {
    key: 'searchRejected',
    label: 'Search rejections',
    kind: 'count',
    unit: 'rejected',
    aggregate: 'sum',
    minDomain: 1,
    description: 'Search requests rejected since the previous sample',
  },
  pressureRejected: {
    key: 'pressureRejected',
    label: 'Indexing pressure rejections',
    kind: 'count',
    unit: 'rejected',
    aggregate: 'sum',
    minDomain: 1,
    description: 'Indexing requests rejected by indexing pressure since the previous sample (7.9+, before the write pool)',
  },
};

export const METRIC_KEYS = Object.keys(METRICS) as readonly MetricKey[];

export interface MetricPoint {
  readonly time: number;
  readonly value: number | null;
  /** Not joined to the previous point (samples too far apart). */
  readonly gap: boolean;
}

export type MetricSeries = readonly MetricPoint[];
export type SeriesSet = Readonly<Record<MetricKey, MetricSeries>>;

export interface NodeSeries {
  readonly id: string;
  readonly name: string;
  readonly roles: readonly string[];
  /** Whether the node answered in the latest sample. */
  readonly present: boolean;
  readonly series: SeriesSet;
}

export interface MetricsHistory {
  readonly times: readonly number[];
  /** Per sample: not joined to the previous one. */
  readonly gaps: readonly boolean[];
  /** Per sample: some nodes did not answer (`_nodes.failed`), so cluster sums are not shown. */
  readonly partial: readonly boolean[];
  /** Time covered by the samples. */
  readonly span: number;
  /** At least one interval has been measured: rates can be shown. */
  readonly ready: boolean;
  /** Nodes that answered the latest sample, when the response said how many were asked. */
  readonly answered: { readonly answered: number; readonly total: number } | null;
  readonly cluster: SeriesSet;
  readonly nodes: readonly NodeSeries[];
}

/** Values of one node at one sample (rates over the interval that ends there). */
type PointValues = Readonly<Record<MetricKey, number | null>>;

function median(values: readonly number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] ?? null)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

/**
 * Which samples are too far from the previous one to be joined: further apart
 * than `MIN_GAP_MS` and than 3 × the interval either of them was taken at
 * (`expected`), so switching auto refresh from 5s to 1m does not turn every
 * new interval into a gap. A sample taken while paused (`expected` 0) keeps
 * the `MIN_GAP_MS` rule; without `expected`, the spacing of the few previous
 * samples stands in for it.
 */
export function sampleGaps(
  times: readonly number[],
  expected: readonly (number | undefined)[] = [],
): boolean[] {
  const deltas = times.slice(1).map((time, position) => time - (times[position] ?? time));
  const gaps = times.map((time, position) => {
    if (position === 0) {
      return false;
    }
    const before = expected[position - 1];
    const after = expected[position];
    const usual =
      before === undefined && after === undefined
        ? (median(deltas.slice(Math.max(0, position - 1 - RECENT_DELTAS), position - 1)) ?? 0)
        : Math.max(before ?? 0, after ?? 0);
    return time - (times[position - 1] ?? time) > Math.max(MIN_GAP_MS, GAP_FACTOR * usual);
  });
  return gaps;
}

function ratio(numerator: number | null, denominator: number | null): number | null {
  return numerator === null || denominator === null || denominator <= 0 ? null : numerator / denominator;
}

function emptyValues(): Record<MetricKey, number | null> {
  const values = {} as Record<MetricKey, number | null>;
  for (const key of METRIC_KEYS) {
    values[key] = null;
  }
  return values;
}

/** Gauges are read at the sample; rates need an earlier sample of the same node. */
function pointValues(current: NodeCounters, interval: NodeInterval | null): PointValues {
  const values = emptyValues();
  values.heap = current.heapPercent;
  values.cpu = current.osCpuPercent;
  values.processCpu = current.processCpuPercent;
  values.load = current.load1m;
  values.writeQueue = current.write?.queue ?? null;
  values.searchQueue = current.search?.queue ?? null;
  values.writeActive = current.write?.active ?? null;
  values.searchActive = current.search?.active ?? null;
  if (interval) {
    values.indexingRate = ratio(interval.indexed, interval.seconds);
    values.indexingLatency = ratio(interval.indexTimeMs, interval.indexed);
    values.searchRate = ratio(interval.queries, interval.seconds);
    values.searchLatency = ratio(interval.queryTimeMs, interval.queries);
    values.fetchRate = ratio(interval.fetches, interval.seconds);
    values.getRate = ratio(interval.gets, interval.seconds);
    values.writeRejected = interval.writeRejected;
    values.searchRejected = interval.searchRejected;
    values.pressureRejected = interval.pressureRejected;
  }
  return values;
}

function sum(values: readonly (number | null)[]): number | null {
  const present = values.filter((value): value is number => value !== null);
  return present.length === 0 ? null : present.reduce((total, value) => total + value, 0);
}

function average(values: readonly (number | null)[]): number | null {
  const present = values.filter((value): value is number => value !== null);
  return present.length === 0 ? null : present.reduce((total, value) => total + value, 0) / present.length;
}

/**
 * Cluster figures of one sample: sums of rates, averages of gauges, latencies
 * weighted by counts. Sums of a partial sample (some nodes failed to answer)
 * would dip by the missing nodes' share, so they are left out.
 */
function clusterValues(
  values: readonly PointValues[],
  intervals: readonly (NodeInterval | null)[],
  partial: boolean,
): PointValues {
  const result = emptyValues();
  for (const key of METRIC_KEYS) {
    const definition = METRICS[key];
    const column = values.map((value) => value[key]);
    if (definition.aggregate === 'sum') {
      result[key] = partial ? null : sum(column);
    } else if (definition.aggregate === 'average') {
      result[key] = average(column);
    }
  }
  const measured = intervals.filter((interval): interval is NodeInterval => interval !== null);
  result.indexingLatency = ratio(
    sum(measured.map((interval) => (interval.indexed === null ? null : interval.indexTimeMs))),
    sum(measured.map((interval) => (interval.indexTimeMs === null ? null : interval.indexed))),
  );
  result.searchLatency = ratio(
    sum(measured.map((interval) => (interval.queries === null ? null : interval.queryTimeMs))),
    sum(measured.map((interval) => (interval.queryTimeMs === null ? null : interval.queries))),
  );
  return result;
}

function toSeries(
  times: readonly number[],
  gaps: readonly boolean[],
  values: readonly (PointValues | null)[],
): SeriesSet {
  const series = {} as Record<MetricKey, MetricSeries>;
  for (const key of METRIC_KEYS) {
    series[key] = times.map((time, position): MetricPoint => ({
      time,
      value: values[position]?.[key] ?? null,
      gap: gaps[position] ?? false,
    }));
  }
  return series;
}

/**
 * Turns the buffered samples into per-node and cluster series, one point per
 * sample. A node's interval runs from the last earlier sample it answered
 * (counters are cumulative, so a node that missed one sample is measured over
 * two intervals), unless a gap lies in between. Rates of the first sample, of
 * a sample after a gap and of an interval whose counters went backwards are
 * `null`; nodes that joined later or left have `null` points where they did
 * not answer.
 */
export function buildHistory(samples: readonly MetricsSample[]): MetricsHistory {
  const times = samples.map((sample) => sample.time);
  const gaps = sampleGaps(
    times,
    samples.map((sample) => sample.expected),
  );
  const partial = samples.map((sample) => (sample.failedNodes ?? 0) > 0);
  const nodeOrder = new Map<string, NodeCounters>();
  for (const sample of samples) {
    for (const node of sample.nodes) {
      nodeOrder.set(node.id, node);
    }
  }
  const nodeValues = new Map<string, (PointValues | null)[]>();
  const clusterPoints: PointValues[] = [];
  /** Each node's latest counters and when they were received, since the last gap. */
  const lastSeen = new Map<string, { readonly node: NodeCounters; readonly time: number }>();
  let ready = false;

  samples.forEach((sample, position) => {
    if (gaps[position]) {
      lastSeen.clear();
    }
    const values: PointValues[] = [];
    const intervals: (NodeInterval | null)[] = [];
    for (const node of sample.nodes) {
      const before = lastSeen.get(node.id);
      const interval = before ? nodeInterval(before.node, node, (sample.time - before.time) / 1000) : null;
      ready ||= interval !== null;
      const point = pointValues(node, interval);
      values.push(point);
      intervals.push(interval);
      lastSeen.set(node.id, { node, time: sample.time });
      const list = nodeValues.get(node.id) ?? [];
      list[position] = point;
      nodeValues.set(node.id, list);
    }
    clusterPoints.push(clusterValues(values, intervals, partial[position] ?? false));
  });

  const latest = samples[samples.length - 1];
  const latestIds = new Set((latest?.nodes ?? []).map((node) => node.id));
  const nodes = [...nodeOrder.values()]
    .sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true }))
    .map((node): NodeSeries => {
      const list = nodeValues.get(node.id) ?? [];
      return {
        id: node.id,
        name: node.name,
        roles: node.roles,
        present: latestIds.has(node.id),
        series: toSeries(times, gaps, times.map((_, position) => list[position] ?? null)),
      };
    });

  const total = latest?.totalNodes ?? null;
  const failed = latest?.failedNodes ?? null;
  return {
    times,
    gaps,
    partial,
    span: times.length > 1 ? (times[times.length - 1] ?? 0) - (times[0] ?? 0) : 0,
    ready,
    answered: total !== null && total > 0 ? { answered: Math.max(0, total - (failed ?? 0)), total } : null,
    cluster: toSeries(times, gaps, clusterPoints),
    nodes,
  };
}

/* ------------------------------------------------------------------ */
/* Reading series                                                      */
/* ------------------------------------------------------------------ */

/** The most recent non-null value, or `null`. */
export function latestValue(series: MetricSeries | undefined): number | null {
  if (!series) {
    return null;
  }
  for (let position = series.length - 1; position >= 0; position--) {
    const value = series[position]?.value;
    if (value !== null && value !== undefined) {
      return value;
    }
  }
  return null;
}

/** The value of the latest sample only (`null` when that sample has none). */
export function currentValue(series: MetricSeries | undefined): number | null {
  return series?.[series.length - 1]?.value ?? null;
}

export interface SeriesSummary {
  readonly current: number | null;
  readonly min: number | null;
  readonly max: number | null;
  readonly average: number | null;
  /** Points with a value. */
  readonly count: number;
}

export function summarizeSeries(series: MetricSeries | undefined): SeriesSummary {
  const values = (series ?? [])
    .map((point) => point.value)
    .filter((value): value is number => value !== null);
  return {
    current: latestValue(series),
    min: values.length ? Math.min(...values) : null,
    max: values.length ? Math.max(...values) : null,
    average: average(values),
    count: values.length,
  };
}

/** Sum of the values over the window (rejections per window). */
export function seriesTotal(series: MetricSeries | undefined): number | null {
  return sum((series ?? []).map((point) => point.value));
}

/**
 * The node with the highest current value of a gauge (for "max 59% on
 * es-node-2"), with its lowest value of the window.
 */
export function busiestNode(
  nodes: readonly NodeSeries[],
  key: MetricKey,
): { readonly name: string; readonly value: number; readonly low: number } | null {
  let best: { name: string; value: number; low: number } | null = null;
  for (const node of nodes) {
    if (!node.present) {
      continue;
    }
    const value = currentValue(node.series[key]);
    if (value !== null && (best === null || value > best.value)) {
      best = { name: node.name, value, low: summarizeSeries(node.series[key]).min ?? value };
    }
  }
  return best;
}

/** Chart colour: percentages turn yellow from 75% and red from 90% (like `<cerebro-meter>`). */
export function metricTone(key: MetricKey, value: number | null): 'accent' | 'yellow' | 'red' {
  if (METRICS[key].kind !== 'percent') {
    return 'accent';
  }
  const level = severity(value);
  return level === 'danger' ? 'red' : level === 'warn' ? 'yellow' : 'accent';
}

/**
 * Colour of a chart of a whole window. Heap used includes garbage, so a
 * healthy node climbs to 75–80% before every young collection: its colour
 * follows the lowest reading of the window (what is left after collections),
 * not the sawtooth peaks. Other metrics follow their current value.
 */
export function seriesTone(key: MetricKey, series: MetricSeries | undefined): 'accent' | 'yellow' | 'red' {
  if (key === 'heap') {
    const { min, current } = summarizeSeries(series);
    return metricTone(key, current === null ? null : min);
  }
  return metricTone(key, currentValue(series));
}

/* ------------------------------------------------------------------ */
/* Formatting                                                          */
/* ------------------------------------------------------------------ */

function trimmed(value: number, digits: number): string {
  return value.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

/** A rate: "0", "0.27", "4.5", "23.4", "812", "12.3K". */
export function formatRate(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '–';
  }
  const magnitude = Math.abs(value);
  if (magnitude === 0) {
    return '0';
  }
  if (magnitude >= 10_000) {
    return formatCompact(value);
  }
  if (magnitude >= 100) {
    return trimmed(Math.round(value), 0);
  }
  if (magnitude >= 10) {
    return trimmed(value, 1);
  }
  if (magnitude >= 0.01) {
    return trimmed(value, 2);
  }
  return '<0.01';
}

/** Two significant digits: "4.2", "0.87", "0.042". */
function significant(value: number): string {
  return value.toLocaleString('en-US', { maximumSignificantDigits: 2 });
}

/**
 * A latency in milliseconds: "1.24 s", "86 ms", "3.1 ms", "0.42 ms",
 * "0.042 ms", and microseconds below 0.01 ms ("4.2 µs") so the per-document
 * cost of bulk indexing still shows its changes.
 */
export function formatLatency(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '–';
  }
  if (value >= 1000) {
    return `${trimmed(value / 1000, 2)} s`;
  }
  if (value >= 100) {
    return `${Math.round(value)} ms`;
  }
  if (value >= 10) {
    return `${trimmed(value, 1)} ms`;
  }
  if (value >= 1) {
    return `${trimmed(value, 2)} ms`;
  }
  if (value >= 0.01) {
    return `${significant(value)} ms`;
  }
  if (value <= 0) {
    return '0 ms';
  }
  const micros = value * 1000;
  return micros < 0.01 ? '<0.01 µs' : `${significant(micros)} µs`;
}

export interface MetricParts {
  /** The number ("23.4", "–"). */
  readonly value: string;
  /** Unit beside it ("docs/s", "%", "ms"), empty when none. */
  readonly unit: string;
}

/** The value and unit to show separately (a stat tile styles the number). */
export function metricParts(key: MetricKey, value: number | null | undefined): MetricParts {
  const definition = METRICS[key];
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return { value: '–', unit: '' };
  }
  switch (definition.kind) {
    case 'rate':
      return { value: formatRate(value), unit: '/s' };
    case 'latency': {
      const [number = '–', unit = ''] = formatLatency(value).split(' ');
      return { value: number, unit };
    }
    case 'percent':
      return { value: String(Math.round(value)), unit: '%' };
    case 'load':
      return { value: value.toFixed(2), unit: '' };
    case 'count':
      return { value: trimmed(Math.round(value), 0), unit: '' };
  }
}

/** The value as one string: "23.4/s", "3.1 ms", "59%", "2.98", "4". */
export function formatMetric(key: MetricKey, value: number | null | undefined): string {
  const parts = metricParts(key, value);
  if (parts.value === '–') {
    return '–';
  }
  const kind = METRICS[key].kind;
  return kind === 'latency' ? `${parts.value} ${parts.unit}` : `${parts.value}${parts.unit}`;
}

const FORMATTERS = new Map<MetricKey, (value: number) => string>();

/**
 * `formatMetric` bound to one metric, created once per key: a chart's
 * `[format]` input keeps the same function across change detection.
 */
export function metricFormatter(key: MetricKey): (value: number) => string {
  let formatter = FORMATTERS.get(key);
  if (!formatter) {
    formatter = (value: number) => formatMetric(key, value);
    FORMATTERS.set(key, formatter);
  }
  return formatter;
}

/** "2 of 3 nodes answered" while some nodes did not answer the latest sample. */
export function answeredLabel(history: Pick<MetricsHistory, 'answered'>): string | undefined {
  const answered = history.answered;
  return answered && answered.answered < answered.total
    ? `${formatNumber(answered.answered)} of ${formatNumber(answered.total)} ${plural(answered.total, 'node')} answered`
    : undefined;
}
