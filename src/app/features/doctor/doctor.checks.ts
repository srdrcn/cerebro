import { formatBytes, formatDuration, formatNumber, plural, pluralize } from '../../core/format';
import { isRecord, stringList } from '../../core/json';
import { unassignedReason } from '../../core/shards';
import {
  CheckOutcome,
  ClusterSettingsLayers,
  DoctorCheck,
  DoctorFact,
  DoctorFinding,
  DoctorFix,
  DoctorInput,
  DoctorLink,
  DoctorReport,
  DoctorResource,
  DoctorSeverity,
  DoctorVerdict,
  IlmErrorRow,
  IndexRow,
  NodeInfo,
  ResourceKind,
} from './doctor.models';
import {
  DiskThresholds,
  WatermarkKey,
  WatermarkLevel,
  countBySeverity,
  describeWatermark,
  diskThresholds,
  hasSource,
  healthReportView,
  indicatorViews,
  isDataNode,
  isExplicit,
  isFrozenOnly,
  isTrue,
  isUnsupportedSource,
  parseDoctorInput,
  requiredFreeBytes,
  roundPercent,
  settingValue,
  sortFindings,
  toNumber,
  unavailableReason,
  versionAtLeast,
} from './doctor.utils';

/* ------------------------------------------------------------------ */
/* Thresholds                                                          */
/* ------------------------------------------------------------------ */

const GB = 1024 ** 3;
/** Elastic's sizing guidance: "aim for shard sizes between 10GB and 50GB". */
export const OVERSIZED_SHARD_BYTES = 50 * GB;
/** Primaries below this are "small" for the over-sharding check. */
export const SMALL_SHARD_BYTES = GB;
/** `cluster.max_shards_per_node` default (7.0+). */
export const DEFAULT_MAX_SHARDS_PER_NODE = 1000;
export const SHARD_LIMIT_WARNING = 0.8;
export const SHARD_LIMIT_CRITICAL = 0.95;
export const HEAP_WARNING = 85;
export const HEAP_CRITICAL = 95;
/** Old-generation GC time as a share of uptime. */
export const GC_TIME_SHARE = 0.05;
/** Average old-generation collection time. */
export const GC_AVERAGE_MS = 1_000;

/* ------------------------------------------------------------------ */
/* Wording helpers                                                     */
/* ------------------------------------------------------------------ */

function isAre(count: number): string {
  return count === 1 ? 'is' : 'are';
}

function hasHave(count: number): string {
  return count === 1 ? 'has' : 'have';
}

function indicesLabel(count: number): string {
  return pluralize(count, 'index', 'indices');
}

/** "a, b and c". */
function listJoin(items: readonly string[]): string {
  if (items.length <= 1) {
    return items[0] ?? '';
  }
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** The single item, or "3 indices". */
function subject(items: readonly string[], singular: string, pluralForm: string): string {
  return items.length === 1 ? (items[0] ?? '') : pluralize(items.length, singular, pluralForm);
}

function isSystemName(name: string): boolean {
  return name.startsWith('.');
}

/* ------------------------------------------------------------------ */
/* Links                                                               */
/* ------------------------------------------------------------------ */

const NODES_LINK: DoctorLink = { label: 'Open nodes', icon: 'bi-hdd-stack', route: '/nodes' };
const CLUSTER_SETTINGS_LINK: DoctorLink = { label: 'Cluster settings', icon: 'bi-sliders', route: '/cluster_settings' };
const ALLOCATION_LINK: DoctorLink = { label: 'Explain unassigned shards', icon: 'bi-signpost-split', route: '/allocation' };
const RECOVERY_LINK: DoctorLink = { label: 'Open recoveries', icon: 'bi-arrow-repeat', route: '/recovery' };
const ILM_POLICIES_LINK: DoctorLink = { label: 'Lifecycle policies', icon: 'bi-hourglass-split', route: '/ilm' };
const DATA_STREAMS_LINK: DoctorLink = { label: 'Data streams', icon: 'bi-water', route: '/data_streams' };
/** Indices passed to the ILM status page (it explains them on arrival). */
const ILM_LINK_INDICES = 20;

/** The ILM status tab, explaining the given indices right away. */
function ilmStatusLink(indices: readonly string[]): DoctorLink {
  const shown = indices.slice(0, ILM_LINK_INDICES);
  return {
    label: 'Lifecycle status',
    icon: 'bi-hourglass-split',
    route: '/ilm',
    params: shown.length > 0 ? { tab: 'status', index: shown.join(',') } : { tab: 'status' },
  };
}

function indexLink(index: string, tab?: string): DoctorLink {
  return {
    label: 'Index details',
    icon: 'bi-box',
    route: '/index_detail',
    params: tab ? { index, tab } : { index },
  };
}

function indexSettingsLink(index: string): DoctorLink {
  return { label: 'Index settings', icon: 'bi-gear', route: '/index_settings', params: { index } };
}

function allocationLink(index: string, shard: number, primary: boolean): DoctorLink {
  return {
    label: 'Explain',
    icon: 'bi-signpost-split',
    route: '/allocation',
    params: { index, shard: String(shard), primary: String(primary) },
  };
}

/* ------------------------------------------------------------------ */
/* Fixes                                                               */
/* ------------------------------------------------------------------ */

function replicasFix(indices: readonly string[], replicas: number, kind: 'add' | 'reduce', extra = ''): DoctorFix {
  const target = subject(indices, 'index', 'indices');
  const many = indices.length > 1;
  const label =
    kind === 'add'
      ? many
        ? 'Add a replica to all'
        : 'Add a replica'
      : many
        ? `Reduce all to ${pluralize(replicas, 'replica')}`
        : `Reduce replicas to ${replicas}`;
  return {
    key: `replicas:${replicas}:${indices.join(',')}`,
    label,
    icon: kind === 'add' ? 'bi-copy' : 'bi-dash-circle',
    tone: 'default',
    confirmTitle:
      kind === 'add' ? `Add a replica to ${target}?` : `Reduce the replicas of ${target} to ${replicas}?`,
    confirmMessage: `Sets index.number_of_replicas to ${replicas}.${extra ? ` ${extra}` : ''}`,
    confirmItems: indices.length > 1 ? indices : [],
    confirmLabel: label,
    path: 'index_settings/bulk_update',
    payload: { indices: [...indices], settings: { 'index.number_of_replicas': replicas } },
    success:
      kind === 'add'
        ? `Added a replica to ${target}`
        : `Reduced the replicas of ${target} to ${replicas}`,
    failure: kind === 'add' ? `Could not add a replica to ${target}` : `Could not reduce the replicas of ${target}`,
  };
}

/** What the disk threshold monitor does with the flood stage block right now. */
interface FloodBlockState {
  /** `cluster.routing.allocation.disk.threshold_enabled`. */
  readonly enabled: boolean;
  /** Data nodes still past the flood stage (only when enabled). */
  readonly stillFull: readonly string[];
}

function removeReadOnlyFix(indices: readonly string[], state: FloodBlockState): DoctorFix {
  const target = subject(indices, 'index', 'indices');
  const shards = indices.length === 1 ? 'its shards' : 'their shards';
  // DiskThresholdMonitor adds the block at the flood stage only while the
  // thresholds are enabled.
  const reapplied = !state.enabled
    ? 'Disk-based shard allocation is disabled, so Elasticsearch will neither add it again nor remove it on its own.'
    : state.stillFull.length > 0
      ? `${listJoin(state.stillFull)} ${isAre(state.stillFull.length)} still above the flood stage watermark, so Elasticsearch will add the block again until disk space is freed.`
      : `Elasticsearch adds it again if a node holding ${shards} passes the flood stage watermark.`;
  return {
    key: `read-only:${indices.join(',')}`,
    label: indices.length > 1 ? 'Remove all blocks' : 'Remove read-only block',
    icon: 'bi-unlock',
    tone: state.stillFull.length > 0 ? 'warning' : 'default',
    confirmTitle: `Remove the read-only block from ${target}?`,
    confirmMessage: `Removes index.blocks.read_only_allow_delete so writes are accepted again. ${reapplied}`,
    confirmItems: indices.length > 1 ? indices : [],
    confirmLabel: indices.length > 1 ? 'Remove blocks' : 'Remove block',
    path: 'index_settings/bulk_update',
    payload: { indices: [...indices], settings: { 'index.blocks.read_only_allow_delete': null } },
    success: `Removed the read-only block from ${target}`,
    failure: `Could not remove the read-only block from ${target}`,
  };
}

function ilmRetryFix(indices: readonly string[]): DoctorFix {
  const single = indices.length === 1 ? indices[0] : null;
  return {
    key: `ilm-retry:${indices.join(',')}`,
    label: single ? 'Retry step' : `Retry ${pluralize(indices.length, 'step')}`,
    icon: 'bi-arrow-clockwise',
    tone: 'default',
    confirmTitle: single ? `Retry the failed step of ${single}?` : `Retry the failed steps of ${indicesLabel(indices.length)}?`,
    confirmMessage: `ILM moves ${single ? 'the index' : 'each index'} back to the step that failed and runs it again. Fix the cause first (for example a missing setting or alias), or the step fails again.`,
    confirmItems: single ? [] : indices,
    confirmLabel: single ? 'Retry step' : `Retry ${pluralize(indices.length, 'step')}`,
    path: 'ilm/retry',
    payload: { indices: [...indices] },
    success: single ? `Retrying the failed step of ${single}` : `Retrying the failed steps of ${indicesLabel(indices.length)}`,
    failure: single ? `Could not retry the failed step of ${single}` : 'Could not retry the failed steps',
  };
}

/* ------------------------------------------------------------------ */
/* Shared lookups                                                      */
/* ------------------------------------------------------------------ */

interface NodeDiskState {
  readonly node: NodeInfo;
  readonly level: WatermarkKey | null;
  readonly used: number;
  readonly available: number;
  readonly total: number;
  /** Free space the exceeded watermark asks for. */
  readonly required: number | null;
  readonly watermark: WatermarkLevel | null;
}

/**
 * Where each data node stands against the watermarks. A node is past a
 * watermark when its available bytes are below the free space the watermark
 * requires, as in `DiskThresholdMonitor` (it checks the least available data
 * path). Dedicated frozen nodes only have a flood stage watermark.
 */
export function nodeDiskStates(input: DoctorInput, thresholds: DiskThresholds): NodeDiskState[] {
  return (input.nodes ?? [])
    .filter((node) => isDataNode(node) && node.disk !== null)
    .map((node) => {
      const disk = node.disk!;
      const frozen = isFrozenOnly(node);
      const levels: readonly (WatermarkLevel | null)[] = frozen
        ? [thresholds.frozenFlood ?? thresholds.flood]
        : [thresholds.flood, thresholds.high, thresholds.low];
      const required = (level: WatermarkLevel): number => {
        // Elasticsearch 8.x reports the free space each watermark requires on
        // this path, resolved by the node itself: it also accounts for values
        // set in elasticsearch.yml (which change the max_headroom defaults but
        // not what include_defaults shows). Frozen nodes report the regular
        // flood stage, not the frozen one, so compute theirs.
        const reported = frozen ? null : disk.reported[level.key];
        return reported ?? requiredFreeBytes(level, disk.total);
      };
      const exceeded = levels.find((level): level is WatermarkLevel => level !== null && disk.available < required(level));
      return {
        node,
        level: exceeded?.key ?? null,
        used: ((disk.total - disk.available) / disk.total) * 100,
        available: disk.available,
        total: disk.total,
        required: exceeded ? required(exceeded) : null,
        watermark: exceeded ?? null,
      };
    });
}

/** Data nodes that hold searchable data (dedicated frozen nodes have their own shard limit). */
function dataNodeCount(input: DoctorInput): number {
  if (input.nodes) {
    const nodes = input.nodes.filter((node) => isDataNode(node) && !isFrozenOnly(node));
    if (nodes.length > 0) {
      return nodes.length;
    }
  }
  return input.health.dataNodes;
}

function settingLayer(settings: ClusterSettingsLayers, key: string): string {
  if (key in settings.transient) {
    return 'transient cluster setting';
  }
  if (key in settings.persistent) {
    return 'persistent cluster setting';
  }
  return 'node configuration (elasticsearch.yml) or default';
}

/* ------------------------------------------------------------------ */
/* 1. Cluster status                                                   */
/* ------------------------------------------------------------------ */

function delayedText(delayed: number): string {
  return delayed > 0
    ? ` ${formatNumber(delayed)} of them ${isAre(delayed)} delayed on purpose after a node left (index.unassigned.node_left.delayed_timeout).`
    : '';
}

function healthFacts(health: DoctorInput['health']): DoctorFact[] {
  return [
    { label: 'Unassigned', value: formatNumber(health.unassigned) },
    { label: 'Initializing', value: formatNumber(health.initializing) },
    { label: 'Relocating', value: formatNumber(health.relocating) },
    { label: 'Active shards', value: formatNumber(health.activeShards) },
  ];
}

const clusterStatus: DoctorCheck = {
  id: 'cluster-status',
  category: 'health',
  title: 'Cluster status',
  description: 'Cluster health is green: every primary and replica shard is allocated.',
  sources: ['health'],
  run: (input) => {
    const health = input.health;
    if (health.status !== 'red' && health.status !== 'yellow') {
      return [];
    }
    const facts = healthFacts(health);
    const delayed = delayedText(health.delayedUnassigned);
    // The unassigned shards finding exists when the shard list could be read and lists them.
    const listed = (input.shards ?? []).some((row) => row.state === 'UNASSIGNED');
    if (health.status === 'red') {
      // Red means a primary is not active: unassigned, or still initializing
      // (recovering from disk after a restart).
      if (health.unassigned === 0 && health.initializing > 0) {
        return [
          {
            id: 'cluster-status:red',
            checkId: 'cluster-status',
            severity: 'critical',
            category: 'health',
            title: 'Cluster health is red while primaries recover',
            summary: `Some primary shards are still initializing (recovering); ${pluralize(health.initializing, 'shard')} ${isAre(health.initializing)} initializing in total.`,
            impact: 'Until they finish, searches on the affected indices return partial results or fail, and writes to them are rejected.',
            advice: 'Usually this resolves on its own after a restart: watch the recoveries. If one does not progress, explain the shard on the shard allocation page.',
            facts,
            resources: [],
            fixes: [],
            links: [RECOVERY_LINK, ALLOCATION_LINK],
          },
        ];
      }
      return [
        {
          id: 'cluster-status:red',
          checkId: 'cluster-status',
          severity: 'critical',
          category: 'health',
          title: 'Cluster health is red',
          summary: `At least one primary shard is not allocated${health.unassigned > 0 ? ` (${pluralize(health.unassigned, 'unassigned shard')} in total)` : ''}.${delayed}`,
          impact: 'Searches on the affected indices return partial results or fail, and writes to them are rejected.',
          advice: listed
            ? 'Find the missing primaries in the unassigned shards finding and explain why Elasticsearch cannot place them.'
            : 'Explain the unassigned primaries on the shard allocation page to see why Elasticsearch cannot place them.',
          facts,
          resources: [],
          fixes: [],
          links: [ALLOCATION_LINK],
        },
      ];
    }
    if (health.unassigned > 0) {
      return [
        {
          id: 'cluster-status:yellow',
          checkId: 'cluster-status',
          severity: 'warning',
          category: 'health',
          title: 'Cluster health is yellow',
          summary: `Every primary shard is allocated, but ${pluralize(health.unassigned, 'replica shard')} ${isAre(health.unassigned)} not.${delayed}`,
          impact:
            'Your data has fewer copies than configured: losing a node can make some of it unavailable, and searches have fewer copies to spread over.',
          advice: listed
            ? 'See the unassigned shards finding for the reason, or explain them on the shard allocation page.'
            : 'Explain the unassigned shards on the shard allocation page to see why no node accepts them.',
          facts,
          resources: [],
          fixes: [],
          links: [ALLOCATION_LINK],
        },
      ];
    }
    return [
      {
        id: 'cluster-status:recovering',
        checkId: 'cluster-status',
        severity: 'info',
        category: 'health',
        title: 'Cluster health is yellow while shards recover',
        summary: `${pluralize(health.initializing, 'shard')} ${isAre(health.initializing)} initializing; nothing is unassigned.`,
        impact: 'Health turns green on its own once the recoveries finish.',
        facts,
        resources: [],
        fixes: [],
        links: [RECOVERY_LINK],
      },
    ];
  },
};

/* ------------------------------------------------------------------ */
/* 2. Unassigned shards                                                */
/* ------------------------------------------------------------------ */

const unassignedShards: DoctorCheck = {
  id: 'unassigned-shards',
  category: 'shards',
  title: 'Unassigned shards',
  description: 'Every shard copy is allocated to a node.',
  sources: ['shards'],
  run: (input) => {
    const rows = (input.shards ?? []).filter((row) => row.state === 'UNASSIGNED');
    const maxReplicas = dataNodeCount(input) - 1;
    const replicasByIndex = new Map((input.indices ?? []).map((row) => [row.name, row.replicas]));
    const findings: DoctorFinding[] = [];
    for (const primary of [true, false]) {
      const copies = rows.filter((row) => row.primary === primary);
      if (copies.length === 0) {
        continue;
      }
      const groups = new Map<string, { shards: Set<number>; reasons: Set<string> }>();
      for (const row of copies) {
        const group = groups.get(row.index) ?? { shards: new Set<number>(), reasons: new Set<string>() };
        group.shards.add(row.shard);
        if (row.reason) {
          group.reasons.add(row.reason.toUpperCase());
        }
        groups.set(row.index, group);
      }
      const failed = [...groups.entries()]
        .filter(([, group]) => group.reasons.has('ALLOCATION_FAILED'))
        .map(([index]) => index);
      const resources: DoctorResource[] = [...groups.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([index, group]) => {
          const shards = [...group.shards].sort((left, right) => left - right);
          const reasons = [...group.reasons].map((reason) => unassignedReason(reason).label);
          const tooMany =
            !primary && maxReplicas >= 0 && (replicasByIndex.get(index) ?? 0) > maxReplicas ? 'more replicas than nodes' : null;
          return {
            kind: 'index' as const,
            name: index,
            detail: [
              `${plural(shards.length, 'Shard', 'Shards')} ${shards.join(', ')}`,
              ...reasons,
              ...(tooMany ? [tooMany] : []),
            ].join(' · '),
            link: allocationLink(index, shards[0] ?? 0, primary),
          };
        });
      const count = copies.length;
      // A yellow cluster is reported here (runChecks drops the separate status finding).
      const yellow = !primary && input.health.status === 'yellow';
      findings.push({
        id: `unassigned-shards:${primary ? 'primary' : 'replica'}`,
        checkId: 'unassigned-shards',
        severity: primary ? 'critical' : 'warning',
        category: 'shards',
        title: `${pluralize(count, primary ? 'primary shard' : 'replica shard')} ${isAre(count)} unassigned`,
        summary: primary
          ? `${indicesLabel(groups.size)} ${hasHave(groups.size)} primary shards without an active copy.`
          : `${yellow ? 'Cluster health is yellow: ' : ''}${indicesLabel(groups.size)} ${isAre(groups.size)} missing replica copies.${yellow ? delayedText(input.health.delayedUnassigned) : ''}`,
        impact: primary
          ? 'This data cannot be searched and writes to it fail until the primaries are allocated.'
          : 'The data is still served, but with less redundancy: if a node holding the last active copy of a shard fails, the cluster turns red.',
        advice: primary
          ? 'Explain each shard to see what blocks it. If a node left, bring it back; if allocation failed repeatedly, fix the cause and retry.'
          : 'Explain a shard to see why no node accepts it. Common causes are too few nodes for the replica count, full disks and allocation filters.',
        ...(yellow ? { facts: [{ label: 'Cluster health', value: 'Yellow' }, ...healthFacts(input.health).slice(0, 3)] } : {}),
        resources,
        resourceLabel: 'Affected indices',
        fixes:
          failed.length > 0
            ? [
                {
                  key: `retry-allocation:${primary ? 'primary' : 'replica'}`,
                  label: 'Retry failed allocations',
                  icon: 'bi-arrow-repeat',
                  tone: 'default',
                  confirmTitle: 'Retry failed allocations?',
                  confirmMessage:
                    'Elasticsearch stops allocating a shard after 5 failed attempts (index.allocation.max_retries). This makes it try again for every shard that hit the limit. Fix the cause first, or the attempts fail again.',
                  confirmItems: failed,
                  confirmLabel: 'Retry allocations',
                  path: 'doctor/retry_allocation',
                  payload: {},
                  success: 'Asked Elasticsearch to retry the failed allocations',
                  failure: 'Could not retry the failed allocations',
                },
              ]
            : [],
        links: [ALLOCATION_LINK],
      });
    }
    return findings;
  },
};

/* ------------------------------------------------------------------ */
/* 3. Replicas that can never be allocated                             */
/* ------------------------------------------------------------------ */

const impossibleReplicas: DoctorCheck = {
  id: 'impossible-replicas',
  category: 'shards',
  title: 'Replica count fits the cluster',
  description: 'No index asks for more replicas than there are data nodes to hold them.',
  sources: ['indices'],
  run: (input) => {
    const dataNodes = dataNodeCount(input);
    if (dataNodes <= 0) {
      return [];
    }
    const max = dataNodes - 1;
    const rows = (input.indices ?? [])
      .filter((row) => row.replicas > max)
      .sort((left, right) => left.name.localeCompare(right.name));
    if (rows.length === 0) {
      return [];
    }
    const names = rows.map((row) => row.name);
    const extra = 'The replicas that are allocated now stay where they are; only copies that can never be placed are dropped.';
    return [
      {
        id: 'impossible-replicas',
        checkId: 'impossible-replicas',
        severity: 'warning',
        category: 'shards',
        title: `${indicesLabel(rows.length)} ${hasHave(rows.length)} more replicas than the cluster can hold`,
        summary: `Elasticsearch never puts two copies of the same shard on one node, so with ${pluralize(dataNodes, 'data node')} an index can have at most ${pluralize(max, 'replica')}. The extra replicas stay unassigned forever.`,
        impact: 'They keep the cluster health yellow, which hides real allocation problems behind permanent noise.',
        advice: `Reduce the replicas to ${max}, or add data nodes. Data tiers and allocation filters can lower the limit further.`,
        resources: rows.map((row) => ({
          kind: 'index',
          name: row.name,
          detail: `${pluralize(row.replicas, 'replica')} · ${pluralize((row.replicas - max) * row.primaries, 'shard copy', 'shard copies')} can never be allocated`,
          link: indexLink(row.name),
          ...(rows.length > 1 ? { fix: replicasFix([row.name], max, 'reduce', extra) } : {}),
        })),
        resourceLabel: 'Affected indices',
        fixes: [replicasFix(names, max, 'reduce', extra)],
        links: [ALLOCATION_LINK],
      },
    ];
  },
};

/* ------------------------------------------------------------------ */
/* 4. Indices without replicas                                         */
/* ------------------------------------------------------------------ */

/**
 * Data stream of a backing index: `.ds-<stream>-<yyyy.MM.dd>-<generation>`
 * (7.11+) or `.ds-<stream>-<generation>` (7.9–7.10).
 */
const BACKING_INDEX = /^\.ds-(.+?)-(?:\d{4}\.\d{2}\.\d{2}-)?\d+$/;

export function backingDataStream(index: string): string | null {
  return BACKING_INDEX.exec(index)?.[1] ?? null;
}

/** Hidden data streams Elasticsearch creates itself whose names do not start with a dot. */
const SYSTEM_DATA_STREAMS = /^(?:ilm-history|slm-history)-\d+$/;

/**
 * Mounted searchable snapshot indices have no replicas by design: the
 * snapshot is their resilience ("Searchable snapshots" in the reference).
 * Their store type is `snapshot` (partially mounted ones also set
 * `index.store.snapshot.partial`).
 */
function isSearchableSnapshot(input: DoctorInput, index: string): boolean {
  const settings = input.blocks?.get(index);
  return settings !== undefined && (settings['index.store.type'] === 'snapshot' || isTrue(settings['index.store.snapshot.partial']));
}

/** User data: regular indices and backing indices of user data streams. */
function isUserIndex(name: string): boolean {
  const stream = backingDataStream(name);
  if (stream !== null) {
    return !isSystemName(stream) && !SYSTEM_DATA_STREAMS.test(stream);
  }
  return !isSystemName(name);
}

const missingReplicas: DoctorCheck = {
  id: 'missing-replicas',
  category: 'indices',
  title: 'Indices have replicas',
  description:
    'Every index and data stream keeps at least one replica (system indices and searchable snapshots, which rely on their snapshot, are not counted).',
  sources: ['indices'],
  run: (input) => {
    const dataNodes = dataNodeCount(input);
    const rows = (input.indices ?? [])
      .filter((row) => row.replicas === 0 && isUserIndex(row.name) && !isSearchableSnapshot(input, row.name))
      .sort((left, right) => left.name.localeCompare(right.name));
    if (rows.length === 0 || dataNodes <= 0) {
      return [];
    }
    // Backing indices are listed per data stream.
    const plain = rows.filter((row) => backingDataStream(row.name) === null);
    const streams = new Map<string, IndexRow[]>();
    for (const row of rows) {
      const stream = backingDataStream(row.name);
      if (stream !== null) {
        streams.set(stream, [...(streams.get(stream) ?? []), row]);
      }
    }
    const streamNames = [...streams.keys()].sort((left, right) => left.localeCompare(right));
    const sizeOf = (selected: readonly IndexRow[]) => selected.reduce((sum, row) => sum + (row.primarySize ?? row.size ?? 0), 0);
    const indexResource = (row: IndexRow): DoctorResource => ({
      kind: 'index',
      name: row.name,
      detail: [
        pluralize(row.primaries, 'primary shard'),
        formatBytes(row.primarySize ?? row.size),
        ...(row.status === 'close' ? ['closed'] : []),
      ].join(' · '),
      link: indexLink(row.name),
    });
    const streamResource = (stream: string): DoctorResource => {
      const backing = streams.get(stream) ?? [];
      return {
        kind: 'data-stream',
        name: stream,
        detail: [
          pluralize(backing.length, 'backing index', 'backing indices'),
          pluralize(backing.reduce((sum, row) => sum + row.primaries, 0), 'primary shard'),
          formatBytes(sizeOf(backing)),
        ].join(' · '),
        link: { label: 'Open data stream', icon: 'bi-water', route: '/data_streams', params: { name: stream } },
      };
    };
    const templateAdvice =
      streamNames.length > 0
        ? ' For data streams, also set number_of_replicas in their index template: new backing indices inherit it.'
        : '';
    const streamLinks = streamNames.length > 0 ? [DATA_STREAMS_LINK] : [];
    const label = streamNames.length > 0 && plain.length > 0 ? 'Affected indices and data streams' : streamNames.length > 0 ? 'Affected data streams' : 'Affected indices';
    const subjects = [
      ...(plain.length > 0 ? [indicesLabel(plain.length)] : []),
      ...(streamNames.length > 0 ? [pluralize(streamNames.length, 'data stream')] : []),
    ];
    const subjectCount = plain.length + streamNames.length;
    const title = `${listJoin(subjects)} ${subjectCount === 1 ? 'has' : 'have'} no replicas`;
    if (dataNodes === 1) {
      return [
        {
          id: 'missing-replicas:single-node',
          checkId: 'missing-replicas',
          severity: 'info',
          category: 'indices',
          title,
          summary:
            'Every shard exists only once. That is expected with a single data node: Elasticsearch never allocates a replica on the node that holds its primary.',
          impact: 'If the node or its disk fails, this data is unavailable or lost; snapshots are its only other copy.',
          advice: 'Add a second data node and then add replicas, or make sure snapshots run regularly.',
          resources: [...plain.map(indexResource), ...streamNames.map(streamResource)],
          resourceLabel: label,
          fixes: [],
          links: streamLinks,
        },
      ];
    }
    const thresholds = diskThresholds(input.settings, input.version);
    const crowded = nodeDiskStates(input, thresholds).filter((state) => state.level === 'high' || state.level === 'flood');
    const extra = (selected: readonly IndexRow[]): string => {
      const disk = `Elasticsearch copies every shard to another node, which needs about ${formatBytes(sizeOf(selected))} of extra disk.`;
      return crowded.length > 0 && thresholds.enabled
        ? `${disk} ${listJoin(crowded.map((state) => state.node.name))} ${isAre(crowded.length)} above the high watermark, so the new replicas may stay unassigned.`
        : disk;
    };
    const many = subjectCount > 1;
    const streamFix = (stream: string): DoctorFix => {
      const backing = streams.get(stream) ?? [];
      return {
        ...replicasFix(
          backing.map((row) => row.name),
          1,
          'add',
          `${extra(backing)} New backing indices take number_of_replicas from the index template.`,
        ),
        confirmTitle:
          backing.length === 1
            ? `Add a replica to the backing index of ${stream}?`
            : `Add a replica to the ${pluralize(backing.length, 'backing index', 'backing indices')} of ${stream}?`,
        confirmItems: backing.length > 1 ? backing.map((row) => row.name) : [],
        success: `Added a replica to the backing indices of ${stream}`,
        failure: `Could not add a replica to the backing indices of ${stream}`,
      };
    };
    return [
      {
        id: 'missing-replicas',
        checkId: 'missing-replicas',
        severity: 'warning',
        category: 'indices',
        title,
        summary:
          streamNames.length > 0 && plain.length === 0
            ? 'Every shard of these data streams exists only once.'
            : `Every shard of these ${streamNames.length > 0 ? 'indices and data streams' : 'indices'} exists only once.`,
        impact:
          'If a node fails, its shards are unavailable until it returns, and lost if its disk is lost. Searches also cannot be spread over copies.',
        advice: `Add a replica so every shard has a copy on another node. It takes as much extra disk as the primaries use.${templateAdvice}`,
        resources: [
          ...plain.map((row) => ({
            ...indexResource(row),
            ...(many ? { fix: replicasFix([row.name], 1, 'add', extra([row])) } : {}),
          })),
          ...streamNames.map((stream) => ({
            ...streamResource(stream),
            ...(many ? { fix: streamFix(stream) } : {}),
          })),
        ],
        resourceLabel: label,
        fixes: [
          !many && streamNames.length === 1 && plain.length === 0
            ? streamFix(streamNames[0]!)
            : replicasFix(rows.map((row) => row.name), 1, 'add', extra(rows)),
        ],
        links: streamLinks,
      },
    ];
  },
};

/* ------------------------------------------------------------------ */
/* 5. Disk watermarks                                                  */
/* ------------------------------------------------------------------ */

const DISK_LEVELS: readonly {
  readonly key: WatermarkKey;
  readonly severity: DoctorSeverity;
  readonly name: string;
}[] = [
  { key: 'flood', severity: 'critical', name: 'flood stage watermark' },
  { key: 'high', severity: 'warning', name: 'high watermark' },
  { key: 'low', severity: 'info', name: 'low watermark' },
];

/**
 * What each watermark does (Elasticsearch reference, "Disk-based shard
 * allocation settings"): low stops allocating shards to the node except
 * primaries of new indices; high relocates shards away; flood stage puts
 * `index.blocks.read_only_allow_delete` on every index with a shard on the
 * node, released automatically below the high watermark since 7.4.
 */
function diskTexts(key: WatermarkKey, enforced: boolean, thresholds: DiskThresholds): Pick<DoctorFinding, 'summary' | 'impact' | 'advice'> {
  if (!enforced) {
    return {
      summary:
        'Disk-based shard allocation is disabled (cluster.routing.allocation.disk.threshold_enabled: false), so Elasticsearch does not react to this.',
      impact:
        'Nothing stops shards from filling the disk completely. When that happens, writes fail and shards on the node can fail.',
      advice: 'Free up disk space or add capacity, and enable disk-based shard allocation again.',
    };
  }
  switch (key) {
    case 'flood':
      return {
        summary:
          'Elasticsearch has blocked writes to every index with a shard on these nodes (index.blocks.read_only_allow_delete) to keep the disk from filling up.',
        impact:
          'Indexing and updates to those indices fail until disk usage drops. Elasticsearch removes the block on its own once usage falls below the high watermark.',
        advice: 'Free up disk space now: delete indices you no longer need, or add data nodes or disk capacity.',
      };
    case 'high':
      return {
        summary: 'Elasticsearch moves shards away from these nodes and does not allocate any new shard to them.',
        impact: `If usage keeps growing and reaches the flood stage${thresholds.flood ? ` (${describeWatermark(thresholds.flood)})` : ''}, every index with a shard on these nodes becomes read-only.`,
        advice: 'Free up disk space or add capacity before the flood stage is reached.',
      };
    case 'low':
      return {
        summary:
          'Elasticsearch no longer allocates shards to these nodes, except primaries of newly created indices.',
        impact: 'The cluster has less room to place replicas and recover shards. At the high watermark shards start moving away.',
        advice: 'Plan more disk capacity or clean up old data.',
      };
  }
}

const diskWatermarks: DoctorCheck = {
  id: 'disk-watermarks',
  category: 'disk',
  title: 'Disk usage',
  description: 'Every data node has more free disk space than the low watermark requires.',
  sources: ['nodes'],
  run: (input) => {
    const thresholds = diskThresholds(input.settings, input.version);
    const states = nodeDiskStates(input, thresholds);
    const facts: DoctorFact[] = [
      ...(thresholds.low ? [{ label: 'Low watermark', value: describeWatermark(thresholds.low) }] : []),
      ...(thresholds.high ? [{ label: 'High watermark', value: describeWatermark(thresholds.high) }] : []),
      ...(thresholds.flood ? [{ label: 'Flood stage', value: describeWatermark(thresholds.flood) }] : []),
    ];
    return DISK_LEVELS.flatMap((level): DoctorFinding[] => {
      const nodes = states.filter((state) => state.level === level.key);
      if (nodes.length === 0) {
        return [];
      }
      return [
        {
          id: `disk-watermarks:${level.key}`,
          checkId: 'disk-watermarks',
          severity: level.severity,
          category: 'disk',
          title: `${pluralize(nodes.length, 'node')} ${isAre(nodes.length)} above the ${level.name}`,
          ...diskTexts(level.key, thresholds.enabled, thresholds),
          ...(thresholds.source === 'defaults'
            ? { note: 'The cluster settings could not be read, so the default watermarks were assumed.' }
            : {}),
          facts,
          resources: nodes.map((state) => ({
            kind: 'node',
            name: state.node.name,
            detail: `${roundPercent(state.used)}% used · ${formatBytes(state.available)} free of ${formatBytes(state.total)}${
              state.required !== null ? ` · the ${level.name} needs ${formatBytes(state.required)} free` : ''
            }`,
          })),
          resourceLabel: 'Affected nodes',
          fixes: [],
          links: [NODES_LINK],
        },
      ];
    });
  },
};

const diskAllocationEnabled: DoctorCheck = {
  id: 'disk-threshold-enabled',
  category: 'settings',
  title: 'Disk-based shard allocation',
  description: 'The disk watermarks are enforced (cluster.routing.allocation.disk.threshold_enabled).',
  sources: ['settings'],
  run: (input) => {
    const thresholds = diskThresholds(input.settings, input.version);
    if (thresholds.enabled || !input.settings) {
      return [];
    }
    const key = 'cluster.routing.allocation.disk.threshold_enabled';
    const pressed = nodeDiskStates(input, thresholds).filter((state) => state.level !== null);
    // Resetting the API value only helps when elasticsearch.yml does not disable it too.
    const resettable = isExplicit(input.settings, key) && input.settings.defaults[key] !== 'false';
    return [
      {
        id: 'disk-threshold-enabled',
        checkId: 'disk-threshold-enabled',
        // Info: when nodes are past a watermark, the disk finding already
        // carries the warning and explains that nothing is enforced.
        severity: 'info',
        category: 'settings',
        title: 'Disk watermarks are not enforced',
        summary: `${key} is false, so Elasticsearch neither keeps shards off full nodes nor blocks writes before a disk fills up.`,
        impact:
          pressed.length > 0
            ? `${listJoin(pressed.map((state) => state.node.name))} ${isAre(pressed.length)} already past a watermark (see the disk finding) and nothing protects ${pressed.length === 1 ? 'it' : 'them'} from running out of disk.`
            : 'A node can run out of disk completely, which fails writes and shards.',
        advice: resettable
          ? 'Enable it again unless this is a test cluster.'
          : 'Enable it again unless this is a test cluster: it is set in the node configuration (elasticsearch.yml), or set it to true as a persistent cluster setting.',
        facts: [{ label: 'Set in', value: settingLayer(input.settings, key) }],
        resources: [],
        fixes: resettable
          ? [
              {
                key: 'disk-threshold-enabled',
                label: 'Enable disk watermarks',
                icon: 'bi-toggle-on',
                tone: 'default',
                confirmTitle: 'Enable disk-based shard allocation?',
                confirmMessage: `Removes the ${key} override so the default (true) applies. Elasticsearch then moves shards off nodes above the high watermark and blocks writes at the flood stage.`,
                confirmItems: [],
                confirmLabel: 'Enable',
                path: 'cluster_settings/save',
                payload: { settings: { persistent: { [key]: null }, transient: { [key]: null } } },
                success: 'Disk-based shard allocation enabled',
                failure: 'Could not enable disk-based shard allocation',
              },
            ]
          : [],
        links: [CLUSTER_SETTINGS_LINK],
      },
    ];
  },
};

/* ------------------------------------------------------------------ */
/* 6. Index blocks                                                     */
/* ------------------------------------------------------------------ */

const BLOCK_LABELS: readonly (readonly [string, string])[] = [
  ['index.blocks.read_only', 'read-only'],
  ['index.blocks.write', 'write block'],
  ['index.blocks.read', 'read block'],
  ['index.blocks.metadata', 'metadata block'],
];

/** Advice and note for the flood stage block, from what the disk threshold monitor does now. */
function floodBlockTexts(
  state: FloodBlockState,
  aboveHigh: readonly string[],
  autoRelease: boolean,
  knowDisks: boolean,
): { advice: string; note: string } {
  if (!state.enabled) {
    return {
      advice: 'Make sure the disks have room, then remove the block.',
      note: 'Disk-based shard allocation is disabled (threshold_enabled: false), so Elasticsearch neither re-applies nor removes this block on its own.',
    };
  }
  if (state.stillFull.length > 0) {
    return {
      advice: 'Free disk space first, then remove the block.',
      note: `${listJoin(state.stillFull)} ${isAre(state.stillFull.length)} still above the flood stage watermark: Elasticsearch re-applies the block until disk space is freed.`,
    };
  }
  if (!knowDisks) {
    return {
      advice: 'Free disk space first, then remove the block.',
      note: 'Elasticsearch re-applies the block while a node holding these indices stays above the flood stage watermark.',
    };
  }
  if (aboveHigh.length > 0) {
    return {
      advice: 'No node is above the flood stage any more, so the block can be removed now.',
      note: autoRelease
        ? `Elasticsearch also removes it on its own once ${listJoin(aboveHigh)} ${aboveHigh.length === 1 ? 'drops' : 'drop'} below the high watermark.`
        : 'Elasticsearch re-applies the block if a node holding these indices passes the flood stage again.',
    };
  }
  return {
    advice: 'No node is above the flood stage any more, so the block can be removed now.',
    note: autoRelease
      ? 'Every node is below the high watermark, so Elasticsearch normally releases the block on its own within a minute.'
      : 'Elasticsearch re-applies the block if a node holding these indices passes the flood stage again.',
  };
}

const indexBlocks: DoctorCheck = {
  id: 'index-blocks',
  category: 'indices',
  title: 'Index blocks',
  description: 'No index is blocked from writes by a full disk or a manual block.',
  sources: ['blocks'],
  run: (input) => {
    const entries = [...(input.blocks ?? new Map()).entries()].sort(([left], [right]) => left.localeCompare(right));
    const floodBlocked = entries
      .filter(([, settings]) => isTrue(settings['index.blocks.read_only_allow_delete']))
      .map(([index]) => index);
    const manual = entries
      .map(([index, settings]) => ({
        index,
        blocks: BLOCK_LABELS.filter(([key]) => isTrue(settings[key])).map(([, label]) => label),
      }))
      .filter((entry) => entry.blocks.length > 0);
    const findings: DoctorFinding[] = [];
    if (floodBlocked.length > 0) {
      const thresholds = diskThresholds(input.settings, input.version);
      const states = thresholds.enabled ? nodeDiskStates(input, thresholds) : [];
      const state: FloodBlockState = {
        enabled: thresholds.enabled,
        stillFull: states.filter((item) => item.level === 'flood').map((item) => item.node.name),
      };
      const aboveHigh = states.filter((item) => item.level === 'high').map((item) => item.node.name);
      // Since 7.4 DiskThresholdMonitor releases the block once every node
      // holding the index is below the high watermark.
      const autoRelease = input.version === null || versionAtLeast(input.version, 7, 4);
      const texts = floodBlockTexts(state, aboveHigh, autoRelease, input.nodes !== null);
      findings.push({
        id: 'index-blocks:read-only-allow-delete',
        checkId: 'index-blocks',
        severity: 'critical',
        category: 'indices',
        title: `${indicesLabel(floodBlocked.length)} ${isAre(floodBlocked.length)} blocked from writes (read_only_allow_delete)`,
        summary:
          'These indices carry index.blocks.read_only_allow_delete, the block Elasticsearch adds when a node passes the flood stage watermark. Only deletes are allowed.',
        impact: 'Indexing and updates fail with "index read-only / allow delete" errors, so new data is being dropped or queued.',
        advice: texts.advice,
        note: texts.note,
        resources: floodBlocked.map((index) => ({
          kind: 'index',
          name: index,
          link: indexSettingsLink(index),
          ...(floodBlocked.length > 1 ? { fix: removeReadOnlyFix([index], state) } : {}),
        })),
        resourceLabel: 'Blocked indices',
        fixes: [removeReadOnlyFix(floodBlocked, state)],
        links: [NODES_LINK],
      });
    }
    if (manual.length > 0) {
      findings.push({
        id: 'index-blocks:manual',
        checkId: 'index-blocks',
        severity: 'info',
        category: 'indices',
        title: `${indicesLabel(manual.length)} ${hasHave(manual.length)} a read-only or write block`,
        summary: 'Requests these blocks forbid (writes, and for some blocks reads or mapping changes) are rejected.',
        impact: 'Often intentional, for example before shrinking, cloning or archiving an index. If not, clients see "index blocked" errors.',
        advice: 'Remove the block in the index settings once the index should accept writes again.',
        resources: manual.map((entry) => ({
          kind: 'index',
          name: entry.index,
          detail: entry.blocks.join(', '),
          link: indexSettingsLink(entry.index),
        })),
        resourceLabel: 'Blocked indices',
        fixes: [],
        links: [],
      });
    }
    return findings;
  },
};

/* ------------------------------------------------------------------ */
/* 7. Oversized shards                                                 */
/* ------------------------------------------------------------------ */

const oversizedShards: DoctorCheck = {
  id: 'oversized-shards',
  category: 'shards',
  title: 'Shard size',
  description: 'No shard is larger than 50 GB (Elastic recommends 10–50 GB per shard).',
  sources: ['shards'],
  run: (input) => {
    const groups = new Map<string, { shards: Set<number>; largest: number }>();
    for (const row of input.shards ?? []) {
      if (row.store === null || row.store <= OVERSIZED_SHARD_BYTES) {
        continue;
      }
      const group = groups.get(row.index) ?? { shards: new Set<number>(), largest: 0 };
      group.shards.add(row.shard);
      group.largest = Math.max(group.largest, row.store);
      groups.set(row.index, group);
    }
    if (groups.size === 0) {
      return [];
    }
    const entries = [...groups.entries()].sort(([, left], [, right]) => right.largest - left.largest);
    return [
      {
        id: 'oversized-shards',
        checkId: 'oversized-shards',
        severity: 'warning',
        category: 'shards',
        title: `${indicesLabel(entries.length)} ${hasHave(entries.length)} shards larger than 50 GB`,
        summary: 'Shards this large are slow to recover and relocate, and make it harder for the cluster to balance load.',
        impact: 'After a node failure, copying a big shard to another node can take hours, while the cluster runs with fewer copies.',
        advice:
          'Aim for 10–50 GB per shard: roll over earlier (max_primary_shard_size: 50gb in the lifecycle policy), or split or reindex into more primary shards.',
        resources: entries.map(([index, group]) => ({
          kind: 'index',
          name: index,
          detail: `${pluralize(group.shards.size, 'shard')} over 50 GB · largest ${formatBytes(group.largest)}`,
          link: indexLink(index, 'shards'),
        })),
        resourceLabel: 'Affected indices',
        fixes: [],
        links: [],
      },
    ];
  },
};

/* ------------------------------------------------------------------ */
/* 8. Shard count                                                      */
/* ------------------------------------------------------------------ */

const shardCapacity: DoctorCheck = {
  id: 'shard-capacity',
  category: 'shards',
  title: 'Shard count',
  description: 'The cluster is well below its shard limit (cluster.max_shards_per_node × data nodes).',
  sources: ['indices'],
  run: (input) => {
    const dataNodes = dataNodeCount(input);
    if (dataNodes <= 0) {
      return [];
    }
    // The shard limit counts every copy of the shards of open indices (ShardLimitValidator).
    const used = (input.indices ?? [])
      .filter((row) => row.status !== 'close')
      .reduce((sum, row) => sum + row.primaries * (1 + row.replicas), 0);
    const perNode = toNumber(settingValue(input.settings, 'cluster.max_shards_per_node')) ?? DEFAULT_MAX_SHARDS_PER_NODE;
    const limit = perNode * dataNodes;
    if (limit <= 0) {
      return [];
    }
    const ratio = used / limit;
    if (ratio < SHARD_LIMIT_WARNING) {
      return [];
    }
    return [
      {
        id: 'shard-capacity',
        checkId: 'shard-capacity',
        severity: ratio >= SHARD_LIMIT_CRITICAL ? 'critical' : 'warning',
        category: 'shards',
        title: `The cluster uses ${roundPercent(ratio * 100)}% of its shard limit`,
        summary: `Open indices hold ${formatNumber(used)} shards; the limit is ${formatNumber(limit)} (${formatNumber(perNode)} per data node × ${pluralize(dataNodes, 'data node')}).`,
        impact:
          'Once the limit is reached, Elasticsearch refuses to create indices, roll over data streams and restore snapshots, so ingestion can stop.',
        advice:
          'Delete or merge small indices, shrink over-sharded ones, or add data nodes. Raising cluster.max_shards_per_node only postpones the problem.',
        facts: [
          { label: 'Shards', value: formatNumber(used) },
          { label: 'Limit', value: formatNumber(limit) },
          { label: 'Per node', value: formatNumber(perNode) },
        ],
        resources: [],
        fixes: [],
        links: [CLUSTER_SETTINGS_LINK],
      },
    ];
  },
};

/* ------------------------------------------------------------------ */
/* 9. Small indices with many shards                                   */
/* ------------------------------------------------------------------ */

const overSharded: DoctorCheck = {
  id: 'over-sharded',
  category: 'shards',
  title: 'Shards per index',
  description: 'No small index is split into several primary shards.',
  sources: ['indices', 'shards'],
  run: (input) => {
    const primaries = new Map<string, number[]>();
    for (const row of input.shards ?? []) {
      if (row.primary) {
        const sizes = primaries.get(row.index) ?? [];
        sizes.push(row.store ?? Number.NaN);
        primaries.set(row.index, sizes);
      }
    }
    const rows = (input.indices ?? [])
      .filter((row) => row.status !== 'close' && row.primaries > 1 && !isSystemName(row.name))
      .filter((row) => {
        const sizes = primaries.get(row.name) ?? [];
        return sizes.length === row.primaries && sizes.every((size) => Number.isFinite(size) && size < SMALL_SHARD_BYTES);
      })
      .sort((left, right) => right.primaries - left.primaries || left.name.localeCompare(right.name));
    if (rows.length === 0) {
      return [];
    }
    return [
      {
        id: 'over-sharded',
        checkId: 'over-sharded',
        severity: 'info',
        category: 'shards',
        title: `${indicesLabel(rows.length)} could use fewer shards`,
        summary: 'Each of these indices has several primary shards, and every one of them is smaller than 1 GB.',
        impact: 'Every shard costs heap, file handles and search threads. Many tiny shards slow searches down without adding capacity.',
        advice:
          'One primary shard holds up to about 50 GB. Shrink existing indices (or reindex them) and lower number_of_shards in their template.',
        resources: rows.map((row) => ({
          kind: 'index',
          name: row.name,
          detail: `${pluralize(row.primaries, 'primary shard')} · ${formatBytes(row.primarySize)} in total`,
          link: indexLink(row.name, 'shards'),
        })),
        resourceLabel: 'Affected indices',
        fixes: [],
        links: [],
      },
    ];
  },
};

/* ------------------------------------------------------------------ */
/* 10. Lifecycle errors                                                */
/* ------------------------------------------------------------------ */

/** "policy [x] does not exist" → "x". */
function missingPolicyName(row: IlmErrorRow): string | null {
  return /^policy \[(.*)\] does not exist$/.exec(row.reason ?? '')?.[1] ?? row.policy;
}

const ilmErrors: DoctorCheck = {
  id: 'ilm-errors',
  category: 'lifecycle',
  title: 'Lifecycle errors',
  description: 'No index managed by ILM is stuck in the ERROR step.',
  sources: ['ilm'],
  run: (input) => {
    const rows = input.ilm ?? [];
    // An index whose policy does not exist cannot be retried (`_ilm/retry`
    // rejects it, and with it the whole request), so it gets its own finding.
    const failed = rows.filter((row) => !row.missingPolicy);
    const orphaned = rows.filter((row) => row.missingPolicy);
    const findings: DoctorFinding[] = [];
    if (failed.length > 0) {
      const indices = failed.map((row) => row.index);
      findings.push({
        id: 'ilm-errors',
        checkId: 'ilm-errors',
        severity: 'warning',
        category: 'lifecycle',
        title: `Lifecycle management failed for ${indicesLabel(failed.length)}`,
        summary: 'ILM stopped at a failed step for these indices.',
        impact: 'Until the step succeeds they are not rolled over, moved to other tiers or deleted, so they can grow and use disk without limit.',
        advice: 'Fix the cause shown for each index (often a missing rollover alias, setting or privilege), then retry the step.',
        ...(failed.some((row) => row.autoRetry)
          ? { note: 'Elasticsearch retries some of these steps on its own (the error is retryable); a manual retry runs the step right away.' }
          : {}),
        resources: failed.map((row) => ({
          kind: 'index',
          name: row.index,
          detail: [
            `${row.failedStep ?? 'A step'} failed${row.reason ? `: ${row.reason}` : ''}`,
            ...(row.policy ? [`policy ${row.policy}`] : []),
            ...(row.retryCount ? [`retried ${pluralize(row.retryCount, 'time')}`] : []),
          ].join(' · '),
          link: indexLink(row.index, 'lifecycle'),
          ...(failed.length > 1 ? { fix: ilmRetryFix([row.index]) } : {}),
        })),
        resourceLabel: 'Affected indices',
        fixes: [ilmRetryFix(indices)],
        links: [ilmStatusLink(indices)],
      });
    }
    if (orphaned.length > 0) {
      const policies = [...new Set(orphaned.map(missingPolicyName).filter((name): name is string => !!name))].sort();
      findings.push({
        id: 'ilm-errors:missing-policy',
        checkId: 'ilm-errors',
        severity: 'warning',
        category: 'lifecycle',
        title: `${indicesLabel(orphaned.length)} ${orphaned.length === 1 ? 'uses' : 'use'} a lifecycle policy that does not exist`,
        summary:
          policies.length === 1
            ? `index.lifecycle.name points to ${policies[0]}, which does not exist, so ILM cannot manage ${orphaned.length === 1 ? 'this index' : 'these indices'}.`
            : `index.lifecycle.name points to policies that do not exist (${listJoin(policies)}), so ILM cannot manage these indices.`,
        impact: 'They are never rolled over, moved to other tiers or deleted, so they can grow and use disk without limit. Retrying does not help.',
        advice: 'Create the policy, or point index.lifecycle.name to an existing policy (or remove it) in the index settings.',
        resources: orphaned.map((row) => ({
          kind: 'index',
          name: row.index,
          detail: `Policy ${missingPolicyName(row) ?? '(unknown)'} does not exist`,
          link: indexSettingsLink(row.index),
        })),
        resourceLabel: 'Affected indices',
        fixes: [],
        links: [ILM_POLICIES_LINK],
      });
    }
    return findings;
  },
};

/* ------------------------------------------------------------------ */
/* 11. JVM                                                             */
/* ------------------------------------------------------------------ */

/**
 * JVM memory pressure as Elastic defines it ("High JVM memory pressure"
 * troubleshooting guide): old-generation used / max. Total heap usage is noisy
 * with G1 (it climbs high before every young collection), so it is only the
 * fallback when the pool is not reported.
 */
export function memoryPressure(node: NodeInfo): { percent: number; oldGen: boolean } | null {
  if (node.oldGenUsed !== null && node.oldGenMax !== null && node.oldGenMax > 0) {
    return { percent: (node.oldGenUsed / node.oldGenMax) * 100, oldGen: true };
  }
  return node.heapPercent === null ? null : { percent: node.heapPercent, oldGen: false };
}

const jvmHeap: DoctorCheck = {
  id: 'jvm-heap',
  category: 'nodes',
  title: 'JVM memory pressure',
  description: `Every node keeps its old-generation heap (JVM memory pressure) below ${HEAP_WARNING}%.`,
  sources: ['nodes'],
  run: (input) => {
    const entries = (input.nodes ?? [])
      .map((node) => ({ node, pressure: memoryPressure(node) }))
      .filter((entry) => entry.pressure !== null && entry.pressure.percent >= HEAP_WARNING);
    const levels: readonly { severity: DoctorSeverity; entries: typeof entries; word: string; threshold: number }[] = [
      { severity: 'critical', entries: entries.filter((entry) => entry.pressure!.percent >= HEAP_CRITICAL), word: 'critical', threshold: HEAP_CRITICAL },
      { severity: 'warning', entries: entries.filter((entry) => entry.pressure!.percent < HEAP_CRITICAL), word: 'high', threshold: HEAP_WARNING },
    ];
    return levels
      .filter((level) => level.entries.length > 0)
      .map((level) => ({
        id: `jvm-heap:${level.severity}`,
        checkId: 'jvm-heap',
        severity: level.severity,
        category: 'nodes' as const,
        title: `JVM memory pressure is ${level.word} on ${pluralize(level.entries.length, 'node')}`,
        summary: level.entries.every((entry) => entry.pressure!.oldGen)
          ? `${level.threshold}% or more of the old-generation heap is in use: memory that garbage collection could not free.`
          : `${level.threshold}% or more of the JVM heap is in use.`,
        impact:
          level.severity === 'critical'
            ? 'The node is close to the parent circuit breaker limit (95% of the heap by default), so requests start being rejected, and it risks running out of memory.'
            : 'Under sustained memory pressure a node spends more time in garbage collection, trips circuit breakers and can run out of memory.',
        advice:
          'Reduce the number of shards, fielddata on text fields or heavy aggregations, or give the node more heap (at most half of its RAM, below 32 GB).',
        note: 'This is a single sample: run the checks again to see whether it stays high.',
        resources: level.entries.map((entry) => ({
          kind: 'node' as const,
          name: entry.node.name,
          detail: [
            ...(entry.pressure!.oldGen ? [`old gen ${roundPercent(entry.pressure!.percent)}%`] : []),
            `heap ${entry.node.heapPercent ?? '?'}% of ${formatBytes(entry.node.heapMax)}`,
          ].join(' · '),
        })),
        resourceLabel: 'Affected nodes',
        fixes: [],
        links: [NODES_LINK],
      }));
  },
};

const jvmGc: DoctorCheck = {
  id: 'jvm-gc',
  category: 'nodes',
  title: 'Garbage collection',
  description: 'Old-generation garbage collections are rare and short on every node.',
  sources: ['nodes'],
  run: (input) => {
    const slow = (input.nodes ?? [])
      .map((node) => {
        const count = node.oldGcCount ?? 0;
        const time = node.oldGcTime ?? 0;
        const uptime = node.uptime ?? 0;
        return { node, count, average: count > 0 ? time / count : 0, share: uptime > 0 ? time / uptime : 0 };
      })
      .filter((entry) => entry.count > 0 && (entry.share >= GC_TIME_SHARE || entry.average >= GC_AVERAGE_MS));
    if (slow.length === 0) {
      return [];
    }
    return [
      {
        id: 'jvm-gc',
        checkId: 'jvm-gc',
        severity: 'warning',
        category: 'nodes',
        title: `Old-generation garbage collection is slow on ${pluralize(slow.length, 'node')}`,
        summary: `Old-generation collections take ${roundPercent(GC_TIME_SHARE * 100)}% or more of the uptime, or ${formatDuration(GC_AVERAGE_MS)} or more on average.`,
        impact: 'Long pauses make the node slow to respond; if they last long enough, the master removes it from the cluster.',
        advice: 'This is usually heap pressure: check heap usage, and reduce memory-hungry workloads or add heap.',
        note: 'Counted since each node started.',
        resources: slow.map((entry) => ({
          kind: 'node',
          name: entry.node.name,
          detail: `${pluralize(entry.count, 'collection')} · ${formatDuration(entry.average)} on average · ${roundPercent(entry.share * 100)}% of uptime`,
        })),
        resourceLabel: 'Affected nodes',
        fixes: [],
        links: [NODES_LINK],
      },
    ];
  },
};

const circuitBreakers: DoctorCheck = {
  id: 'circuit-breakers',
  category: 'nodes',
  title: 'Circuit breakers',
  description: 'No circuit breaker has tripped since the nodes started.',
  sources: ['nodes'],
  run: (input) => {
    const tripped = (input.nodes ?? [])
      .map((node) => ({ node, breakers: node.breakers.filter((breaker) => breaker.tripped > 0) }))
      .filter((entry) => entry.breakers.length > 0);
    if (tripped.length === 0) {
      return [];
    }
    const parent = tripped.some((entry) => entry.breakers.some((breaker) => breaker.name === 'parent'));
    return [
      {
        id: 'circuit-breakers',
        checkId: 'circuit-breakers',
        severity: parent ? 'warning' : 'info',
        category: 'nodes',
        title: `Circuit breakers tripped on ${pluralize(tripped.length, 'node')}`,
        summary: 'Elasticsearch rejected requests that would have used too much memory (circuit_breaking_exception, HTTP 429).',
        impact: parent
          ? 'The parent breaker trips when the whole heap is nearly full, so clients get errors for ordinary requests.'
          : 'Requests that would have exceeded a memory limit failed; the rest of the node kept working.',
        advice: 'Look for large aggregations, fielddata on text fields or very big bulk requests.',
        note: 'Counted since each node started.',
        resources: tripped.map((entry) => ({
          kind: 'node',
          name: entry.node.name,
          detail: entry.breakers
            .sort((left, right) => right.tripped - left.tripped)
            .map((breaker) => `${breaker.name} ${pluralize(breaker.tripped, 'time')}`)
            .join(', '),
        })),
        resourceLabel: 'Affected nodes',
        fixes: [],
        links: [NODES_LINK],
      },
    ];
  },
};

/* ------------------------------------------------------------------ */
/* 12. Shard allocation disabled                                       */
/* ------------------------------------------------------------------ */

const ALLOCATION_KEY = 'cluster.routing.allocation.enable';

/** What each `cluster.routing.allocation.enable` mode allows, and what it costs. */
const ALLOCATION_MODES: Readonly<Record<string, { summary: string; impact: string }>> = {
  none: {
    summary: 'No shards are allocated at all, not even primaries of new indices.',
    impact: 'Unassigned shards stay unassigned, a restarted node gets none of its shards back, and new indices stay red.',
  },
  primaries: {
    summary: 'Only primary shards are allocated; replicas stay unassigned.',
    impact: 'Replicas stay unassigned, so the cluster stays yellow and has less redundancy.',
  },
  new_primaries: {
    summary: 'Only primaries of newly created indices are allocated.',
    impact: 'Existing shards, including those of a restarted node, stay unassigned; only new indices get primaries.',
  },
};

const allocationEnabled: DoctorCheck = {
  id: 'allocation-enabled',
  category: 'settings',
  title: 'Shard allocation',
  description: 'Shard allocation is enabled for all shards (cluster.routing.allocation.enable: all).',
  sources: ['settings'],
  run: (input) => {
    const settings = input.settings;
    const value = (settingValue(settings, ALLOCATION_KEY) ?? 'all').toLowerCase();
    if (!settings || value === 'all') {
      return [];
    }
    // Reset the API overrides when the node default is "all"; otherwise override it persistently.
    // (A transient value would be lost on a full restart and is deprecated since 7.16.)
    const fallback = (settings.defaults[ALLOCATION_KEY] ?? 'all').toLowerCase();
    return [
      {
        id: 'allocation-enabled',
        checkId: 'allocation-enabled',
        severity: 'warning',
        category: 'settings',
        title: 'Shard allocation is restricted',
        summary: ALLOCATION_MODES[value]?.summary ?? `${ALLOCATION_KEY} is "${value}".`,
        impact: ALLOCATION_MODES[value]?.impact ?? 'Some shards cannot be allocated while this is set.',
        advice: 'This is expected during a rolling restart. Enable allocation again once all nodes are back.',
        facts: [
          { label: 'Setting', value: `${ALLOCATION_KEY}: ${value}` },
          { label: 'Set in', value: settingLayer(settings, ALLOCATION_KEY) },
        ],
        resources: [],
        fixes: [
          {
            key: 'allocation-enabled',
            label: 'Enable allocation',
            icon: 'bi-play-circle',
            tone: 'default',
            confirmTitle: 'Enable shard allocation?',
            confirmMessage: `Sets ${ALLOCATION_KEY} back to "all". Elasticsearch starts allocating every unassigned shard, which can move a lot of data.`,
            confirmItems: [],
            confirmLabel: 'Enable allocation',
            path: 'cluster_settings/save',
            payload: {
              settings: {
                persistent: { [ALLOCATION_KEY]: fallback === 'all' ? null : 'all' },
                transient: { [ALLOCATION_KEY]: null },
              },
            },
            success: 'Shard allocation enabled',
            failure: 'Could not enable shard allocation',
          },
        ],
        links: [CLUSTER_SETTINGS_LINK],
      },
    ];
  },
};

/* ------------------------------------------------------------------ */
/* Cluster-wide blocks                                                 */
/* ------------------------------------------------------------------ */

const CLUSTER_BLOCKS: readonly (readonly [string, string])[] = [
  ['cluster.blocks.read_only', 'read-only'],
  ['cluster.blocks.read_only_allow_delete', 'read-only, deletes allowed'],
];

/**
 * `cluster.blocks.read_only(_allow_delete)` rejects every write and metadata
 * change in the cluster (reference: "Cluster-level shard allocation and
 * routing settings" → metadata). Updating the cluster settings to remove it
 * stays allowed.
 */
const clusterBlocks: DoctorCheck = {
  id: 'cluster-blocks',
  category: 'settings',
  title: 'Cluster-wide blocks',
  description: 'The cluster accepts writes (no cluster.blocks.read_only or read_only_allow_delete).',
  sources: ['settings'],
  run: (input) => {
    const settings = input.settings;
    if (!settings) {
      return [];
    }
    const active = CLUSTER_BLOCKS.filter(([key]) => isTrue(settingValue(settings, key)));
    if (active.length === 0) {
      return [];
    }
    const keys = CLUSTER_BLOCKS.map(([key]) => key);
    // Reset the API values; a block set in elasticsearch.yml needs a persistent "false".
    const persistent = Object.fromEntries(keys.map((key) => [key, isTrue(settings.defaults[key]) ? 'false' : null]));
    const transient = Object.fromEntries(keys.map((key) => [key, null]));
    return [
      {
        id: 'cluster-blocks',
        checkId: 'cluster-blocks',
        severity: 'critical',
        category: 'settings',
        title: 'Writes to every index are rejected',
        summary: `The cluster is blocked (${active.map(([key]) => key).join(', ')}): Elasticsearch rejects indexing and changes to indices, mappings and templates in the whole cluster.`,
        impact: 'Clients get cluster_block_exception errors for every write, so new data is being dropped or queued.',
        advice: 'Remove the block once the reason for it (maintenance, a full disk) is gone.',
        facts: active.map(([key, label]) => ({ label: label === 'read-only' ? 'Read-only' : 'Read-only (allow delete)', value: settingLayer(settings, key) })),
        resources: [],
        fixes: [
          {
            key: 'cluster-blocks',
            label: 'Remove cluster block',
            icon: 'bi-unlock',
            tone: 'warning',
            confirmTitle: 'Remove the cluster-wide block?',
            confirmMessage: `Clears ${keys.join(' and ')} so the cluster accepts writes again.`,
            confirmItems: [],
            confirmLabel: 'Remove block',
            path: 'cluster_settings/save',
            payload: { settings: { persistent, transient } },
            success: 'Removed the cluster-wide block',
            failure: 'Could not remove the cluster-wide block',
          },
        ],
        links: [CLUSTER_SETTINGS_LINK],
      },
    ];
  },
};

/* ------------------------------------------------------------------ */
/* 13. Transient settings                                              */
/* ------------------------------------------------------------------ */

const transientSettings: DoctorCheck = {
  id: 'transient-settings',
  category: 'settings',
  title: 'Transient settings',
  description: 'No transient cluster settings are set (deprecated since 7.16).',
  sources: ['settings'],
  run: (input) => {
    const entries = Object.entries(input.settings?.transient ?? {}).sort(([left], [right]) => left.localeCompare(right));
    if (entries.length === 0) {
      return [];
    }
    return [
      {
        id: 'transient-settings',
        checkId: 'transient-settings',
        severity: 'info',
        category: 'settings',
        title: `${pluralize(entries.length, 'transient cluster setting')} ${isAre(entries.length)} set`,
        summary: 'Transient settings are deprecated since Elasticsearch 7.16 and are lost when the whole cluster restarts.',
        impact: 'After a full cluster restart the cluster silently falls back to the persistent values, which can undo an emergency fix.',
        advice: 'Set the same values as persistent settings and remove the transient ones.',
        resources: entries.map(([key, value]) => ({ kind: 'setting', name: key, detail: value })),
        resourceLabel: 'Transient settings',
        fixes: [],
        links: [CLUSTER_SETTINGS_LINK],
      },
    ];
  },
};

/* ------------------------------------------------------------------ */
/* 14. Upgrade readiness                                               */
/* ------------------------------------------------------------------ */

interface DeprecationItem {
  readonly level: string;
  readonly message: string;
  readonly url: string | null;
  readonly details: string | null;
  readonly rollingUpgrade: boolean;
  readonly resources: readonly DoctorResource[];
}

const NODES_IMPACTED = /\s*\(nodes impacted: \[([^\]]*)\]\)\s*$/;

function deprecationItems(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function deprecationResource(kind: ResourceKind, name: string, detail: string | null): DoctorResource {
  const link: DoctorLink | undefined =
    kind === 'index'
      ? indexSettingsLink(name)
      : kind === 'policy'
        ? { label: 'Open policy', icon: 'bi-hourglass-split', route: '/ilm', params: { policy: name } }
        : kind === 'data-stream'
          ? { label: 'Open data stream', icon: 'bi-water', route: '/data_streams', params: { name } }
          : undefined;
  return { kind, name, ...(detail ? { detail } : {}), ...(link ? { link } : {}) };
}

/** Flattens every section of `_migration/deprecations` into items with their resources. */
export function parseDeprecations(response: Readonly<Record<string, unknown>>): DeprecationItem[] {
  const items: DeprecationItem[] = [];
  const add = (raw: Record<string, unknown>, resources: DoctorResource[]) => {
    const message = typeof raw['message'] === 'string' ? raw['message'] : '';
    if (!message) {
      return;
    }
    let details = typeof raw['details'] === 'string' && raw['details'].trim() ? raw['details'].trim() : null;
    let extra = resources;
    // Node issues are merged across nodes: "… (nodes impacted: [es-node-1, es-node-2])".
    const impacted = details ? NODES_IMPACTED.exec(details) : null;
    if (details && impacted) {
      details = details.replace(NODES_IMPACTED, '') || null;
      extra = [
        ...resources,
        ...(impacted[1] ?? '')
          .split(',')
          .map((name) => name.trim())
          .filter(Boolean)
          .map((name) => deprecationResource('node', name, null)),
      ];
    }
    const meta = isRecord(raw['_meta']) ? raw['_meta'] : {};
    for (const node of stringList(meta['nodes'])) {
      if (!extra.some((resource) => resource.kind === 'node' && resource.name === node)) {
        extra = [...extra, deprecationResource('node', node, null)];
      }
    }
    const url = typeof raw['url'] === 'string' && /^https?:\/\//i.test(raw['url']) ? raw['url'] : null;
    items.push({
      level: typeof raw['level'] === 'string' ? raw['level'].toLowerCase() : 'warning',
      message,
      url,
      details,
      rollingUpgrade: raw['resolve_during_rolling_upgrade'] === true,
      resources: extra,
    });
  };
  for (const section of ['cluster_settings', 'node_settings', 'ml_settings']) {
    for (const raw of deprecationItems(response[section])) {
      add(raw, []);
    }
  }
  const keyed: readonly (readonly [string, ResourceKind])[] = [
    ['index_settings', 'index'],
    ['data_streams', 'data-stream'],
    ['templates', 'template'],
    ['ilm_policies', 'policy'],
  ];
  for (const [section, kind] of keyed) {
    const entries = isRecord(response[section]) ? Object.entries(response[section]) : [];
    for (const [name, list] of entries) {
      for (const raw of deprecationItems(list)) {
        add(raw, [deprecationResource(kind, name, null)]);
      }
    }
  }
  return items;
}

const upgradeReadiness: DoctorCheck = {
  id: 'deprecations',
  category: 'upgrade',
  title: 'Upgrade readiness',
  description: 'The deprecation info API reports nothing to fix before the next major upgrade.',
  sources: ['deprecations'],
  run: (input) => {
    const items = parseDeprecations(input.deprecations ?? {}).filter(
      (item) => item.level === 'critical' || item.level === 'warning',
    );
    const next = input.version ? `Elasticsearch ${input.version.major + 1}` : 'the next major version';
    const groups = new Map<string, DeprecationItem[]>();
    for (const item of items) {
      const key = `${item.level}\u0000${item.message}`;
      groups.set(key, [...(groups.get(key) ?? []), item]);
    }
    return [...groups.values()].map((group): DoctorFinding => {
      const first = group[0]!;
      const critical = first.level === 'critical';
      const details = [...new Set(group.map((item) => item.details).filter((detail): detail is string => !!detail))];
      const resources = new Map<string, DoctorResource>();
      for (const item of group) {
        for (const resource of item.resources) {
          const key = `${resource.kind}:${resource.name}`;
          // With per-item details (they usually name the index), show them next to the resource.
          const detail = details.length > 1 && item.details ? item.details : resource.detail;
          resources.set(key, { ...resource, ...(detail ? { detail } : {}) });
        }
      }
      const urls = [...new Set(group.map((item) => item.url).filter((url): url is string => !!url))];
      return {
        id: `deprecations:${first.level}:${first.message}`,
        checkId: 'deprecations',
        severity: critical ? 'warning' : 'info',
        category: 'upgrade',
        title: first.message,
        summary: details.length === 1 ? (details[0] ?? '') : `Elasticsearch reports this for ${pluralize(group.length, 'item')}.`,
        impact: critical
          ? `Must be fixed before upgrading to ${next}.`
          : `Works today, but is deprecated and changes or goes away in ${next}.`,
        ...(group.every((item) => item.rollingUpgrade) ? { advice: 'Can be resolved during a rolling upgrade.' } : {}),
        resources: [...resources.values()],
        resourceLabel: 'Affected',
        fixes: [],
        links: [],
        external: urls.map((url) => ({ label: 'Learn more', url })),
      };
    });
  },
};

/* ------------------------------------------------------------------ */
/* Health report indicators                                            */
/* ------------------------------------------------------------------ */

const HEALTH_RESOURCE_KINDS: Readonly<Record<string, ResourceKind>> = {
  Indices: 'index',
  Nodes: 'node',
  'Lifecycle policies': 'policy',
};

const healthIndicators: DoctorCheck = {
  id: 'health-indicators',
  category: 'health',
  title: 'Elasticsearch health indicators',
  description:
    'The health report indicators the other checks do not cover (master stability, lifecycle, snapshots, repositories, …) are green.',
  sources: ['health_report'],
  run: (input) => {
    // Indicators covered by the checks above, when those checks could run.
    const covered = new Set<string>([
      ...(hasSource(input, 'nodes') ? ['disk'] : []),
      ...(hasSource(input, 'shards') ? ['shards_availability'] : []),
      ...(hasSource(input, 'indices') ? ['shards_capacity'] : []),
    ]);
    return indicatorViews(input.healthReport ?? {})
      .filter((indicator) => indicator.status !== 'green' && !covered.has(indicator.name))
      .map((indicator): DoctorFinding => {
        const severity: DoctorSeverity = indicator.tone === 'red' ? 'critical' : indicator.tone === 'yellow' ? 'warning' : 'info';
        const causes = [...new Set(indicator.diagnoses.map((diagnosis) => diagnosis.cause).filter(Boolean))];
        const actions = [...new Set(indicator.diagnoses.map((diagnosis) => diagnosis.action).filter(Boolean))];
        const resources = new Map<string, DoctorResource>();
        for (const diagnosis of indicator.diagnoses) {
          for (const group of diagnosis.resources) {
            const kind = HEALTH_RESOURCE_KINDS[group.label] ?? 'other';
            for (const name of group.names) {
              resources.set(`${kind}:${name}`, {
                kind,
                name,
                ...(kind === 'other' ? { detail: group.label } : {}),
                ...(kind === 'index' ? { link: indexLink(name) } : {}),
              });
            }
          }
        }
        const urls = [...new Set(indicator.diagnoses.map((diagnosis) => diagnosis.helpUrl).filter((url): url is string => !!url))];
        return {
          id: `health-indicators:${indicator.name}`,
          checkId: 'health-indicators',
          severity,
          category: 'health',
          title: `${indicator.label} is ${indicator.statusLabel.toLowerCase()} in the health report`,
          summary: indicator.symptom || `Elasticsearch reports ${indicator.label.toLowerCase()} as ${indicator.status}.`,
          impact:
            indicator.impacts.map((impact) => impact.description).join(' ') ||
            'Elasticsearch did not describe the impact.',
          ...(actions.length > 0 ? { advice: actions.join(' ') } : {}),
          ...(causes.length > 0 ? { note: causes.join(' ') } : {}),
          resources: [...resources.values()],
          resourceLabel: 'Affected',
          fixes: [],
          links: [],
          external: urls.map((url) => ({ label: 'Troubleshooting guide', url })),
        };
      });
  },
};

/* ------------------------------------------------------------------ */
/* Report                                                              */
/* ------------------------------------------------------------------ */

/** Every check, in the order they are listed when passed. */
export const CHECKS: readonly DoctorCheck[] = [
  clusterStatus,
  healthIndicators,
  diskWatermarks,
  unassignedShards,
  impossibleReplicas,
  oversizedShards,
  shardCapacity,
  overSharded,
  missingReplicas,
  indexBlocks,
  ilmErrors,
  jvmHeap,
  jvmGc,
  circuitBreakers,
  allocationEnabled,
  clusterBlocks,
  diskAllocationEnabled,
  transientSettings,
  upgradeReadiness,
];

export function runCheck(check: DoctorCheck, input: DoctorInput): CheckOutcome {
  const base = { id: check.id, category: check.category, title: check.title, description: check.description };
  const missing = check.sources.find((source) => !hasSource(input, source));
  if (missing) {
    return {
      ...base,
      status: 'skipped',
      findings: [],
      reason: unavailableReason(input, missing),
      ...(isUnsupportedSource(input, missing) ? { unsupported: true } : {}),
    };
  }
  const findings = check.run(input);
  return { ...base, status: findings.length > 0 ? 'failed' : 'passed', findings };
}

/**
 * Findings another finding already reports, keyed by the finding that covers
 * them: a yellow cluster is explained by its unassigned replicas.
 */
const COVERED_BY: Readonly<Record<string, readonly string[]>> = {
  'cluster-status:yellow': ['unassigned-shards:replica', 'unassigned-shards:primary'],
};

/** Drops findings that repeat what another finding reports (one root cause, one finding). */
export function consolidate(outcomes: readonly CheckOutcome[]): CheckOutcome[] {
  const present = new Set(outcomes.flatMap((outcome) => outcome.findings.map((finding) => finding.id)));
  return outcomes.map((outcome) => {
    const findings = outcome.findings.filter((finding) => !(COVERED_BY[finding.id] ?? []).some((id) => present.has(id)));
    // Still "failed" when its findings were folded into another one: it did not pass.
    return findings.length === outcome.findings.length ? outcome : { ...outcome, findings };
  });
}

export function verdictFor(counts: Readonly<Record<DoctorSeverity, number>>, coverage?: { ran: number; gaps: number }): DoctorVerdict {
  const problems = [
    ...(counts.critical > 0 ? [pluralize(counts.critical, 'critical problem')] : []),
    ...(counts.warning > 0 ? [pluralize(counts.warning, 'warning')] : []),
  ];
  const total = counts.critical + counts.warning;
  const infos = counts.info > 0 ? pluralize(counts.info, 'info finding') : '';
  const gaps = coverage?.gaps ?? 0;
  const notRun = gaps > 0 ? ` ${pluralize(gaps, 'check')} could not run.` : '';
  if (total > 0) {
    const sentence = `${problems.join(' and ')} ${total === 1 ? 'needs' : 'need'} attention${infos ? `, plus ${infos}` : ''}.${notRun}`;
    return counts.critical > 0
      ? { tone: 'red', icon: 'bi-x-octagon-fill', title: 'Critical problems found', text: sentence }
      : { tone: 'yellow', icon: 'bi-exclamation-triangle-fill', title: 'Needs attention', text: sentence };
  }
  if (coverage && gaps > 0) {
    // Not "healthy": most of the cluster may not have been looked at.
    const ran = coverage.ran === 1 ? 'the only check that could run' : `the ${formatNumber(coverage.ran)} checks that could run`;
    return {
      tone: 'blue',
      icon: 'bi-question-circle-fill',
      title: 'Partly checked',
      text: `No problems in ${ran}${infos ? ` (only ${infos})` : ''}, but ${pluralize(gaps, 'check')} could not run.`,
    };
  }
  return {
    tone: 'green',
    icon: 'bi-check-circle-fill',
    title: 'Healthy',
    text: infos ? `No problems found, only ${infos} to consider.` : 'No problems found.',
  };
}

/** Runs every check against the backend report. */
export function runChecks(raw: unknown): DoctorReport {
  const input = parseDoctorInput(raw);
  const outcomes = consolidate(CHECKS.map((check) => runCheck(check, input)));
  const findings = sortFindings(outcomes.flatMap((outcome) => outcome.findings));
  const counts = countBySeverity(findings);
  const ran = outcomes.filter((outcome) => outcome.status !== 'skipped').length;
  const skipped = outcomes.filter((outcome) => outcome.status === 'skipped');
  const gaps = skipped.filter((outcome) => !outcome.unsupported).length;
  return {
    clusterName: input.health.clusterName,
    version: input.version?.text ?? null,
    findings,
    outcomes,
    counts,
    ran,
    passed: outcomes.filter((outcome) => outcome.status === 'passed').length,
    skipped: skipped.length,
    gaps,
    verdict: verdictFor(counts, { ran, gaps }),
    healthReport: healthReportView(input),
  };
}
