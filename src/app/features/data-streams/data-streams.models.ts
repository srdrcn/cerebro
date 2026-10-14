/** Shapes of `GET _data_stream` and `GET _data_stream/_stats` as wrapped by Cerebro. */

export interface BackingIndex {
  readonly index_name: string;
  readonly index_uuid?: string;
  readonly ilm_policy?: string;
  readonly managed_by?: string;
  readonly prefer_ilm?: boolean;
}

export interface DataStreamLifecycle {
  readonly enabled?: boolean;
  readonly data_retention?: string;
  readonly effective_retention?: string;
}

export interface DataStream {
  readonly name: string;
  readonly timestamp_field?: { readonly name?: string };
  readonly indices?: readonly BackingIndex[];
  readonly generation?: number;
  readonly status?: string;
  readonly template?: string;
  readonly ilm_policy?: string;
  readonly next_generation_managed_by?: string;
  readonly prefer_ilm?: boolean;
  readonly lifecycle?: DataStreamLifecycle;
  readonly hidden?: boolean;
  readonly system?: boolean;
  readonly replicated?: boolean;
  readonly allow_custom_routing?: boolean;
  readonly rollover_on_write?: boolean;
  readonly _meta?: Record<string, unknown>;
  readonly failure_store?: { readonly enabled?: boolean; readonly indices?: readonly BackingIndex[] };
  readonly [key: string]: unknown;
}

export interface DataStreamStatsEntry {
  readonly data_stream: string;
  readonly backing_indices?: number;
  readonly store_size_bytes?: number;
  readonly maximum_timestamp?: number;
}

export interface DataStreamStats {
  readonly data_stream_count?: number;
  readonly backing_indices?: number;
  readonly total_store_size_bytes?: number;
  readonly data_streams?: readonly DataStreamStatsEntry[];
}

export interface DataStreamsResponse {
  readonly data_streams?: readonly DataStream[];
  readonly stats?: DataStreamStats | null;
}

export interface RolloverResponse {
  readonly acknowledged?: boolean;
  readonly old_index?: string;
  readonly new_index?: string;
  readonly rolled_over?: boolean;
}

export type HealthTone = 'green' | 'yellow' | 'red' | 'gray';

export type LifecycleInfo =
  | { readonly kind: 'ilm'; readonly policy: string }
  | { readonly kind: 'dsl'; readonly retention: string | null }
  | { readonly kind: 'none' };

export interface BackingIndexRow {
  readonly name: string;
  /** 1-based position, oldest first. */
  readonly position: number;
  readonly write: boolean;
  readonly managedBy: string | null;
  readonly policy: string | null;
}

/** One table row: the stream plus the numbers from the stats call. */
export interface StreamRow {
  readonly stream: DataStream;
  readonly name: string;
  readonly health: HealthTone;
  readonly healthLabel: string;
  readonly indexCount: number;
  readonly generation: number;
  readonly template: string | null;
  readonly lifecycle: LifecycleInfo;
  readonly sizeBytes: number | null;
  readonly lastEvent: number | null;
  readonly writeIndex: string | null;
  readonly hidden: boolean;
  readonly system: boolean;
  readonly replicated: boolean;
  readonly timestampField: string;
  readonly backingIndices: readonly BackingIndexRow[];
}

export type StreamSortField = 'name' | 'health' | 'indices' | 'size' | 'lastEvent';

export interface StreamSummary {
  readonly streams: number;
  readonly backingIndices: number;
  readonly sizeBytes: number | null;
  readonly unhealthy: number;
  readonly lastEvent: number | null;
}
