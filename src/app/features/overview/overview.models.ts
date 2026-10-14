export type ShardState = 'started' | 'initializing' | 'relocating' | 'unassigned' | 'unknown';

export interface OverviewShard {
  readonly shard: number;
  readonly index: string;
  readonly node?: string | null;
  readonly relocating_node?: string | null;
  readonly state: string;
  readonly primary: boolean;
}

export interface OverviewIndex {
  readonly name: string;
  readonly closed: boolean;
  readonly special: boolean;
  readonly unhealthy: boolean;
  readonly doc_count: number;
  readonly deleted_docs?: number;
  readonly size_in_bytes: number;
  readonly total_size_in_bytes?: number;
  readonly aliases: readonly string[];
  readonly num_shards: number;
  readonly num_replicas: number;
  /** Shards keyed by node id; unassigned shards live under `unassigned`. */
  readonly shards: Readonly<Record<string, readonly OverviewShard[] | undefined>>;
}

/**
 * Closed indices of Elasticsearch < 7 have no routing table, so the backend
 * only sends `name`, `closed` and `special` for them.
 */
export type RawOverviewIndex = Pick<OverviewIndex, 'name' | 'closed' | 'special'> &
  Partial<Omit<OverviewIndex, 'name' | 'closed' | 'special'>>;

export interface OverviewNode {
  readonly id: string;
  readonly current_master: boolean;
  readonly name: string;
  readonly host: string | null;
  readonly ip?: string | null;
  readonly es_version: string;
  readonly jvm_version: string | null;
  readonly load_average: number;
  readonly available_processors: number;
  readonly cpu_percent: number;
  readonly master: boolean;
  readonly data: boolean;
  readonly coordinating: boolean;
  readonly ingest: boolean;
  readonly heap: {
    readonly used: number;
    readonly committed: number;
    readonly used_percent: number;
    readonly max: number;
  };
  readonly disk: {
    readonly total: number;
    readonly free: number;
    /** Space available to Elasticsearch (absent on very old backends). */
    readonly available?: number;
    readonly used_percent: number;
  };
  readonly attributes: Readonly<Record<string, unknown>>;
}

export interface OverviewData {
  readonly cluster_name: string;
  readonly status: string;
  readonly number_of_nodes: number;
  readonly active_primary_shards: number;
  readonly active_shards: number;
  readonly relocating_shards: number;
  readonly initializing_shards: number;
  readonly unassigned_shards: number;
  readonly docs_count: number;
  readonly size_in_bytes: number;
  readonly total_indices: number;
  readonly closed_indices: number;
  readonly special_indices: number;
  readonly indices: readonly OverviewIndex[];
  readonly nodes: readonly OverviewNode[];
  readonly shard_allocation: boolean;
}

export type RawOverviewData = Omit<OverviewData, 'indices' | 'nodes'> & {
  readonly indices?: readonly RawOverviewIndex[];
  readonly nodes?: readonly OverviewNode[];
};

export interface OverviewIndexFilter {
  readonly name: string;
  readonly closed: boolean;
  readonly special: boolean;
  /** `true` displays all indices; `false` displays affected indices only. */
  readonly healthy: boolean;
  readonly ascending: boolean;
}

export type IndexOperation =
  | 'open'
  | 'close'
  | 'merge'
  | 'refresh'
  | 'flush'
  | 'cache'
  | 'delete';

export type IndexOperationPath =
  | 'overview/open_indices'
  | 'overview/close_indices'
  | 'overview/force_merge'
  | 'overview/refresh_indices'
  | 'overview/flush_indices'
  | 'overview/clear_indices_cache'
  | 'overview/delete_indices';

export type AllocationKind = 'none' | 'primaries' | 'new_primaries';

export type JsonEndpoint =
  | 'overview/get_shard_stats'
  | 'commons/get_node_stats'
  | 'commons/get_index_stats'
  | 'commons/get_index_settings'
  | 'commons/get_index_mapping';

/** Geometry of the shard map, derived from the width of the grid. */
export interface ShardMapLayout {
  readonly nodeColumn: number;
  readonly columns: number;
  readonly columnWidth: number;
  /** `true` when even a single index column does not fit (horizontal scroll). */
  readonly scroll: boolean;
}
