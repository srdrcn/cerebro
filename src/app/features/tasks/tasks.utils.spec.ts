import { describe, expect, it } from 'vitest';
import { RawTask, Task, TaskFilter } from './tasks.models';
import {
  LONG_RUNNING_MILLIS,
  actionLabel,
  buildTaskTree,
  cancelFailure,
  cancelMessage,
  countDescendants,
  isSystemTask,
  filterTaskTree,
  flattenTaskTree,
  isInternalAction,
  liveRunningMillis,
  matchesTaskQuery,
  normalizeTasks,
  shouldLookUpNodes,
  sortTaskTree,
  summarizeTasks,
  taskProgress,
} from './tasks.utils';

function raw(overrides: Partial<RawTask> = {}): RawTask {
  return {
    node: 'n1',
    id: 1,
    type: 'transport',
    action: 'indices:data/write/reindex',
    description: 'reindex from [a] to [b]',
    start_time_in_millis: 1_000,
    running_time_in_nanos: 5_000_000_000,
    cancellable: true,
    cancelled: false,
    headers: {},
    ...overrides,
  };
}

const names = new Map([
  ['n1', 'es-node-1'],
  ['n2', 'es-node-2'],
]);

function tasks(...entries: Partial<RawTask>[]): Task[] {
  return normalizeTasks({ tasks: entries.map((entry) => raw(entry)) }, names);
}

const ALL: TaskFilter = { query: '', hideInternal: false, onlyCancellable: false };

describe('action labels', () => {
  it('uses readable names for well known actions', () => {
    expect(actionLabel('indices:data/write/reindex')).toEqual({ label: 'Reindex', scope: null });
    expect(actionLabel('indices:data/write/update/byquery')).toEqual({ label: 'Update by query', scope: null });
    expect(actionLabel('indices:admin/forcemerge')).toEqual({ label: 'Force merge', scope: null });
  });

  it('turns scope markers into words', () => {
    expect(actionLabel('indices:data/write/bulk[s]')).toEqual({ label: 'Bulk', scope: 'shard' });
    expect(actionLabel('indices:data/write/bulk[s][p]')).toEqual({ label: 'Bulk', scope: 'primary' });
    expect(actionLabel('cluster:monitor/tasks/lists[n]')).toEqual({ label: 'List tasks', scope: 'node' });
    expect(actionLabel('health-node[c]')).toEqual({ label: 'Health node', scope: null });
  });

  it('derives a label for unknown actions', () => {
    expect(actionLabel('indices:admin/data_stream/lifecycle/explain').label).toBe('Lifecycle explain');
    expect(actionLabel('cluster:admin/xpack/ml/job/open').label).toBe('Job open');
    expect(actionLabel('publish_cluster_state_update').label).toBe('Publish cluster state update');
  });

  it('flags monitoring and internal actions', () => {
    expect(isInternalAction('cluster:monitor/tasks/lists')).toBe(true);
    expect(isInternalAction('cluster:monitor/nodes/stats[n]')).toBe(true);
    expect(isInternalAction('indices:monitor/stats')).toBe(true);
    expect(isInternalAction('internal:cluster/coordination/join')).toBe(true);
    expect(isInternalAction('health-node[c]')).toBe(true);
    expect(isInternalAction('indices:data/write/reindex')).toBe(false);
    expect(isInternalAction('indices:admin/forcemerge')).toBe(false);
  });
});

describe('task progress', () => {
  it('computes progress of reindex-like tasks', () => {
    const progress = taskProgress('indices:data/write/reindex', {
      total: 1000,
      created: 200,
      updated: 50,
      deleted: 0,
      noops: 50,
      batches: 3,
      version_conflicts: 2,
      requests_per_second: 1,
      throttled_until_millis: 400,
    });
    expect(progress).toEqual({
      total: 1000,
      done: 300,
      percent: 30,
      created: 200,
      updated: 50,
      deleted: 0,
      noops: 50,
      versionConflicts: 2,
      batches: 3,
      requestsPerSecond: 1,
      throttledUntilMillis: 400,
      slices: null,
    });
  });

  it('treats -1 requests per second as unthrottled and handles unknown totals', () => {
    expect(taskProgress('indices:data/write/delete/byquery', { total: 0, deleted: 0, requests_per_second: -1 })).toMatchObject({
      percent: null,
      requestsPerSecond: null,
      throttledUntilMillis: null,
    });
    expect(taskProgress('indices:data/write/update/byquery', { total: 10, updated: 20, slices: [{}, {}] })).toMatchObject({
      percent: 100,
      slices: 2,
    });
  });

  it('ignores other actions and missing totals', () => {
    expect(taskProgress('indices:admin/forcemerge', { total: 10 })).toBeNull();
    expect(taskProgress('indices:data/write/reindex', { state: 'x' })).toBeNull();
    expect(taskProgress('indices:data/write/reindex', undefined)).toBeNull();
  });
});

describe('normalizeTasks', () => {
  it('builds keys, node names and running time in milliseconds', () => {
    const [task] = tasks({ node: 'n2', id: 7, parent_task_id: 'n1:3', cancelled: true });
    expect(task).toMatchObject({
      key: 'n2:7',
      nodeName: 'es-node-2',
      label: 'Reindex',
      runningMillis: 5_000,
      cancellable: true,
      cancelled: true,
      parentKey: 'n1:3',
      internal: false,
      description: 'reindex from [a] to [b]',
    });
  });

  it('falls back to the node id and tolerates missing fields', () => {
    const [task] = normalizeTasks(
      { tasks: [{ ...raw({ node: 'zz' }), description: undefined, cancelled: undefined }] },
      names,
    );
    expect(task?.nodeName).toBe('zz');
    expect(task?.description).toBe('');
    expect(task?.cancelled).toBe(false);
    expect(normalizeTasks(undefined, names)).toEqual([]);
    expect(normalizeTasks({}, names)).toEqual([]);
  });
});

describe('task tree', () => {
  const list = tasks(
    { id: 1, action: 'indices:data/write/reindex', running_time_in_nanos: 90_000_000_000 },
    { id: 2, action: 'indices:data/write/bulk', parent_task_id: 'n1:1', start_time_in_millis: 3_000, cancellable: false },
    { id: 3, action: 'indices:data/read/search', parent_task_id: 'n1:1', start_time_in_millis: 2_000, cancellable: false },
    { id: 4, action: 'indices:data/write/bulk[s]', parent_task_id: 'n1:2', node: 'n2', cancellable: false },
    { id: 5, action: 'cluster:monitor/tasks/lists', description: '', running_time_in_nanos: 1_000_000 },
    { id: 6, action: 'cluster:monitor/tasks/lists[n]', parent_task_id: 'n1:5', description: '' },
    { id: 7, action: 'health-node[c]', type: 'persistent', parent_task_id: 'cluster:3', description: 'id=health-node' },
  );

  it('nests tasks under parents present in the listing', () => {
    const tree = buildTaskTree(list);
    expect(tree.map((node) => node.task.id)).toEqual([1, 5, 7]);
    expect(tree[0]?.children.map((node) => node.task.id)).toEqual([2, 3]);
    expect(tree[0]?.children[0]?.children.map((node) => node.task.id)).toEqual([4]);
    expect(tree[0] && countDescendants(tree[0])).toBe(3);
  });

  it('survives parent cycles', () => {
    const cyclic = tasks({ id: 1, parent_task_id: 'n1:2' }, { id: 2, parent_task_id: 'n1:1' }, { id: 3, parent_task_id: 'n1:3' });
    const tree = buildTaskTree(cyclic);
    expect(tree.map((node) => node.task.id)).toEqual([3]);
  });

  it('hides internal tasks and keeps parents of matching children', () => {
    const tree = filterTaskTree(buildTaskTree(list), { ...ALL, hideInternal: true });
    expect(tree.map((node) => node.task.id)).toEqual([1]);
    const cancellable = filterTaskTree(buildTaskTree(list), { ...ALL, onlyCancellable: true });
    expect(cancellable.map((node) => node.task.id)).toEqual([1, 5, 7]);
    expect(cancellable[0]?.children).toEqual([]);
  });

  it('keeps the sub-tasks of a search match and the ancestors of a matching sub-task', () => {
    const byParent = filterTaskTree(buildTaskTree(list), { ...ALL, query: 'reindex' });
    expect(byParent.map((node) => node.task.id)).toEqual([1]);
    expect(byParent[0]?.children.map((node) => node.task.id)).toEqual([2, 3]);
    const byChild = filterTaskTree(buildTaskTree(list), { ...ALL, query: 'search' });
    expect(byChild.map((node) => node.task.id)).toEqual([1]);
    expect(byChild[0]?.children.map((node) => node.task.id)).toEqual([3]);
  });

  it('matches action, label, description, id and node name', () => {
    const [task] = list;
    expect(task && matchesTaskQuery(task, 'Reindex')).toBe(true);
    expect(task && matchesTaskQuery(task, 'write/reindex')).toBe(true);
    expect(task && matchesTaskQuery(task, '[a]')).toBe(true);
    expect(task && matchesTaskQuery(task, 'n1:1')).toBe(true);
    expect(task && matchesTaskQuery(task, 'es-node-1')).toBe(true);
    expect(task && matchesTaskQuery(task, 'snapshot')).toBe(false);
  });

  it('sorts roots by the chosen column and children by start time', () => {
    const tree = sortTaskTree(buildTaskTree(list), 'running', true);
    expect(tree.map((node) => node.task.id)).toEqual([1, 7, 5]);
    expect(tree[0]?.children.map((node) => node.task.id)).toEqual([3, 2]);
    expect(sortTaskTree(buildTaskTree(list), 'action', false).map((node) => node.task.label)).toEqual([
      'Health node',
      'List tasks',
      'Reindex',
    ]);
    expect(sortTaskTree(buildTaskTree(list), 'node', false).map((node) => node.task.id)).toEqual([1, 5, 7]);
  });

  it('flattens the tree and skips collapsed sub-trees', () => {
    const tree = sortTaskTree(buildTaskTree(list), 'running', true);
    const rows = flattenTaskTree(tree, new Set());
    expect(rows.map((row) => [row.task.id, row.depth])).toEqual([
      [1, 0],
      [3, 1],
      [2, 1],
      [4, 2],
      [7, 0],
      [5, 0],
      [6, 1],
    ]);
    const collapsed = flattenTaskTree(tree, new Set(['n1:1']));
    expect(collapsed.map((row) => row.task.id)).toEqual([1, 7, 5, 6]);
    expect(collapsed[0]).toMatchObject({ expanded: false, childCount: 3 });
  });
});

describe('summary and timing', () => {
  it('summarises the tasks the internal toggle keeps', () => {
    const list = tasks(
      { id: 1, running_time_in_nanos: (LONG_RUNNING_MILLIS + 1) * 1_000_000 },
      { id: 2, cancellable: false, running_time_in_nanos: 1_000_000 },
      { id: 3, cancelled: true },
      { id: 4, action: 'cluster:monitor/tasks/lists', running_time_in_nanos: 10 * LONG_RUNNING_MILLIS * 1_000_000 },
    );
    expect(summarizeTasks(list, true)).toMatchObject({ running: 3, cancellable: 1, longRunning: 1, total: 4 });
    expect(summarizeTasks(list, true).longest?.id).toBe(1);
    expect(summarizeTasks(list, false)).toMatchObject({ running: 4, longRunning: 2 });
    expect(summarizeTasks([], true).longest).toBeNull();
  });

  it('counts tasks that crossed the long-running threshold since the list was loaded', () => {
    const list = tasks(
      { id: 1, running_time_in_nanos: (LONG_RUNNING_MILLIS - 5_000) * 1_000_000 },
      { id: 2, running_time_in_nanos: 1_000_000_000 },
    );
    expect(summarizeTasks(list, true).longRunning).toBe(0);
    expect(summarizeTasks(list, true, 4_999).longRunning).toBe(0);
    expect(summarizeTasks(list, true, 5_000).longRunning).toBe(1);
    expect(summarizeTasks(list, true, -10_000).longRunning).toBe(0);
    expect(summarizeTasks(list, true, 5_000).longest?.id).toBe(1);
  });

  it('advances the running time while the list is on screen', () => {
    const [task] = tasks({ running_time_in_nanos: 2_000_000_000 });
    expect(task && liveRunningMillis(task, 10_000, 13_000)).toBe(5_000);
    expect(task && liveRunningMillis(task, 10_000, 9_000)).toBe(2_000);
  });
});

describe('node name lookups', () => {
  it('looks up node names only for new ids or after the failure back-off', () => {
    const none = new Set<string>();
    expect(shouldLookUpNodes([], none, null, 0)).toBe(false);
    expect(shouldLookUpNodes(['n1'], none, null, 0)).toBe(true);
    expect(shouldLookUpNodes(['n1'], new Set(['n1']), null, 0)).toBe(false);
    expect(shouldLookUpNodes(['n1', 'n2'], new Set(['n1']), null, 0)).toBe(true);
    expect(shouldLookUpNodes(['n1'], new Set(['n1']), 1_000, 30_000)).toBe(false);
    expect(shouldLookUpNodes(['n2'], new Set(['n1']), 1_000, 30_000)).toBe(false);
    expect(shouldLookUpNodes(['n1'], new Set(['n1']), 1_000, 61_000)).toBe(true);
    expect(shouldLookUpNodes(['n1'], new Set(['n1']), 1_000, 6_000, 5_000)).toBe(true);
  });
});

describe('errors and cancellation', () => {
  it('detects failures reported inside a 200 cancel response', () => {
    expect(cancelFailure({ nodes: {} })).toBeNull();
    expect(cancelFailure({ node_failures: [], task_failures: [] })).toBeNull();
    expect(
      cancelFailure({ task_failures: [{ task_id: 9, reason: { type: 'illegal_argument_exception', reason: 'task is not cancellable' } }] }),
    ).toBe('Task is not cancellable');
    expect(cancelFailure({ node_failures: [{ type: 'failed_node_exception', caused_by: { reason: 'node left' } }] })).toBe('Node left');
    expect(cancelFailure({ node_failures: [{}] })).toBe('Elasticsearch reported a failure while cancelling the task.');
    expect(cancelFailure('nope')).toBeNull();
  });

  it('explains what cancelling keeps', () => {
    const [reindex, merge] = tasks({ status: { total: 10 } }, { action: 'indices:admin/forcemerge', description: '' });
    expect(reindex && cancelMessage(reindex)).toBe(
      'reindex from [a] to [b]. Documents already processed are kept; the rest of the operation is skipped.',
    );
    expect(merge && cancelMessage(merge)).toBe('Elasticsearch stops the task at its next checkpoint; work already done is kept.');
  });

  it('warns before cancelling built-in persistent and monitoring tasks', () => {
    const [health, monitor, reindex] = tasks(
      { action: 'health-node[c]', type: 'persistent', description: 'id=health-node' },
      { action: 'cluster:monitor/nodes/stats[n]', description: '' },
      {},
    );
    expect(health && isSystemTask(health)).toBe(true);
    expect(monitor && isSystemTask(monitor)).toBe(true);
    expect(reindex && isSystemTask(reindex)).toBe(false);
    expect(health && cancelMessage(health)).toBe(
      'id=health-node. Elasticsearch stops the task at its next checkpoint; work already done is kept. ' +
        'This is a built-in Elasticsearch task. It is usually restarted automatically, and cancelling it can interrupt ' +
        'cluster features such as health reporting or GeoIP updates.',
    );
    expect(monitor && cancelMessage(monitor)).toContain('built-in Elasticsearch task');
    expect(reindex && cancelMessage(reindex)).not.toContain('built-in');
  });
});
