import { textMatcher } from '../../core/format';
import {
  METRICS,
  MetricKey,
  MetricSeries,
  NodeCounters,
  NodeSeries,
  ThreadPoolCounters,
  currentValue,
  formatMetric,
  metricParts,
  seriesTone,
  seriesTotal,
  summarizeSeries,
} from '../../core/metrics';
import { isInternalAttribute } from '../../core/node-attributes';
import { NodeSortField, NodesFilter, NodesNode } from './nodes.models';

/** Does `node` pass the name filter (regex or substring) and the role filter? */
export function matchesNode(
  node: NodesNode,
  filter: NodesFilter,
  matchesName: (value: string) => boolean = textMatcher(filter.name),
): boolean {
  const matchesRole =
    (node.master && filter.master) ||
    (node.data && filter.data) ||
    (node.ingest && filter.ingest) ||
    (node.coordinating && filter.coordinating);
  return matchesName(node.name) && !!matchesRole;
}

/** The nodes that pass `filter`, compiling the name filter once. */
export function filterNodes(nodes: readonly NodesNode[], filter: NodesFilter): NodesNode[] {
  const matchesName = textMatcher(filter.name);
  return nodes.filter((node) => matchesNode(node, filter, matchesName));
}

function sortValue(node: NodesNode, field: NodeSortField): string | number | null {
  switch (field) {
    case 'name':
      return node.name;
    case 'cpu.load':
      return node.cpu.load;
    case 'cpu.process':
      return node.cpu.process;
    case 'heap.percent':
      return node.heap.percent;
    case 'disk.percent':
      return node.disk?.percent ?? null;
    case 'uptime':
      return node.uptime;
  }
}

/** Stable sort; missing values always go last, ties fall back to the name. */
export function sortNodes(
  nodes: readonly NodesNode[],
  field: NodeSortField,
  reverse: boolean,
): NodesNode[] {
  const direction = reverse ? -1 : 1;
  return [...nodes].sort((left, right) => {
    const leftValue = sortValue(left, field);
    const rightValue = sortValue(right, field);
    if (leftValue === rightValue) {
      return left.name.localeCompare(right.name);
    }
    if (leftValue === null) {
      return 1;
    }
    if (rightValue === null) {
      return -1;
    }
    if (typeof leftValue === 'string' && typeof rightValue === 'string') {
      return direction * leftValue.localeCompare(rightValue);
    }
    return direction * (Number(leftValue) - Number(rightValue));
  });
}

/** Built-in attributes (`ml.*`, `xpack.*`, …) are hidden unless asked for. */
export function attributeEntries(
  attributes: Readonly<Record<string, unknown>>,
  includeInternal = false,
): readonly (readonly [string, string])[] {
  return Object.entries(attributes)
    .filter(([name]) => includeInternal || !isInternalAttribute(name))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => [name, String(value)] as const);
}

export interface NodeRoleBadge {
  readonly key: 'master' | 'data' | 'ingest' | 'coordinating';
  readonly label: string;
  readonly title: string;
}

export function nodeRoles(node: NodesNode): readonly NodeRoleBadge[] {
  const roles: NodeRoleBadge[] = [];
  if (node.master) {
    roles.push({
      key: 'master',
      label: node.current_master ? 'master ★' : 'master',
      title: node.current_master ? 'Elected master' : 'Master-eligible',
    });
  }
  if (node.data) {
    roles.push({ key: 'data', label: 'data', title: 'Data node' });
  }
  if (node.ingest) {
    roles.push({ key: 'ingest', label: 'ingest', title: 'Ingest node' });
  }
  if (node.coordinating) {
    roles.push({ key: 'coordinating', label: 'coordinating', title: 'Coordinating only' });
  }
  return roles;
}

function average(values: readonly number[]): number | null {
  return values.length === 0
    ? null
    : values.reduce((sum, value) => sum + value, 0) / values.length;
}

export interface NodesSummary {
  readonly total: number;
  readonly master?: string;
  readonly versions: readonly string[];
  readonly averageHeap: number | null;
  readonly averageCpu: number | null;
  readonly diskUsed: number;
  readonly diskTotal: number;
}

export function summarizeNodes(nodes: readonly NodesNode[]): NodesSummary {
  const disks = nodes.flatMap((node) => (node.disk ? [node.disk] : []));
  const diskTotal = disks.reduce((sum, disk) => sum + disk.total, 0);
  const diskUsed = disks.reduce((sum, disk) => sum + (disk.total - disk.available), 0);
  const master = nodes.find((node) => node.current_master)?.name;
  return {
    total: nodes.length,
    ...(master ? { master } : {}),
    versions: [...new Set(nodes.map((node) => node.version))].sort(),
    averageHeap: average(nodes.map((node) => node.heap.percent)),
    averageCpu: average(
      nodes.flatMap((node) => (node.cpu.process === null ? [] : [node.cpu.process])),
    ),
    diskUsed,
    diskTotal,
  };
}

/** Elasticsearch byte strings such as "274mb" → "274 MB". */
export function prettyByteString(value: string | null | undefined): string {
  if (!value) {
    return '–';
  }
  const match = /^([\d.]+)\s*([kmgtp]?b)$/i.exec(value.trim());
  if (!match) {
    return value;
  }
  return `${match[1]} ${(match[2] ?? '').toUpperCase()}`;
}

/** The node with exactly this name (the `?node=` deep link), if any. */
export function findNodeByName(nodes: readonly NodesNode[], name: string): NodesNode | undefined {
  return nodes.find((node) => node.name === name);
}

/* ---- Live metrics --------------------------------------------------------- */

/**
 * The nodes with CPU, load and heap percentages of the latest metrics sample,
 * where it has them, so a cell's number, meter and sparkline (whose last point
 * is that sample) agree, and sorting follows what is shown. Nodes the sample
 * does not cover keep the values of the nodes request.
 */
export function withLiveGauges(
  nodes: readonly NodesNode[],
  latest: ReadonlyMap<string, NodeCounters>,
): readonly NodesNode[] {
  if (latest.size === 0) {
    return nodes;
  }
  return nodes.map((node) => {
    const live = latest.get(node.id);
    if (!live) {
      return node;
    }
    return {
      ...node,
      cpu: {
        load: live.load1m ?? node.cpu.load,
        process: live.processCpuPercent ?? node.cpu.process,
        os: live.osCpuPercent ?? node.cpu.os,
      },
      heap: { ...node.heap, percent: live.heapPercent ?? node.heap.percent },
    };
  });
}

/** A chart of the expanded node row. */
export interface NodeChart {
  readonly key: MetricKey;
  readonly label: string;
  readonly description: string;
  /** Latest value ("23.4", "–") and unit ("docs/s"). */
  readonly value: string;
  readonly unit: string;
  /** "low 2% · high 35%" over the window, empty without values. */
  readonly range: string;
  readonly points: MetricSeries;
  readonly tone: 'accent' | 'yellow' | 'red';
  readonly domainMax?: number;
  readonly minDomain?: number;
}

const NODE_CHARTS: readonly { readonly key: MetricKey; readonly unit?: string }[] = [
  // Resources, then work: two rows of four on wide screens.
  { key: 'processCpu' },
  { key: 'heap' },
  { key: 'load' },
  { key: 'getRate', unit: 'gets/s' },
  { key: 'indexingRate', unit: 'docs/s' },
  { key: 'indexingLatency' },
  { key: 'searchRate', unit: 'shard queries/s' },
  { key: 'searchLatency' },
];

/** The charts of a node's live activity (empty series before the first sample). */
export function nodeCharts(node: NodeSeries | undefined): NodeChart[] {
  return NODE_CHARTS.map(({ key, unit }) => {
    const points = node?.series[key] ?? [];
    const current = currentValue(points);
    const parts = metricParts(key, current);
    const summary = summarizeSeries(points);
    const definition = METRICS[key];
    return {
      key,
      label: definition.label,
      description: definition.description,
      value: parts.value,
      unit: parts.value === '–' ? '' : (unit ?? parts.unit),
      range:
        summary.count > 1
          ? `low ${formatMetric(key, summary.min)} · high ${formatMetric(key, summary.max)}`
          : '',
      points,
      tone: seriesTone(key, points),
      ...(definition.domainMax !== undefined ? { domainMax: definition.domainMax } : {}),
      ...(definition.minDomain !== undefined ? { minDomain: definition.minDomain } : {}),
    };
  });
}

export interface ThreadPoolRow {
  readonly name: string;
  /** Busy threads of the latest sample. */
  readonly active: number | null;
  /** Pool size. */
  readonly threads: number | null;
  readonly queue: number | null;
  /** Largest queue seen in the window. */
  readonly peakQueue: number | null;
  /** Rejections during the window (between samples). */
  readonly rejectedInWindow: number | null;
  /** Rejections since the node started. */
  readonly rejectedTotal: number | null;
}

function poolRow(
  name: string,
  pool: ThreadPoolCounters | null | undefined,
  queue: MetricSeries,
  rejected: MetricSeries,
): ThreadPoolRow {
  return {
    name,
    active: pool?.active ?? null,
    threads: pool?.threads ?? null,
    queue: pool?.queue ?? null,
    peakQueue: summarizeSeries(queue).max,
    rejectedInWindow: seriesTotal(rejected),
    rejectedTotal: pool?.rejected ?? null,
  };
}

/**
 * Write and search thread pools of a node: current state and rejections.
 * Since 7.9 indexing pressure turns bulk requests away before the write pool
 * (whose queue holds 10,000) sees them, so its rejections get a row of their
 * own when the node reports them.
 */
export function threadPoolRows(node: NodeSeries | undefined, latest: NodeCounters | undefined): ThreadPoolRow[] {
  const rows = [
    poolRow('Write', latest?.write, node?.series.writeQueue ?? [], node?.series.writeRejected ?? []),
    poolRow('Search', latest?.search, node?.series.searchQueue ?? [], node?.series.searchRejected ?? []),
  ];
  const pressure = latest?.pressureRejected ?? null;
  if (pressure !== null) {
    rows.push({
      name: 'Indexing pressure',
      active: null,
      threads: null,
      queue: null,
      peakQueue: null,
      rejectedInWindow: seriesTotal(node?.series.pressureRejected),
      rejectedTotal: pressure,
    });
  }
  return rows;
}
