import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { AlertService } from '../../core/alert.service';
import { ClipboardService } from '../../core/clipboard.service';
import { ClusterApiService } from '../../core/cluster-api.service';
import { ConnectionService } from '../../core/connection.service';
import { DialogService } from '../../core/dialog.service';
import { ClusterApiError } from '../../core/api-envelope';
import { failureMessage, readableReason } from '../../core/errors';
import { formatDuration, pluralize } from '../../core/format';
import { RefreshService } from '../../core/refresh.service';
import { EmptyStateComponent } from '../../shared/empty-state.component';
import { NumberPipe, PluralPipe } from '../../shared/format.pipes';
import { MenuComponent } from '../../shared/menu.component';
import { MeterComponent } from '../../shared/meter.component';
import { SearchInputComponent } from '../../shared/search-input.component';
import { createSort } from '../../shared/sort-state';
import { Task, TaskFilter, TaskNode, TaskRow, TaskSortField, TasksResponse } from './tasks.models';
import {
  LONG_RUNNING_MILLIS,
  buildTaskTree,
  cancelFailure,
  cancelMessage,
  filterTaskTree,
  isSystemTask,
  flattenTaskTree,
  liveRunningMillis,
  normalizeTasks,
  shouldLookUpNodes,
  sortTaskTree,
  summarizeTasks,
} from './tasks.utils';

/** Descriptions longer than this get a "Show more" toggle. */
const DESCRIPTION_LIMIT = 110;

@Component({
  selector: 'cerebro-tasks',
  imports: [DatePipe, EmptyStateComponent, MenuComponent, MeterComponent, NumberPipe, PluralPipe, SearchInputComponent],
  templateUrl: './tasks.component.html',
  styleUrl: './tasks.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TasksComponent {
  private readonly api = inject(ClusterApiService);
  private readonly alerts = inject(AlertService);
  private readonly dialogs = inject(DialogService);
  private readonly clipboard = inject(ClipboardService);
  private readonly refreshService = inject(RefreshService);
  private readonly connection = inject(ConnectionService);

  readonly longRunningMillis = LONG_RUNNING_MILLIS;
  readonly descriptionLimit = DESCRIPTION_LIMIT;
  readonly pluralize = pluralize;

  readonly tasks = signal<readonly Task[] | undefined>(undefined);
  readonly loading = signal(false);
  readonly failed = signal(false);
  readonly loadError = signal<string | undefined>(undefined);
  readonly loadedAt = signal(Date.now());
  readonly now = signal(Date.now());
  /** Reason of the last failed background refresh while older tasks stay on screen. */
  readonly staleReason = signal<string | undefined>(undefined);
  readonly stale = computed(() => this.staleReason() !== undefined);
  /**
   * Clock the running times are extrapolated to: frozen at the last
   * successful load while refreshes fail, so stale tasks do not keep ticking.
   */
  private readonly clock = computed(() => (this.stale() ? this.loadedAt() : this.now()));
  readonly nodeNames = signal<ReadonlyMap<string, string>>(new Map());

  readonly query = signal('');
  readonly hideInternal = signal(true);
  readonly onlyCancellable = signal(false);
  // Running time is most useful longest first; the other columns start ascending.
  readonly sort = createSort<TaskSortField>('running', {
    reverse: true,
    descendingFirst: (field) => field === 'running',
  });
  readonly collapsed = signal<ReadonlySet<string>>(new Set());
  readonly expandedDescriptions = signal<ReadonlySet<string>>(new Set());
  readonly cancelling = signal<ReadonlySet<string>>(new Set());

  readonly filter = computed<TaskFilter>(() => ({
    query: this.query(),
    hideInternal: this.hideInternal(),
    onlyCancellable: this.onlyCancellable(),
  }));

  /** Tasks with node names applied (names may arrive after the tasks). */
  readonly named = computed(() => {
    const names = this.nodeNames();
    return (this.tasks() ?? []).map((task) =>
      names.has(task.node) ? { ...task, nodeName: names.get(task.node) ?? task.node } : task,
    );
  });

  readonly tree = computed(() =>
    sortTaskTree(filterTaskTree(buildTaskTree(this.named()), this.filter()), this.sort.field(), this.sort.reverse()),
  );
  readonly rows = computed<readonly TaskRow[]>(() => flattenTaskTree(this.tree(), this.collapsed()));
  readonly visibleCount = computed(() => this.rows().length);
  readonly summary = computed(() => summarizeTasks(this.named(), this.hideInternal(), this.clock() - this.loadedAt()));
  readonly hiddenInternal = computed(() => this.named().filter((task) => task.internal).length);
  readonly filtersActive = computed(() => this.query().trim() !== '' || this.onlyCancellable());

  private loadSequence = 0;
  private nodesSequence = 0;
  private nodesHost: string | undefined;
  private nodesLoading = false;
  /** Node ids already looked up, so unknown ids do not trigger a nodes call on every tick. */
  private nodesRequested = new Set<string>();
  private nodesFailedAt: number | null = null;

  constructor() {
    effect(() => {
      this.refreshService.tick();
      const host = this.connection.host();
      untracked(() => {
        if (host !== this.nodesHost) {
          this.nodesHost = host;
          this.nodesSequence++;
          this.nodesLoading = false;
          this.nodesRequested = new Set();
          this.nodesFailedAt = null;
          this.nodeNames.set(new Map());
          this.tasks.set(undefined);
          this.failed.set(false);
          this.staleReason.set(undefined);
          this.collapsed.set(new Set());
        }
        if (host) {
          void this.load();
        }
      });
    });

    const timer = setInterval(() => this.now.set(Date.now()), 1_000);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  async load(): Promise<void> {
    const sequence = ++this.loadSequence;
    this.loading.set(true);
    try {
      const response = await this.api.post<TasksResponse>('tasks');
      if (sequence !== this.loadSequence) {
        return;
      }
      const tasks = normalizeTasks(response, this.nodeNames());
      this.loadedAt.set(Date.now());
      this.now.set(Date.now());
      this.tasks.set(tasks);
      this.failed.set(false);
      this.loadError.set(undefined);
      this.staleReason.set(undefined);
      this.pruneState(tasks);
      const unknown = new Set(tasks.map((task) => task.node).filter((node) => !this.nodeNames().has(node)));
      if (shouldLookUpNodes(unknown, this.nodesRequested, this.nodesFailedAt, Date.now())) {
        void this.loadNodes(unknown);
      }
    } catch (error: unknown) {
      if (sequence === this.loadSequence) {
        // A failed background refresh keeps the last list on screen, marked as stale.
        if (this.tasks() === undefined) {
          this.failed.set(true);
          this.loadError.set(readableReason(error));
        } else {
          this.staleReason.set(readableReason(error) ?? 'The request failed');
        }
        this.alerts.error(failureMessage('Could not load tasks', error), error);
      }
    } finally {
      if (sequence === this.loadSequence) {
        this.loading.set(false);
      }
    }
  }

  retry(): void {
    this.failed.set(false);
    this.tasks.set(undefined);
    void this.load();
  }

  private async loadNodes(ids: ReadonlySet<string>): Promise<void> {
    if (this.nodesLoading) {
      return;
    }
    this.nodesLoading = true;
    const sequence = ++this.nodesSequence;
    ids.forEach((id) => this.nodesRequested.add(id));
    try {
      const nodes = await this.api.post<readonly TaskNode[]>('nodes');
      if (sequence === this.nodesSequence) {
        this.nodesFailedAt = null;
        this.nodeNames.set(new Map(nodes.map((node) => [node.id, node.name])));
      }
    } catch {
      // Node names are cosmetic: ids are shown instead; retried after a back-off.
      if (sequence === this.nodesSequence) {
        this.nodesFailedAt = Date.now();
      }
    } finally {
      if (sequence === this.nodesSequence) {
        this.nodesLoading = false;
      }
    }
  }

  // ---- Table state -------------------------------------------------------------

  toggleChildren(task: Task): void {
    this.collapsed.update((keys) => toggle(keys, task.key));
  }

  toggleDescription(task: Task): void {
    this.expandedDescriptions.update((keys) => toggle(keys, task.key));
  }

  resetFilters(): void {
    this.query.set('');
    this.onlyCancellable.set(false);
  }

  isLongRunning(task: Task): boolean {
    return this.running(task) >= this.longRunningMillis;
  }

  isSystem(task: Task): boolean {
    return isSystemTask(task);
  }

  running(task: Task): number {
    return liveRunningMillis(task, this.loadedAt(), this.clock());
  }

  runningLabel(task: Task): string {
    return formatDuration(this.running(task));
  }

  /** Clicks on the row background open the JSON; controls keep their own behaviour. */
  onRowClick(event: MouseEvent, task: Task): void {
    const target = event.target as HTMLElement | null;
    if (target?.closest('button, a, input, select, cerebro-menu, .menu')) {
      return;
    }
    const selection = globalThis.getSelection?.();
    if (selection && selection.toString().length > 0) {
      return;
    }
    this.showJson(task);
  }

  showJson(task: Task): void {
    this.dialogs.showJson(`Task ${task.key}`, task.raw, `${task.label} on ${task.nodeName}`);
  }

  copyId(task: Task): void {
    void this.clipboard.copyAndNotify(task.key, 'task id');
  }

  showParent(task: Task): void {
    if (task.parentKey) {
      this.query.set(task.parentKey);
    }
  }

  async cancel(task: Task): Promise<void> {
    if (!task.cancellable || this.cancelling().has(task.key)) {
      return;
    }
    const confirmed = await this.dialogs.confirm({
      title: isSystemTask(task) ? `Cancel built-in task ${task.label}?` : `Cancel task ${task.label}?`,
      message: cancelMessage(task),
      items: [`${task.key} · ${task.action}`],
      confirmLabel: 'Cancel task',
      cancelLabel: 'Keep running',
      tone: 'danger',
    });
    if (!confirmed) {
      return;
    }
    this.cancelling.update((keys) => new Set([...keys, task.key]));
    try {
      const response = await this.api.post<unknown>('tasks/cancel', { task_id: task.key });
      const failure = cancelFailure(response);
      if (failure) {
        this.alerts.error(`Could not cancel ${task.label}: ${failure}`, response);
      } else {
        this.alerts.success(`Cancellation requested for ${task.label} (${task.key})`, response);
      }
    } catch (error: unknown) {
      this.alerts.error(this.withReason(`Could not cancel ${task.label}`, error), error);
    } finally {
      this.cancelling.update((keys) => {
        const next = new Set(keys);
        next.delete(task.key);
        return next;
      });
      this.refreshService.refresh();
    }
  }

  /** A failed `_cancel` may carry its reason in `node_failures` / `task_failures`. */
  private withReason(message: string, error: unknown): string {
    const failure = error instanceof ClusterApiError ? cancelFailure(error.body) : null;
    return failure ? `${message}: ${failure}` : failureMessage(message, error);
  }

  /** Forget UI state of tasks that finished. */
  private pruneState(tasks: readonly Task[]): void {
    const keys = new Set(tasks.map((task) => task.key));
    const prune = (set: ReadonlySet<string>): ReadonlySet<string> => {
      const kept = [...set].filter((key) => keys.has(key));
      return kept.length === set.size ? set : new Set(kept);
    };
    this.collapsed.update(prune);
    this.expandedDescriptions.update(prune);
  }
}

function toggle(keys: ReadonlySet<string>, key: string): ReadonlySet<string> {
  const next = new Set(keys);
  if (next.has(key)) {
    next.delete(key);
  } else {
    next.add(key);
  }
  return next;
}
