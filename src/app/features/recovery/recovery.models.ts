/** Row of `_cat/recovery?format=json&bytes=b&time=ms` (every value is a string). */
export interface RawRecoveryRow {
  readonly index?: string;
  readonly shard?: string;
  readonly time?: string;
  readonly type?: string;
  readonly stage?: string;
  readonly source_host?: string;
  readonly source_node?: string;
  readonly target_host?: string;
  readonly target_node?: string;
  readonly repository?: string;
  readonly snapshot?: string;
  readonly files?: string;
  readonly files_recovered?: string;
  readonly files_percent?: string;
  readonly files_total?: string;
  readonly bytes?: string;
  readonly bytes_recovered?: string;
  readonly bytes_percent?: string;
  readonly bytes_total?: string;
  readonly translog_ops?: string;
  readonly translog_ops_recovered?: string;
  readonly translog_ops_percent?: string;
}

export type RecoveryType = 'peer' | 'existing_store' | 'snapshot' | 'empty_store' | 'local_shards';
export type RecoveryStage = 'init' | 'index' | 'verify_index' | 'translog' | 'finalize' | 'done';

export interface Progress {
  /** Amount that has to be recovered (files/bytes/ops actually copied or replayed). */
  readonly total: number;
  readonly recovered: number;
  /** 0–100 as reported by Elasticsearch. */
  readonly percent: number;
}

export interface Recovery {
  /** Stable identity across polls. */
  readonly key: string;
  readonly index: string;
  readonly shard: number;
  readonly timeMs: number;
  readonly type: string;
  readonly stage: string;
  readonly done: boolean;
  readonly sourceNode?: string;
  readonly sourceHost?: string;
  readonly targetNode?: string;
  readonly targetHost?: string;
  readonly repository?: string;
  readonly snapshot?: string;
  readonly files: Progress;
  /** All files of the shard, including the ones reused from the target. */
  readonly filesTotal: number;
  readonly bytes: Progress;
  /** Size of the shard, including the bytes reused from the target. */
  readonly bytesTotal: number;
  /** `null` when Elasticsearch does not know the number of operations yet. */
  readonly translog: Progress | null;
}

export interface RecoveryGroup {
  readonly index: string;
  readonly recoveries: readonly Recovery[];
  readonly active: number;
  readonly bytesTotal: number;
  readonly bytesRecovered: number;
  readonly bytesRemaining: number;
  /** Byte-weighted progress of the group (0–100). */
  readonly percent: number;
  readonly longestMs: number;
}

export interface RecoverySummary {
  readonly total: number;
  readonly active: number;
  readonly indices: number;
  readonly bytesToRecover: number;
  readonly bytesRemaining: number;
  readonly filesRemaining: number;
  readonly translogRemaining: number;
  /** Byte-weighted progress of the active recoveries (0–100), `null` when nothing is active. */
  readonly percent: number | null;
  readonly byType: readonly { readonly type: string; readonly count: number }[];
}

export type RecoverySortField = 'index' | 'remaining' | 'time';

/** Bytes recovered per recovery at a point in time, to estimate throughput. */
export interface RecoverySample {
  readonly at: number;
  readonly recovered: ReadonlyMap<string, number>;
}
