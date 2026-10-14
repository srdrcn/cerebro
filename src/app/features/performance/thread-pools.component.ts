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
import { failureMessage, readableReason } from '../../core/errors';
import { pluralize } from '../../core/format';
import { RefreshService } from '../../core/refresh.service';
import { EmptyStateComponent } from '../../shared/empty-state.component';
import { NumberPipe, PluralPipe } from '../../shared/format.pipes';
import { SearchInputComponent } from '../../shared/search-input.component';
import { createSort } from '../../shared/sort-state';
import { ThreadPoolRow, ThreadPoolSortField } from './performance.models';
import {
  filterThreadPools,
  isSaturated,
  isShownByDefault,
  normalizeThreadPools,
  queueLevel,
  queuePercent,
  rejectionIncreases,
  rejectionSample,
  sortThreadPools,
  summarizeThreadPools,
  totalIncrease,
} from './performance.utils';

@Component({
  selector: 'cerebro-thread-pools',
  imports: [DatePipe, EmptyStateComponent, NumberPipe, PluralPipe, SearchInputComponent],
  templateUrl: './thread-pools.component.html',
  styleUrl: './thread-pools.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ThreadPoolsComponent {
  private readonly api = inject(ClusterApiService);
  private readonly alerts = inject(AlertService);
  private readonly refreshService = inject(RefreshService);
  private readonly connection = inject(ConnectionService);

  /** Whether the tab is shown: hidden tabs do not refresh. */
  readonly active = input(false);
  /** Rejections added since the page started watching (for the tab badge). */
  readonly newRejections = output<number>();

  readonly pluralize = pluralize;
  readonly queueLevel = queueLevel;
  readonly queuePercent = queuePercent;
  readonly isSaturated = isSaturated;

  readonly rows = signal<readonly ThreadPoolRow[] | undefined>(undefined);
  readonly loading = signal(false);
  readonly loadError = signal<string | undefined>(undefined);
  readonly staleReason = signal<string | undefined>(undefined);
  readonly loadedAt = signal(0);
  /** First sample of this host: "N new since" counts from it. */
  readonly baselineAt = signal(0);
  /** Rejections that grew since the previous sample, by row key. */
  readonly increases = signal<ReadonlyMap<string, number>>(new Map());

  readonly query = signal('');
  readonly showAll = signal(false);
  readonly sort = createSort<ThreadPoolSortField>('pool', {
    descendingFirst: (field) => field !== 'pool' && field !== 'node',
  });

  readonly all = computed(() => this.rows() ?? []);
  readonly hiddenCount = computed(() => this.all().filter((row) => !isShownByDefault(row)).length);
  readonly visible = computed(() =>
    sortThreadPools(
      filterThreadPools(this.all(), this.query(), this.showAll()),
      this.sort.field(),
      this.sort.reverse(),
      this.increases(),
    ),
  );
  readonly filtered = computed(() => this.query().trim() !== '' || (!this.showAll() && this.hiddenCount() > 0));
  readonly summary = computed(() => summarizeThreadPools(this.all()));
  readonly sinceBaseline = signal(0);
  readonly announcement = signal('');

  private sequence = 0;
  private host: string | undefined;
  private previous: ReadonlyMap<string, number> | null = null;

  constructor() {
    effect(() => {
      this.refreshService.tick();
      const active = this.active();
      const host = this.connection.host();
      untracked(() => {
        if (host !== this.host) {
          this.host = host;
          this.sequence++;
          this.previous = null;
          this.baselineAt.set(0);
          this.rows.set(undefined);
          this.loadError.set(undefined);
          this.staleReason.set(undefined);
          this.increases.set(new Map());
          this.sinceBaseline.set(0);
          this.newRejections.emit(0);
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
      const response = await this.api.post<unknown>('performance/thread_pools');
      if (sequence !== this.sequence) {
        return;
      }
      const rows = normalizeThreadPools(response);
      const increases = rejectionIncreases(this.previous, rows);
      if (!this.previous) {
        this.baselineAt.set(Date.now());
      }
      this.previous = rejectionSample(rows);
      this.rows.set(rows);
      this.increases.set(increases);
      this.loadedAt.set(Date.now());
      this.loadError.set(undefined);
      this.staleReason.set(undefined);
      // Summed sample by sample, so a node restart (counters back to 0) counts from the restart.
      const added = totalIncrease(increases);
      const since = this.sinceBaseline() + added;
      this.sinceBaseline.set(since);
      this.newRejections.emit(since);
      if (increases.size > 0) {
        this.announcement.set(`${pluralize(added, 'new rejection')} in ${pluralize(increases.size, 'thread pool')}`);
      }
    } catch (error: unknown) {
      if (sequence !== this.sequence) {
        return;
      }
      if (this.rows() === undefined) {
        this.loadError.set(readableReason(error) ?? 'The cluster did not answer the thread pool request.');
      } else {
        this.staleReason.set(readableReason(error) ?? 'The request failed.');
      }
      this.alerts.error(failureMessage('Could not load thread pools', error), error);
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

  resetFilters(): void {
    this.query.set('');
    this.showAll.set(true);
  }

  increase(row: ThreadPoolRow): number {
    return this.increases().get(row.key) ?? 0;
  }

  queueClass(row: ThreadPoolRow): string {
    const level = queueLevel(row);
    return level === 'danger' ? 'text-danger' : level === 'warn' ? 'text-warning' : '';
  }

  rowLabel(row: ThreadPoolRow): string {
    return `${row.pool} on ${row.node}`;
  }
}
