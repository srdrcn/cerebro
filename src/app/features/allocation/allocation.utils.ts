import { elasticsearchReason } from '../../core/errors';
import { formatBytes, formatDuration, humanize, sentence } from '../../core/format';
import { isRecord } from '../../core/json';
import { isInternalAttribute } from '../../core/node-attributes';
import {
  CatShardRow,
  CheckView,
  DeciderView,
  DiskView,
  ExplainRequest,
  ExplanationView,
  FactView,
  NodeDecisionView,
  NodeSortField,
  RawAllocationExplain,
  RawClusterInfo,
  RawDecider,
  RawNodeDecision,
  RawNodeStore,
  RawUnassignedInfo,
  ShardCopy,
  Tone,
  UnassignedView,
  VerdictView,
} from './allocation.models';

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

/** 1 → "1st", 2 → "2nd", 11 → "11th". */
export function ordinal(value: number): string {
  const remainder100 = value % 100;
  if (remainder100 >= 11 && remainder100 <= 13) {
    return `${value}th`;
  }
  switch (value % 10) {
    case 1:
      return `${value}st`;
    case 2:
      return `${value}nd`;
    case 3:
      return `${value}rd`;
    default:
      return `${value}th`;
  }
}

/** Node attributes without the built-in ones, which never explain a decision. */
export function visibleAttributes(
  attributes: Readonly<Record<string, string>> | undefined,
): readonly (readonly [string, string])[] {
  return Object.entries(attributes ?? {})
    .filter(([name]) => !isInternalAttribute(name))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => [name, String(value)] as const);
}

/** Regular indices alphabetically, then hidden/system ones (leading dot). */
export function sortIndexNames(names: readonly string[]): string[] {
  return [...new Set(names)].sort((left, right) => {
    const leftHidden = left.startsWith('.');
    const rightHidden = right.startsWith('.');
    if (leftHidden !== rightHidden) {
      return leftHidden ? 1 : -1;
    }
    return left.localeCompare(right);
  });
}

/* ------------------------------------------------------------------ */
/* Decisions and deciders                                              */
/* ------------------------------------------------------------------ */

interface DecisionMeta {
  readonly label: string;
  readonly tone: Tone;
}

const DECISIONS: Readonly<Record<string, DecisionMeta>> = {
  yes: { label: 'Yes', tone: 'green' },
  no: { label: 'No', tone: 'red' },
  throttle: { label: 'Throttled', tone: 'yellow' },
  throttled: { label: 'Throttled', tone: 'yellow' },
  worse_balance: { label: 'Worse balance', tone: 'gray' },
  awaiting_info: { label: 'Awaiting info', tone: 'blue' },
  allocation_delayed: { label: 'Delayed', tone: 'yellow' },
  no_valid_shard_copy: { label: 'No valid copy', tone: 'red' },
  no_attempt: { label: 'Not attempted', tone: 'gray' },
};

export function normalizeDecision(value: string | undefined): string {
  return (value ?? '').trim().toLocaleLowerCase();
}

export function decisionMeta(value: string | undefined): DecisionMeta {
  const decision = normalizeDecision(value);
  return DECISIONS[decision] ?? { label: humanize(decision) || 'Unknown', tone: 'gray' };
}

/** Status mark of a decision: check for yes, cross for no, hourglass while throttled. */
export function decisionIcon(value: string | undefined): string {
  switch (normalizeDecision(value)) {
    case 'yes':
      return 'bi-check-lg';
    case 'no':
      return 'bi-x-lg';
    case 'throttle':
    case 'throttled':
      return 'bi-hourglass-split';
    default:
      return 'bi-dash-lg';
  }
}

/** Best first: nodes that would take the shard, then throttled, … then no. */
const DECISION_RANK: Readonly<Record<string, number>> = {
  yes: 0,
  throttle: 1,
  throttled: 1,
  worse_balance: 2,
  awaiting_info: 3,
  no: 4,
};

export function decisionRank(value: string | undefined): number {
  return DECISION_RANK[normalizeDecision(value)] ?? 5;
}

interface DeciderMeta {
  readonly label: string;
  readonly hint?: string;
}

const DECIDERS: Readonly<Record<string, DeciderMeta>> = {
  same_shard: {
    label: 'Same shard',
    hint: 'A node never holds two copies of the same shard. Add a data node or lower index.number_of_replicas.',
  },
  disk_threshold: {
    label: 'Disk watermark',
    hint: 'Free up disk space on the node, add capacity, or review the cluster.routing.allocation.disk.watermark.* settings.',
  },
  filter: {
    label: 'Allocation filtering',
    hint: 'Check the index.routing.allocation.include / exclude / require settings of the index and the cluster.routing.allocation.* filters.',
  },
  awareness: {
    label: 'Allocation awareness',
    hint: 'Copies are spread across awareness attributes such as zone or rack. Add nodes with the missing attribute values or relax forced awareness.',
  },
  max_retry: {
    label: 'Retry limit',
    hint: 'Allocation failed too many times. Fix the underlying cause, then retry with POST _cluster/reroute?retry_failed=true.',
  },
  enable: {
    label: 'Allocation enabled',
    hint: 'cluster.routing.allocation.enable (or index.routing.allocation.enable) currently restricts which shards may be allocated.',
  },
  rebalance_enable: {
    label: 'Rebalancing enabled',
    hint: 'cluster.routing.rebalance.enable currently restricts rebalancing.',
  },
  throttling: {
    label: 'Recovery throttling',
    hint: 'The node is already running the maximum number of concurrent recoveries. The shard is allocated as soon as one of them finishes.',
  },
  concurrent_rebalance: {
    label: 'Concurrent rebalance limit',
    hint: 'cluster.routing.allocation.cluster_concurrent_rebalance limits how many shards may move at the same time.',
  },
  shards_limit: {
    label: 'Shards per node limit',
    hint: 'index.routing.allocation.total_shards_per_node or cluster.routing.allocation.total_shards_per_node caps the shards this node may hold.',
  },
  node_version: {
    label: 'Node version',
    hint: 'Shards never move to a node running an older Elasticsearch version than the one holding the primary.',
  },
  replica_after_primary_active: {
    label: 'Primary not active',
    hint: 'Replicas are only allocated once their primary is active. Explain the primary shard first.',
  },
  rebalance_only_when_active: {
    label: 'Rebalance only when active',
    hint: 'Shards of an index only rebalance once all of its copies are active.',
  },
  cluster_rebalance: {
    label: 'Cluster rebalance',
    hint: 'cluster.routing.allocation.allow_rebalance only allows rebalancing once the required shards are active.',
  },
  snapshot_in_progress: {
    label: 'Snapshot in progress',
    hint: 'A shard that is being snapshotted cannot move until the snapshot finishes.',
  },
  restore_in_progress: {
    label: 'Restore in progress',
    hint: 'The shard is being restored from a snapshot.',
  },
  node_shutdown: {
    label: 'Node shutdown',
    hint: 'The node is registered for shutdown with the node shutdown API.',
  },
  node_replacement: {
    label: 'Node replacement',
    hint: 'A node replacement is in progress; shards move only to the replacement node.',
  },
  data_tier: {
    label: 'Data tier',
    hint: "The index's index.routing.allocation.include._tier_preference does not match this node's data roles.",
  },
  resize: {
    label: 'Resize source',
    hint: 'Shrink, split and clone targets must be allocated next to the source shards.',
  },
};

export function deciderLabel(name: string): string {
  return DECIDERS[name]?.label ?? (humanize(name) || 'Unknown decider');
}

export function deciderHint(name: string): string | undefined {
  return DECIDERS[name]?.hint;
}

export function toDeciderView(raw: RawDecider): DeciderView {
  const decider = raw.decider ?? '';
  const meta = decisionMeta(raw.decision);
  const hint = deciderHint(decider);
  return {
    decider,
    label: deciderLabel(decider),
    decision: normalizeDecision(raw.decision),
    decisionLabel: meta.label,
    tone: meta.tone,
    explanation: sentence(raw.explanation ?? ''),
    ...(hint ? { hint } : {}),
  };
}

function withoutHint(decider: DeciderView): DeciderView {
  return {
    decider: decider.decider,
    label: decider.label,
    decision: decider.decision,
    decisionLabel: decider.decisionLabel,
    tone: decider.tone,
    explanation: decider.explanation,
  };
}

/** Deciders that did not say YES — the ones the user has to read. */
export function blockingDeciders(deciders: readonly RawDecider[] | undefined): DeciderView[] {
  return (deciders ?? [])
    .filter((decider) => normalizeDecision(decider.decision) !== 'yes')
    .map(toDeciderView);
}

/* ------------------------------------------------------------------ */
/* Shard state and unassigned info                                     */
/* ------------------------------------------------------------------ */

const STATES: Readonly<Record<string, DecisionMeta>> = {
  unassigned: { label: 'Unassigned', tone: 'yellow' },
  started: { label: 'Started', tone: 'green' },
  initializing: { label: 'Initializing', tone: 'blue' },
  relocating: { label: 'Relocating', tone: 'purple' },
};

export function shardStateMeta(state: string | undefined): DecisionMeta {
  const key = (state ?? '').toLocaleLowerCase();
  return STATES[key] ?? { label: humanize(key) || 'Unknown', tone: 'gray' };
}

interface ReasonMeta {
  readonly label: string;
  readonly text: string;
}

const UNASSIGNED_REASONS: Readonly<Record<string, ReasonMeta>> = {
  INDEX_CREATED: { label: 'Index created', text: 'The index was just created and this copy has not been allocated yet.' },
  CLUSTER_RECOVERED: { label: 'Cluster recovered', text: 'The cluster restarted (full cluster recovery) and this copy has not been allocated since.' },
  INDEX_REOPENED: { label: 'Index reopened', text: 'The index was reopened after being closed.' },
  DANGLING_INDEX_IMPORTED: { label: 'Dangling index imported', text: 'A dangling index was imported into the cluster.' },
  NEW_INDEX_RESTORED: { label: 'Restored into a new index', text: 'A snapshot was restored into a new index.' },
  EXISTING_INDEX_RESTORED: { label: 'Restored into an existing index', text: 'A snapshot was restored into a closed index.' },
  REPLICA_ADDED: { label: 'Replica added', text: 'The number of replicas was increased.' },
  ALLOCATION_FAILED: { label: 'Allocation failed', text: 'A previous attempt to allocate this copy failed.' },
  NODE_LEFT: { label: 'Node left', text: 'The node holding this copy left the cluster.' },
  NODE_RESTARTING: { label: 'Node restarting', text: 'The node holding this copy is restarting (registered with the node shutdown API).' },
  REROUTE_CANCELLED: { label: 'Reroute cancelled', text: 'A reroute command explicitly cancelled this copy.' },
  REINITIALIZED: { label: 'Reinitialized', text: 'The copy went back from started to initializing.' },
  REALLOCATED_REPLICA: { label: 'Replica reallocated', text: 'A better location was found, so the existing replica allocation was cancelled.' },
  PRIMARY_FAILED: { label: 'Primary failed', text: 'The primary failed while this replica was initializing.' },
  FORCED_EMPTY_PRIMARY: { label: 'Forced empty primary', text: 'An empty primary was forcibly allocated.' },
  MANUAL_ALLOCATION: { label: 'Manual allocation', text: 'The copy was allocated manually with the reroute API.' },
  INDEX_CLOSED: { label: 'Index closed', text: 'The index was closed.' },
};

export function unassignedReasonMeta(reason: string | undefined): ReasonMeta {
  const key = (reason ?? '').toUpperCase();
  return UNASSIGNED_REASONS[key] ?? { label: humanize(key) || 'Unknown', text: '' };
}

const LAST_ALLOCATION_STATUS: Readonly<Record<string, string>> = {
  no_attempt: 'Not attempted yet',
  deciders_no: 'Every node said no',
  no_valid_shard_copy: 'No valid shard copy found',
  throttled: 'Throttled',
  fetching_shard_data: 'Fetching shard data',
  delayed_allocation: 'Delayed on purpose',
};

export function lastAllocationStatusLabel(status: string | undefined): string | undefined {
  if (!status) {
    return undefined;
  }
  return LAST_ALLOCATION_STATUS[status.toLocaleLowerCase()] ?? humanize(status);
}

export function toUnassignedView(info: RawUnassignedInfo): UnassignedView {
  const reason = info.reason ?? '';
  const meta = unassignedReasonMeta(reason);
  const at = info.at ? Date.parse(info.at) : Number.NaN;
  const lastStatusLabel = lastAllocationStatusLabel(info.last_allocation_status);
  const details = info.details?.trim();
  return {
    reason,
    reasonLabel: meta.label,
    reasonText: meta.text,
    at: Number.isFinite(at) ? at : null,
    failedAttempts: info.failed_allocation_attempts ?? 0,
    delayed: info.delayed === true,
    ...(details ? { details } : {}),
    ...(info.last_allocation_status ? { lastStatus: info.last_allocation_status } : {}),
    ...(lastStatusLabel ? { lastStatusLabel } : {}),
    ...(info.last_node ? { lastNode: info.last_node } : {}),
  };
}

/* ------------------------------------------------------------------ */
/* Verdict                                                             */
/* ------------------------------------------------------------------ */

export function buildVerdict(raw: RawAllocationExplain): VerdictView {
  const state = (raw.current_state ?? '').toLocaleLowerCase();
  if (state === 'unassigned' || !raw.current_node) {
    const explanation = sentence(raw.allocate_explanation ?? '');
    switch (normalizeDecision(raw.can_allocate)) {
      case 'yes':
        return {
          tone: 'blue',
          icon: 'bi-check2-circle',
          title: 'Can be allocated',
          text: explanation || 'Elasticsearch can allocate this shard and should do so shortly.',
        };
      case 'throttle':
      case 'throttled':
        return {
          tone: 'yellow',
          icon: 'bi-hourglass-split',
          title: 'Waiting to be allocated',
          text: explanation || 'Allocation is throttled: the target nodes are busy with other recoveries.',
        };
      case 'allocation_delayed': {
        const remaining = raw.remaining_delay_in_millis;
        const delay =
          remaining !== undefined && remaining > 0
            ? ` About ${formatDuration(remaining)} remaining.`
            : '';
        return {
          tone: 'yellow',
          icon: 'bi-clock-history',
          title: 'Allocation delayed',
          text: (explanation || 'Elasticsearch is waiting for the node that held this copy to come back.') + delay,
        };
      }
      case 'awaiting_info':
        return {
          tone: 'blue',
          icon: 'bi-hourglass',
          title: 'Waiting for shard information',
          text: explanation || 'Elasticsearch is still collecting information about the copies on disk.',
        };
      case 'no_valid_shard_copy':
        return {
          tone: 'red',
          icon: 'bi-x-octagon',
          title: 'No valid shard copy',
          text: explanation || 'No node holds a usable copy of this shard.',
        };
      case 'no':
        return {
          tone: 'red',
          icon: 'bi-x-octagon',
          title: 'Cannot be allocated',
          text: explanation || 'No node in the cluster is allowed to hold this shard.',
        };
      case 'no_attempt':
        return {
          tone: 'gray',
          icon: 'bi-dash-circle',
          title: 'Not attempted yet',
          text: explanation || 'Elasticsearch has not tried to allocate this shard yet.',
        };
      default:
        return {
          tone: 'gray',
          icon: 'bi-question-circle',
          title: 'Unassigned',
          text: explanation || 'Elasticsearch did not say whether this shard can be allocated.',
        };
    }
  }

  const node = raw.current_node.name ?? raw.current_node.id ?? 'its node';
  const canRemain = normalizeDecision(raw.can_remain_on_current_node);
  if (canRemain === 'no') {
    const move = normalizeDecision(raw.can_move_to_other_node);
    const text = sentence(raw.move_explanation ?? '');
    if (move === 'yes') {
      return {
        tone: 'yellow',
        icon: 'bi-box-arrow-right',
        title: `Moving off ${node}`,
        text: text || `The shard is not allowed to stay on ${node} and will be moved to another node.`,
      };
    }
    if (move === 'throttle' || move === 'throttled') {
      return {
        tone: 'yellow',
        icon: 'bi-hourglass-split',
        title: `Waiting to move off ${node}`,
        text: text || `The shard must leave ${node}; the move is throttled.`,
      };
    }
    return {
      tone: 'red',
      icon: 'bi-exclamation-octagon',
      title: `Must leave ${node} but cannot move`,
      text: text || `The shard is not allowed to stay on ${node}, and no other node can take it.`,
    };
  }

  if (state === 'relocating') {
    return {
      tone: 'purple',
      icon: 'bi-arrow-left-right',
      title: `Relocating from ${node}`,
      text: `The shard is being moved off ${node} to another node.`,
    };
  }
  if (state === 'initializing') {
    return {
      tone: 'blue',
      icon: 'bi-arrow-repeat',
      title: `Initializing on ${node}`,
      text: `The copy is being recovered onto ${node} and becomes active once the recovery finishes.`,
    };
  }
  const clause = rebalanceClause(raw);
  return {
    tone: 'green',
    icon: 'bi-check2-circle',
    title: `Allocated to ${node}`,
    text: `The shard is healthy on ${node} and can stay there.${clause ? ` ${clause}` : ''}`,
  };
}

/**
 * One plain sentence on whether an assigned shard is going to move, built
 * from `can_rebalance_to_other_node` and `can_rebalance_cluster` (the raw
 * `rebalance_explanation` reads like an error even when all is well).
 */
export function rebalanceClause(raw: RawAllocationExplain): string {
  const cluster = normalizeDecision(raw.can_rebalance_cluster);
  switch (normalizeDecision(raw.can_rebalance_to_other_node)) {
    case 'yes':
      return 'A better-balanced node is available, so Elasticsearch may move it there.';
    case 'throttle':
    case 'throttled':
      return 'A move to a better-balanced node is waiting for other recoveries to finish.';
    case 'worse_balance':
      return 'No other node would be a better fit.';
    case 'no': {
      if (cluster === 'no' || cluster === 'throttle' || cluster === 'throttled') {
        const labels = [
          ...new Set(blockingDeciders(raw.can_rebalance_cluster_decisions).map((decider) => decider.label)),
        ];
        const how = cluster === 'no' ? 'blocked' : 'throttled';
        return labels.length > 0
          ? `It is not being moved: rebalancing is ${how} (${labels.join(', ')}).`
          : `It is not being moved: rebalancing is ${how}.`;
      }
      return 'It is not being moved: no other node may take it.';
    }
    default:
      return '';
  }
}

/* ------------------------------------------------------------------ */
/* Nodes, disk and full normalisation                                  */
/* ------------------------------------------------------------------ */

export function describeStore(store: RawNodeStore | undefined): string | undefined {
  if (!store) {
    return undefined;
  }
  if (store.store_exception !== undefined && store.store_exception !== null) {
    return 'Copy on disk could not be read';
  }
  if (store.in_sync === true) {
    return 'Holds an in-sync copy';
  }
  if (store.found === false) {
    return 'No copy on disk';
  }
  if (store.in_sync === false) {
    return 'Holds a stale copy';
  }
  if (store.matching_sync_id === true) {
    return 'Holds an identical copy';
  }
  if (typeof store.matching_size_in_bytes === 'number' && store.matching_size_in_bytes > 0) {
    return `${formatBytes(store.matching_size_in_bytes)} of matching data`;
  }
  return undefined;
}

/**
 * `hints: false` drops the remedy hints: for an assigned, healthy shard the
 * other nodes refusing it is expected, and "add a data node" would be bad advice.
 */
export function toNodeDecisionView(raw: RawNodeDecision, options: { readonly hints?: boolean } = {}): NodeDecisionView {
  const meta = decisionMeta(raw.node_decision);
  const store = describeStore(raw.store);
  const blockers = blockingDeciders(raw.deciders);
  return {
    id: raw.node_id ?? raw.node_name ?? '',
    name: raw.node_name ?? raw.node_id ?? 'Unknown node',
    address: raw.transport_address ?? '',
    decision: normalizeDecision(raw.node_decision),
    decisionLabel: meta.label,
    tone: meta.tone,
    weightRanking: typeof raw.weight_ranking === 'number' ? raw.weight_ranking : null,
    blockers: options.hints === false ? blockers.map(withoutHint) : blockers,
    attributes: visibleAttributes(raw.node_attributes),
    ...(store ? { store } : {}),
    holdsCopy: blockers.some((decider) => decider.decider === 'same_shard' && decider.decision === 'no'),
  };
}

/** Stable sort; ties fall back to the weight ranking and then the name. */
export function sortNodeDecisions(
  nodes: readonly NodeDecisionView[],
  field: NodeSortField,
  reverse = false,
): NodeDecisionView[] {
  const direction = reverse ? -1 : 1;
  const byName = (left: NodeDecisionView, right: NodeDecisionView) =>
    left.name.localeCompare(right.name, undefined, { numeric: true });
  const byWeight = (left: NodeDecisionView, right: NodeDecisionView) => {
    if (left.weightRanking === right.weightRanking) {
      return 0;
    }
    if (left.weightRanking === null) {
      return 1;
    }
    if (right.weightRanking === null) {
      return -1;
    }
    return left.weightRanking - right.weightRanking;
  };
  return [...nodes].sort((left, right) => {
    switch (field) {
      case 'name':
        return direction * byName(left, right);
      case 'weight': {
        const weight = byWeight(left, right);
        // Unranked nodes stay last in both directions.
        if (weight !== 0 && (left.weightRanking === null || right.weightRanking === null)) {
          return weight;
        }
        return direction * weight || byName(left, right);
      }
      case 'decision':
        return (
          direction * (decisionRank(left.decision) - decisionRank(right.decision)) ||
          byWeight(left, right) ||
          byName(left, right)
        );
    }
  });
}

export function diskUsage(info: RawClusterInfo | undefined): DiskView[] {
  return Object.entries(info?.nodes ?? {})
    .flatMap(([id, node]) => {
      const disk = node.least_available;
      if (!disk || typeof disk.total_bytes !== 'number' || disk.total_bytes <= 0) {
        return [];
      }
      const total = disk.total_bytes;
      const free = disk.free_bytes ?? Math.max(0, total - (disk.used_bytes ?? 0));
      const used = disk.used_bytes ?? Math.max(0, total - free);
      const percent =
        disk.used_disk_percent ??
        (disk.free_disk_percent !== undefined ? 100 - disk.free_disk_percent : (used / total) * 100);
      return [
        {
          id,
          name: node.node_name ?? id,
          usedPercent: Math.round(percent * 10) / 10,
          usedBytes: used,
          freeBytes: free,
          totalBytes: total,
          ...(disk.path ? { path: disk.path } : {}),
        },
      ];
    })
    .sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true }));
}

export function shardSize(
  info: RawClusterInfo | undefined,
  index: string,
  shard: number,
  primary: boolean,
): number | null {
  const sizes = info?.shard_sizes ?? {};
  const key = `[${index}][${shard}][${primary ? 'p' : 'r'}]`;
  const value = sizes[key] ?? sizes[`${key}_bytes`];
  return typeof value === 'number' ? value : null;
}

interface CheckMeta extends DecisionMeta {
  readonly icon: string;
}

/**
 * Rebalancing outcomes of an assigned shard are informational: "no" only
 * means the shard stays where it is, so it is gray rather than red.
 */
const REBALANCE_CLUSTER: Readonly<Record<string, CheckMeta>> = {
  yes: { label: 'Yes', tone: 'green', icon: 'bi-check-lg' },
  no: { label: 'No', tone: 'gray', icon: 'bi-pause-circle' },
  throttle: { label: 'Throttled', tone: 'yellow', icon: 'bi-hourglass-split' },
  throttled: { label: 'Throttled', tone: 'yellow', icon: 'bi-hourglass-split' },
};

const REBALANCE_TO_OTHER_NODE: Readonly<Record<string, CheckMeta>> = {
  yes: { label: 'Better node found', tone: 'blue', icon: 'bi-arrow-left-right' },
  throttle: { label: 'Throttled', tone: 'yellow', icon: 'bi-hourglass-split' },
  throttled: { label: 'Throttled', tone: 'yellow', icon: 'bi-hourglass-split' },
  worse_balance: { label: 'No better node', tone: 'green', icon: 'bi-check-lg' },
  no: { label: 'No', tone: 'gray', icon: 'bi-dash-lg' },
};

function check(
  label: string,
  decision: string | undefined,
  explanation: string | undefined,
  deciders: readonly RawDecider[] | undefined,
  metas?: Readonly<Record<string, CheckMeta>>,
): CheckView {
  const normalized = normalizeDecision(decision);
  const meta: CheckMeta = metas?.[normalized] ?? { ...decisionMeta(decision), icon: decisionIcon(decision) };
  const text = sentence(explanation ?? '');
  return {
    label,
    decision: normalized,
    decisionLabel: meta.label,
    tone: meta.tone,
    icon: meta.icon,
    ...(text ? { explanation: text } : {}),
    blockers: blockingDeciders(deciders),
  };
}

const RANDOM_SHARD_NOTE = /no shard was specified/i;

export function friendlyNote(note: string | undefined): string | undefined {
  if (!note) {
    return undefined;
  }
  return RANDOM_SHARD_NOTE.test(note)
    ? 'No shard was specified, so Elasticsearch explained an unassigned shard of its choice. Other unassigned shards may be stuck for different reasons.'
    : note;
}

export function normalizeExplanation(raw: RawAllocationExplain): ExplanationView {
  const index = raw.index ?? '';
  const shard = raw.shard ?? 0;
  const primary = raw.primary === true;
  const state = (raw.current_state ?? 'unknown').toLocaleLowerCase();
  const stateMeta = shardStateMeta(state);
  const current = raw.current_node;
  const assigned = state !== 'unassigned' && !!current;
  const size = shardSize(raw.cluster_info, index, shard, primary);

  const facts: FactView[] = [];
  const checks: CheckView[] = [];
  if (assigned && current) {
    const name = current.name ?? current.id ?? '';
    facts.push({ label: 'Current node', value: name, ...(current.transport_address ? { title: current.transport_address } : {}) });
    if (typeof current.weight_ranking === 'number') {
      facts.push({
        label: 'Weight ranking',
        value: ordinal(current.weight_ranking),
        title: 'Where the current node ranks for this shard according to the balancer (1st is the best fit).',
      });
    }
    if (raw.can_remain_on_current_node !== undefined) {
      checks.push(
        check(`Can stay on ${name}`, raw.can_remain_on_current_node, undefined, raw.can_remain_decisions),
      );
    }
    if (normalizeDecision(raw.can_remain_on_current_node) === 'no' && raw.can_move_to_other_node !== undefined) {
      checks.push(check('Can move to another node', raw.can_move_to_other_node, raw.move_explanation, undefined));
    }
    if (raw.can_rebalance_cluster !== undefined) {
      checks.push(
        check(
          'Rebalancing allowed in the cluster',
          raw.can_rebalance_cluster,
          undefined,
          raw.can_rebalance_cluster_decisions,
          REBALANCE_CLUSTER,
        ),
      );
    }
    if (raw.can_rebalance_to_other_node !== undefined) {
      checks.push(
        check(
          'Can rebalance to another node',
          raw.can_rebalance_to_other_node,
          raw.rebalance_explanation,
          undefined,
          REBALANCE_TO_OTHER_NODE,
        ),
      );
    }
  }
  if (size !== null) {
    facts.push({ label: 'Shard size', value: formatBytes(size) });
  }

  const note = friendlyNote(raw.note);
  return {
    index,
    shard,
    primary,
    state,
    stateLabel: stateMeta.label,
    stateTone: stateMeta.tone,
    assigned,
    ...(assigned && current
      ? {
          currentNode: {
            id: current.id ?? '',
            name: current.name ?? current.id ?? '',
            address: current.transport_address ?? '',
          },
        }
      : {}),
    verdict: buildVerdict(raw),
    facts,
    checks,
    ...(raw.unassigned_info ? { unassigned: toUnassignedView(raw.unassigned_info) } : {}),
    nodes: (raw.node_allocation_decisions ?? []).map((node) => toNodeDecisionView(node, { hints: !assigned })),
    disks: diskUsage(raw.cluster_info),
    shardSize: size,
    ...(note ? { note } : {}),
  };
}

export interface BlockerSummary {
  readonly decider: string;
  readonly label: string;
  readonly hint?: string;
  readonly nodes: readonly string[];
}

/**
 * Deciders that kept nodes from taking the shard, most widespread first:
 * "Same shard — on all 3 nodes" is the gist of most unassigned replicas.
 */
export function commonBlockers(nodes: readonly NodeDecisionView[]): BlockerSummary[] {
  const groups = new Map<string, { label: string; hint?: string; nodes: string[] }>();
  for (const node of nodes) {
    if (node.decision === 'yes') {
      continue;
    }
    for (const decider of node.blockers) {
      const group = groups.get(decider.decider) ?? {
        label: decider.label,
        ...(decider.hint ? { hint: decider.hint } : {}),
        nodes: [],
      };
      if (!group.nodes.includes(node.name)) {
        group.nodes.push(node.name);
      }
      groups.set(decider.decider, group);
    }
  }
  return [...groups.entries()]
    .map(([decider, group]) => ({ decider, ...group }))
    .sort((left, right) => right.nodes.length - left.nodes.length || left.label.localeCompare(right.label));
}

export interface DecisionSummary {
  readonly yes: number;
  readonly throttled: number;
  readonly no: number;
  readonly other: number;
}

export function summarizeDecisions(nodes: readonly NodeDecisionView[]): DecisionSummary {
  let yes = 0;
  let throttled = 0;
  let no = 0;
  let other = 0;
  for (const node of nodes) {
    switch (node.decision) {
      case 'yes':
        yes++;
        break;
      case 'throttle':
      case 'throttled':
        throttled++;
        break;
      case 'no':
        no++;
        break;
      default:
        other++;
    }
  }
  return { yes, throttled, no, other };
}

/* ------------------------------------------------------------------ */
/* Requests, URLs and errors                                           */
/* ------------------------------------------------------------------ */

/** Reads `?index=&shard=&primary=&node=`; `null` means "next unassigned". */
export function parseExplainParams(get: (name: string) => string | null): ExplainRequest | null {
  const index = get('index')?.trim();
  if (!index) {
    return null;
  }
  const shard = Number.parseInt(get('shard') ?? '', 10);
  const node = get('node')?.trim();
  return {
    index,
    shard: Number.isFinite(shard) && shard >= 0 ? shard : 0,
    primary: get('primary') !== 'false',
    ...(node ? { node } : {}),
  };
}

export function explainQueryParams(request: ExplainRequest | null): Record<string, string | null> {
  if (!request) {
    return { index: null, shard: null, primary: null, node: null };
  }
  return {
    index: request.index,
    shard: String(request.shard),
    primary: String(request.primary),
    node: request.node ?? null,
  };
}

export function buildExplainPayload(request: ExplainRequest | null): Record<string, unknown> {
  if (!request) {
    return {};
  }
  return {
    index: request.index,
    shard: request.shard,
    primary: request.primary,
    ...(request.node ? { current_node: request.node } : {}),
  };
}

export function sameRequest(left: ExplainRequest | null, right: ExplainRequest | null): boolean {
  if (left === null || right === null) {
    return left === right;
  }
  return (
    left.index === right.index &&
    left.shard === right.shard &&
    left.primary === right.primary &&
    (left.node ?? '') === (right.node ?? '')
  );
}

/** The shard an explanation is about, to re-run it on refresh. */
export function requestFor(view: ExplanationView, previous: ExplainRequest | null): ExplainRequest {
  const node =
    previous && previous.index === view.index && previous.shard === view.shard && previous.primary === view.primary
      ? previous.node
      : undefined;
  return { index: view.index, shard: view.shard, primary: view.primary, ...(node ? { node } : {}) };
}

export interface ExplainErrorDetails {
  readonly status?: number;
  readonly type?: string;
  readonly reason?: string;
  readonly index?: string;
  readonly shard?: string;
  /**
   * Cerebro answered for Elasticsearch (`{ error: "<message>" }` with a 5xx):
   * the cluster was not reached, e.g. a refused connection or a timeout.
   */
  readonly unreachable?: boolean;
}

/**
 * Status, reason and the `type`, `index` and `shard` fields of a failed
 * explain request, which tell a missing index or shard from other failures.
 */
export function explainErrorDetails(error: unknown): ExplainErrorDetails {
  if (!isRecord(error)) {
    return typeof error === 'string' ? { reason: error } : {};
  }
  const status = typeof error['status'] === 'number' ? error['status'] : undefined;
  const body = error['body'];
  const reason = elasticsearchReason(body) ?? undefined;
  const payload = isRecord(body) ? body['error'] : undefined;
  const rootCauses = isRecord(payload) ? payload['root_cause'] : undefined;
  const root = Array.isArray(rootCauses) && isRecord(rootCauses[0]) ? rootCauses[0] : undefined;
  const pick = (key: string): string | undefined => {
    const value = (isRecord(payload) ? payload[key] : undefined) ?? root?.[key];
    return typeof value === 'string' || typeof value === 'number' ? String(value) : undefined;
  };
  const type = pick('type');
  const index = pick('index');
  const shard = pick('shard');
  const unreachable = status !== undefined && status >= 500 && isRecord(body) && typeof body['error'] === 'string';
  return {
    ...(status !== undefined ? { status } : {}),
    ...(unreachable ? { unreachable } : {}),
    ...(type ? { type } : {}),
    ...(reason ? { reason } : {}),
    ...(index ? { index } : {}),
    ...(shard ? { shard } : {}),
  };
}

/** Elasticsearch answers 400 when asked for "the next unassigned shard" of a healthy cluster. */
export function isNoUnassignedShards(error: unknown): boolean {
  const details = explainErrorDetails(error);
  const reason = details.reason ?? '';
  return (
    details.status === 400 &&
    /unassigned shards?/i.test(reason) &&
    /(unable to find|there are no|no unassigned)/i.test(reason)
  );
}

export interface ExplainFailure {
  readonly title: string;
  readonly message: string;
  /** The node named in the request does not exist: offer to explain without it. */
  readonly unknownNode?: string;
  /** Elasticsearch was not reached, so there is no response worth showing. */
  readonly unreachable?: boolean;
}

const UNKNOWN_NODE = /failed to resolve \[(.+?)\],? no matching nodes/i;

export function describeExplainError(error: unknown, request: ExplainRequest | null): ExplainFailure {
  const details = explainErrorDetails(error);
  if (details.status === undefined || details.unreachable) {
    return {
      title: 'Could not reach the cluster',
      message: details.reason
        ? sentence(details.reason)
        : 'The request failed before Elasticsearch answered. Check the connection and try again.',
      unreachable: true,
    };
  }
  if (details.status === 401 || details.status === 403) {
    return {
      title: 'Not allowed',
      message:
        'The connected user may not call the allocation explain API. It needs the "monitor" cluster privilege.',
    };
  }
  const unknownNode = UNKNOWN_NODE.exec(details.reason ?? '')?.[1];
  if (unknownNode) {
    return {
      title: 'Node not found',
      message: `No node named "${unknownNode}" is in the cluster. It may have left; explain the shard without a node instead.`,
      unknownNode,
    };
  }
  const index = details.index ?? request?.index;
  switch (details.type) {
    case 'index_not_found_exception':
      return {
        title: 'Index not found',
        message: index ? `There is no index named "${index}".` : sentence(details.reason ?? 'No such index.'),
      };
    case 'shard_not_found_exception': {
      const shard = details.shard ?? (request ? String(request.shard) : undefined);
      return {
        title: 'Shard not found',
        message:
          index && shard !== undefined
            ? `Index "${index}" has no shard ${shard}. Shard numbers start at 0.`
            : sentence(details.reason ?? 'No such shard.'),
      };
    }
  }
  return {
    title: 'Elasticsearch could not explain this shard',
    message: details.reason ? sentence(details.reason) : `The request failed with status ${details.status}.`,
  };
}

/* ------------------------------------------------------------------ */
/* Shard copies from _cat/shards                                       */
/* ------------------------------------------------------------------ */

export function parseShardCopies(rows: unknown): ShardCopy[] {
  if (!Array.isArray(rows)) {
    return [];
  }
  return rows.flatMap((row: unknown) => {
    if (!isRecord(row)) {
      return [];
    }
    const value = row as CatShardRow;
    const shard = Number.parseInt(value.shard ?? '', 10);
    if (!value.index || !Number.isFinite(shard)) {
      return [];
    }
    // Relocating shards read "node-a -> 10.0.0.2 id node-b": keep the source.
    const node = typeof value.node === 'string' && value.node.trim() ? value.node.split(' -> ')[0]?.trim() ?? null : null;
    return [
      {
        index: value.index,
        shard,
        primary: value.prirep === 'p',
        state: (value.state ?? 'UNKNOWN').toUpperCase(),
        node: node || null,
      },
    ];
  });
}

function compareCopies(left: ShardCopy, right: ShardCopy): number {
  if (left.shard !== right.shard) {
    return left.shard - right.shard;
  }
  if (left.primary !== right.primary) {
    return left.primary ? -1 : 1;
  }
  if (left.node === right.node) {
    return 0;
  }
  if (left.node === null) {
    return 1;
  }
  if (right.node === null) {
    return -1;
  }
  return left.node.localeCompare(right.node, undefined, { numeric: true });
}

/** Copies of one shard: primary first, then replicas by node, unassigned last. */
export function copiesOf(copies: readonly ShardCopy[], index: string, shard: number): ShardCopy[] {
  return copies.filter((copy) => copy.index === index && copy.shard === shard).sort(compareCopies);
}

export function shardCount(copies: readonly ShardCopy[], index: string): number {
  let max = -1;
  for (const copy of copies) {
    if (copy.index === index && copy.shard > max) {
      max = copy.shard;
    }
  }
  return max + 1;
}

export interface UnassignedGroup {
  readonly index: string;
  readonly copies: readonly ShardCopy[];
}

export function unassignedGroups(copies: readonly ShardCopy[]): UnassignedGroup[] {
  const groups = new Map<string, ShardCopy[]>();
  for (const copy of copies) {
    if (copy.state !== 'UNASSIGNED') {
      continue;
    }
    const list = groups.get(copy.index) ?? [];
    list.push(copy);
    groups.set(copy.index, list);
  }
  return sortIndexNames([...groups.keys()]).map((index) => ({
    index,
    copies: (groups.get(index) ?? []).sort(compareCopies),
  }));
}

export function copyLabel(copy: ShardCopy): string {
  const kind = copy.primary ? 'Primary' : 'Replica';
  const state = copy.state.toLocaleLowerCase();
  return copy.node
    ? `${kind} of shard ${copy.shard}, ${state} on ${copy.node}`
    : `${kind} of shard ${copy.shard}, ${state}`;
}

/** Node names by id from the `nodes` endpoint (`[{ id, name, … }]`). */
export function nodeNamesById(value: unknown): ReadonlyMap<string, string> {
  const names = new Map<string, string>();
  for (const node of Array.isArray(value) ? value : []) {
    if (isRecord(node) && typeof node['id'] === 'string' && typeof node['name'] === 'string') {
      names.set(node['id'], node['name']);
    }
  }
  return names;
}

/**
 * Display name of the node a request names (`?node=` takes an id or a name):
 * looked up among the nodes the explanation mentions, then the cluster's
 * node list; unknown values are shown as given.
 */
export function nodeDisplayName(
  node: string,
  view: ExplanationView | undefined,
  names: ReadonlyMap<string, string> = new Map(),
): string {
  const known = view ? [...(view.currentNode ? [view.currentNode] : []), ...view.nodes, ...view.disks] : [];
  return known.find((candidate) => candidate.id === node)?.name ?? names.get(node) ?? node;
}
