/** Raw and view models of the tasks page. */

/** One entry of `GET _tasks?detailed=true&group_by=none`. */
export interface RawTask {
  readonly node: string;
  readonly id: number;
  readonly type: string;
  readonly action: string;
  readonly description?: string;
  readonly start_time_in_millis: number;
  readonly running_time_in_nanos: number;
  readonly cancellable: boolean;
  readonly cancelled?: boolean;
  readonly parent_task_id?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly status?: Readonly<Record<string, unknown>>;
}

export interface TasksResponse {
  readonly tasks?: readonly RawTask[];
}

/** Subset of the nodes endpoint used to name nodes. */
export interface TaskNode {
  readonly id: string;
  readonly name: string;
}

/** Progress of reindex / update by query / delete by query tasks. */
export interface TaskProgress {
  readonly total: number;
  readonly done: number;
  /** 0–100, `null` while the total is still unknown. */
  readonly percent: number | null;
  readonly created: number;
  readonly updated: number;
  readonly deleted: number;
  readonly noops: number;
  readonly versionConflicts: number;
  readonly batches: number;
  /** `null` when unthrottled (Elasticsearch reports -1 or Infinity). */
  readonly requestsPerSecond: number | null;
  readonly throttledUntilMillis: number | null;
  readonly slices: number | null;
}

export interface Task {
  /** `node:id`, the id used to cancel a task. */
  readonly key: string;
  readonly node: string;
  readonly nodeName: string;
  readonly id: number;
  readonly type: string;
  readonly action: string;
  readonly label: string;
  /** Scope marker of the action (`[n]` node, `[s]` shard …) as a word. */
  readonly scope: string | null;
  readonly description: string;
  readonly startTime: number;
  /** Running time when the list was loaded. */
  readonly runningMillis: number;
  readonly cancellable: boolean;
  readonly cancelled: boolean;
  readonly parentKey: string | null;
  readonly internal: boolean;
  readonly progress: TaskProgress | null;
  readonly raw: RawTask;
}

/** A task with the children that are present in the same listing. */
export interface TaskTreeNode {
  readonly task: Task;
  readonly children: readonly TaskTreeNode[];
}

export interface TaskFilter {
  readonly query: string;
  readonly hideInternal: boolean;
  readonly onlyCancellable: boolean;
}

export type TaskSortField = 'action' | 'node' | 'start' | 'running';

/** A row of the flattened, visible tree. */
export interface TaskRow {
  readonly task: Task;
  readonly depth: number;
  readonly childCount: number;
  readonly expanded: boolean;
}

export interface TaskSummary {
  readonly running: number;
  readonly cancellable: number;
  readonly longRunning: number;
  readonly longest: Task | null;
  readonly total: number;
}
