/**
 * Shapes of the Elasticsearch `_cluster/allocation/explain` response
 * (requested with `include_disk_info=true`) and of the view model the page
 * renders. Only the fields the page reads are typed; everything is optional
 * because the response differs between assigned and unassigned shards and
 * between Elasticsearch versions.
 */

export interface RawDecider {
  readonly decider?: string;
  readonly decision?: string;
  readonly explanation?: string;
}

export interface RawNodeStore {
  readonly in_sync?: boolean;
  readonly allocation_id?: string;
  readonly found?: boolean;
  readonly matching_sync_id?: boolean;
  readonly matching_size_in_bytes?: number;
  readonly store_exception?: unknown;
}

export interface RawNodeDecision {
  readonly node_id?: string;
  readonly node_name?: string;
  readonly transport_address?: string;
  readonly node_attributes?: Readonly<Record<string, string>>;
  readonly roles?: readonly string[];
  readonly node_decision?: string;
  readonly weight_ranking?: number;
  readonly store?: RawNodeStore;
  readonly deciders?: readonly RawDecider[];
}

export interface RawCurrentNode {
  readonly id?: string;
  readonly name?: string;
  readonly transport_address?: string;
  readonly attributes?: Readonly<Record<string, string>>;
  readonly roles?: readonly string[];
  readonly weight_ranking?: number;
}

export interface RawUnassignedInfo {
  readonly reason?: string;
  readonly at?: string;
  readonly failed_allocation_attempts?: number;
  readonly delayed?: boolean;
  readonly details?: string;
  readonly last_allocation_status?: string;
  readonly last_node?: string;
}

export interface RawDiskUsage {
  readonly path?: string;
  readonly total_bytes?: number;
  readonly used_bytes?: number;
  readonly free_bytes?: number;
  readonly free_disk_percent?: number;
  readonly used_disk_percent?: number;
}

export interface RawClusterInfoNode {
  readonly node_name?: string;
  readonly least_available?: RawDiskUsage;
  readonly most_available?: RawDiskUsage;
}

export interface RawClusterInfo {
  readonly nodes?: Readonly<Record<string, RawClusterInfoNode>>;
  readonly shard_sizes?: Readonly<Record<string, number>>;
}

export interface RawAllocationExplain {
  readonly note?: string;
  readonly index?: string;
  readonly shard?: number;
  readonly primary?: boolean;
  readonly current_state?: string;
  readonly current_node?: RawCurrentNode;
  readonly unassigned_info?: RawUnassignedInfo;
  readonly cluster_info?: RawClusterInfo;
  readonly can_allocate?: string;
  readonly allocate_explanation?: string;
  readonly configured_delay_in_millis?: number;
  readonly remaining_delay_in_millis?: number;
  readonly can_remain_on_current_node?: string;
  readonly can_remain_decisions?: readonly RawDecider[];
  readonly can_move_to_other_node?: string;
  readonly move_explanation?: string;
  readonly can_rebalance_cluster?: string;
  readonly can_rebalance_cluster_decisions?: readonly RawDecider[];
  readonly can_rebalance_to_other_node?: string;
  readonly rebalance_explanation?: string;
  readonly node_allocation_decisions?: readonly RawNodeDecision[];
}

/** What the page asks Elasticsearch about. `null` means "next unassigned". */
export interface ExplainRequest {
  readonly index: string;
  readonly shard: number;
  readonly primary: boolean;
  readonly node?: string;
}

export type Tone = 'green' | 'yellow' | 'red' | 'blue' | 'purple' | 'gray';

export interface DeciderView {
  readonly decider: string;
  readonly label: string;
  readonly decision: string;
  readonly decisionLabel: string;
  readonly tone: Tone;
  readonly explanation: string;
  readonly hint?: string;
}

export interface NodeDecisionView {
  readonly id: string;
  readonly name: string;
  readonly address: string;
  readonly decision: string;
  readonly decisionLabel: string;
  readonly tone: Tone;
  /** Lower is better; `null` when Elasticsearch did not rank the node. */
  readonly weightRanking: number | null;
  /** Deciders that said NO or THROTTLE (the ones worth reading). */
  readonly blockers: readonly DeciderView[];
  readonly attributes: readonly (readonly [string, string])[];
  readonly store?: string;
  /** The node already holds another copy of this shard (same_shard said no). */
  readonly holdsCopy: boolean;
}

export interface FactView {
  readonly label: string;
  readonly value: string;
  readonly tone?: Tone;
  readonly title?: string;
}

export interface CheckView {
  readonly label: string;
  readonly decision: string;
  readonly decisionLabel: string;
  readonly tone: Tone;
  /** Bootstrap icon name of the status mark (`bi-check-lg`, `bi-x-lg`, …). */
  readonly icon: string;
  readonly explanation?: string;
  readonly blockers: readonly DeciderView[];
}

export interface VerdictView {
  readonly tone: Tone;
  readonly icon: string;
  readonly title: string;
  readonly text: string;
}

export interface UnassignedView {
  readonly reason: string;
  readonly reasonLabel: string;
  readonly reasonText: string;
  readonly at: number | null;
  readonly failedAttempts: number;
  readonly details?: string;
  readonly lastStatus?: string;
  readonly lastStatusLabel?: string;
  readonly delayed: boolean;
  readonly lastNode?: string;
}

export interface DiskView {
  readonly id: string;
  readonly name: string;
  readonly usedPercent: number;
  readonly usedBytes: number;
  readonly freeBytes: number;
  readonly totalBytes: number;
  readonly path?: string;
}

export interface ExplanationView {
  readonly index: string;
  readonly shard: number;
  readonly primary: boolean;
  readonly state: string;
  readonly stateLabel: string;
  readonly stateTone: Tone;
  readonly assigned: boolean;
  readonly currentNode?: { readonly id: string; readonly name: string; readonly address: string };
  readonly verdict: VerdictView;
  readonly facts: readonly FactView[];
  readonly checks: readonly CheckView[];
  readonly unassigned?: UnassignedView;
  readonly nodes: readonly NodeDecisionView[];
  readonly disks: readonly DiskView[];
  readonly shardSize: number | null;
  readonly note?: string;
}

/** Row of `_cat/shards` as returned by the `cat` endpoint. */
export interface CatShardRow {
  readonly index?: string;
  readonly shard?: string;
  readonly prirep?: string;
  readonly state?: string;
  readonly node?: string | null;
}

export interface ShardCopy {
  readonly index: string;
  readonly shard: number;
  readonly primary: boolean;
  readonly state: string;
  readonly node: string | null;
}

export type NodeSortField = 'decision' | 'name' | 'weight';
