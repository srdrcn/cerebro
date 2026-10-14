import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { AlertService } from '../../core/alert.service';
import { ClusterApiService } from '../../core/cluster-api.service';
import { ConnectionService } from '../../core/connection.service';
import { DialogService } from '../../core/dialog.service';
import { failureMessage, readableReason } from '../../core/errors';
import { formatDuration, pluralize } from '../../core/format';
import { RefreshService } from '../../core/refresh.service';
import { EmptyStateComponent } from '../../shared/empty-state.component';
import { NumberPipe, PluralPipe } from '../../shared/format.pipes';
import { SearchInputComponent } from '../../shared/search-input.component';
import { createSort } from '../../shared/sort-state';
import { PendingSortField, PendingTask } from './performance.models';
import {
  SLOW_PENDING_MILLIS,
  filterPendingTasks,
  normalizePendingTasks,
  priorityTone,
  sortPendingTasks,
  summarizePendingTasks,
} from './performance.utils';

@Component({
  selector: 'cerebro-pending-tasks',
  imports: [DatePipe, EmptyStateComponent, NumberPipe, PluralPipe, SearchInputComponent],
  templateUrl: './pending-tasks.component.html',
  styleUrl: './pending-tasks.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PendingTasksComponent {
  private readonly api = inject(ClusterApiService);
  private readonly alerts = inject(AlertService);
  private readonly dialogs = inject(DialogService);
  private readonly refreshService = inject(RefreshService);
  private readonly connection = inject(ConnectionService);

  /** Whether the tab is shown: hidden tabs do not refresh. */
  readonly active = input(false);
  /** Number of pending tasks after every load (for the tab badge). */
  readonly count = output<number>();

  readonly formatDuration = formatDuration;
  readonly slowMillis = SLOW_PENDING_MILLIS;

  readonly tasks = signal<readonly PendingTask[] | undefined>(undefined);
  readonly raw = signal<unknown>(undefined);
  readonly loading = signal(false);
  readonly loadError = signal<string | undefined>(undefined);
  readonly staleReason = signal<string | undefined>(undefined);
  readonly loadedAt = signal(0);
  readonly query = signal('');
  readonly sort = createSort<PendingSortField>('queue', {
    descendingFirst: (field) => field === 'time',
  });

  readonly all = computed(() => this.tasks() ?? []);
  readonly visible = computed(() =>
    sortPendingTasks(filterPendingTasks(this.all(), this.query()), this.sort.field(), this.sort.reverse()),
  );
  readonly summary = computed(() => summarizePendingTasks(this.all()));
  readonly announcement = signal('');

  private sequence = 0;
  private host: string | undefined;

  constructor() {
    effect(() => {
      this.refreshService.tick();
      const active = this.active();
      const host = this.connection.host();
      untracked(() => {
        if (host !== this.host) {
          this.host = host;
          this.sequence++;
          this.tasks.set(undefined);
          this.loadError.set(undefined);
          this.staleReason.set(undefined);
        }
        if (active && host) {
          void this.load();
        }
      });
    });
  }

  async load(): Promise<void> {
    const sequence = ++this.sequence;
    this.loading.set(true);
    try {
      const response = await this.api.post<unknown>('performance/pending_tasks');
      if (sequence !== this.sequence) {
        return;
      }
      const tasks = normalizePendingTasks(response);
      const before = this.tasks()?.length;
      this.tasks.set(tasks);
      this.raw.set(response);
      this.loadedAt.set(Date.now());
      this.loadError.set(undefined);
      this.staleReason.set(undefined);
      this.count.emit(tasks.length);
      if (before !== tasks.length) {
        this.announcement.set(tasks.length === 0 ? 'No pending cluster tasks' : `${pluralize(tasks.length, 'pending cluster task')}`);
      }
    } catch (error: unknown) {
      if (sequence !== this.sequence) {
        return;
      }
      if (this.tasks() === undefined) {
        this.loadError.set(readableReason(error) ?? 'The cluster did not answer the pending tasks request.');
      } else {
        this.staleReason.set(readableReason(error) ?? 'The request failed.');
      }
      this.alerts.error(failureMessage('Could not load pending tasks', error), error);
    } finally {
      if (sequence === this.sequence) {
        this.loading.set(false);
      }
    }
  }

  retry(): void {
    this.loadError.set(undefined);
    void this.load();
  }

  priorityBadge(task: PendingTask): string {
    const tone = priorityTone(task.priority);
    return tone === 'gray' ? 'badge badge-outline' : `badge badge-${tone}`;
  }

  showJson(task: PendingTask): void {
    this.dialogs.showJson(`Pending task (insert order ${task.order})`, task.raw, task.source);
  }

  showAllJson(): void {
    this.dialogs.showJson('Pending cluster tasks', this.raw(), '_cluster/pending_tasks');
  }
}
