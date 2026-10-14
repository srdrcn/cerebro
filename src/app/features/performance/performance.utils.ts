import { formatNumber, humanize, pluralize, textMatcher } from '../../core/format';
import { isRecord } from '../../core/json';
import {
  FrameKind,
  HotNode,
  HotThread,
  HotThreadsRequest,
  HotThreadsReport,
  HotThreadsType,
  PendingSortField,
  PendingSummary,
  PendingTask,
  PendingTasksResponse,
  PerformanceTab,
  RawPendingTask,
  PerformanceTabDefinition,
  PoolHint,
  QueueLevel,
  RawThreadPoolRow,
  SlowlogErrors,
  SlowlogForm,
  SlowlogGroup,
  SlowlogIndex,
  SlowlogLevel,
  SlowlogPreset,
  SlowlogPresetKey,
  SlowlogResponse,
  SlowlogThresholds,
  PoolLoad,
  StackFrame,
  StackGroup,
  StackKind,
  ThreadPoolRow,
  ThreadPoolSortField,
  ThreadPoolSummary,
} from './performance.models';

// ==== Tabs ======================================================================

export const PERFORMANCE_TABS: readonly PerformanceTabDefinition[] = [
  { key: 'hot-threads', label: 'Hot threads', icon: 'bi-fire' },
  { key: 'thread-pools', label: 'Thread pools', icon: 'bi-cpu' },
  { key: 'pending-tasks', label: 'Pending tasks', icon: 'bi-hourglass-split' },
  { key: 'slow-logs', label: 'Slow logs', icon: 'bi-stopwatch' },
];

export const DEFAULT_TAB: PerformanceTab = 'hot-threads';

export function parseTab(value: string | null | undefined): PerformanceTab {
  return PERFORMANCE_TABS.find((tab) => tab.key === value)?.key ?? DEFAULT_TAB;
}

/** Arrow / Home / End navigation between tabs (wraps around). */
export function nextTab(current: PerformanceTab, key: string): PerformanceTab | null {
  const index = PERFORMANCE_TABS.findIndex((tab) => tab.key === current);
  const last = PERFORMANCE_TABS.length - 1;
  let next: number;
  switch (key) {
    case 'ArrowRight':
      next = index >= last ? 0 : index + 1;
      break;
    case 'ArrowLeft':
      next = index <= 0 ? last : index - 1;
      break;
    case 'Home':
      next = 0;
      break;
    case 'End':
      next = last;
      break;
    default:
      return null;
  }
  return PERFORMANCE_TABS[next]?.key ?? null;
}

// ==== Hot threads ===============================================================

export const HOT_THREAD_TYPES: readonly { readonly key: HotThreadsType; readonly label: string; readonly hint: string }[] = [
  { key: 'cpu', label: 'CPU', hint: 'Threads that used the most CPU time' },
  { key: 'wait', label: 'Wait', hint: 'Threads that spent the most time waiting (parked or sleeping)' },
  { key: 'block', label: 'Block', hint: 'Threads that spent the most time blocked on a lock' },
  { key: 'mem', label: 'Memory', hint: 'Threads that allocated the most memory (Elasticsearch 8.x)' },
];

export const HOT_THREAD_INTERVALS: readonly string[] = ['500ms', '1s', '2s', '5s'];

export const DEFAULT_HOT_THREADS_REQUEST: HotThreadsRequest = {
  node: '',
  type: 'cpu',
  threads: 3,
  interval: '500ms',
  ignoreIdleThreads: true,
};

export const MIN_THREADS = 1;
export const MAX_THREADS = 50;

/** A thread under this share of the interval is not "busy" (cpu) or "blocked" (block). */
export const BUSY_PERCENT = 5;

/**
 * Snapshots Elasticsearch takes per capture (the `snapshots` parameter,
 * which the backend leaves at its default). The total of a thread that only
 * printed unique snapshots.
 */
export const HOT_THREADS_SNAPSHOTS = 10;

/** Auto-capture when the tab opens only up to this many nodes (each node is sampled). */
export const AUTO_CAPTURE_MAX_NODES = 10;

/** Number of frames a collapsed stack shows. */
export const COLLAPSED_FRAMES = 8;

/** Error of the "threads" field, or `null` when it is a whole number from 1 to 50. */
export function validateThreads(value: unknown): string | null {
  const text = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : '';
  if (text === '') {
    return 'Enter how many threads to show per node';
  }
  if (!/^\d+$/.test(text)) {
    return `Enter a whole number from ${MIN_THREADS} to ${MAX_THREADS}`;
  }
  const threads = Number(text);
  return threads < MIN_THREADS || threads > MAX_THREADS ? `Enter a whole number from ${MIN_THREADS} to ${MAX_THREADS}` : null;
}

/** Payload of `performance/hot_threads`. */
export function hotThreadsPayload(request: HotThreadsRequest): Record<string, unknown> {
  return {
    ...(request.node ? { node: request.node } : {}),
    threads: request.threads,
    interval: request.interval,
    type: request.type,
    ignore_idle_threads: request.ignoreIdleThreads,
  };
}

const NODE_HEADER = /^:::\s*(.*)$/;
const CAPTURE_HEADER =
  /^\s*Hot threads at (\S+?),\s*interval=([^,]+),\s*busiestThreads=(\d+),\s*ignoreIdleThreads=(true|false)/;
/**
 * `90.9% [cpu=6.9%, other=84.0%] (909ms out of 1s) cpu usage by thread '…'`;
 * 8.x prints network threads as `[cpu=0.1%, idle=99.9%]`, 7.x has no split.
 */
const USAGE_LINE =
  /^\s*(\d+(?:\.\d+)?)%\s+(?:\[cpu=(\d+(?:\.\d+)?)%,\s*(other|idle)=(\d+(?:\.\d+)?)%\]\s+)?\((.+?)\)\s+(\w+)\s+usage by thread '(.*)'\s*$/;
/** Any other line that announces a thread, so a format change never merges two threads. */
const LOOSE_USAGE_LINE = /^\s*(\d+(?:\.\d+)?)%.*?\b(cpu|wait|block)\s+usage by thread '(.*)'\s*$/;
const MEMORY_LINE = /^\s*(\d+(?:\.\d+)?)\s*(b|kb|mb|gb|tb|pb)\s+memory allocated by thread '(.*)'\s*$/i;
const SHARED_GROUP = /^\s*(\d+)\/(\d+) snapshots sharing following (\d+) elements\s*$/;
const UNIQUE_GROUP = /^\s*unique snapshot\s*$/;

const BYTE_FACTORS: Readonly<Record<string, number>> = {
  b: 1,
  kb: 1024,
  mb: 1024 ** 2,
  gb: 1024 ** 3,
  tb: 1024 ** 4,
  pb: 1024 ** 5,
};

interface ThreadDraft {
  name: string;
  type: HotThreadsType;
  percent: number | null;
  cpuPercent: number | null;
  otherPercent: number | null;
  idlePercent: number | null;
  usage: string | null;
  allocatedBytes: number | null;
  groups: { snapshots: number; total: number | null; unique: boolean; frames: StackFrame[] }[];
}

interface NodeDraft {
  name: string;
  id: string;
  address: string | null;
  capturedAt: number | null;
  interval: string | null;
  busiestThreads: number | null;
  ignoreIdleThreads: boolean | null;
  threads: ThreadDraft[];
}

/**
 * Parses the plain text of `_nodes/hot_threads` into nodes and their threads,
 * keeping the order Elasticsearch printed (busiest first). Works with the 7.x
 * format (no cpu/other split) and the 8.x one, for cpu, wait, block and
 * memory captures. Lines it does not recognise are counted in `unparsed`.
 */
export function parseHotThreads(text: string): HotThreadsReport {
  const nodes: NodeDraft[] = [];
  let node: NodeDraft | undefined;
  let thread: ThreadDraft | undefined;
  let unparsed = 0;

  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === '') {
      continue;
    }
    const header = NODE_HEADER.exec(line);
    if (header) {
      node = nodeFromHeader(header[1] ?? '');
      nodes.push(node);
      thread = undefined;
      continue;
    }
    const capture = CAPTURE_HEADER.exec(line);
    if (capture && node) {
      const time = Date.parse(capture[1] ?? '');
      node.capturedAt = Number.isFinite(time) ? time : null;
      node.interval = capture[2]?.trim() ?? null;
      node.busiestThreads = Number(capture[3]);
      node.ignoreIdleThreads = capture[4] === 'true';
      continue;
    }
    const usage = USAGE_LINE.exec(line);
    if (usage && node) {
      const split = usage[2] === undefined ? null : { cpu: Number(usage[2]), label: usage[3], rest: Number(usage[4]) };
      thread = {
        name: usage[7] ?? '',
        type: threadsType(usage[6]),
        percent: Number(usage[1]),
        cpuPercent: split ? split.cpu : null,
        otherPercent: split && split.label === 'other' ? split.rest : null,
        idlePercent: split && split.label === 'idle' ? split.rest : null,
        // Network threads count idle time in "(500ms out of 500ms)": it is not their load.
        usage: split?.label === 'idle' ? null : (usage[5]?.trim() ?? null),
        allocatedBytes: null,
        groups: [],
      };
      node.threads.push(thread);
      continue;
    }
    const loose = LOOSE_USAGE_LINE.exec(line);
    if (loose && node) {
      thread = {
        name: loose[3] ?? '',
        type: threadsType(loose[2]),
        percent: Number(loose[1]),
        cpuPercent: null,
        otherPercent: null,
        idlePercent: null,
        usage: null,
        allocatedBytes: null,
        groups: [],
      };
      node.threads.push(thread);
      continue;
    }
    const memory = MEMORY_LINE.exec(line);
    if (memory && node) {
      const factor = BYTE_FACTORS[(memory[2] ?? 'b').toLowerCase()] ?? 1;
      thread = {
        name: memory[3] ?? '',
        type: 'mem',
        percent: null,
        cpuPercent: null,
        otherPercent: null,
        idlePercent: null,
        usage: null,
        allocatedBytes: Math.round(Number(memory[1]) * factor),
        groups: [],
      };
      node.threads.push(thread);
      continue;
    }
    const shared = SHARED_GROUP.exec(line);
    if (shared && thread) {
      thread.groups.push({ snapshots: Number(shared[1]), total: Number(shared[2]), unique: false, frames: [] });
      continue;
    }
    if (UNIQUE_GROUP.test(line) && thread) {
      thread.groups.push({ snapshots: 1, total: null, unique: true, frames: [] });
      continue;
    }
    const group = thread?.groups[thread.groups.length - 1];
    if (group) {
      group.frames.push(parseFrame(line));
      continue;
    }
    unparsed++;
  }

  return {
    nodes: nodes.map((draft) => ({
      name: draft.name,
      id: draft.id,
      address: draft.address,
      capturedAt: draft.capturedAt,
      interval: draft.interval,
      busiestThreads: draft.busiestThreads,
      ignoreIdleThreads: draft.ignoreIdleThreads,
      threads: draft.threads.map((item, index) => finishThread(item, `${draft.id || draft.name}/${index}`)),
    })),
    unparsed,
  };
}

function threadsType(value: string | undefined): HotThreadsType {
  return value === 'wait' || value === 'block' || value === 'mem' ? value : 'cpu';
}

function nodeFromHeader(header: string): NodeDraft {
  const parts = [...header.matchAll(/\{([^{}]*)\}/g)].map((match) => match[1] ?? '');
  const address = parts.slice(2).find((part) => /^[^\s=,]+:\d+$/.test(part)) ?? null;
  return {
    name: parts[0] || header.trim(),
    id: parts[1] ?? '',
    address,
    capturedAt: null,
    interval: null,
    busiestThreads: null,
    ignoreIdleThreads: null,
    threads: [],
  };
}

const KIND_ORDER: Readonly<Record<StackKind, number>> = { work: 0, base: 1, idle: 2 };

function finishThread(draft: ThreadDraft, key: string): HotThread {
  const sharedTotals = draft.groups.filter((group) => !group.unique).map((group) => group.total ?? 0);
  const snapshotSum = draft.groups.reduce((sum, group) => sum + group.snapshots, 0);
  // Unique snapshots carry no total: they belong to the same capture as the shared ones.
  const total = sharedTotals.length > 0 ? Math.max(...sharedTotals) : Math.max(HOT_THREADS_SNAPSHOTS, snapshotSum);
  // Stacks doing work first, most frequent first (stable for ties); then the
  // ones sharing only executor frames, then the idle ones.
  const groups: StackGroup[] = draft.groups
    .map((group) => ({
      snapshots: group.snapshots,
      total: group.total ?? total,
      unique: group.unique,
      kind: stackKind(group.frames),
      frames: group.frames,
    }))
    .sort(
      (left, right) =>
        KIND_ORDER[left.kind] - KIND_ORDER[right.kind] ||
        right.snapshots - left.snapshots ||
        Number(hasTellingFrame(right.frames)) - Number(hasTellingFrame(left.frames)),
    );
  const { pool, worker } = threadPoolOf(draft.name);
  const focus = focusFrame(groups);
  return {
    key,
    name: draft.name,
    pool,
    worker,
    type: draft.type,
    percent: draft.percent,
    cpuPercent: draft.cpuPercent,
    otherPercent: draft.otherPercent,
    idlePercent: draft.idlePercent,
    usage: draft.usage,
    allocatedBytes: draft.allocatedBytes,
    groups,
    focus: focus?.frame ?? null,
    focusGroup: focus?.group ?? null,
    idle: groups.length > 0 && groups.every((group) => group.kind === 'idle'),
  };
}

/**
 * Thread pool and worker of a thread name:
 * `elasticsearch[es-node-1][search][T#3]` → `search` / `T#3`,
 * `elasticsearch[n][[logs][0]: Lucene Merge Thread #4]` → `merge` / `#4`,
 * `elasticsearch[n][[timer]]` → `timer`. Threads outside pools give `null`.
 */
export function threadPoolOf(name: string): { readonly pool: string | null; readonly worker: string | null } {
  if (/Lucene Merge Thread/i.test(name)) {
    return { pool: 'merge', worker: /#(\d+)/.exec(name)?.[0] ?? null };
  }
  const match = /^elasticsearch\[[^\]]*\]\[(\[?[^\]]+)\]\]?(?:\[([^\]]+)\])?/.exec(name);
  if (!match) {
    return { pool: null, worker: null };
  }
  return { pool: (match[1] ?? '').replace(/^\[/, '') || null, worker: match[2] ?? null };
}

/** Parses one stack frame line such as `app/org.elasticsearch.server@8.15.3/org.elasticsearch.X.run(X.java:12)`. */
export function parseFrame(line: string): StackFrame {
  const raw = line.trim();
  let rest = raw.replace(/^app\//, '');
  let module = '';
  const versioned = /^([\w.$-]+@[^/\s]+)\//.exec(rest) ?? /^((?:java|jdk)\.[\w.]+)\//.exec(rest);
  if (versioned) {
    module = versioned[1] ?? '';
    rest = rest.slice(versioned[0].length);
  }
  const call = /^(.+)\.([^.(]+)\((.*)\)\s*$/.exec(rest);
  if (!call) {
    return { raw, className: '', simpleName: '', packageName: '', method: '', location: '', module, kind: 'other' };
  }
  const className = call[1] ?? '';
  const lastDot = className.lastIndexOf('.');
  const simple = lastDot >= 0 ? className.slice(lastDot + 1) : className;
  return {
    raw,
    className,
    simpleName: simple.replace(/\/0x[0-9a-f]+$/i, ''),
    packageName: lastDot >= 0 ? className.slice(0, lastDot) : '',
    method: call[2] ?? '',
    location: call[3] ?? '',
    module,
    kind: frameKind(className, module),
  };
}

export function frameKind(className: string, module = ''): FrameKind {
  if (className.startsWith('org.elasticsearch.') || module.startsWith('org.elasticsearch')) {
    return 'elasticsearch';
  }
  if (className.startsWith('org.apache.lucene.') || module.startsWith('org.apache.lucene')) {
    return 'lucene';
  }
  if (/^(java|javax|jdk|sun|com\.sun)\./.test(className)) {
    return 'jdk';
  }
  return 'other';
}

/** Top frames that mean "this thread is parked, sleeping or polling". */
const IDLE_FRAMES = new Set([
  'jdk.internal.misc.Unsafe.park',
  'sun.misc.Unsafe.park',
  'java.lang.Thread.sleep',
  'java.lang.Thread.sleep0',
  'java.lang.Thread.sleepNanos0',
  'java.lang.Object.wait',
  'java.lang.Object.wait0',
  'sun.nio.ch.EPoll.wait',
  'sun.nio.ch.EPollArrayWrapper.epollWait',
  'sun.nio.ch.KQueue.poll',
  'sun.nio.ch.WEPoll.wait',
]);

/** Top frames that wait for the next event on their own: sleeping or polling the network. */
const SELF_IDLE_FRAMES = new Set([
  'java.lang.Thread.sleep',
  'java.lang.Thread.sleep0',
  'java.lang.Thread.sleepNanos0',
  'sun.nio.ch.EPoll.wait',
  'sun.nio.ch.EPollArrayWrapper.epollWait',
  'sun.nio.ch.KQueue.poll',
  'sun.nio.ch.WEPoll.wait',
]);

/** Frames below a parked top that mean "waiting for the next task" rather than for a result or a lock. */
const WAIT_FOR_WORK_FRAMES = new Set([
  'java.util.concurrent.ThreadPoolExecutor.getTask',
  'java.util.concurrent.ScheduledThreadPoolExecutor$DelayedWorkQueue.take',
  'java.util.concurrent.ForkJoinPool.awaitWork',
  'java.lang.ref.ReferenceQueue.remove',
]);

/** Executor frames every pooled thread has at the bottom of its stack. */
const BASE_FRAMES = new Set([
  'java.lang.Thread.run',
  'java.lang.Thread.runWith',
  'java.util.concurrent.ThreadPoolExecutor.runWorker',
  'java.util.concurrent.ThreadPoolExecutor$Worker.run',
  'java.util.concurrent.FutureTask.run',
  'java.util.concurrent.ForkJoinWorkerThread.run',
]);

function frameId(frame: StackFrame): string {
  return `${frame.className}.${frame.method}`;
}

export function isIdleFrame(frame: StackFrame | undefined): boolean {
  return !!frame && IDLE_FRAMES.has(frameId(frame));
}

/**
 * Elasticsearch frames that only run tasks (`TimedRunnable`, `ThreadContext`
 * wrappers, `AbstractRunnable`, `ActionRunnable`): they say nothing about the work.
 */
export function isPlumbingFrame(frame: StackFrame): boolean {
  return (
    BASE_FRAMES.has(frameId(frame)) ||
    frame.packageName === 'org.elasticsearch.common.util.concurrent' ||
    frame.className.startsWith('org.elasticsearch.action.ActionRunnable')
  );
}

/**
 * What a stack says: `idle` when the top frame sleeps or polls, or parks in
 * an executor waiting for its next task (parked while waiting for a result
 * or a lock is not idle); `base` when every frame is executor plumbing (the
 * snapshots only shared the bottom of the stack); `work` otherwise.
 */
export function stackKind(frames: readonly StackFrame[]): StackKind {
  const top = frames[0];
  if (top && isIdleFrame(top) && (SELF_IDLE_FRAMES.has(frameId(top)) || frames.some((frame) => WAIT_FOR_WORK_FRAMES.has(frameId(frame))))) {
    return 'idle';
  }
  if (frames.length > 0 && frames.every(isPlumbingFrame)) {
    return 'base';
  }
  return 'work';
}

function isTellingFrame(frame: StackFrame): boolean {
  return (frame.kind === 'elasticsearch' || frame.kind === 'lucene') && !isPlumbingFrame(frame);
}

function hasTellingFrame(frames: readonly StackFrame[]): boolean {
  return frames.some(isTellingFrame);
}

/** The first Elasticsearch or Lucene frame, plumbing aside, of the stacks doing work (groups come sorted). */
function focusFrame(groups: readonly StackGroup[]): { readonly frame: StackFrame; readonly group: number } | null {
  for (const [index, group] of groups.entries()) {
    const frame = group.kind === 'work' ? group.frames.find(isTellingFrame) : undefined;
    if (frame) {
      return { frame, group: index };
    }
  }
  return null;
}

/** Load of a thread for sorting: percent of the interval, or allocated bytes. */
export function threadLoad(thread: HotThread): number {
  return thread.percent ?? thread.allocatedBytes ?? 0;
}

/** Nodes ordered by their busiest thread, threads by load (stable for ties). */
export function sortHotNodes(nodes: readonly HotNode[]): HotNode[] {
  return nodes
    .map((node) => ({
      ...node,
      threads: [...node.threads].sort((left, right) => threadLoad(right) - threadLoad(left)),
    }))
    .sort((left, right) => nodeLoad(right) - nodeLoad(left) || left.name.localeCompare(right.name));
}

function nodeLoad(node: HotNode): number {
  return node.threads.reduce((max, thread) => Math.max(max, threadLoad(thread)), 0);
}

/**
 * Whether a thread is worth attention: for cpu and block captures it used at
 * least `BUSY_PERCENT` of the interval; wait and memory captures report
 * every thread Elasticsearch listed.
 */
export function isBusyThread(thread: HotThread): boolean {
  if (thread.type === 'cpu' || thread.type === 'block') {
    return (thread.percent ?? 0) >= BUSY_PERCENT;
  }
  return true;
}

/**
 * Whether a thread counts for the pool hint: busy enough, and for wait and
 * block captures not an idle worker (parked waiting for work always "waits").
 */
export function countsForHint(thread: HotThread): boolean {
  if (!isBusyThread(thread)) {
    return false;
  }
  return !((thread.type === 'wait' || thread.type === 'block') && thread.idle);
}

/** Load per thread pool over the threads that count for the hint, heaviest first. */
export function poolLoads(nodes: readonly HotNode[]): PoolLoad[] {
  interface Entry {
    pool: string | null;
    threads: number;
    total: number;
    max: number;
    maxCpu: number | null;
    cpu: number | null;
    other: number | null;
    nodes: Set<string>;
  }
  const byPool = new Map<string, Entry>();
  for (const node of nodes) {
    for (const thread of node.threads) {
      if (!countsForHint(thread)) {
        continue;
      }
      const key = thread.pool ?? '';
      const entry: Entry = byPool.get(key) ?? {
        pool: thread.pool,
        threads: 0,
        total: 0,
        max: 0,
        maxCpu: null,
        cpu: 0,
        other: 0,
        nodes: new Set<string>(),
      };
      const load = threadLoad(thread);
      entry.threads++;
      entry.total += load;
      if (entry.threads === 1 || load > entry.max) {
        entry.max = load;
        entry.maxCpu = thread.otherPercent === null ? null : thread.cpuPercent;
      }
      const split = thread.cpuPercent !== null && thread.otherPercent !== null;
      entry.cpu = split && entry.cpu !== null ? entry.cpu + (thread.cpuPercent ?? 0) : null;
      entry.other = split && entry.other !== null ? entry.other + (thread.otherPercent ?? 0) : null;
      entry.nodes.add(node.name);
      byPool.set(key, entry);
    }
  }
  const round = (value: number) => Math.round(value * 10) / 10;
  return [...byPool.values()]
    .map((entry) => ({
      pool: entry.pool,
      threads: entry.threads,
      total: round(entry.total),
      max: entry.max,
      maxCpu: entry.maxCpu,
      cpu: entry.cpu === null ? null : round(entry.cpu),
      other: entry.other === null ? null : round(entry.other),
      nodes: [...entry.nodes].sort(),
    }))
    .sort((left, right) => right.total - left.total || right.max - left.max);
}

/**
 * Wait or block captures whose every reported thread is an idle worker:
 * nothing is stuck, the pools simply have nothing to do.
 */
export function onlyIdleWaits(nodes: readonly HotNode[]): boolean {
  const threads = nodes.flatMap((node) => node.threads);
  return threads.length > 0 && threads.every((thread) => (thread.type === 'wait' || thread.type === 'block') && thread.idle);
}

export interface HotThreadsSummary {
  readonly nodes: number;
  readonly threads: number;
  readonly busy: number;
  readonly hottest: { readonly thread: HotThread; readonly node: string } | null;
}

export function summarizeHotThreads(nodes: readonly HotNode[]): HotThreadsSummary {
  let hottest: HotThreadsSummary['hottest'] = null;
  let threads = 0;
  let busy = 0;
  for (const node of nodes) {
    for (const thread of node.threads) {
      threads++;
      if (isBusyThread(thread)) {
        busy++;
      }
      if (!hottest || threadLoad(thread) > threadLoad(hottest.thread)) {
        hottest = { thread, node: node.name };
      }
    }
  }
  return { nodes: nodes.length, threads, busy, hottest };
}

const POOL_HINTS: Readonly<Record<string, Omit<PoolHint, 'pool'>>> = {
  search: {
    label: 'search',
    text: 'It runs the query and fetch phases of searches on the shards a node holds, so the node is busy answering searches. Expensive queries (leading wildcards, regular expressions, scripts, large aggregations) are the usual cause; the search slow log names them.',
  },
  search_worker: {
    label: 'search worker',
    text: 'It runs one search over several segments in parallel (concurrent segment search), so heavy queries keep it busy. The search slow log names the expensive ones.',
  },
  search_coordination: {
    label: 'search coordination',
    text: 'It coordinates searches (can-match checks, field capabilities). It is rarely the bottleneck on its own; look at the search pools as well.',
  },
  search_throttled: {
    label: 'throttled search',
    text: 'It searches frozen or throttled indices, one request at a time.',
  },
  write: {
    label: 'write',
    text: 'It indexes, updates and deletes documents from bulk and index requests, so the node is busy indexing. Larger bulk requests, ingest pipelines doing less work or a longer refresh interval reduce the load.',
  },
  get: {
    label: 'get',
    text: 'It serves real-time gets and multi-gets by id. A busy get pool usually means an application fetches many documents one by one.',
  },
  management: {
    label: 'management',
    text: 'It answers node and cluster statistics and the cat APIs. Monitoring agents or dashboards that poll stats too often usually keep it busy.',
  },
  refresh: {
    label: 'refresh',
    text: 'It makes recently indexed documents visible to searches. Many refreshes on indices that are written to keep it busy; a longer index.refresh_interval (for example 30s) helps.',
  },
  flush: {
    label: 'flush',
    text: 'It writes indexed data and the translog to disk. Heavy indexing or large translogs keep it busy.',
  },
  force_merge: {
    label: 'force merge',
    text: 'It runs force merge requests, which rewrite whole shards. Run force merges only on indices that are no longer written to, outside busy hours.',
  },
  merge: {
    label: 'merge',
    text: 'Lucene merges small segments into larger ones in the background. Heavy indexing or many updates and deletes keep merges busy; it settles once indexing slows down.',
  },
  snapshot: {
    label: 'snapshot',
    text: 'It copies shard files to or from a snapshot repository, so a snapshot or restore is running.',
  },
  snapshot_meta: {
    label: 'snapshot metadata',
    text: 'It reads snapshot metadata from the repository, for example while listing snapshots.',
  },
  generic: {
    label: 'generic',
    text: 'It runs background work such as shard recoveries, node discovery and housekeeping. Shards recovering or relocating are the usual cause.',
  },
  transport_worker: {
    label: 'network',
    text: 'It reads and writes requests between nodes and from clients. Large requests or responses (bulk, big search results) or a lot of traffic keep it busy.',
  },
  warmer: {
    label: 'warmer',
    text: 'It warms up new segments so searches on them are fast; it follows refreshes and merges.',
  },
  fetch_shard_started: {
    label: 'shard fetching',
    text: 'It asks nodes which shard copies they hold while shards are being allocated, typically after a node restart.',
  },
  fetch_shard_store: {
    label: 'shard store fetching',
    text: 'It reads shard store metadata while replicas are being allocated, typically after a node restart.',
  },
  'masterService#updateTask': {
    label: 'master service',
    text: 'It computes new cluster states on the elected master (index creation, mapping updates, shard allocation). When it is busy, cluster changes queue up as pending tasks.',
  },
  'clusterApplierService#updateTask': {
    label: 'cluster state applier',
    text: 'It applies new cluster states on this node. Large or frequently changing cluster states (many indices, shards or mapping updates) keep it busy.',
  },
  cluster_coordination: {
    label: 'cluster coordination',
    text: 'It handles master elections and cluster state publication.',
  },
  analyze: {
    label: 'analyze',
    text: 'It runs _analyze requests.',
  },
  system_read: {
    label: 'system read',
    text: 'It reads Elasticsearch’s own system indices (security, tasks, Kibana).',
  },
  system_write: {
    label: 'system write',
    text: 'It writes to Elasticsearch’s own system indices (security, tasks, Kibana).',
  },
  system_critical_read: {
    label: 'critical system read',
    text: 'It reads critical system indices such as the security index.',
  },
  system_critical_write: {
    label: 'critical system write',
    text: 'It writes critical system indices such as the security index.',
  },
  timer: {
    label: 'timer',
    text: 'It keeps Elasticsearch’s cached clock up to date. It never does real work.',
  },
  scheduler: {
    label: 'scheduler',
    text: 'It triggers scheduled background jobs; the jobs themselves run in other pools.',
  },
};

/** Plain-language explanation of a thread pool for the hint callout. */
export function poolHint(pool: string | null): PoolHint {
  if (pool === null) {
    return {
      pool: '',
      label: 'threads outside the thread pools',
      text: 'These are Java threads outside Elasticsearch’s thread pools (plugins, client libraries, JVM housekeeping). Garbage collection is not shown by hot threads: check the GC counts and times in the node statistics (Nodes page).',
    };
  }
  const known = POOL_HINTS[pool];
  if (known) {
    return { pool, ...known };
  }
  if (pool.startsWith('ml_')) {
    return { pool, label: humanize(pool), text: 'It runs machine learning jobs, datafeeds or model inference.' };
  }
  return { pool, label: pool, text: `It is the ${pool} thread pool of Elasticsearch.` };
}

/**
 * "Most CPU time went to the search pool", worded for the capture type. In
 * 8.x a cpu capture measures busy time (on a CPU or runnable but off it):
 * when most of it was off the CPU the lead says so, since the cure (disks,
 * an overloaded host) differs from the one for CPU-heavy queries.
 */
export function poolLead(type: HotThreadsType, hint: PoolHint, load?: PoolLoad): string {
  const subject = hint.pool ? `the ${hint.label} pool` : hint.label;
  switch (type) {
    case 'wait':
      return `Threads of ${subject} waited the most`;
    case 'block':
      return `Threads of ${subject} were blocked the longest, waiting for locks`;
    case 'mem':
      return `Threads of ${subject} allocated the most memory`;
    default:
      if (load && load.cpu !== null && load.other !== null && load.other > load.cpu) {
        return `Most busy time went to ${subject}, mostly waiting on I/O or for a free CPU core rather than computing`;
      }
      return `Most CPU time went to ${subject}`;
  }
}

/** "3 threads on es-node-2, up to 90.9% busy (6.9% on CPU)": the figures behind the lead. */
export function poolDetail(type: HotThreadsType, load: PoolLoad): string {
  const where = `${pluralize(load.threads, 'thread')} on ${load.nodes.join(', ')}`;
  if (type === 'mem') {
    return where;
  }
  if (type === 'cpu' && load.maxCpu !== null) {
    return `${where}, up to ${load.max.toFixed(1)}% busy with ${load.maxCpu.toFixed(1)}% on CPU`;
  }
  return `${where}, up to ${load.max.toFixed(1)}%`;
}

/** Heading of the empty/idle state for a capture type. */
export function quietHeading(type: HotThreadsType): string {
  switch (type) {
    case 'block':
      return 'No blocked threads';
    case 'wait':
      return 'No waiting threads';
    case 'mem':
      return 'No allocating threads';
    default:
      return 'No busy threads';
  }
}

// ==== Thread pools ==============================================================

/** Pools that matter most for diagnosis, in display order. */
export const INTERESTING_POOLS: readonly string[] = [
  'search',
  'write',
  'get',
  'management',
  'refresh',
  'flush',
  'force_merge',
  'snapshot',
  'generic',
];

function poolRank(pool: string): number {
  const index = INTERESTING_POOLS.indexOf(pool);
  return index >= 0 ? index : INTERESTING_POOLS.length;
}

function toCount(value: string | null | undefined): number {
  const number = Number(value);
  return value !== null && value !== undefined && value !== '' && Number.isFinite(number) ? number : 0;
}

function toOptionalCount(value: string | null | undefined): number | null {
  if (value === null || value === undefined || value.trim() === '') {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function normalizeThreadPools(rows: unknown): ThreadPoolRow[] {
  if (!Array.isArray(rows)) {
    return [];
  }
  return rows.filter(isRecord).map((row) => {
    const raw = row as RawThreadPoolRow;
    const node = raw.node_name ?? '';
    const pool = raw.name ?? '';
    const queueSize = toOptionalCount(raw.queue_size);
    return {
      key: `${raw.node_id || node}/${pool}`,
      node,
      pool,
      type: raw.type ?? '',
      active: toCount(raw.active),
      queue: toCount(raw.queue),
      rejected: toCount(raw.rejected),
      completed: toCount(raw.completed),
      size: toOptionalCount(raw.size) ?? toOptionalCount(raw.max),
      threads: toOptionalCount(raw.pool_size),
      queueSize: queueSize !== null && queueSize >= 0 ? queueSize : null,
      interesting: INTERESTING_POOLS.includes(pool),
    };
  });
}

/** Share of a bounded queue in use (0–100), `null` for unbounded queues. */
export function queuePercent(row: ThreadPoolRow): number | null {
  if (row.queueSize === null || row.queueSize <= 0) {
    return null;
  }
  return Math.min(100, (row.queue / row.queueSize) * 100);
}

/** A bounded queue at least half full warns, at least 80% full is critical. */
export function queueLevel(row: ThreadPoolRow): QueueLevel {
  const percent = queuePercent(row);
  if (percent === null) {
    return 'ok';
  }
  if (percent >= 80) {
    return 'danger';
  }
  return percent >= 50 ? 'warn' : 'ok';
}

/** Every thread of a sized pool is busy (normal for one-thread pools at work). */
export function isSaturated(row: ThreadPoolRow): boolean {
  return row.size !== null && row.size > 0 && row.active >= row.size;
}

/** Saturated with work waiting in the queue: the pool cannot keep up. */
export function isSaturatedAndQueueing(row: ThreadPoolRow): boolean {
  return isSaturated(row) && row.queue > 0;
}

/**
 * How much a row needs attention, for the default order: rejections since
 * the previous sample, then a queue, then rejections since the node started.
 */
export function attentionRank(row: ThreadPoolRow, increases?: ReadonlyMap<string, number>): number {
  if ((increases?.get(row.key) ?? 0) > 0) {
    return 0;
  }
  if (row.queue > 0) {
    return 1;
  }
  return row.rejected > 0 ? 2 : 3;
}

/**
 * Pools shown while "Show all pools" is off: the interesting ones, plus any
 * other pool with queued tasks or rejections so problems are never hidden.
 */
export function isShownByDefault(row: ThreadPoolRow): boolean {
  return row.interesting || row.queue > 0 || row.rejected > 0;
}

export function filterThreadPools(rows: readonly ThreadPoolRow[], query: string, showAll: boolean): ThreadPoolRow[] {
  const matches = textMatcher(query);
  return rows.filter((row) => (showAll || isShownByDefault(row)) && matches(`${row.node} ${row.pool}`));
}

/**
 * Sorts thread pool rows. The default order (`pool`) puts the rows that need
 * attention first (see `attentionRank`), whatever the direction, then the
 * interesting pools in `INTERESTING_POOLS` order.
 */
export function sortThreadPools(
  rows: readonly ThreadPoolRow[],
  field: ThreadPoolSortField,
  reverse: boolean,
  increases?: ReadonlyMap<string, number>,
): ThreadPoolRow[] {
  const byPool = (left: ThreadPoolRow, right: ThreadPoolRow) =>
    poolRank(left.pool) - poolRank(right.pool) || left.pool.localeCompare(right.pool);
  const byNode = (left: ThreadPoolRow, right: ThreadPoolRow) => left.node.localeCompare(right.node);
  const direction = reverse ? -1 : 1;
  return [...rows].sort((left, right) => {
    switch (field) {
      case 'pool':
        return (
          attentionRank(left, increases) - attentionRank(right, increases) ||
          direction * (byPool(left, right) || byNode(left, right))
        );
      case 'node':
        return direction * (byNode(left, right) || byPool(left, right));
      default:
        // Ties keep the natural pool/node order whatever the direction.
        return direction * (left[field] - right[field]) || byPool(left, right) || byNode(left, right);
    }
  });
}

/**
 * Rejections added since the previous sample, by row key. Rows missing from
 * the previous sample are not reported. A counter that went down means the
 * node restarted (counters start at 0): everything it counts now is new.
 *
 * Samples are keyed by node name and pool, as `_cat/thread_pool` has no node
 * id column; two nodes sharing a name would share a row key.
 */
export function rejectionIncreases(
  previous: ReadonlyMap<string, number> | null,
  rows: readonly ThreadPoolRow[],
): Map<string, number> {
  const increases = new Map<string, number>();
  if (!previous) {
    return increases;
  }
  for (const row of rows) {
    const before = previous.get(row.key);
    if (before === undefined) {
      continue;
    }
    const added = row.rejected >= before ? row.rejected - before : row.rejected;
    if (added > 0) {
      increases.set(row.key, added);
    }
  }
  return increases;
}

export function rejectionSample(rows: readonly ThreadPoolRow[]): Map<string, number> {
  return new Map(rows.map((row) => [row.key, row.rejected]));
}

/** Sum of the increases of one sample. */
export function totalIncrease(increases: ReadonlyMap<string, number>): number {
  return [...increases.values()].reduce((sum, value) => sum + value, 0);
}

export function summarizeThreadPools(rows: readonly ThreadPoolRow[]): ThreadPoolSummary {
  return {
    active: rows.reduce((sum, row) => sum + row.active, 0),
    queued: rows.reduce((sum, row) => sum + row.queue, 0),
    rejected: rows.reduce((sum, row) => sum + row.rejected, 0),
    nearCapacity: rows.filter((row) => queueLevel(row) !== 'ok').length,
    saturated: rows.filter(isSaturated).length,
    saturatedQueueing: rows.filter(isSaturatedAndQueueing).length,
    nodes: new Set(rows.map((row) => row.node)).size,
  };
}

// ==== Pending tasks =============================================================

export const PENDING_PRIORITIES: readonly string[] = ['IMMEDIATE', 'URGENT', 'HIGH', 'NORMAL', 'LOW', 'LANGUID'];

/** Waiting longer than this is worth a warning. */
export const SLOW_PENDING_MILLIS = 30_000;

export function priorityRank(priority: string): number {
  const index = PENDING_PRIORITIES.indexOf(priority.toUpperCase());
  return index >= 0 ? index : PENDING_PRIORITIES.length;
}

/** Badge tone of a pending task priority. */
export function priorityTone(priority: string): 'red' | 'yellow' | 'blue' | 'gray' {
  switch (priority.toUpperCase()) {
    case 'IMMEDIATE':
      return 'red';
    case 'URGENT':
      return 'yellow';
    case 'HIGH':
      return 'blue';
    default:
      return 'gray';
  }
}

export function normalizePendingTasks(response: unknown): PendingTask[] {
  const tasks = isRecord(response) ? (response as PendingTasksResponse).tasks : undefined;
  if (!Array.isArray(tasks)) {
    return [];
  }
  return tasks.filter(isRecord).map((record, index) => {
    const task = record as RawPendingTask;
    const priority = typeof task.priority === 'string' && task.priority ? task.priority.toUpperCase() : 'NORMAL';
    const millis = Number(task.time_in_queue_millis);
    return {
      position: index,
      order: typeof task.insert_order === 'number' ? task.insert_order : index,
      priority,
      rank: priorityRank(priority),
      source: typeof task.source === 'string' ? task.source : '',
      executing: task.executing === true,
      timeInQueueMillis: Number.isFinite(millis) && millis > 0 ? millis : 0,
      raw: task,
    };
  });
}

/**
 * The order the master runs the queue in: the executing batch first, then by
 * priority (IMMEDIATE … LANGUID), then the position Elasticsearch listed the
 * task at (8.x lists batched tasks together in queue order; 7.x lists an
 * unsorted priority queue), then the insertion order.
 */
function queueOrder(left: PendingTask, right: PendingTask): number {
  return (
    Number(right.executing) - Number(left.executing) ||
    left.rank - right.rank ||
    left.position - right.position ||
    left.order - right.order
  );
}

/** Sorts pending tasks; the default (`queue`) is the master's own order. */
export function sortPendingTasks(tasks: readonly PendingTask[], field: PendingSortField, reverse: boolean): PendingTask[] {
  const direction = reverse ? -1 : 1;
  return [...tasks].sort((left, right) => {
    switch (field) {
      case 'priority':
        return direction * (left.rank - right.rank) || queueOrder(left, right);
      case 'time':
        return direction * (left.timeInQueueMillis - right.timeInQueueMillis) || queueOrder(left, right);
      default:
        return direction * queueOrder(left, right);
    }
  });
}

export function filterPendingTasks(tasks: readonly PendingTask[], query: string): PendingTask[] {
  const matches = textMatcher(query);
  return tasks.filter((task) => matches(`${task.source} ${task.priority} ${task.order}`));
}

export function summarizePendingTasks(tasks: readonly PendingTask[]): PendingSummary {
  let oldest: PendingTask | null = null;
  for (const task of tasks) {
    if (!oldest || task.timeInQueueMillis > oldest.timeInQueueMillis) {
      oldest = task;
    }
  }
  return {
    total: tasks.length,
    executing: tasks.filter((task) => task.executing).length,
    oldest,
    urgent: tasks.filter((task) => task.rank <= 1).length,
  };
}

// ==== Slow logs =================================================================

export const SLOWLOG_GROUPS: readonly { readonly key: SlowlogGroup; readonly label: string; readonly hint: string }[] = [
  { key: 'query', label: 'Search query', hint: 'Time a shard spends finding the matching documents' },
  { key: 'fetch', label: 'Search fetch', hint: 'Time a shard spends loading the documents of the hits' },
  { key: 'index', label: 'Indexing', hint: 'Time a shard spends indexing one document' },
];

export const SLOWLOG_LEVELS: readonly SlowlogLevel[] = ['warn', 'info', 'debug', 'trace'];

export const SOURCE_KEY = 'index.indexing.slowlog.source';
export const REFORMAT_KEY = 'index.indexing.slowlog.reformat';

export function thresholdKey(group: SlowlogGroup, level: SlowlogLevel): string {
  return group === 'index'
    ? `index.indexing.slowlog.threshold.index.${level}`
    : `index.search.slowlog.threshold.${group}.${level}`;
}

export const THRESHOLD_KEYS: readonly string[] = SLOWLOG_GROUPS.flatMap((group) =>
  SLOWLOG_LEVELS.map((level) => thresholdKey(group.key, level)),
);

function thresholds(values: Record<SlowlogGroup, readonly [string, string, string, string]>): SlowlogThresholds {
  const levels = (group: SlowlogGroup) => {
    const [warn, info, debug, trace] = values[group];
    return { warn, info, debug, trace };
  };
  return { query: levels('query'), fetch: levels('fetch'), index: levels('index') };
}

export function emptyThresholds(): SlowlogThresholds {
  return thresholds({ query: ['', '', '', ''], fetch: ['', '', '', ''], index: ['', '', '', ''] });
}

export const SLOWLOG_PRESETS: readonly SlowlogPreset[] = [
  {
    key: 'off',
    label: 'Off',
    description:
      'Sets every threshold to -1 explicitly. Same effect as Reset to defaults; new indices still take their thresholds from their index template.',
    thresholds: thresholds({
      query: ['-1', '-1', '-1', '-1'],
      fetch: ['-1', '-1', '-1', '-1'],
      index: ['-1', '-1', '-1', '-1'],
    }),
  },
  {
    key: 'moderate',
    label: 'Moderate',
    description: 'Logs only clearly slow requests. A good default for production.',
    thresholds: thresholds({
      query: ['10s', '5s', '2s', '500ms'],
      fetch: ['1s', '800ms', '500ms', '200ms'],
      index: ['10s', '5s', '2s', '500ms'],
    }),
  },
  {
    key: 'aggressive',
    label: 'Aggressive',
    description: 'Logs most requests that take noticeable time. Use while investigating, then switch back: it can write a lot.',
    thresholds: thresholds({
      query: ['2s', '1s', '500ms', '100ms'],
      fetch: ['500ms', '200ms', '100ms', '50ms'],
      index: ['2s', '1s', '500ms', '100ms'],
    }),
  },
];

export function presetThresholds(key: SlowlogPresetKey): SlowlogThresholds {
  return SLOWLOG_PRESETS.find((preset) => preset.key === key)?.thresholds ?? emptyThresholds();
}

/** Lower-cased, trimmed time value for comparisons. */
function normalizedTime(value: string): string {
  return value.trim().toLowerCase();
}

/** The preset that `values` matches exactly, `'custom'`, or `null` when nothing is set. */
export function detectPreset(values: SlowlogThresholds): SlowlogPresetKey | 'custom' | null {
  const flat = flatThresholds(values);
  if (flat.every((value) => value === '')) {
    return null;
  }
  const match = SLOWLOG_PRESETS.find((preset) => {
    const expected = flatThresholds(preset.thresholds);
    return expected.every((value, index) => value === flat[index]);
  });
  return match?.key ?? 'custom';
}

function flatThresholds(values: SlowlogThresholds): string[] {
  return SLOWLOG_GROUPS.flatMap((group) => SLOWLOG_LEVELS.map((level) => normalizedTime(values[group.key][level])));
}

const TIME_VALUE = /^(?:-1|0|\d+(?:nanos|micros|ms|s|m|h|d))$/i;
const TIME_FACTORS: Readonly<Record<string, number>> = {
  nanos: 1e-6,
  micros: 1e-3,
  ms: 1,
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

/** Whether Elasticsearch accepts `value` as a slow log threshold (-1 disables it). */
export function isTimeValue(value: string): boolean {
  return TIME_VALUE.test(value.trim());
}

/** Milliseconds of a time value, `null` for -1 (disabled) or invalid values. */
export function timeValueMillis(value: string): number | null {
  const text = value.trim().toLowerCase();
  if (text === '0') {
    return 0;
  }
  const match = /^(\d+)(nanos|micros|ms|s|m|h|d)$/.exec(text);
  return match ? Number(match[1]) * (TIME_FACTORS[match[2] ?? 'ms'] ?? 1) : null;
}

/** Digits Elasticsearch can hold in a time value (a Java long). */
const MAX_TIME_DIGITS = 18;

/** Error message of a threshold field, `null` when valid or empty. */
export function thresholdError(value: string): string | null {
  const text = value.trim();
  const digits = /^(\d+)/.exec(text)?.[1] ?? '';
  if (digits.length > MAX_TIME_DIGITS) {
    return `That number is too large: use at most ${MAX_TIME_DIGITS} digits and a larger unit, such as 10m`;
  }
  if (text === '' || isTimeValue(text)) {
    return null;
  }
  if (/^\d+\.\d+\s*(nanos|micros|ms|s|m|h|d)$/i.test(text)) {
    return 'Elasticsearch does not accept fractions: use a smaller unit, such as 1500ms for 1.5s';
  }
  if (/^\d+$/.test(text)) {
    return `Add a unit, such as ${text}ms or ${text}s`;
  }
  return 'Enter a time such as 500ms, 5s or 1m, or -1 to turn this level off';
}

/**
 * Warning (not an error) for a threshold of 0: Elasticsearch then logs every
 * query, fetch or indexed document on every shard.
 */
export function thresholdWarning(value: string): string | null {
  return timeValueMillis(value) === 0 ? 'logs every request, which writes very large slow log files' : null;
}

/** Error of the indexing source field: empty, `true`, `false` or a number of characters. */
export function sourceError(value: string): string | null {
  const text = value.trim().toLowerCase();
  return text === '' || text === 'true' || text === 'false' || /^\d+$/.test(text)
    ? null
    : 'Enter a number of characters, true (the whole source) or false (no source)';
}

export function validateSlowlogForm(form: SlowlogForm): SlowlogErrors {
  const errors: Record<string, string> = {};
  for (const group of SLOWLOG_GROUPS) {
    for (const level of SLOWLOG_LEVELS) {
      const error = thresholdError(form.thresholds[group.key][level]);
      if (error) {
        errors[`${group.key}.${level}`] = error;
      }
    }
  }
  const source = sourceError(form.source);
  if (source) {
    errors['source'] = source;
  }
  return errors;
}

/**
 * Warning (not an error) when a group's levels are not in descending order:
 * a request slower than the warn threshold is logged at warn, so warn should
 * be the highest threshold and trace the lowest.
 */
export function orderWarning(levels: Readonly<Record<SlowlogLevel, string>>): string | null {
  const set = SLOWLOG_LEVELS.map((level) => ({ level, millis: timeValueMillis(levels[level]) })).filter(
    (entry): entry is { level: SlowlogLevel; millis: number } => entry.millis !== null,
  );
  for (let index = 1; index < set.length; index++) {
    const higher = set[index - 1];
    const lower = set[index];
    if (higher && lower && lower.millis > higher.millis) {
      return `${sentenceCase(lower.level)} (${levels[lower.level].trim()}) is above ${higher.level} (${levels[higher.level].trim()}): requests between the two are logged at ${higher.level}, never at ${lower.level}`;
    }
  }
  return null;
}

function sentenceCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** Settings sent to `index_settings/bulk_update`: empty fields reset to the default (`null`). */
export function buildSlowlogSettings(form: SlowlogForm): Record<string, string | null> {
  const settings: Record<string, string | null> = {};
  for (const group of SLOWLOG_GROUPS) {
    for (const level of SLOWLOG_LEVELS) {
      const value = normalizedTime(form.thresholds[group.key][level]);
      settings[thresholdKey(group.key, level)] = value === '' ? null : value;
    }
  }
  const source = form.source.trim().toLowerCase();
  settings[SOURCE_KEY] = source === '' ? null : source;
  settings[REFORMAT_KEY] = form.reformat === '' ? null : form.reformat;
  return settings;
}

/**
 * Settings that reset the slow log of `indices` to the defaults: every
 * threshold, source and reformat, plus any other slow log setting set on
 * one of them (level, include.user…).
 */
export function resetSlowlogSettings(indices: readonly SlowlogIndex[]): Record<string, null> {
  const keys = new Set<string>([...THRESHOLD_KEYS, SOURCE_KEY, REFORMAT_KEY]);
  for (const index of indices) {
    Object.keys(index.settings).forEach((key) => keys.add(key));
  }
  return Object.fromEntries([...keys].map((key) => [key, null]));
}

/** Slow log settings of every index that has some, sorted by name. */
export function parseSlowlog(response: unknown): SlowlogIndex[] {
  if (!isRecord(response)) {
    return [];
  }
  return Object.entries(response)
    .map(([index, value]) => slowlogIndex(index, isRecord(value) ? flatten(value['settings']) : {}))
    .filter((entry) => Object.keys(entry.settings).length > 0)
    .sort((left, right) => left.index.localeCompare(right.index));
}

function slowlogIndex(index: string, all: Record<string, string>): SlowlogIndex {
  const settings = Object.fromEntries(Object.entries(all).filter(([key]) => isSlowlogKey(key)));
  const values = thresholds({
    query: levelValues(settings, 'query'),
    fetch: levelValues(settings, 'fetch'),
    index: levelValues(settings, 'index'),
  });
  const other = Object.fromEntries(Object.entries(settings).filter(([key]) => !THRESHOLD_KEYS.includes(key)));
  const active = flatThresholds(values).filter((value) => value !== '' && value !== '-1').length;
  return { index, thresholds: values, other, settings, active, preset: detectPreset(values) };
}

function levelValues(settings: Record<string, string>, group: SlowlogGroup): [string, string, string, string] {
  const [warn, info, debug, trace] = SLOWLOG_LEVELS.map((level) => settings[thresholdKey(group, level)] ?? '');
  return [warn ?? '', info ?? '', debug ?? '', trace ?? ''];
}

function isSlowlogKey(key: string): boolean {
  return key.startsWith('index.search.slowlog.') || key.startsWith('index.indexing.slowlog.');
}

/** Flat settings as strings, also when Elasticsearch nested them. */
function flatten(value: unknown, prefix = ''): Record<string, string> {
  if (!isRecord(value)) {
    return {};
  }
  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (isRecord(entry)) {
      Object.assign(result, flatten(entry, path));
    } else if (entry !== null && entry !== undefined) {
      result[path] = Array.isArray(entry) ? entry.join(',') : String(entry);
    }
  }
  return result;
}

/** Readable label of a non-threshold slow log setting. */
export function otherSettingLabel(key: string): string {
  switch (key) {
    case SOURCE_KEY:
      return 'Indexing source';
    case REFORMAT_KEY:
      return 'Reformat source';
    case 'index.search.slowlog.level':
      return 'Search level';
    case 'index.indexing.slowlog.level':
      return 'Indexing level';
    case 'index.search.slowlog.include.user':
      return 'Search logs user';
    case 'index.indexing.slowlog.include.user':
      return 'Indexing logs user';
    default:
      return humanize(key.replace(/^index\./, ''));
  }
}

/** "warn 10s · info 5s · trace off" (levels that are set only), or `''`. */
export function describeLevels(levels: Readonly<Record<SlowlogLevel, string>>): string {
  return SLOWLOG_LEVELS.filter((level) => levels[level].trim() !== '')
    .map((level) => {
      const value = levels[level].trim();
      if (value === '-1') {
        return `${level} off`;
      }
      return thresholdWarning(value) ? `${level} ${value} (every request)` : `${level} ${value}`;
    })
    .join(' · ');
}

/** Form pre-filled with what an index has set. */
export function formFromIndex(index: SlowlogIndex | undefined): SlowlogForm {
  if (!index) {
    return { thresholds: emptyThresholds(), source: '', reformat: '' };
  }
  const reformat = (index.settings[REFORMAT_KEY] ?? '').toLowerCase();
  return {
    thresholds: index.thresholds,
    source: index.settings[SOURCE_KEY] ?? '',
    reformat: reformat === 'true' || reformat === 'false' ? reformat : '',
  };
}

export function sameForm(left: SlowlogForm, right: SlowlogForm): boolean {
  return (
    flatThresholds(left.thresholds).join('|') === flatThresholds(right.thresholds).join('|') &&
    left.source.trim().toLowerCase() === right.source.trim().toLowerCase() &&
    left.reformat === right.reformat
  );
}

/** Whether the form leaves some field empty (which resets that setting). */
export function hasEmptyFields(form: SlowlogForm): boolean {
  return Object.values(buildSlowlogSettings(form)).some((value) => value === null);
}

/** Readable name of a slow log setting key: `Search query warn`, `Indexing source`. */
export function settingLabel(key: string): string {
  for (const group of SLOWLOG_GROUPS) {
    for (const level of SLOWLOG_LEVELS) {
      if (thresholdKey(group.key, level) === key) {
        return `${group.label} ${level}`;
      }
    }
  }
  return otherSettingLabel(key);
}

const PRESET_LABELS: Readonly<Record<SlowlogPresetKey | 'custom', string>> = {
  off: 'Off',
  moderate: 'Moderate',
  aggressive: 'Aggressive',
  custom: 'custom thresholds',
};

/**
 * What applying `form` changes on indices that already have slow log
 * settings: one line per index whose settings are replaced or removed, so
 * adding a configured index to the selection never silently wipes it.
 */
export function describeOverwrites(form: SlowlogForm, selected: readonly SlowlogIndex[]): string[] {
  const settings = buildSlowlogSettings(form);
  return selected.flatMap((index) => {
    const changed: string[] = [];
    const removed: string[] = [];
    for (const [key, value] of Object.entries(settings)) {
      const current = index.settings[key];
      if (current === undefined) {
        continue;
      }
      if (value === null) {
        removed.push(settingLabel(key));
      } else if (normalizedTime(current) !== value) {
        changed.push(settingLabel(key));
      }
    }
    if (changed.length === 0 && removed.length === 0) {
      return [];
    }
    const name = index.preset ? `${index.index} (${PRESET_LABELS[index.preset]})` : index.index;
    const parts = [
      changed.length > 0 ? `changes ${listSettings(changed)}` : '',
      removed.length > 0 ? `removes ${listSettings(removed)}` : '',
    ].filter((part) => part !== '');
    return [`${name}: ${parts.join(', ')}`];
  });
}

function listSettings(labels: readonly string[]): string {
  return labels.length > 3 ? `${labels.length} settings` : labels.join(', ');
}

/**
 * Compares what was sent to `index_settings/bulk_update` with the slow log
 * settings read back afterwards: which indices hold every value sent.
 */
export function verifySlowlog(
  indices: readonly string[],
  sent: Readonly<Record<string, string | null>>,
  rows: readonly SlowlogIndex[],
): { readonly applied: readonly string[]; readonly missing: readonly string[] } {
  const byName = new Map(rows.map((row) => [row.index, row]));
  const applied: string[] = [];
  const missing: string[] = [];
  for (const index of indices) {
    const current = byName.get(index)?.settings ?? {};
    const matches = Object.entries(sent).every(([key, value]) => {
      const now = current[key];
      return value === null ? now === undefined : now !== undefined && normalizedTime(now) === value.toLowerCase();
    });
    (matches ? applied : missing).push(index);
  }
  return { applied, missing };
}

/** Lines of the confirmation dialog describing what will be written. */
export function describeForm(form: SlowlogForm): string[] {
  const lines = SLOWLOG_GROUPS.map((group) => {
    const levels = describeLevels(form.thresholds[group.key]);
    return `${group.label}: ${levels || 'default (off)'}`;
  });
  const source = form.source.trim().toLowerCase();
  lines.push(
    `Indexing source: ${source === '' ? 'default (first 1000 characters)' : source === 'true' ? 'whole source' : source === 'false' ? 'not logged' : `first ${formatNumber(Number(source))} characters`}`,
  );
  lines.push(`Reformat source: ${form.reformat === '' ? 'default (yes)' : form.reformat === 'true' ? 'yes' : 'no'}`);
  return lines;
}

/** Index names that match the filter, the selected ones kept on top of the list order. */
export function filterIndexNames(names: readonly string[], query: string): string[] {
  const matches = textMatcher(query);
  return names.filter((name) => matches(name));
}

/** Sorts index names with regular indices first, then dot-prefixed system and hidden ones. */
export function sortIndexNames(names: readonly string[]): string[] {
  return [...new Set(names)].sort(
    (left, right) => Number(left.startsWith('.')) - Number(right.startsWith('.')) || left.localeCompare(right),
  );
}

/** `.ds-<stream>-<date>-<generation>`: a backing index of a data stream. */
export function isBackingIndex(name: string): boolean {
  return name.startsWith('.ds-');
}

/**
 * Index names of the picker by kind: regular indices (the only ones "Select
 * all" takes), data stream backing indices, and system or hidden indices.
 */
export function groupPickerNames(names: readonly string[]): {
  readonly regular: readonly string[];
  readonly backing: readonly string[];
  readonly system: readonly string[];
} {
  const sorted = sortIndexNames(names);
  return {
    regular: sorted.filter((name) => !name.startsWith('.')),
    backing: sorted.filter(isBackingIndex),
    system: sorted.filter((name) => name.startsWith('.') && !isBackingIndex(name)),
  };
}
