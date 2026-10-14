/** Tabs of the Performance page, kept in `?tab=`. */
export type PerformanceTab = 'hot-threads' | 'thread-pools' | 'pending-tasks' | 'slow-logs';

export interface PerformanceTabDefinition {
  readonly key: PerformanceTab;
  readonly label: string;
  readonly icon: string;
}

// ---- Hot threads -------------------------------------------------------------

/** `type` of `_nodes/hot_threads`. */
export type HotThreadsType = 'cpu' | 'wait' | 'block' | 'mem';

/** What the capture form sends to `performance/hot_threads`. */
export interface HotThreadsRequest {
  /** Node id, or `''` for every node. */
  readonly node: string;
  readonly type: HotThreadsType;
  readonly threads: number;
  readonly interval: string;
  readonly ignoreIdleThreads: boolean;
}

/** Where a stack frame comes from, for emphasis. */
export type FrameKind = 'elasticsearch' | 'lucene' | 'jdk' | 'other';

export interface StackFrame {
  /** The line as Elasticsearch printed it (trimmed). */
  readonly raw: string;
  /** `org.elasticsearch.search.query.QueryPhase` (empty when the line could not be parsed). */
  readonly className: string;
  /** `QueryPhase`. */
  readonly simpleName: string;
  /** `org.elasticsearch.search.query`. */
  readonly packageName: string;
  /** `executeQuery`. */
  readonly method: string;
  /** `QueryPhase.java:135`, `Native Method`, `Unknown Source`. */
  readonly location: string;
  /** `org.elasticsearch.server@8.15.3`, the Java module, when printed. */
  readonly module: string;
  readonly kind: FrameKind;
}

/**
 * What a stack group says about the thread:
 * `work` – it ran this code; `base` – the snapshots only share the executor
 * frames at the bottom (it ran different code each time); `idle` – parked,
 * sleeping or polling, waiting for work.
 */
export type StackKind = 'work' | 'base' | 'idle';

/** One "N/M snapshots sharing following K elements" block (or a unique snapshot). */
export interface StackGroup {
  /** Snapshots that showed this stack. */
  readonly snapshots: number;
  /** Snapshots taken in total (10 by default). */
  readonly total: number;
  readonly unique: boolean;
  readonly kind: StackKind;
  readonly frames: readonly StackFrame[];
}

export interface HotThread {
  /** Stable key within a capture: `<node>/<index>`. */
  readonly key: string;
  readonly name: string;
  /** Thread pool (`search`, `write`, `merge`…) or `null` for threads outside pools. */
  readonly pool: string | null;
  /** `T#6` and similar worker suffixes. */
  readonly worker: string | null;
  readonly type: HotThreadsType;
  /** Share of the interval (cpu, wait, block); `null` for memory captures. */
  readonly percent: number | null;
  /** CPU part of `percent` when Elasticsearch reports the split (8.x). */
  readonly cpuPercent: number | null;
  /** Runnable but off the CPU (blocking I/O, waiting for a core) when reported. */
  readonly otherPercent: number | null;
  /**
   * Idle share of network (transport) threads, which 8.x reports as
   * `[cpu=x%, idle=y%]`: their `percent` is the CPU share alone.
   */
  readonly idlePercent: number | null;
  /** "909ms out of 1s". */
  readonly usage: string | null;
  /** Bytes allocated during the interval (memory captures). */
  readonly allocatedBytes: number | null;
  /** Stacks doing work first (most frequent first), then base-only, then idle ones. */
  readonly groups: readonly StackGroup[];
  /**
   * The most telling frame: the first Elasticsearch or Lucene frame (executor
   * plumbing aside) of the first stack doing work, `null` when none has one.
   */
  readonly focus: StackFrame | null;
  /** Index in `groups` of the stack `focus` comes from. */
  readonly focusGroup: number | null;
  /** Every snapshot shows the thread parked, sleeping or waiting for work. */
  readonly idle: boolean;
}

export interface HotNode {
  readonly name: string;
  readonly id: string;
  /** `127.0.0.1:9300` when the header carries it. */
  readonly address: string | null;
  /** Epoch millis of "Hot threads at …". */
  readonly capturedAt: number | null;
  readonly interval: string | null;
  readonly busiestThreads: number | null;
  readonly ignoreIdleThreads: boolean | null;
  readonly threads: readonly HotThread[];
}

export interface HotThreadsReport {
  readonly nodes: readonly HotNode[];
  /** Lines that did not belong to any node or thread (kept for the raw view). */
  readonly unparsed: number;
}

/** A plain-language explanation of what a busy thread pool means. */
export interface PoolHint {
  readonly pool: string;
  readonly label: string;
  readonly text: string;
}

/** Load of one thread pool over the threads worth a look of a capture. */
export interface PoolLoad {
  readonly pool: string | null;
  readonly threads: number;
  /** Sum of the threads' percent (cpu, wait, block) or allocated bytes (mem). */
  readonly total: number;
  /** Load of the busiest thread. */
  readonly max: number;
  /** CPU part of the busiest thread's load (8.x cpu captures), else `null`. */
  readonly maxCpu: number | null;
  /** Sum of the CPU part when every thread reported the cpu/other split, else `null`. */
  readonly cpu: number | null;
  /** Sum of the runnable-off-CPU part, with the same rule. */
  readonly other: number | null;
  readonly nodes: readonly string[];
}

// ---- Thread pools -------------------------------------------------------------

/** One `_cat/thread_pool?format=json` row: every column is a string (or null). */
export interface RawThreadPoolRow {
  readonly node_id?: string | null;
  readonly node_name?: string | null;
  readonly name?: string | null;
  readonly type?: string | null;
  readonly active?: string | null;
  readonly queue?: string | null;
  readonly rejected?: string | null;
  readonly completed?: string | null;
  readonly size?: string | null;
  /** Scaling pools: minimum and maximum threads, and the threads alive now. */
  readonly core?: string | null;
  readonly max?: string | null;
  readonly pool_size?: string | null;
  readonly queue_size?: string | null;
}

export interface ThreadPoolRow {
  /** `<node id>/<pool>` (node names can repeat and survive restarts with new ids). */
  readonly key: string;
  readonly node: string;
  readonly pool: string;
  /** `fixed`, `scaling`, `fixed_auto_queue_size`… */
  readonly type: string;
  readonly active: number;
  readonly queue: number;
  readonly rejected: number;
  readonly completed: number;
  /** Thread capacity: the size of a fixed pool, the maximum of a scaling pool; `null` when not reported. */
  readonly size: number | null;
  /** Threads alive now (`pool_size`); scaling pools grow towards `size`. */
  readonly threads: number | null;
  /** Queue capacity; `null` for unbounded queues (`-1`). */
  readonly queueSize: number | null;
  readonly interesting: boolean;
}

export type ThreadPoolSortField = 'pool' | 'node' | 'active' | 'queue' | 'rejected' | 'completed';

export type QueueLevel = 'ok' | 'warn' | 'danger';

export interface ThreadPoolSummary {
  readonly active: number;
  readonly queued: number;
  readonly rejected: number;
  /** Pools whose bounded queue is at least half full. */
  readonly nearCapacity: number;
  /** Pools whose every thread is busy. */
  readonly saturated: number;
  /** Saturated pools with tasks waiting in their queue: the ones that matter. */
  readonly saturatedQueueing: number;
  readonly nodes: number;
}

// ---- Pending tasks ------------------------------------------------------------

export interface RawPendingTask {
  readonly insert_order?: number;
  readonly priority?: string;
  readonly source?: string;
  readonly executing?: boolean;
  readonly time_in_queue_millis?: number;
  readonly time_in_queue?: string;
}

export interface PendingTasksResponse {
  readonly tasks?: readonly RawPendingTask[];
}

export type PendingPriority = 'IMMEDIATE' | 'URGENT' | 'HIGH' | 'NORMAL' | 'LOW' | 'LANGUID';

export interface PendingTask {
  /** Position in Elasticsearch's answer: the order the master runs the queue in (8.x). */
  readonly position: number;
  /** `insert_order`: when the task was submitted (falls back to the position). */
  readonly order: number;
  /** Upper case as Elasticsearch prints it; unknown priorities are kept as is. */
  readonly priority: string;
  /** 0 (IMMEDIATE) … 5 (LANGUID), 6 for unknown. */
  readonly rank: number;
  readonly source: string;
  readonly executing: boolean;
  readonly timeInQueueMillis: number;
  readonly raw: RawPendingTask;
}

/** `queue` is the master's own order: executing first, then priority, then position. */
export type PendingSortField = 'queue' | 'priority' | 'time';

export interface PendingSummary {
  readonly total: number;
  readonly executing: number;
  readonly oldest: PendingTask | null;
  readonly urgent: number;
}

// ---- Slow logs ----------------------------------------------------------------

/** `performance/slowlog`: `{ index: { settings: { flat key: value } } }`. */
export type SlowlogResponse = Readonly<Record<string, { readonly settings?: Readonly<Record<string, unknown>> }>>;

export type SlowlogGroup = 'query' | 'fetch' | 'index';
export type SlowlogLevel = 'warn' | 'info' | 'debug' | 'trace';

/** Threshold values by group and level (`''` = not set). */
export type SlowlogThresholds = Readonly<Record<SlowlogGroup, Readonly<Record<SlowlogLevel, string>>>>;

export interface SlowlogIndex {
  readonly index: string;
  /** Explicitly set thresholds (`''` = not set). */
  readonly thresholds: SlowlogThresholds;
  /** Other slow log settings that are set (`index.indexing.slowlog.source` → `1000`). */
  readonly other: Readonly<Record<string, string>>;
  /** Every explicitly set slow log setting, flat. */
  readonly settings: Readonly<Record<string, string>>;
  /** Thresholds that log something (not `-1`). */
  readonly active: number;
  readonly preset: SlowlogPresetKey | 'custom' | null;
}

export type SlowlogPresetKey = 'off' | 'moderate' | 'aggressive';

export interface SlowlogPreset {
  readonly key: SlowlogPresetKey;
  readonly label: string;
  readonly description: string;
  readonly thresholds: SlowlogThresholds;
}

/** Tri-state choice for boolean settings: keep the default, or force a value. */
export type BooleanChoice = '' | 'true' | 'false';

/** The slow log editor form. */
export interface SlowlogForm {
  readonly thresholds: SlowlogThresholds;
  /** `index.indexing.slowlog.source`: `''` (default 1000), `false`, `true` or a number of characters. */
  readonly source: string;
  /** `index.indexing.slowlog.reformat`. */
  readonly reformat: BooleanChoice;
}

/** Field errors of the editor: `query.warn` → message, `source` → message. */
export type SlowlogErrors = Readonly<Record<string, string>>;
