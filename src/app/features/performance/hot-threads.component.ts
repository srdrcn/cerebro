import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AlertService } from '../../core/alert.service';
import { ClipboardService } from '../../core/clipboard.service';
import { ClusterApiService } from '../../core/cluster-api.service';
import { ConnectionService } from '../../core/connection.service';
import { failureMessage, readableReason } from '../../core/errors';
import { formatBytes, formatTimestamp, pluralize } from '../../core/format';
import { isRecord } from '../../core/json';
import { EmptyStateComponent } from '../../shared/empty-state.component';
import { NumberPipe, PluralPipe } from '../../shared/format.pipes';
import { HotNode, HotThread, HotThreadsRequest, HotThreadsType, StackFrame, StackGroup } from './performance.models';
import {
  AUTO_CAPTURE_MAX_NODES,
  BUSY_PERCENT,
  COLLAPSED_FRAMES,
  DEFAULT_HOT_THREADS_REQUEST,
  HOT_THREAD_INTERVALS,
  HOT_THREAD_TYPES,
  MAX_THREADS,
  MIN_THREADS,
  hotThreadsPayload,
  isBusyThread,
  onlyIdleWaits,
  parseHotThreads,
  poolDetail,
  poolHint,
  poolLead,
  poolLoads,
  quietHeading,
  sortHotNodes,
  summarizeHotThreads,
  validateThreads,
} from './performance.utils';

interface NodeOption {
  readonly id: string;
  readonly name: string;
}

/** A stack group with its index in `HotThread.groups` (expansion is keyed by it). */
interface ShownGroup {
  readonly group: StackGroup;
  readonly index: number;
}

interface Capture {
  readonly request: HotThreadsRequest;
  readonly text: string;
  readonly nodes: readonly HotNode[];
  readonly unparsed: number;
  readonly capturedAt: number;
}

/** Frames shown in full when a stack is only slightly longer than the collapsed size. */
const COLLAPSE_SLACK = 2;

@Component({
  selector: 'cerebro-hot-threads',
  imports: [EmptyStateComponent, FormsModule, NumberPipe, PluralPipe],
  templateUrl: './hot-threads.component.html',
  styleUrl: './hot-threads.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HotThreadsComponent {
  private readonly api = inject(ClusterApiService);
  private readonly alerts = inject(AlertService);
  private readonly clipboard = inject(ClipboardService);
  private readonly connection = inject(ConnectionService);

  /** Whether the tab is shown: the first capture runs when it is. */
  readonly active = input(false);

  readonly types = HOT_THREAD_TYPES;
  readonly intervals = HOT_THREAD_INTERVALS;
  readonly minThreads = MIN_THREADS;
  readonly maxThreads = MAX_THREADS;
  readonly busyPercent = BUSY_PERCENT;
  readonly collapsedFrames = COLLAPSED_FRAMES;
  readonly pluralize = pluralize;
  readonly isBusyThread = isBusyThread;

  // ---- Form ----
  readonly node = signal(DEFAULT_HOT_THREADS_REQUEST.node);
  readonly type = signal<HotThreadsType>(DEFAULT_HOT_THREADS_REQUEST.type);
  readonly threads = signal(String(DEFAULT_HOT_THREADS_REQUEST.threads));
  readonly interval = signal(DEFAULT_HOT_THREADS_REQUEST.interval);
  readonly ignoreIdle = signal(DEFAULT_HOT_THREADS_REQUEST.ignoreIdleThreads);
  readonly submitted = signal(false);
  readonly threadsError = computed(() => validateThreads(this.threads()));
  readonly typeHint = computed(() => this.types.find((type) => type.key === this.type())?.hint ?? '');

  readonly nodes = signal<readonly NodeOption[]>([]);
  readonly nodesFailed = signal(false);
  /** The first capture did not start on its own (large cluster, or the node list failed). */
  readonly waitingForCapture = signal(false);

  // ---- Capture ----
  readonly capturing = signal(false);
  readonly capture = signal<Capture | undefined>(undefined);
  readonly captureError = signal<string | undefined>(undefined);
  readonly view = signal<'readable' | 'raw'>('readable');
  readonly showQuiet = signal(false);
  readonly expanded = signal<ReadonlySet<string>>(new Set());
  /** Threads whose less frequent stacks are shown too. */
  readonly allStacks = signal<ReadonlySet<string>>(new Set());
  readonly announcement = signal('');

  readonly summary = computed(() => summarizeHotThreads(this.capture()?.nodes ?? []));
  readonly pools = computed(() => poolLoads(this.capture()?.nodes ?? []));
  readonly captureType = computed<HotThreadsType>(() => this.capture()?.request.type ?? 'cpu');
  readonly hint = computed(() => {
    const top = this.pools()[0];
    if (!top) {
      return null;
    }
    const hint = poolHint(top.pool);
    const type = this.captureType();
    return { ...hint, lead: poolLead(type, hint, top), detail: poolDetail(type, top) };
  });
  /** A wait or block capture where every thread is an idle worker: nothing is stuck. */
  readonly idleOnly = computed(() => onlyIdleWaits(this.capture()?.nodes ?? []));
  readonly quietCount = computed(() => this.summary().threads - this.summary().busy);
  /** Nodes with the threads to show (busy ones unless quiet threads are shown). */
  readonly shownNodes = computed(() => {
    const showQuiet = this.showQuiet();
    return (this.capture()?.nodes ?? []).map((node) => ({
      node,
      threads: showQuiet ? node.threads : node.threads.filter(isBusyThread),
      quiet: node.threads.filter((thread) => !isBusyThread(thread)).length,
    }));
  });
  /** The empty state of a capture without busy threads, `null` otherwise. */
  readonly quietState = computed(() => {
    const capture = this.capture();
    const summary = this.summary();
    if (!capture || summary.busy > 0) {
      return null;
    }
    const { type, interval, ignoreIdleThreads } = capture.request;
    if (summary.threads === 0) {
      return {
        icon: 'bi-cup-hot',
        heading: type === 'cpu' || type === 'block' ? quietHeading(type) : 'No threads reported',
        text: `Elasticsearch reported no thread on ${pluralize(summary.nodes, 'node')}${ignoreIdleThreads ? ': every thread was idle, and idle threads are ignored' : ''}.`,
      };
    }
    return {
      icon: 'bi-moon-stars',
      heading: quietHeading(type),
      text: `Every reported thread used less than ${BUSY_PERCENT}% of the ${interval} interval. Capture again while the cluster is under load to see what keeps it busy.`,
    };
  });
  readonly capturedLabel = computed(() => {
    const capture = this.capture();
    return capture ? formatTimestamp(capture.capturedAt, { seconds: true }).slice(11) : '';
  });
  readonly requestLabel = computed(() => {
    const capture = this.capture();
    if (!capture) {
      return '';
    }
    const type = this.types.find((entry) => entry.key === capture.request.type)?.label ?? capture.request.type;
    const node = capture.request.node ? (this.nodeName(capture.request.node) ?? capture.request.node) : 'every node';
    return `${type} · ${capture.request.interval} on ${node} · top ${capture.request.threads} per node`;
  });

  private readonly threadsInput = viewChild<ElementRef<HTMLInputElement>>('threadsInput');
  private sequence = 0;
  private nodesSequence = 0;
  private autoCaptured = false;

  constructor() {
    effect(() => {
      const active = this.active();
      const connected = this.connection.connected();
      untracked(() => {
        if (!active || !connected) {
          return;
        }
        if (!this.autoCaptured) {
          this.autoCaptured = true;
          void this.captureWhenSmall();
        } else if (this.nodes().length === 0 && !this.nodesFailed()) {
          void this.loadNodes();
        }
      });
    });
  }

  /**
   * The first capture runs on its own only on small clusters: hot threads
   * samples every thread of every node, and each node runs one capture at a
   * time. Larger clusters (or an unknown size) wait for "Capture".
   */
  private async captureWhenSmall(): Promise<void> {
    const sequence = this.sequence;
    await this.loadNodes();
    if (sequence !== this.sequence || this.capture() || this.capturing()) {
      return;
    }
    const count = this.nodes().length;
    if (count > 0 && count <= AUTO_CAPTURE_MAX_NODES) {
      void this.run();
    } else {
      this.waitingForCapture.set(true);
    }
  }

  private async loadNodes(): Promise<void> {
    const sequence = ++this.nodesSequence;
    try {
      const response = await this.api.post<unknown>('nodes');
      if (sequence !== this.nodesSequence) {
        return;
      }
      const nodes = (Array.isArray(response) ? response : [])
        .filter(isRecord)
        .map((node) => ({ id: String(node['id'] ?? ''), name: String(node['name'] ?? node['id'] ?? '') }))
        .filter((node) => node.id !== '')
        .sort((left, right) => left.name.localeCompare(right.name));
      this.nodes.set(nodes);
      this.nodesFailed.set(false);
    } catch {
      // The capture still works for every node; only the node choice is missing.
      if (sequence === this.nodesSequence) {
        this.nodesFailed.set(true);
      }
    }
  }

  retryNodes(): void {
    this.nodesFailed.set(false);
    void this.loadNodes();
  }

  nodeName(id: string): string | undefined {
    return this.nodes().find((node) => node.id === id)?.name;
  }

  setThreads(value: unknown): void {
    this.threads.set(value === null || value === undefined ? '' : String(value));
  }

  submit(): void {
    this.submitted.set(true);
    if (this.threadsError()) {
      this.threadsInput()?.nativeElement.focus();
      return;
    }
    void this.run();
  }

  async run(): Promise<void> {
    if (this.threadsError()) {
      return;
    }
    const request: HotThreadsRequest = {
      node: this.node(),
      type: this.type(),
      threads: Number(this.threads()),
      interval: this.interval(),
      ignoreIdleThreads: this.ignoreIdle(),
    };
    const sequence = ++this.sequence;
    this.capturing.set(true);
    this.waitingForCapture.set(false);
    this.announcement.set(`Capturing hot threads for ${request.interval}…`);
    try {
      const body = await this.api.post<unknown>('performance/hot_threads', hotThreadsPayload(request));
      if (sequence !== this.sequence) {
        return;
      }
      const text = typeof body === 'string' ? body : JSON.stringify(body, null, 2);
      const report = parseHotThreads(text);
      const nodes = sortHotNodes(report.nodes);
      this.capture.set({ request, text, nodes, unparsed: report.unparsed, capturedAt: Date.now() });
      this.captureError.set(undefined);
      this.showQuiet.set(false);
      this.expanded.set(new Set());
      this.allStacks.set(new Set());
      const summary = summarizeHotThreads(nodes);
      this.announcement.set(
        summary.busy > 0
          ? `Captured ${pluralize(summary.busy, 'thread')} worth a look on ${pluralize(summary.nodes, 'node')}`
          : `${quietHeading(request.type)} on ${pluralize(summary.nodes, 'node')}`,
      );
    } catch (error: unknown) {
      if (sequence !== this.sequence) {
        return;
      }
      this.captureError.set(readableReason(error) ?? 'The cluster did not answer the hot threads request.');
      this.announcement.set('Could not capture hot threads');
      this.alerts.error(failureMessage('Could not capture hot threads', error), error);
    } finally {
      if (sequence === this.sequence) {
        this.capturing.set(false);
      }
    }
  }

  // ---- Presentation helpers -------------------------------------------------------

  loadLabel(thread: HotThread): string {
    if (thread.allocatedBytes !== null) {
      return formatBytes(thread.allocatedBytes);
    }
    return thread.percent === null ? '–' : `${thread.percent.toFixed(1)}%`;
  }

  /**
   * Tone of the load figure: CPU and block load stand out, waiting is normal.
   * When 8.x splits busy time, only the CPU part turns it yellow or red; time
   * runnable off the CPU is shown separately.
   */
  loadTone(thread: HotThread): string {
    if (thread.type === 'cpu' || thread.type === 'block') {
      const percent = thread.percent ?? 0;
      const hot = thread.type === 'cpu' && thread.cpuPercent !== null ? thread.cpuPercent : percent;
      if (hot >= 80) {
        return 'tone-red';
      }
      if (hot >= 40) {
        return 'tone-yellow';
      }
      return percent >= BUSY_PERCENT ? 'tone-blue' : 'tone-gray';
    }
    return 'tone-gray';
  }

  barWidth(value: number | null): number {
    return value === null ? 0 : Math.max(0, Math.min(100, value));
  }

  /** Allocations are shown relative to the busiest thread of the capture. */
  memoryWidth(thread: HotThread): number {
    const max = this.summary().hottest?.thread.allocatedBytes ?? 0;
    return max > 0 && thread.allocatedBytes !== null ? (thread.allocatedBytes / max) * 100 : 0;
  }

  /**
   * The first stack, plus the idle and base-only ones as one-liners; the
   * other stacks doing work once asked.
   */
  visibleGroups(thread: HotThread): readonly ShownGroup[] {
    const all = this.allStacks().has(thread.key);
    return thread.groups
      .map((group, index) => ({ group, index }))
      .filter(({ group, index }) => index === 0 || all || group.kind !== 'work');
  }

  /** Stacks doing work hidden behind "Show N other stacks". */
  otherStacks(thread: HotThread): readonly StackGroup[] {
    return thread.groups.filter((group, index) => index > 0 && group.kind === 'work');
  }

  otherSnapshots(thread: HotThread): number {
    return this.otherStacks(thread).reduce((sum, group) => sum + group.snapshots, 0);
  }

  toggleStacks(thread: HotThread): void {
    this.allStacks.update((keys) => toggled(keys, thread.key));
  }

  groupKey(thread: HotThread, index: number): string {
    return `${thread.key}/${index}`;
  }

  /** Idle and base-only stacks fold into one line until opened. */
  isFolded(thread: HotThread, group: StackGroup, index: number): boolean {
    return group.kind !== 'work' && !this.expanded().has(this.groupKey(thread, index));
  }

  isCollapsible(group: StackGroup): boolean {
    return group.kind === 'work' && group.frames.length > COLLAPSED_FRAMES + COLLAPSE_SLACK;
  }

  visibleFrames(thread: HotThread, group: StackGroup, index: number): readonly StackFrame[] {
    return this.isCollapsible(group) && !this.expanded().has(this.groupKey(thread, index))
      ? group.frames.slice(0, COLLAPSED_FRAMES)
      : group.frames;
  }

  toggleFrames(thread: HotThread, index: number): void {
    this.expanded.update((keys) => toggled(keys, this.groupKey(thread, index)));
  }

  groupLabel(group: StackGroup): string {
    const share = `${group.snapshots} of ${group.total} snapshots`;
    switch (group.kind) {
      case 'idle':
        return `Waiting for work in ${share}`;
      case 'base':
        return `Different code in ${share}: only the ${pluralize(group.frames.length, 'executor frame')} at the bottom were the same`;
      default:
        return group.unique ? `In 1 of ${group.total} snapshots (unique)` : `In ${share}`;
    }
  }

  groupShare(group: StackGroup): number {
    return group.total > 0 ? (group.snapshots / group.total) * 100 : 0;
  }

  copyRaw(): void {
    const capture = this.capture();
    if (capture) {
      void this.clipboard.copyAndNotify(capture.text, 'hot threads');
    }
  }

  copyThread(node: HotNode, thread: HotThread): void {
    const lines = [`${node.name}: ${this.loadLabel(thread)} ${thread.type} ${thread.usage ? `(${thread.usage}) ` : ''}${thread.name}`];
    for (const group of thread.groups) {
      lines.push(`  ${this.groupLabel(group)}`, ...group.frames.map((frame) => `    ${frame.raw}`));
    }
    void this.clipboard.copyAndNotify(lines.join('\n'), 'thread stack');
  }

  restoreDefaults(): void {
    this.node.set(DEFAULT_HOT_THREADS_REQUEST.node);
    this.type.set(DEFAULT_HOT_THREADS_REQUEST.type);
    this.threads.set(String(DEFAULT_HOT_THREADS_REQUEST.threads));
    this.interval.set(DEFAULT_HOT_THREADS_REQUEST.interval);
    this.ignoreIdle.set(DEFAULT_HOT_THREADS_REQUEST.ignoreIdleThreads);
    this.submitted.set(false);
  }
}

function toggled(keys: ReadonlySet<string>, key: string): ReadonlySet<string> {
  const next = new Set(keys);
  if (next.has(key)) {
    next.delete(key);
  } else {
    next.add(key);
  }
  return next;
}
