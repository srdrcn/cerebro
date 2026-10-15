import { humanize, textMatcher } from '../../core/format';
import {
  RawTask,
  Task,
  TaskFilter,
  TaskProgress,
  TaskRow,
  TaskSortField,
  TaskSummary,
  TaskTreeNode,
  TasksResponse,
} from './tasks.models';

/** Tasks running for longer than this are flagged as long running. */
export const LONG_RUNNING_MILLIS = 60_000;

const ACTION_LABELS: Readonly<Record<string, string>> = {
  'indices:data/write/reindex': 'Reindex',
  'indices:data/write/update/byquery': 'Update by query',
  'indices:data/write/delete/byquery': 'Delete by query',
  'indices:data/write/bulk': 'Bulk',
  'indices:data/write/index': 'Index document',
  'indices:data/write/update': 'Update document',
  'indices:data/write/delete': 'Delete document',
  'indices:data/read/search': 'Search',
  'indices:data/read/scroll': 'Scroll',
  'indices:data/read/msearch': 'Multi search',
  'indices:data/read/get': 'Get document',
  'indices:data/read/mget': 'Multi get',
  'indices:data/read/open_point_in_time': 'Open point in time',
  'indices:data/read/esql': 'ES|QL query',
  'indices:data/read/eql': 'EQL search',
  'indices:data/read/sql': 'SQL query',
  'indices:admin/forcemerge': 'Force merge',
  'indices:admin/refresh': 'Refresh',
  'indices:admin/flush': 'Flush',
  'indices:admin/cache/clear': 'Clear cache',
  'indices:admin/create': 'Create index',
  'indices:admin/delete': 'Delete index',
  'indices:admin/open': 'Open index',
  'indices:admin/close': 'Close index',
  'indices:admin/shrink': 'Shrink index',
  'indices:admin/split': 'Split index',
  'indices:admin/resize': 'Resize index',
  'indices:admin/rollover': 'Rollover',
  'indices:admin/mapping/put': 'Update mapping',
  'indices:admin/settings/update': 'Update settings',
  'indices:admin/aliases': 'Update aliases',
  'indices:admin/analyze': 'Analyze',
  'cluster:admin/snapshot/create': 'Create snapshot',
  'cluster:admin/snapshot/restore': 'Restore snapshot',
  'cluster:admin/snapshot/delete': 'Delete snapshot',
  'cluster:admin/snapshot/clone': 'Clone snapshot',
  'cluster:admin/reroute': 'Cluster reroute',
  'cluster:admin/settings/update': 'Update cluster settings',
  'cluster:monitor/tasks/lists': 'List tasks',
  'cluster:monitor/nodes/stats': 'Node stats',
  'cluster:monitor/nodes/info': 'Node info',
  'cluster:monitor/health': 'Cluster health',
  'cluster:monitor/state': 'Cluster state',
  'cluster:monitor/stats': 'Cluster stats',
  'indices:monitor/stats': 'Index stats',
  'indices:monitor/recovery': 'Recovery status',
  'indices:monitor/segments': 'Segments',
};

const SCOPES: Readonly<Record<string, string>> = {
  n: 'node',
  s: 'shard',
  p: 'primary',
  r: 'replica',
  f: 'fetch',
  m: 'merge',
};

/** Splits trailing scope markers: `indices:data/write/bulk[s][p]` → base + "primary". */
function splitAction(action: string): { base: string; scope: string | null } {
  const markers: string[] = [];
  let base = action;
  let match = /\[([a-z]+)\]$/i.exec(base);
  while (match) {
    markers.unshift(match[1] ?? '');
    base = base.slice(0, match.index);
    match = /\[([a-z]+)\]$/i.exec(base);
  }
  // `[c]` only marks the executor of a persistent task: not worth a badge.
  const last = markers.filter((marker) => marker.toLowerCase() !== 'c').pop();
  const scope = last === undefined ? null : (SCOPES[last.toLowerCase()] ?? last);
  return { base, scope };
}

/** Readable label of a transport action ("Reindex", "Health node", …). */
export function actionLabel(action: string): { label: string; scope: string | null } {
  const { base, scope } = splitAction(action);
  const known = ACTION_LABELS[base];
  if (known) {
    return { label: known, scope };
  }
  // `indices:admin/mapping/put` → "Mapping put"; persistent tasks have no prefix.
  const path = base.includes(':') ? base.slice(base.indexOf(':') + 1) : base;
  const segments = path.split('/').filter(Boolean);
  const meaningful = segments.length > 1 && ['admin', 'data', 'monitor', 'internal'].includes(segments[0] ?? '') ? segments.slice(1) : segments;
  const tail = meaningful.slice(-2).join(' ');
  return { label: humanize(tail || base), scope };
}

/** Persistent tasks every cluster runs on its own. */
const SYSTEM_PERSISTENT_TASKS = new Set(['health-node', 'geoip-downloader']);

/** Monitoring and internal plumbing the page hides by default. */
export function isInternalAction(action: string): boolean {
  return (
    SYSTEM_PERSISTENT_TASKS.has(splitAction(action).base) ||
    action.startsWith('cluster:monitor/') ||
    action.startsWith('indices:monitor/') ||
    action.startsWith('internal:') ||
    action.startsWith('cluster:internal/')
  );
}

const PROGRESS_ACTIONS = new Set([
  'indices:data/write/reindex',
  'indices:data/write/update/byquery',
  'indices:data/write/delete/byquery',
]);

function numberAt(source: Readonly<Record<string, unknown>>, key: string): number | null {
  const value = source[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Progress of by-query and reindex tasks from their bulk-by-scroll status. */
export function taskProgress(action: string, status: Readonly<Record<string, unknown>> | undefined): TaskProgress | null {
  if (!status || !PROGRESS_ACTIONS.has(splitAction(action).base)) {
    return null;
  }
  const total = numberAt(status, 'total');
  if (total === null) {
    return null;
  }
  const created = numberAt(status, 'created') ?? 0;
  const updated = numberAt(status, 'updated') ?? 0;
  const deleted = numberAt(status, 'deleted') ?? 0;
  const noops = numberAt(status, 'noops') ?? 0;
  const done = created + updated + deleted + noops;
  const rps = status['requests_per_second'];
  const requestsPerSecond = typeof rps === 'number' && Number.isFinite(rps) && rps > 0 ? rps : null;
  const throttledUntil = numberAt(status, 'throttled_until_millis');
  const slices = Array.isArray(status['slices']) ? status['slices'].length : null;
  return {
    total,
    done,
    percent: total > 0 ? Math.min(100, (done / total) * 100) : null,
    created,
    updated,
    deleted,
    noops,
    versionConflicts: numberAt(status, 'version_conflicts') ?? 0,
    batches: numberAt(status, 'batches') ?? 0,
    requestsPerSecond,
    throttledUntilMillis: throttledUntil && throttledUntil > 0 ? throttledUntil : null,
    slices,
  };
}

/** Raw listing → typed tasks with node names and readable labels. */
export function normalizeTasks(response: TasksResponse | null | undefined, nodeNames: ReadonlyMap<string, string>): Task[] {
  return (response?.tasks ?? []).map((raw: RawTask) => {
    const { label, scope } = actionLabel(raw.action);
    return {
      key: `${raw.node}:${raw.id}`,
      node: raw.node,
      nodeName: nodeNames.get(raw.node) ?? raw.node,
      id: raw.id,
      type: raw.type,
      action: raw.action,
      label,
      scope,
      description: raw.description ?? '',
      startTime: raw.start_time_in_millis,
      runningMillis: Math.max(0, raw.running_time_in_nanos / 1_000_000),
      cancellable: raw.cancellable === true,
      cancelled: raw.cancelled === true,
      parentKey: raw.parent_task_id ?? null,
      internal: isInternalAction(raw.action),
      progress: taskProgress(raw.action, raw.status),
      raw,
    };
  });
}

/** Nests tasks under their parent when the parent is in the same listing. */
export function buildTaskTree(tasks: readonly Task[]): TaskTreeNode[] {
  const byKey = new Map(tasks.map((task) => [task.key, task]));
  const children = new Map<string, Task[]>();
  const roots: Task[] = [];
  for (const task of tasks) {
    if (task.parentKey && task.parentKey !== task.key && byKey.has(task.parentKey)) {
      children.set(task.parentKey, [...(children.get(task.parentKey) ?? []), task]);
    } else {
      roots.push(task);
    }
  }
  const visiting = new Set<string>();
  const build = (task: Task): TaskTreeNode => {
    visiting.add(task.key);
    const nested = (children.get(task.key) ?? []).filter((child) => !visiting.has(child.key)).map(build);
    visiting.delete(task.key);
    return { task, children: nested };
  };
  return roots.map(build);
}

/** Compiles the search query once into a test for many tasks. */
export function taskQueryMatcher(query: string): (task: Task) => boolean {
  if (!query.trim()) {
    return () => true;
  }
  const matches = textMatcher(query);
  return (task) => [task.action, task.label, task.description, task.key, task.nodeName].some(matches);
}

function passesToggles(task: Task, filter: TaskFilter): boolean {
  return (!filter.hideInternal || !task.internal) && (!filter.onlyCancellable || task.cancellable);
}

/**
 * Keeps a task when it passes the filters or one of its descendants does.
 * A search match on a task keeps its sub-tasks (subject to the toggles), so
 * searching "reindex" still shows the reindex's bulk and search children.
 */
export function filterTaskTree(nodes: readonly TaskTreeNode[], filter: TaskFilter): TaskTreeNode[] {
  return filterTaskNodes(nodes, filter, taskQueryMatcher(filter.query), false);
}

function filterTaskNodes(
  nodes: readonly TaskTreeNode[],
  filter: TaskFilter,
  matches: (task: Task) => boolean,
  ancestorMatched: boolean,
): TaskTreeNode[] {
  const result: TaskTreeNode[] = [];
  for (const node of nodes) {
    const searchMatch = ancestorMatched || matches(node.task);
    const children = filterTaskNodes(node.children, filter, matches, searchMatch);
    if ((searchMatch && passesToggles(node.task, filter)) || children.length > 0) {
      result.push({ task: node.task, children });
    }
  }
  return result;
}

function compareTasks(left: Task, right: Task, field: TaskSortField): number {
  switch (field) {
    case 'action':
      return left.label.localeCompare(right.label) || left.action.localeCompare(right.action);
    case 'node':
      return left.nodeName.localeCompare(right.nodeName);
    case 'start':
      return left.startTime - right.startTime;
    case 'running':
      return left.runningMillis - right.runningMillis;
  }
}

/** Sorts the roots; sub-tasks always follow their start order. */
export function sortTaskTree(nodes: readonly TaskTreeNode[], field: TaskSortField, reverse: boolean): TaskTreeNode[] {
  const direction = reverse ? -1 : 1;
  const sortChildren = (node: TaskTreeNode): TaskTreeNode => ({
    task: node.task,
    children: [...node.children]
      .sort((left, right) => compareTasks(left.task, right.task, 'start') || left.task.key.localeCompare(right.task.key))
      .map(sortChildren),
  });
  return [...nodes]
    .sort((left, right) => direction * compareTasks(left.task, right.task, field) || left.task.key.localeCompare(right.task.key))
    .map(sortChildren);
}

/** Flattens the tree into table rows, skipping collapsed sub-trees. */
export function flattenTaskTree(nodes: readonly TaskTreeNode[], collapsed: ReadonlySet<string>, depth = 0): TaskRow[] {
  return nodes.flatMap((node) => {
    const expanded = !collapsed.has(node.task.key);
    const row: TaskRow = { task: node.task, depth, childCount: countDescendants(node), expanded };
    return expanded ? [row, ...flattenTaskTree(node.children, collapsed, depth + 1)] : [row];
  });
}

export function countDescendants(node: TaskTreeNode): number {
  return node.children.reduce((sum, child) => sum + 1 + countDescendants(child), 0);
}

/** Wait this long before asking for node names again after a failed lookup. */
export const NODE_LOOKUP_BACKOFF_MILLIS = 60_000;

/**
 * Whether the (heavy) nodes call is worth making: only for node ids never
 * looked up before, or once the back-off after a failed lookup has passed.
 * Ids a successful lookup did not know (a node that left) are not retried.
 */
export function shouldLookUpNodes(
  unknownIds: Iterable<string>,
  requested: ReadonlySet<string>,
  failedAt: number | null,
  now: number,
  backoffMillis = NODE_LOOKUP_BACKOFF_MILLIS,
): boolean {
  const ids = [...unknownIds];
  if (ids.length === 0) {
    return false;
  }
  if (failedAt !== null) {
    return now - failedAt >= backoffMillis;
  }
  return ids.some((id) => !requested.has(id));
}

/** Running time, advanced by the time elapsed since the list was loaded. */
export function liveRunningMillis(task: Task, loadedAt: number, now: number): number {
  return task.runningMillis + Math.max(0, now - loadedAt);
}

/**
 * Tiles: counts over the tasks the "hide internal" toggle keeps. `elapsedMillis`
 * (time since the list was loaded) keeps the long-running count and the longest
 * task in step with the ticking running times shown in the table.
 */
export function summarizeTasks(tasks: readonly Task[], hideInternal: boolean, elapsedMillis = 0): TaskSummary {
  const elapsed = Math.max(0, elapsedMillis);
  const relevant = tasks.filter((task) => !hideInternal || !task.internal);
  const longest = relevant.reduce<Task | null>(
    (best, task) => (best === null || task.runningMillis > best.runningMillis ? task : best),
    null,
  );
  return {
    running: relevant.length,
    cancellable: relevant.filter((task) => task.cancellable && !task.cancelled).length,
    longRunning: relevant.filter((task) => task.runningMillis + elapsed >= LONG_RUNNING_MILLIS).length,
    longest,
    total: tasks.length,
  };
}

/** Built-in tasks Elasticsearch runs (and usually restarts) on its own. */
export function isSystemTask(task: Task): boolean {
  return task.internal || task.type === 'persistent';
}

export const SYSTEM_TASK_WARNING =
  'This is a built-in Elasticsearch task. It is usually restarted automatically, and cancelling it can interrupt cluster features such as health reporting or GeoIP updates.';

/** "Cancel task Reindex?" message describing what cancelling keeps. */
export function cancelMessage(task: Task): string {
  const subject = task.description ? `${task.description}. ` : '';
  const kept = task.progress
    ? 'Documents already processed are kept; the rest of the operation is skipped.'
    : 'Elasticsearch stops the task at its next checkpoint; work already done is kept.';
  const warning = isSystemTask(task) ? ` ${SYSTEM_TASK_WARNING}` : '';
  return `${subject}${kept}${warning}`;
}
