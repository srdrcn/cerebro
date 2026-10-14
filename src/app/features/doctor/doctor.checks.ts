import { formatBytes, formatDuration, formatNumber, plural, pluralize } from '../../core/format';
import { isRecord, stringList } from '../../core/json';
import { unassignedReasonMeta } from '../allocation/allocation.utils';
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
  parseDoctorInput,
  requiredFreeBytes,
  roundPercent,
  settingValue,
  sortFindings,
  toNumber,
  unavailableReason,
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
const ILM_STATUS_LINK: DoctorLink = { label: 'Lifecycle status', icon: 'bi-hourglass-split', route: '/ilm', params: { tab: 'status' } };

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
    path: 'doctor/index_settings',
    payload: { indices: [...indices], settings: { 'index.number_of_replicas': replicas } },
    success:
      kind === 'add'
        ? `Added a replica to ${target}`
        : `Reduced the replicas of ${target} to ${replicas}`,
    failure: kind === 'add' ? `Could not add a replica to ${target}` : `Could not reduce the replicas of ${target}`,
  };
}

function removeReadOnlyFix(indices: readonly string[], stillFull: readonly string[]): DoctorFix {
  const target = subject(indices, 'index', 'indices');
  const reapplied =
    stillFull.length > 0
      ? `${listJoin(stillFull)} ${isAre(stillFull.length)} still above the flood stage watermark, so Elasticsearch will add the block again until disk space is freed.`
      : 'Elasticsearch adds it again if a node holding their shards passes the flood stage watermark.';
  return {
    key: `read-only:${indices.join(',')}`,
    label: indices.length > 1 ? 'Remove all blocks' : 'Remove read-only block',
    icon: 'bi-unlock',
    tone: stillFull.length > 0 ? 'warning' : 'default',
    confirmTitle: `Remove the read-only block from ${target}?`,
    confirmMessage: `Removes index.blocks.read_only_allow_delete so writes are accepted again. ${reapplied}`,
    confirmItems: indices.length > 1 ? indices : [],
    confirmLabel: indices.length > 1 ? 'Remove blocks' : 'Remove block',
    path: 'doctor/index_settings',
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
        // Without the cluster settings, prefer what the node itself reports (8.x).
        const reported = thresholds.source === 'defaults' && !frozen ? disk.reported[level.key] : null;
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

const clusterStatus: DoctorCheck = {
  id: 'cluster-status',
  category: 'health',
  title: 'Cluster status',
  description: 'Cluster health is green: every primary and replica shard is allocated.',
  sources: ['health'],
  run: ({ health }) => {
    if (health.status !== 'red' && health.status !== 'yellow') {
      return [];
    }
    const facts: DoctorFact[] = [
      { label: 'Unassigned', value: formatNumber(health.unassigned) },
      { label: 'Initializing', value: formatNumber(health.initializing) },
      { label: 'Relocating', value: formatNumber(health.relocating) },
      { label: 'Active shards', value: formatNumber(health.activeShards) },
    ];
    const delayed =
      health.delayedUnassigned > 0
        ? ` ${formatNumber(health.delayedUnassigned)} of them ${isAre(health.delayedUnassigned)} delayed on purpose after a node left (index.unassigned.node_left.delayed_timeout).`
        : '';
    if (health.status === 'red') {
      return [
        {
          id: 'cluster-status:red',
          checkId: 'cluster-status',
          severity: 'critical',
          category: 'health',
          title: 'Cluster health is red',
          summary: `At least one primary shard is not allocated${health.unassigned > 0 ? ` (${pluralize(health.unassigned, 'unassigned shard')} in total)` : ''}.${delayed}`,
          impact: 'Searches on the affected indices return partial results or fail, and writes to them are rejected.',
          advice: 'Find the missing primaries in the unassigned shards finding and explain why Elasticsearch cannot place them.',
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
          advice: 'See the unassigned shards finding for the reason, or explain them on the shard allocation page.',
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
          const reasons = [...group.reasons].map((reason) => unassignedReasonMeta(reason).label);
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
      findings.push({
        id: `unassigned-shards:${primary ? 'primary' : 'replica'}`,
        checkId: 'unassigned-shards',
        severity: primary ? 'critical' : 'warning',
        category: 'shards',
        title: `${pluralize(count, primary ? 'primary shard' : 'replica shard')} ${isAre(count)} unassigned`,
        summary: primary
          ? `${indicesLabel(groups.size)} ${hasHave(groups.size)} primary shards without an active copy.`
          : `${indicesLabel(groups.size)} ${isAre(groups.size)} missing replica copies.`,
        impact: primary
          ? 'This data cannot be searched and writes to it fail until the primaries are allocated.'
          : 'The data is still served by the primaries, but with less redundancy: losing a node that holds a primary turns the cluster red.',
        advice: primary
          ? 'Explain each shard to see what blocks it. If a node left, bring it back; if allocation failed repeatedly, fix the cause and retry.'
          : 'Explain a shard to see why no node accepts it. Common causes are too few nodes for the replica count, full disks and allocation filters.',
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

const missingReplicas: DoctorCheck = {
  id: 'missing-replicas',
  category: 'indices',
  title: 'Indices have replicas',
  description: 'Every index (other than system and hidden indices) keeps at least one replica.',
  sources: ['indices'],
  run: (input) => {
    const dataNodes = dataNodeCount(input);
    const rows = (input.indices ?? [])
      .filter((row) => row.replicas === 0 && !isSystemName(row.name))
      .sort((left, right) => left.name.localeCompare(right.name));
    if (rows.length === 0 || dataNodes <= 0) {
      return [];
    }
    const resource = (row: IndexRow): DoctorResource => ({
      kind: 'index',
      name: row.name,
      detail: [
        pluralize(row.primaries, 'primary shard'),
        formatBytes(row.primarySize ?? row.size),
        ...(row.status === 'close' ? ['closed'] : []),
      ].join(' · '),
      link: indexLink(row.name),
    });
    if (dataNodes === 1) {
      return [
        {
          id: 'missing-replicas:single-node',
          checkId: 'missing-replicas',
          severity: 'info',
          category: 'indices',
          title: `${indicesLabel(rows.length)} ${hasHave(rows.length)} no replicas`,
          summary:
            'Every shard exists only once. That is expected with a single data node: Elasticsearch never allocates a replica on the node that holds its primary.',
          impact: 'If the node or its disk fails, this data is unavailable or lost; snapshots are its only other copy.',
          advice: 'Add a second data node and then add replicas, or make sure snapshots run regularly.',
          resources: rows.map(resource),
          resourceLabel: 'Affected indices',
          fixes: [],
          links: [],
        },
      ];
    }
    const thresholds = diskThresholds(input.settings, input.version);
    const crowded = nodeDiskStates(input, thresholds).filter((state) => state.level === 'high' || state.level === 'flood');
    const extra = (selected: readonly IndexRow[]): string => {
      const bytes = selected.reduce((sum, row) => sum + (row.primarySize ?? 0), 0);
      const disk = `Elasticsearch copies every shard to another node, which needs about ${formatBytes(bytes)} of extra disk.`;
      return crowded.length > 0 && thresholds.enabled
        ? `${disk} ${listJoin(crowded.map((state) => state.node.name))} ${isAre(crowded.length)} above the high watermark, so the new replicas may stay unassigned.`
        : disk;
    };
    return [
      {
        id: 'missing-replicas',
        checkId: 'missing-replicas',
        severity: 'warning',
        category: 'indices',
        title: `${indicesLabel(rows.length)} ${hasHave(rows.length)} no replicas`,
        summary: 'Every shard of these indices exists only once.',
        impact:
          'If a node fails, its shards are unavailable until it returns, and lost if its disk is lost. Searches also cannot be spread over copies.',
        advice: 'Add a replica so every shard has a copy on another node. It takes as much extra disk as the primaries use.',
        resources: rows.map((row) => ({
          ...resource(row),
          ...(rows.length > 1 ? { fix: replicasFix([row.name], 1, 'add', extra([row])) } : {}),
        })),
        resourceLabel: 'Affected indices',
        fixes: [replicasFix(rows.map((row) => row.name), 1, 'add', extra(rows))],
        links: [],
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
        severity: pressed.length > 0 ? 'warning' : 'info',
        category: 'settings',
        title: 'Disk watermarks are not enforced',
        summary: `${key} is false, so Elasticsearch neither keeps shards off full nodes nor blocks writes before a disk fills up.`,
        impact:
          pressed.length > 0
            ? `${listJoin(pressed.map((state) => state.node.name))} ${isAre(pressed.length)} already past a watermark and nothing protects ${pressed.length === 1 ? 'it' : 'them'} from running out of disk.`
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
      const stillFull = thresholds.enabled
        ? nodeDiskStates(input, thresholds)
            .filter((state) => state.level === 'flood')
            .map((state) => state.node.name)
        : [];
      findings.push({
        id: 'index-blocks:read-only-allow-delete',
        checkId: 'index-blocks',
        severity: 'critical',
        category: 'indices',
        title: `${indicesLabel(floodBlocked.length)} ${isAre(floodBlocked.length)} blocked from writes (read_only_allow_delete)`,
        summary:
          'These indices carry index.blocks.read_only_allow_delete, the block Elasticsearch adds when a node passes the flood stage watermark. Only deletes are allowed.',
        impact: 'Indexing and updates fail with "index read-only / allow delete" errors, so new data is being dropped or queued.',
        advice: 'Free disk space first, then remove the block.',
        note:
          stillFull.length > 0
            ? `${listJoin(stillFull)} ${isAre(stillFull.length)} still above the flood stage watermark: Elasticsearch re-applies the block until disk space is freed.`
            : 'Elasticsearch re-applies the block while a node holding these indices stays above the flood stage watermark.',
        resources: floodBlocked.map((index) => ({
          kind: 'index',
          name: index,
          link: indexSettingsLink(index),
          ...(floodBlocked.length > 1 ? { fix: removeReadOnlyFix([index], stillFull) } : {}),
        })),
        resourceLabel: 'Blocked indices',
        fixes: [removeReadOnlyFix(floodBlocked, stillFull)],
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

const ilmErrors: DoctorCheck = {
  id: 'ilm-errors',
  category: 'lifecycle',
  title: 'Lifecycle errors',
  description: 'No index managed by ILM is stuck in the ERROR step.',
  sources: ['ilm'],
  run: (input) => {
    const rows = input.ilm ?? [];
    if (rows.length === 0) {
      return [];
    }
    const indices = rows.map((row) => row.index);
    return [
      {
        id: 'ilm-errors',
        checkId: 'ilm-errors',
        severity: 'warning',
        category: 'lifecycle',
        title: `Lifecycle management failed for ${indicesLabel(rows.length)}`,
        summary: 'ILM stopped at a failed step for these indices.',
        impact: 'Until the step succeeds they are not rolled over, moved to other tiers or deleted, so they can grow and use disk without limit.',
        advice: 'Fix the cause shown for each index (often a missing rollover alias, setting or privilege), then retry the step.',
        ...(rows.some((row) => row.autoRetry)
          ? { note: 'Elasticsearch retries some of these steps on its own (the error is retryable); a manual retry runs the step right away.' }
          : {}),
        resources: rows.map((row) => ({
          kind: 'index',
          name: row.index,
          detail: [
            `${row.failedStep ?? 'A step'} failed${row.reason ? `: ${row.reason}` : ''}`,
            ...(row.policy ? [`policy ${row.policy}`] : []),
            ...(row.retryCount ? [`retried ${pluralize(row.retryCount, 'time')}`] : []),
          ].join(' · '),
          link: indexLink(row.index, 'lifecycle'),
          ...(rows.length > 1 ? { fix: ilmRetryFix([row.index]) } : {}),
        })),
        resourceLabel: 'Affected indices',
        fixes: [ilmRetryFix(indices)],
        links: [ILM_STATUS_LINK],
      },
    ];
  },
};

/* ------------------------------------------------------------------ */
/* 11. JVM                                                             */
/* ------------------------------------------------------------------ */

const jvmHeap: DoctorCheck = {
  id: 'jvm-heap',
  category: 'nodes',
  title: 'Heap usage',
  description: `Every node uses less than ${HEAP_WARNING}% of its JVM heap.`,
  sources: ['nodes'],
  run: (input) => {
    const nodes = (input.nodes ?? []).filter((node) => node.heapPercent !== null && node.heapPercent >= HEAP_WARNING);
    const levels: readonly { severity: DoctorSeverity; nodes: NodeInfo[]; word: string; threshold: number }[] = [
      { severity: 'critical', nodes: nodes.filter((node) => (node.heapPercent ?? 0) >= HEAP_CRITICAL), word: 'critical', threshold: HEAP_CRITICAL },
      { severity: 'warning', nodes: nodes.filter((node) => (node.heapPercent ?? 0) < HEAP_CRITICAL), word: 'high', threshold: HEAP_WARNING },
    ];
    return levels
      .filter((level) => level.nodes.length > 0)
      .map((level) => ({
        id: `jvm-heap:${level.severity}`,
        checkId: 'jvm-heap',
        severity: level.severity,
        category: 'nodes' as const,
        title: `Heap usage is ${level.word} on ${pluralize(level.nodes.length, 'node')}`,
        summary: `${level.threshold}% or more of the JVM heap is in use.`,
        impact:
          'Under sustained heap pressure a node spends more time in garbage collection, trips circuit breakers and can run out of memory.',
        advice:
          'This is a single sample, so run the checks again to see whether it stays high. If it does, reduce shards, fielddata or heavy aggregations, or give the node more heap (at most half of its RAM).',
        resources: level.nodes.map((node) => ({
          kind: 'node' as const,
          name: node.name,
          detail: `${node.heapPercent}% of ${formatBytes(node.heapMax)}`,
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

const ALLOCATION_MODES: Readonly<Record<string, string>> = {
  none: 'No shards are allocated at all, not even primaries of new indices.',
  primaries: 'Only primary shards are allocated; replicas stay unassigned.',
  new_primaries: 'Only primaries of newly created indices are allocated.',
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
        summary: ALLOCATION_MODES[value] ?? `${ALLOCATION_KEY} is "${value}".`,
        impact: 'Unassigned shards stay unassigned, and a node that restarts gets none of its shards back.',
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
  description: 'Every indicator of the Elasticsearch health report is green.',
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
  diskAllocationEnabled,
  transientSettings,
  upgradeReadiness,
];

export function runCheck(check: DoctorCheck, input: DoctorInput): CheckOutcome {
  const base = { id: check.id, category: check.category, title: check.title, description: check.description };
  const missing = check.sources.find((source) => !hasSource(input, source));
  if (missing) {
    return { ...base, status: 'skipped', findings: [], reason: unavailableReason(input, missing) };
  }
  const findings = check.run(input);
  return { ...base, status: findings.length > 0 ? 'failed' : 'passed', findings };
}

export function verdictFor(counts: Readonly<Record<DoctorSeverity, number>>): DoctorVerdict {
  const problems = [
    ...(counts.critical > 0 ? [pluralize(counts.critical, 'critical problem')] : []),
    ...(counts.warning > 0 ? [pluralize(counts.warning, 'warning')] : []),
  ];
  const total = counts.critical + counts.warning;
  const suggestions = counts.info > 0 ? pluralize(counts.info, 'suggestion') : '';
  if (total > 0) {
    const sentence = `${problems.join(' and ')} ${total === 1 ? 'needs' : 'need'} attention${suggestions ? `, plus ${suggestions}` : ''}.`;
    return counts.critical > 0
      ? { tone: 'red', icon: 'bi-x-octagon-fill', title: 'Critical problems found', text: sentence }
      : { tone: 'yellow', icon: 'bi-exclamation-triangle-fill', title: 'Needs attention', text: sentence };
  }
  return {
    tone: 'green',
    icon: 'bi-check-circle-fill',
    title: 'Healthy',
    text: suggestions ? `No problems found, only ${suggestions} to consider.` : 'No problems found.',
  };
}

/** Runs every check against the backend report. */
export function runChecks(raw: unknown): DoctorReport {
  const input = parseDoctorInput(raw);
  const outcomes = CHECKS.map((check) => runCheck(check, input));
  const findings = sortFindings(outcomes.flatMap((outcome) => outcome.findings));
  const counts = countBySeverity(findings);
  return {
    clusterName: input.health.clusterName,
    version: input.version?.text ?? null,
    findings,
    outcomes,
    counts,
    ran: outcomes.filter((outcome) => outcome.status !== 'skipped').length,
    passed: outcomes.filter((outcome) => outcome.status === 'passed').length,
    skipped: outcomes.filter((outcome) => outcome.status === 'skipped').length,
    verdict: verdictFor(counts),
    healthReport: healthReportView(input),
  };
}
