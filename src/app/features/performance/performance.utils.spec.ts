import { describe, expect, it } from 'vitest';
import {
  BLOCK_CAPTURE,
  BUSY_CPU_CAPTURE,
  BUSY_SEARCH_CAPTURE,
  EMPTY_CPU_CAPTURE,
  IDLE_CPU_CAPTURE,
  MEMORY_CAPTURE,
  PENDING_TASKS,
  SLOWLOG_RESPONSE,
  THREAD_POOL_ROWS,
  TRANSPORT_IDLE_CAPTURE,
  WAIT_CAPTURE,
} from './performance.fixtures';
import { SlowlogForm, ThreadPoolRow } from './performance.models';
import {
  BUSY_PERCENT,
  DEFAULT_HOT_THREADS_REQUEST,
  HOT_THREADS_SNAPSHOTS,
  REFORMAT_KEY,
  SLOWLOG_PRESETS,
  SOURCE_KEY,
  THRESHOLD_KEYS,
  attentionRank,
  buildSlowlogSettings,
  countsForHint,
  describeForm,
  describeLevels,
  describeOverwrites,
  detectPreset,
  emptyThresholds,
  filterIndexNames,
  filterPendingTasks,
  filterThreadPools,
  formFromIndex,
  frameKind,
  groupPickerNames,
  hasEmptyFields,
  hotThreadsPayload,
  isBusyThread,
  isPlumbingFrame,
  isSaturated,
  isSaturatedAndQueueing,
  isTimeValue,
  nextTab,
  normalizePendingTasks,
  normalizeThreadPools,
  onlyIdleWaits,
  orderWarning,
  otherSettingLabel,
  parseFrame,
  parseHotThreads,
  parseSlowlog,
  parseTab,
  poolDetail,
  poolHint,
  poolLead,
  poolLoads,
  presetThresholds,
  priorityTone,
  queueLevel,
  queuePercent,
  quietHeading,
  rejectionIncreases,
  rejectionSample,
  resetSlowlogSettings,
  sameForm,
  settingLabel,
  sortHotNodes,
  sortIndexNames,
  sortPendingTasks,
  sortThreadPools,
  sourceError,
  stackKind,
  summarizeHotThreads,
  summarizePendingTasks,
  summarizeThreadPools,
  thresholdError,
  thresholdKey,
  thresholdWarning,
  threadPoolOf,
  timeValueMillis,
  totalIncrease,
  validateSlowlogForm,
  validateThreads,
  verifySlowlog,
} from './performance.utils';

describe('tabs', () => {
  it('parses known tabs and falls back to hot threads', () => {
    expect(parseTab('slow-logs')).toBe('slow-logs');
    expect(parseTab('thread-pools')).toBe('thread-pools');
    expect(parseTab('nope')).toBe('hot-threads');
    expect(parseTab(null)).toBe('hot-threads');
  });

  it('moves with arrows, Home and End, wrapping around', () => {
    expect(nextTab('hot-threads', 'ArrowRight')).toBe('thread-pools');
    expect(nextTab('slow-logs', 'ArrowRight')).toBe('hot-threads');
    expect(nextTab('hot-threads', 'ArrowLeft')).toBe('slow-logs');
    expect(nextTab('pending-tasks', 'Home')).toBe('hot-threads');
    expect(nextTab('hot-threads', 'End')).toBe('slow-logs');
    expect(nextTab('hot-threads', 'Enter')).toBeNull();
  });
});

describe('hot threads request', () => {
  it('validates the thread count', () => {
    expect(validateThreads(3)).toBeNull();
    expect(validateThreads('50')).toBeNull();
    expect(validateThreads('1')).toBeNull();
    expect(validateThreads('')).toBe('Enter how many threads to show per node');
    expect(validateThreads('0')).toBe('Enter a whole number from 1 to 50');
    expect(validateThreads('51')).toBe('Enter a whole number from 1 to 50');
    expect(validateThreads('2.5')).toBe('Enter a whole number from 1 to 50');
    expect(validateThreads(null)).toBe('Enter how many threads to show per node');
  });

  it('builds the payload, omitting the node for every node', () => {
    expect(hotThreadsPayload(DEFAULT_HOT_THREADS_REQUEST)).toEqual({
      threads: 3,
      interval: '500ms',
      type: 'cpu',
      ignore_idle_threads: true,
    });
    expect(
      hotThreadsPayload({ node: 'abc', type: 'mem', threads: 10, interval: '2s', ignoreIdleThreads: false }),
    ).toEqual({ node: 'abc', threads: 10, interval: '2s', type: 'mem', ignore_idle_threads: false });
  });
});

describe('parseHotThreads', () => {
  it('parses nodes, threads, cpu/other split and stack groups of a busy capture', () => {
    const report = parseHotThreads(BUSY_CPU_CAPTURE);
    expect(report.unparsed).toBe(0);
    expect(report.nodes.map((node) => node.name)).toEqual(['es-node-3', 'es-node-2', 'es-node-1']);

    const [idle, node2, node1] = report.nodes;
    expect(idle?.threads).toEqual([]);
    expect(idle?.id).toBe('dmdk_a7-TrKWtlTZ9-ZHzQ');
    expect(idle?.address).toBe('127.0.0.1:9302');
    expect(idle?.interval).toBe('1s');
    expect(idle?.busiestThreads).toBe(4);
    expect(idle?.ignoreIdleThreads).toBe(true);
    expect(idle?.capturedAt).toBe(Date.parse('2026-10-14T21:25:04.783Z'));

    expect(node2?.threads).toHaveLength(3);
    const hottest = node2?.threads[0];
    expect(hottest).toMatchObject({
      name: 'elasticsearch[es-node-2][search_worker][T#6]',
      pool: 'search_worker',
      worker: 'T#6',
      type: 'cpu',
      percent: 90.9,
      cpuPercent: 6.9,
      otherPercent: 84,
      usage: '909ms out of 1s',
      allocatedBytes: null,
      idle: false,
    });
    // Stacks doing work first (the one with Lucene frames first among equals),
    // then the 6/10 that only share the three executor frames at the bottom.
    expect(hottest?.groups.map((group) => [group.snapshots, group.total, group.frames.length, group.kind])).toEqual([
      [2, 10, 25, 'work'],
      [2, 10, 12, 'work'],
      [6, 10, 3, 'base'],
    ]);
    // The focus skips executor plumbing (TimedRunnable…) and comes from the first stack.
    expect(hottest?.focus?.className).toBe('org.apache.lucene.codecs.lucene90.blocktree.IntersectTermsEnum');
    expect(hottest?.focusGroup).toBe(0);

    // A worker parked for work in most snapshots still opens on the stack doing work.
    const parked = node2?.threads[1];
    expect(parked?.groups.map((group) => [group.snapshots, group.kind])).toEqual([
      [3, 'work'],
      [2, 'work'],
      [4, 'idle'],
    ]);
    expect(parked?.idle).toBe(false);
    expect(parked?.focus?.simpleName).toBe('BooleanScorer');

    const search = node1?.threads[0];
    expect(search).toMatchObject({ pool: 'search', worker: 'T#1', percent: 82.4, cpuPercent: 6.7, otherPercent: 75.7, idlePercent: null });
    const groups = search?.groups ?? [];
    // Parked in FutureTask.get waiting for its search workers: waiting for a result is work, not idle.
    expect(groups.map((group) => [group.snapshots, group.unique, group.kind])).toEqual([
      [5, false, 'work'],
      [2, false, 'work'],
      [2, false, 'work'],
      [1, true, 'work'],
    ]);
    expect(search?.focus?.simpleName).toBe('TaskExecutor$TaskGroup');
    // A unique snapshot belongs to the same 10 snapshots as its siblings.
    expect(groups[3]?.total).toBe(10);
    expect(groups.reduce((sum, group) => sum + group.snapshots, 0)).toBe(10);
  });

  it('counts a thread with only a unique snapshot out of the 10 snapshots taken', () => {
    const [node3, node2] = parseHotThreads(BUSY_SEARCH_CAPTURE).nodes;
    const unique = node3?.threads[0];
    expect(unique).toMatchObject({ pool: 'search_worker', worker: 'T#1', percent: 33.1 });
    expect(unique?.groups.map((group) => [group.snapshots, group.total, group.unique, group.frames.length])).toEqual([
      [1, HOT_THREADS_SNAPSHOTS, true, 25],
    ]);
    expect(unique?.focus?.simpleName).toBe('IntersectTermsEnum');

    // Only an executor suffix (4/10) and parked for work (6/10): no stack names the work.
    const [base, rewrite] = node2?.threads ?? [];
    expect(base?.groups.map((group) => [group.snapshots, group.kind])).toEqual([
      [4, 'base'],
      [6, 'idle'],
    ]);
    expect(base?.focus).toBeNull();
    expect(base?.focusGroup).toBeNull();
    expect(base?.idle).toBe(false);
    expect(rewrite?.groups.map((group) => [group.snapshots, group.kind])).toEqual([
      [2, 'work'],
      [8, 'base'],
    ]);
    expect(rewrite?.focus?.simpleName).toBe('AbstractMultiTermQueryConstantScoreWrapper$RewritingWeight$1');
  });

  it('parses network threads, which 8.x prints as [cpu=…, idle=…]', () => {
    const report = parseHotThreads(TRANSPORT_IDLE_CAPTURE);
    expect(report.unparsed).toBe(0);
    const [node] = report.nodes;
    expect(node?.threads.map((thread) => thread.pool)).toEqual([
      'transport_worker',
      'scheduler',
      'inference_utility',
      'refresh',
      'refresh',
      'timer',
    ]);
    // One stack each: nothing is merged into the thread printed before.
    expect(node?.threads.map((thread) => thread.groups.length)).toEqual([1, 1, 1, 1, 1, 1]);
    expect(node?.threads[0]).toMatchObject({
      percent: 0,
      cpuPercent: 0,
      otherPercent: null,
      idlePercent: 100,
      // "(500ms out of 500ms)" counts idle time: not shown as load.
      usage: null,
      idle: true,
    });
    expect(node?.threads[1]).toMatchObject({ cpuPercent: 0.1, otherPercent: 0, idlePercent: null, usage: '395.1micros out of 500ms' });
  });

  it('starts a new thread on a usage line it cannot fully read', () => {
    const text = [
      '::: {node-a}{abc}{def}{10.0.0.1}{10.0.0.1:9300}',
      "   12.0% [cpu=2.0%, other=10.0%] (60ms out of 500ms) cpu usage by thread 'elasticsearch[node-a][write][T#1]'",
      '     2/10 snapshots sharing following 1 elements',
      '       org.elasticsearch.index.engine.InternalEngine.index(InternalEngine.java:900)',
      "    7.5% [cpu=7.5%, someday=92.5%] (500ms out of 500ms) cpu usage by thread 'elasticsearch[node-a][transport_worker][T#2]'",
      '     10/10 snapshots sharing following 1 elements',
      '       java.base@22.0.1/sun.nio.ch.EPoll.wait(Native Method)',
    ].join('\n');
    const [node] = parseHotThreads(text).nodes;
    expect(node?.threads.map((thread) => [thread.pool, thread.percent, thread.groups.length])).toEqual([
      ['write', 12, 1],
      ['transport_worker', 7.5, 1],
    ]);
  });

  it('marks a sleeping thread as idle and keeps its 0.0% load', () => {
    const [node] = parseHotThreads(IDLE_CPU_CAPTURE).nodes;
    const thread = node?.threads[0];
    expect(thread).toMatchObject({
      pool: 'inference_utility',
      percent: 0,
      cpuPercent: 0,
      otherPercent: 0,
      usage: '187.9micros out of 500ms',
      idle: true,
    });
    expect(thread?.groups[0]?.frames).toHaveLength(16);
    expect(isBusyThread(thread!)).toBe(false);
  });

  it('lists nodes without threads when everything is idle', () => {
    const report = parseHotThreads(EMPTY_CPU_CAPTURE);
    expect(report.nodes).toHaveLength(3);
    expect(report.nodes.every((node) => node.threads.length === 0)).toBe(true);
    expect(summarizeHotThreads(report.nodes)).toEqual({ nodes: 3, threads: 0, busy: 0, hottest: null });
  });

  it('classifies stacks as work, base-only or idle', () => {
    const frames = (...lines: string[]) => lines.map((line) => parseFrame(line));
    const getTask = frames(
      'java.base@22.0.1/jdk.internal.misc.Unsafe.park(Native Method)',
      'java.base@22.0.1/java.util.concurrent.ThreadPoolExecutor.getTask(ThreadPoolExecutor.java:1070)',
    );
    expect(stackKind(getTask)).toBe('idle');
    expect(stackKind(frames('java.base@22.0.1/sun.nio.ch.EPoll.wait(Native Method)'))).toBe('idle');
    // Parked waiting for a result (not for the next task) is work.
    expect(
      stackKind(
        frames(
          'java.base@22.0.1/jdk.internal.misc.Unsafe.park(Native Method)',
          'java.base@22.0.1/java.util.concurrent.FutureTask.get(FutureTask.java:190)',
        ),
      ),
    ).toBe('work');
    expect(
      stackKind(
        frames(
          'app/org.elasticsearch.server@8.15.3/org.elasticsearch.common.util.concurrent.TimedRunnable.doRun(TimedRunnable.java:33)',
          'java.base@22.0.1/java.lang.Thread.run(Thread.java:1570)',
        ),
      ),
    ).toBe('base');
    expect(stackKind([])).toBe('work');
    expect(isPlumbingFrame(parseFrame('org.elasticsearch.action.ActionRunnable$4.doRun(ActionRunnable.java:100)'))).toBe(true);
    expect(isPlumbingFrame(parseFrame('org.elasticsearch.search.query.QueryPhase.execute(QueryPhase.java:62)'))).toBe(false);
  });

  it('parses wait captures without a cpu/other split', () => {
    const [node] = parseHotThreads(WAIT_CAPTURE).nodes;
    expect(node?.ignoreIdleThreads).toBe(false);
    expect(node?.threads.map((thread) => [thread.name, thread.pool, thread.type, thread.percent, thread.cpuPercent])).toEqual([
      ['Connection evictor', null, 'wait', 100.2, null],
      ['elasticsearch[es-node-1][generic][T#6]', 'generic', 'wait', 100.2, null],
      ['elasticsearch[es-node-1][generic][T#9]', 'generic', 'wait', 100.2, null],
    ]);
    expect(node?.threads.every((thread) => thread.idle)).toBe(true);
  });

  it('parses block captures', () => {
    const [node] = parseHotThreads(BLOCK_CAPTURE).nodes;
    const thread = node?.threads[0];
    expect(thread).toMatchObject({ name: 'elasticsearch-cli-monitor-thread', type: 'block', percent: 0, usage: '0s out of 500ms' });
    expect(thread?.idle).toBe(false);
    expect(thread?.focus?.method).toBe('lambda$startCliMonitorThread$1');
  });

  it('parses memory captures into bytes', () => {
    const [node] = parseHotThreads(MEMORY_CAPTURE).nodes;
    expect(node?.threads.map((thread) => [thread.pool, thread.allocatedBytes, thread.percent])).toEqual([
      ['search', 71 * 1024 ** 2, null],
      ['search', 45 * 1024 ** 2, null],
      ['search', Math.round(38.3 * 1024 ** 2), null],
    ]);
    expect(node?.threads.every((thread) => thread.type === 'mem')).toBe(true);
    expect(node?.threads[1]?.groups.map((group) => group.snapshots)).toEqual([8, 2]);
  });

  it('counts lines it does not understand and survives empty text', () => {
    expect(parseHotThreads('')).toEqual({ nodes: [], unparsed: 0 });
    expect(parseHotThreads('something else\n').unparsed).toBe(1);
  });

  it('parses the 7.x format', () => {
    const text = [
      '::: {node-a}{abc}{def}{10.0.0.1}{10.0.0.1:9300}{dim}{xpack.installed=true}',
      '   Hot threads at 2021-03-01T10:00:00.000Z, interval=500ms, busiestThreads=3, ignoreIdleThreads=true:',
      '   ',
      '   12.4% (62ms out of 500ms) cpu usage by thread \'elasticsearch[node-a][write][T#2]\'',
      '     2/10 snapshots sharing following 2 elements',
      '       org.elasticsearch.index.engine.InternalEngine.index(InternalEngine.java:900)',
      '       java.lang.Thread.run(Thread.java:834)',
    ].join('\n');
    const [node] = parseHotThreads(text).nodes;
    expect(node?.address).toBe('10.0.0.1:9300');
    expect(node?.threads[0]).toMatchObject({ pool: 'write', percent: 12.4, cpuPercent: null, usage: '62ms out of 500ms' });
    expect(node?.threads[0]?.groups[0]?.frames.map((frame) => frame.kind)).toEqual(['elasticsearch', 'jdk']);
  });
});

describe('frames and thread names', () => {
  it('parses module, class, method and location', () => {
    expect(
      parseFrame('       app/org.elasticsearch.server@8.15.3/org.elasticsearch.search.query.QueryPhase.execute(QueryPhase.java:62)'),
    ).toEqual({
      raw: 'app/org.elasticsearch.server@8.15.3/org.elasticsearch.search.query.QueryPhase.execute(QueryPhase.java:62)',
      className: 'org.elasticsearch.search.query.QueryPhase',
      simpleName: 'QueryPhase',
      packageName: 'org.elasticsearch.search.query',
      method: 'execute',
      location: 'QueryPhase.java:62',
      module: 'org.elasticsearch.server@8.15.3',
      kind: 'elasticsearch',
    });
    const lambda = parseFrame(
      'org.elasticsearch.inference@8.15.3/org.elasticsearch.xpack.inference.external.http.sender.RequestExecutorService$$Lambda/0x00007f2c43c78b68.sleep(Unknown Source)',
    );
    expect(lambda.simpleName).toBe('RequestExecutorService$$Lambda');
    expect(lambda.method).toBe('sleep');
    expect(lambda.location).toBe('Unknown Source');
    expect(parseFrame('java.base@22.0.1/jdk.internal.misc.Unsafe.park(Native Method)')).toMatchObject({
      module: 'java.base@22.0.1',
      className: 'jdk.internal.misc.Unsafe',
      kind: 'jdk',
    });
    expect(parseFrame('app/org.apache.lucene.core@9.11.1/org.apache.lucene.search.Weight.bulkScorer(Weight.java:173)').kind).toBe(
      'lucene',
    );
    expect(parseFrame('not a frame')).toMatchObject({ raw: 'not a frame', className: '', kind: 'other' });
  });

  it('classifies frames', () => {
    expect(frameKind('org.elasticsearch.X')).toBe('elasticsearch');
    expect(frameKind('org.apache.lucene.X')).toBe('lucene');
    expect(frameKind('java.lang.Thread')).toBe('jdk');
    expect(frameKind('sun.nio.ch.EPoll')).toBe('jdk');
    expect(frameKind('io.netty.channel.nio.NioEventLoop')).toBe('other');
  });

  it('extracts the pool and worker of a thread', () => {
    expect(threadPoolOf('elasticsearch[es-node-1][search][T#3]')).toEqual({ pool: 'search', worker: 'T#3' });
    expect(threadPoolOf('elasticsearch[es-node-1][[timer]]')).toEqual({ pool: 'timer', worker: null });
    expect(threadPoolOf('elasticsearch[n][[logs][0]: Lucene Merge Thread #4]')).toEqual({ pool: 'merge', worker: '#4' });
    expect(threadPoolOf('elasticsearch[n][masterService#updateTask][T#1]')).toEqual({
      pool: 'masterService#updateTask',
      worker: 'T#1',
    });
    expect(threadPoolOf('elasticsearch[keepAlive/8.15.3]')).toEqual({ pool: null, worker: null });
    expect(threadPoolOf('Connection evictor')).toEqual({ pool: null, worker: null });
  });
});

describe('hot threads summaries', () => {
  const nodes = parseHotThreads(BUSY_CPU_CAPTURE).nodes;

  it('sorts nodes by their busiest thread and threads by load', () => {
    const sorted = sortHotNodes(nodes);
    expect(sorted.map((node) => node.name)).toEqual(['es-node-2', 'es-node-1', 'es-node-3']);
    expect(sorted[0]?.threads.map((thread) => thread.percent)).toEqual([90.9, 88.5, 88.4]);
  });

  it('sums load per pool over busy threads, with the cpu/other split', () => {
    expect(poolLoads(nodes)).toEqual([
      { pool: 'search_worker', threads: 3, total: 267.8, max: 90.9, maxCpu: 6.9, cpu: 27.5, other: 240.3, nodes: ['es-node-2'] },
      { pool: 'search', threads: 1, total: 82.4, max: 82.4, maxCpu: 6.7, cpu: 6.7, other: 75.7, nodes: ['es-node-1'] },
    ]);
    // 7.x has no split.
    const [legacy] = poolLoads(
      parseHotThreads(
        "::: {a}{b}\n   12.4% (62ms out of 500ms) cpu usage by thread 'elasticsearch[a][write][T#2]'\n     2/10 snapshots sharing following 1 elements\n       java.lang.Thread.run(Thread.java:834)",
      ).nodes,
    );
    expect(legacy).toMatchObject({ pool: 'write', cpu: null, other: null, maxCpu: null });
  });

  it('words the lead by what the busy time was spent on', () => {
    const [searchWorker] = poolLoads(nodes);
    expect(poolLead('cpu', poolHint('search_worker'), searchWorker)).toBe(
      'Most busy time went to the search worker pool, mostly waiting on I/O or for a free CPU core rather than computing',
    );
    expect(poolDetail('cpu', searchWorker!)).toBe('3 threads on es-node-2, up to 90.9% busy with 6.9% on CPU');
    const cpuBound = { ...searchWorker!, cpu: 200, other: 67.8 };
    expect(poolLead('cpu', poolHint('search_worker'), cpuBound)).toBe('Most CPU time went to the search worker pool');
    expect(poolDetail('wait', { ...searchWorker!, maxCpu: null })).toBe('3 threads on es-node-2, up to 90.9%');
    expect(poolDetail('mem', searchWorker!)).toBe('3 threads on es-node-2');
  });

  it('leaves idle workers out of the hint of wait and block captures', () => {
    const wait = parseHotThreads(WAIT_CAPTURE).nodes;
    expect(wait[0]?.threads.every((thread) => !countsForHint(thread))).toBe(true);
    expect(poolLoads(wait)).toEqual([]);
    expect(onlyIdleWaits(wait)).toBe(true);
    // CPU captures of idle threads are not "only idle waits".
    expect(onlyIdleWaits(parseHotThreads(TRANSPORT_IDLE_CAPTURE).nodes)).toBe(false);
    expect(onlyIdleWaits([])).toBe(false);
    const thread = wait[0]!.threads[1]!;
    expect(countsForHint({ ...thread, idle: false })).toBe(true);
  });

  it('summarizes the capture', () => {
    const summary = summarizeHotThreads(nodes);
    expect(summary).toMatchObject({ nodes: 3, threads: 4, busy: 4 });
    expect(summary.hottest?.node).toBe('es-node-2');
    expect(summary.hottest?.thread.percent).toBe(90.9);
  });

  it('only counts threads above the busy threshold for cpu and block captures', () => {
    const [node] = parseHotThreads(IDLE_CPU_CAPTURE).nodes;
    const thread = node!.threads[0]!;
    expect(isBusyThread({ ...thread, percent: BUSY_PERCENT })).toBe(true);
    expect(isBusyThread({ ...thread, percent: BUSY_PERCENT - 0.1 })).toBe(false);
    expect(isBusyThread({ ...thread, type: 'wait', percent: 0 })).toBe(true);
    expect(poolLoads([node!])).toEqual([]);
  });

  it('explains pools in plain language', () => {
    expect(poolHint('search').label).toBe('search');
    expect(poolHint('write').text).toContain('indexing');
    expect(poolHint('transport_worker').label).toBe('network');
    expect(poolHint('ml_utility').text).toContain('machine learning');
    expect(poolHint('custom_pool')).toEqual({ pool: 'custom_pool', label: 'custom_pool', text: 'It is the custom_pool thread pool of Elasticsearch.' });
    expect(poolHint(null).pool).toBe('');
    // Hot threads only lists Java threads: GC is never one of them.
    expect(poolHint(null).text).toContain('Garbage collection is not shown by hot threads');
    expect(poolLead('cpu', poolHint('search'))).toBe('Most CPU time went to the search pool');
    expect(poolLead('block', poolHint('write'))).toBe('Threads of the write pool were blocked the longest, waiting for locks');
    expect(poolLead('mem', poolHint(null))).toBe('Threads of threads outside the thread pools allocated the most memory');
    expect(quietHeading('cpu')).toBe('No busy threads');
    expect(quietHeading('block')).toBe('No blocked threads');
  });
});

describe('thread pools', () => {
  const rows = normalizeThreadPools(THREAD_POOL_ROWS);

  function row(node: string, pool: string): ThreadPoolRow {
    const found = rows.find((candidate) => candidate.node === node && candidate.pool === pool);
    if (!found) {
      throw new Error(`missing ${node}/${pool}`);
    }
    return found;
  }

  it('converts the string columns', () => {
    expect(row('es-node-1', 'write')).toEqual({
      key: 'es-node-1/write',
      node: 'es-node-1',
      pool: 'write',
      type: 'fixed',
      active: 0,
      queue: 0,
      rejected: 0,
      completed: 1627,
      size: 4,
      queueSize: 10000,
      interesting: true,
    });
    // Idle scaling pools report no size and an unbounded queue.
    expect(row('es-node-1', 'azure_event_loop')).toMatchObject({ size: null, queueSize: null, interesting: false });
    expect(normalizeThreadPools(null)).toEqual([]);
    expect(normalizeThreadPools([{ name: 'x', active: 'abc' }])[0]).toMatchObject({ node: '', active: 0, size: null });
  });

  it('measures how full a bounded queue is', () => {
    const search = row('es-node-1', 'search');
    expect(queuePercent(search)).toBe(0);
    expect(queuePercent({ ...search, queue: 500 })).toBe(50);
    expect(queueLevel({ ...search, queue: 499 })).toBe('ok');
    expect(queueLevel({ ...search, queue: 500 })).toBe('warn');
    expect(queueLevel({ ...search, queue: 800 })).toBe('danger');
    expect(queuePercent({ ...search, queue: 2000 })).toBe(100);
    expect(queuePercent(row('es-node-1', 'generic'))).toBeNull();
    expect(queueLevel({ ...row('es-node-1', 'generic'), queue: 9000 })).toBe('ok');
  });

  it('detects saturated pools, and the ones where work queues', () => {
    const search = row('es-node-1', 'search');
    expect(isSaturated(search)).toBe(false);
    expect(isSaturated({ ...search, active: 7 })).toBe(true);
    expect(isSaturated({ ...row('es-node-1', 'azure_event_loop'), active: 3 })).toBe(false);
    // A one-thread pool running its force merge is busy, not in trouble.
    const forceMerge = { ...row('es-node-1', 'force_merge'), active: 1 };
    expect(forceMerge.size).toBe(1);
    expect(isSaturated(forceMerge)).toBe(true);
    expect(isSaturatedAndQueueing(forceMerge)).toBe(false);
    expect(isSaturatedAndQueueing({ ...forceMerge, queue: 2 })).toBe(true);
  });

  it('hides uninteresting pools unless they queue or reject', () => {
    const shown = filterThreadPools(rows, '', false).map((entry) => entry.key);
    expect(shown).toContain('es-node-1/search');
    expect(shown).not.toContain('es-node-1/azure_event_loop');
    expect(shown).not.toContain('es-node-1/search_worker');
    const rejecting = { ...row('es-node-1', 'analyze'), rejected: 3 };
    expect(filterThreadPools([rejecting], '', false)).toHaveLength(1);
    expect(filterThreadPools(rows, '', true)).toHaveLength(rows.length);
    expect(filterThreadPools(rows, '^es-node-2 wr', true).map((entry) => entry.key)).toEqual(['es-node-2/write']);
    expect(filterThreadPools(rows, 'node-1 search', true).map((entry) => entry.key)).toEqual([
      'es-node-1/search',
      'es-node-1/search_worker',
    ]);
  });

  it('sorts interesting pools first, then by node', () => {
    const sorted = sortThreadPools(filterThreadPools(rows, '', false), 'pool', false).map((entry) => entry.key);
    expect(sorted.slice(0, 4)).toEqual(['es-node-1/search', 'es-node-2/search', 'es-node-1/write', 'es-node-2/write']);
    const byNode = sortThreadPools(rows, 'node', false).map((entry) => entry.key);
    expect(byNode[0]).toBe('es-node-1/search');
    expect(sortThreadPools(rows, 'completed', true)[0]?.key).toBe('es-node-1/refresh');
    // Ties keep the pool order whatever the direction.
    expect(sortThreadPools(rows, 'rejected', true)[0]?.key).toBe('es-node-1/search');
  });

  it('puts rows that need attention first in the default order', () => {
    const rejecting = { ...row('es-node-1', 'analyze'), rejected: 141 };
    const queueing = { ...row('es-node-2', 'snapshot'), queue: 3 };
    const growing = { ...row('es-node-2', 'search_worker'), rejected: 5 };
    const sample = [...rows.filter((entry) => ![rejecting.key, queueing.key, growing.key].includes(entry.key)), rejecting, queueing, growing];
    const increases = new Map([[growing.key, 2]]);
    expect(attentionRank(growing, increases)).toBe(0);
    expect(attentionRank(queueing, increases)).toBe(1);
    expect(attentionRank(rejecting, increases)).toBe(2);
    expect(attentionRank(row('es-node-1', 'search'), increases)).toBe(3);
    const sorted = sortThreadPools(sample, 'pool', false, increases).map((entry) => entry.key);
    expect(sorted.slice(0, 4)).toEqual([growing.key, queueing.key, rejecting.key, 'es-node-1/search']);
    // Reversing the pool order keeps attention first.
    expect(sortThreadPools(sample, 'pool', true, increases).slice(0, 3).map((entry) => entry.key)).toEqual([
      growing.key,
      queueing.key,
      rejecting.key,
    ]);
  });

  it('reports rejections that grew since the previous sample', () => {
    const before = rejectionSample(rows);
    const after = rows.map((entry) =>
      entry.key === 'es-node-1/analyze' ? { ...entry, rejected: entry.rejected + 4 } : entry.key === 'es-node-2/write' ? { ...entry, rejected: 0 } : entry,
    );
    expect([...rejectionIncreases(before, after)]).toEqual([['es-node-1/analyze', 4]]);
    expect(rejectionIncreases(null, after).size).toBe(0);
    expect(totalIncrease(rejectionIncreases(before, after))).toBe(4);
    expect(totalIncrease(new Map())).toBe(0);
  });

  it('counts from the restart when a counter goes down', () => {
    const analyze = row('es-node-1', 'analyze');
    const before = new Map([[analyze.key, 141]]);
    // The node restarted and has rejected 3 since: those 3 are new.
    expect([...rejectionIncreases(before, [{ ...analyze, rejected: 3 }])]).toEqual([[analyze.key, 3]]);
    expect(rejectionIncreases(before, [{ ...analyze, rejected: 0 }]).size).toBe(0);
    // The next sample compares with the post-restart value, not the old baseline.
    const next = rejectionSample([{ ...analyze, rejected: 3 }]);
    expect([...rejectionIncreases(next, [{ ...analyze, rejected: 150 }])]).toEqual([[analyze.key, 147]]);
  });

  it('summarizes every pool', () => {
    const summary = summarizeThreadPools([
      ...rows,
      { ...row('es-node-1', 'search'), key: 'x/search', node: 'x', active: 7, queue: 900, rejected: 12 },
    ]);
    expect(summary).toEqual({
      active: rows.reduce((sum, entry) => sum + entry.active, 0) + 7,
      queued: 900,
      rejected: 12,
      nearCapacity: 1,
      saturated: 1,
      saturatedQueueing: 1,
      nodes: 3,
    });
  });
});

describe('pending tasks', () => {
  const tasks = normalizePendingTasks(PENDING_TASKS);

  it('normalizes the master queue', () => {
    expect(tasks).toHaveLength(13);
    expect(tasks[0]).toMatchObject({
      position: 0,
      order: 2573,
      priority: 'URGENT',
      rank: 1,
      source: 'create-index [tmp-performance-p3], cause [api]',
      executing: true,
      timeInQueueMillis: 202,
    });
    expect(normalizePendingTasks({ tasks: [{ priority: 'low', time_in_queue_millis: 'x' }] })[0]).toMatchObject({
      position: 0,
      order: 0,
      priority: 'LOW',
      rank: 4,
      source: '',
      executing: false,
      timeInQueueMillis: 0,
    });
    expect(normalizePendingTasks({})).toEqual([]);
    expect(normalizePendingTasks(null)).toEqual([]);
  });

  it('sorts in the order the master runs the queue, by priority or by time in queue', () => {
    const mixed = normalizePendingTasks({
      tasks: [
        { insert_order: 3, priority: 'NORMAL', time_in_queue_millis: 50, source: 'c' },
        { insert_order: 1, priority: 'URGENT', time_in_queue_millis: 900, source: 'a' },
        { insert_order: 2, priority: 'IMMEDIATE', time_in_queue_millis: 10, source: 'b' },
        { insert_order: 9, priority: 'URGENT', time_in_queue_millis: 5, source: 'later urgent' },
        { insert_order: 4, priority: 'NORMAL', time_in_queue_millis: 70, source: 'running', executing: true },
      ],
    });
    // Executing first, then by priority; a later URGENT task runs before earlier NORMAL ones.
    expect(sortPendingTasks(mixed, 'queue', false).map((task) => task.source)).toEqual(['running', 'b', 'a', 'later urgent', 'c']);
    expect(sortPendingTasks(mixed, 'queue', true).map((task) => task.source)).toEqual(['c', 'later urgent', 'a', 'b', 'running']);
    // Within a priority, Elasticsearch's own order wins over insert_order (8.x keeps batches together).
    const live = sortPendingTasks(tasks, 'queue', false);
    expect(live[0]?.executing).toBe(true);
    expect(live.map((task) => task.position)).toEqual(tasks.map((task) => task.position));
    expect(sortPendingTasks(mixed, 'priority', false).map((task) => task.priority)).toEqual([
      'IMMEDIATE',
      'URGENT',
      'URGENT',
      'NORMAL',
      'NORMAL',
    ]);
    expect(sortPendingTasks(mixed, 'time', true).map((task) => task.timeInQueueMillis)).toEqual([900, 70, 50, 10, 5]);
    expect(filterPendingTasks(mixed, 'urgent').map((task) => task.source)).toEqual(['a', 'later urgent']);
    expect(filterPendingTasks(tasks, 'p1[0-2]').map((task) => task.order)).toEqual([2576, 2582]);
  });

  it('summarizes the queue', () => {
    expect(summarizePendingTasks(tasks)).toMatchObject({ total: 13, executing: 1, urgent: 13 });
    expect(summarizePendingTasks(tasks).oldest?.order).toBe(2573);
    expect(summarizePendingTasks([])).toEqual({ total: 0, executing: 0, oldest: null, urgent: 0 });
    expect(priorityTone('IMMEDIATE')).toBe('red');
    expect(priorityTone('urgent')).toBe('yellow');
    expect(priorityTone('HIGH')).toBe('blue');
    expect(priorityTone('LANGUID')).toBe('gray');
  });
});

describe('slow logs', () => {
  const indices = parseSlowlog(SLOWLOG_RESPONSE);

  it('parses the explicitly set settings per index', () => {
    expect(indices.map((index) => index.index)).toEqual(['tmp-performance-a', 'tmp-performance-b']);
    const [partial, moderate] = indices;
    expect(moderate?.preset).toBe('moderate');
    expect(moderate?.active).toBe(12);
    expect(moderate?.other).toEqual({});
    expect(partial?.preset).toBe('custom');
    expect(partial?.active).toBe(3);
    expect(partial?.thresholds.fetch).toEqual({ warn: '200ms', info: '', debug: '', trace: '1s' });
    expect(partial?.thresholds.index.warn).toBe('-1');
    expect(partial?.other).toEqual({
      [REFORMAT_KEY]: 'false',
      [SOURCE_KEY]: '1000',
      'index.search.slowlog.include.user': 'true',
    });
    expect(parseSlowlog({})).toEqual([]);
    expect(parseSlowlog(null)).toEqual([]);
  });

  it('flattens nested settings and ignores unrelated ones', () => {
    const [index] = parseSlowlog({
      logs: {
        settings: {
          index: { search: { slowlog: { threshold: { query: { warn: '1s' } } } }, number_of_shards: '1' },
        },
      },
      empty: { settings: {} },
    });
    expect(index?.index).toBe('logs');
    expect(index?.settings).toEqual({ 'index.search.slowlog.threshold.query.warn': '1s' });
  });

  it('builds threshold keys', () => {
    expect(thresholdKey('query', 'warn')).toBe('index.search.slowlog.threshold.query.warn');
    expect(thresholdKey('fetch', 'trace')).toBe('index.search.slowlog.threshold.fetch.trace');
    expect(thresholdKey('index', 'debug')).toBe('index.indexing.slowlog.threshold.index.debug');
    expect(THRESHOLD_KEYS).toHaveLength(12);
  });

  it('validates time values the way Elasticsearch does', () => {
    for (const value of ['-1', '0', '0s', '500ms', '10s', '5S', '2m', '1h', '1d', '100nanos', '500micros', ' 5s ']) {
      expect(isTimeValue(value)).toBe(true);
    }
    for (const value of ['', '1.5s', '-1s', '10', '10x', 'fast', '-2']) {
      expect(isTimeValue(value)).toBe(false);
    }
    expect(thresholdError('')).toBeNull();
    expect(thresholdError('1.5s')).toBe('Elasticsearch does not accept fractions: use a smaller unit, such as 1500ms for 1.5s');
    expect(thresholdError('10')).toBe('Add a unit, such as 10ms or 10s');
    expect(thresholdError('soon')).toBe('Enter a time such as 500ms, 5s or 1m, or -1 to turn this level off');
    // Elasticsearch holds time values in a long.
    expect(thresholdError('999999999999999999ms')).toBeNull();
    expect(thresholdError('99999999999999999999s')).toBe('That number is too large: use at most 18 digits and a larger unit, such as 10m');
    expect(thresholdError('1234567890123456789')).toBe('That number is too large: use at most 18 digits and a larger unit, such as 10m');
    expect(timeValueMillis('2s')).toBe(2000);
    expect(timeValueMillis('1m')).toBe(60_000);
    expect(timeValueMillis('500micros')).toBe(0.5);
    expect(timeValueMillis('0')).toBe(0);
    expect(timeValueMillis('-1')).toBeNull();
    expect(sourceError('')).toBeNull();
    expect(sourceError('true')).toBeNull();
    expect(sourceError('FALSE')).toBeNull();
    expect(sourceError('500')).toBeNull();
    expect(sourceError('-5')).toBe('Enter a number of characters, true (the whole source) or false (no source)');
  });

  it('warns that a threshold of 0 logs every request', () => {
    expect(thresholdWarning('0')).toBe('logs every request, which writes very large slow log files');
    expect(thresholdWarning('0ms')).not.toBeNull();
    expect(thresholdWarning('0s')).not.toBeNull();
    expect(thresholdWarning('1ms')).toBeNull();
    expect(thresholdWarning('-1')).toBeNull();
    expect(thresholdWarning('')).toBeNull();
    expect(describeLevels({ warn: '1s', info: '0ms', debug: '', trace: '' })).toBe('warn 1s · info 0ms (every request)');
  });

  it('validates the whole form', () => {
    const form: SlowlogForm = {
      thresholds: { ...presetThresholds('moderate'), fetch: { warn: '1.5s', info: '', debug: '', trace: 'x' } },
      source: 'abc',
      reformat: '',
    };
    expect(Object.keys(validateSlowlogForm(form))).toEqual(['fetch.warn', 'fetch.trace', 'source']);
    expect(validateSlowlogForm({ thresholds: emptyThresholds(), source: '', reformat: '' })).toEqual({});
  });

  it('warns when levels are not in descending order', () => {
    expect(orderWarning(presetThresholds('moderate').query)).toBeNull();
    expect(orderWarning({ warn: '200ms', info: '', debug: '', trace: '1s' })).toBe(
      'Trace (1s) is above warn (200ms): requests between the two are logged at warn, never at trace',
    );
    expect(orderWarning({ warn: '-1', info: '5s', debug: '10s', trace: '' })).toBe(
      'Debug (10s) is above info (5s): requests between the two are logged at info, never at debug',
    );
    expect(orderWarning({ warn: '', info: '', debug: '', trace: '' })).toBeNull();
  });

  it('describes the Off preset as the same as a reset', () => {
    expect(SLOWLOG_PRESETS.find((preset) => preset.key === 'off')?.description).toBe(
      'Sets every threshold to -1 explicitly. Same effect as Reset to defaults; new indices still take their thresholds from their index template.',
    );
  });

  it('detects presets', () => {
    expect(detectPreset(presetThresholds('off'))).toBe('off');
    expect(detectPreset(presetThresholds('moderate'))).toBe('moderate');
    expect(detectPreset(presetThresholds('aggressive'))).toBe('aggressive');
    expect(detectPreset({ ...presetThresholds('moderate'), query: { warn: '10S', info: '5s', debug: '2s', trace: '500ms' } })).toBe('moderate');
    expect(detectPreset({ ...presetThresholds('moderate'), fetch: { warn: '', info: '', debug: '', trace: '' } })).toBe('custom');
    expect(detectPreset(emptyThresholds())).toBeNull();
  });

  it('builds the settings to write: empty fields reset to the default', () => {
    const settings = buildSlowlogSettings({
      thresholds: { ...presetThresholds('moderate'), index: { warn: ' 10S ', info: '', debug: '', trace: '-1' } },
      source: ' TRUE ',
      reformat: 'false',
    });
    expect(Object.keys(settings)).toHaveLength(14);
    expect(settings['index.search.slowlog.threshold.query.warn']).toBe('10s');
    expect(settings['index.search.slowlog.threshold.fetch.trace']).toBe('200ms');
    expect(settings['index.indexing.slowlog.threshold.index.warn']).toBe('10s');
    expect(settings['index.indexing.slowlog.threshold.index.info']).toBeNull();
    expect(settings['index.indexing.slowlog.threshold.index.trace']).toBe('-1');
    expect(settings[SOURCE_KEY]).toBe('true');
    expect(settings[REFORMAT_KEY]).toBe('false');
    const defaults = buildSlowlogSettings({ thresholds: emptyThresholds(), source: '', reformat: '' });
    expect(Object.values(defaults).every((value) => value === null)).toBe(true);
  });

  it('resets every slow log setting, including others set on the indices', () => {
    const reset = resetSlowlogSettings(indices);
    expect(Object.keys(reset)).toHaveLength(15);
    expect(reset['index.search.slowlog.include.user']).toBeNull();
    expect(Object.values(reset).every((value) => value === null)).toBe(true);
    expect(Object.keys(resetSlowlogSettings([]))).toHaveLength(14);
  });

  it('pre-fills the form from an index and compares forms', () => {
    const [partial, moderate] = indices;
    const form = formFromIndex(partial);
    expect(form.source).toBe('1000');
    expect(form.reformat).toBe('false');
    expect(form.thresholds.query.warn).toBe('10s');
    expect(formFromIndex(undefined)).toEqual({ thresholds: emptyThresholds(), source: '', reformat: '' });
    expect(sameForm(formFromIndex(moderate), { thresholds: presetThresholds('moderate'), source: '', reformat: '' })).toBe(true);
    expect(sameForm(form, { ...form, source: '1000 ' })).toBe(true);
    expect(sameForm(form, { ...form, reformat: '' })).toBe(false);
  });

  it('describes levels and forms in words', () => {
    expect(describeLevels(presetThresholds('moderate').fetch)).toBe('warn 1s · info 800ms · debug 500ms · trace 200ms');
    expect(describeLevels({ warn: '-1', info: '', debug: '', trace: '' })).toBe('warn off');
    expect(describeLevels(emptyThresholds().query)).toBe('');
    expect(describeForm({ thresholds: presetThresholds('moderate'), source: '', reformat: '' })).toEqual([
      'Search query: warn 10s · info 5s · debug 2s · trace 500ms',
      'Search fetch: warn 1s · info 800ms · debug 500ms · trace 200ms',
      'Indexing: warn 10s · info 5s · debug 2s · trace 500ms',
      'Indexing source: default (first 1000 characters)',
      'Reformat source: default (yes)',
    ]);
    expect(describeForm({ thresholds: emptyThresholds(), source: '2500', reformat: 'false' }).slice(2)).toEqual([
      'Indexing: default (off)',
      'Indexing source: first 2,500 characters',
      'Reformat source: no',
    ]);
    expect(otherSettingLabel(SOURCE_KEY)).toBe('Indexing source');
    expect(otherSettingLabel('index.search.slowlog.include.user')).toBe('Search logs user');
    expect(otherSettingLabel('index.search.slowlog.something_new')).toBe('Search slowlog something new');
  });

  it('tells which settings of configured indices a form replaces or removes', () => {
    const [partial, moderate] = indices;
    const aggressiveQuery: SlowlogForm = {
      thresholds: { ...emptyThresholds(), query: presetThresholds('aggressive').query },
      source: '',
      reformat: '',
    };
    expect(describeOverwrites(aggressiveQuery, [moderate!])).toEqual(['tmp-performance-b (Moderate): changes 4 settings, removes 8 settings']);
    expect(describeOverwrites(aggressiveQuery, [partial!])).toEqual([
      'tmp-performance-a (custom thresholds): changes Search query warn, removes 5 settings',
    ]);
    // Writing exactly what an index has replaces nothing.
    expect(describeOverwrites(formFromIndex(moderate), [moderate!])).toEqual([]);
    expect(describeOverwrites(aggressiveQuery, [])).toEqual([]);
    expect(settingLabel('index.search.slowlog.threshold.fetch.debug')).toBe('Search fetch debug');
    expect(settingLabel(SOURCE_KEY)).toBe('Indexing source');
  });

  it('knows when the form leaves fields empty', () => {
    expect(hasEmptyFields({ thresholds: presetThresholds('moderate'), source: '', reformat: '' })).toBe(true);
    expect(hasEmptyFields({ thresholds: presetThresholds('moderate'), source: '1000', reformat: 'true' })).toBe(false);
  });

  it('verifies the settings read back after a change', () => {
    const sent = buildSlowlogSettings({ thresholds: presetThresholds('moderate'), source: '', reformat: '' });
    expect(verifySlowlog(['tmp-performance-b', 'tmp-performance-a', 'other'], sent, indices)).toEqual({
      applied: ['tmp-performance-b'],
      missing: ['tmp-performance-a', 'other'],
    });
    // A reset is verified by the settings being gone.
    expect(verifySlowlog(['other'], resetSlowlogSettings([]), indices)).toEqual({ applied: ['other'], missing: [] });
    expect(verifySlowlog(['tmp-performance-a'], resetSlowlogSettings(indices), indices).missing).toEqual(['tmp-performance-a']);
  });

  it('groups picker names into regular, backing and system indices', () => {
    expect(groupPickerNames(['logs', '.ds-app-events-web-2026.10.14-000001', '.tasks', 'audit', '.kibana_1'])).toEqual({
      regular: ['audit', 'logs'],
      backing: ['.ds-app-events-web-2026.10.14-000001'],
      system: ['.kibana_1', '.tasks'],
    });
  });

  it('sorts and filters index names', () => {
    const names = ['logs', '.kibana', 'audit', 'logs'];
    expect(sortIndexNames(names)).toEqual(['audit', 'logs', '.kibana']);
    expect(filterIndexNames(['logs-1', 'audit', 'logs-2'], '^logs')).toEqual(['logs-1', 'logs-2']);
    expect(filterIndexNames(['a[b', 'c'], 'a[')).toEqual(['a[b']);
  });
});
