import { DOCUMENT, DatePipe } from '@angular/common';
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
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { AlertService } from '../../core/alert.service';
import { ClusterApiService } from '../../core/cluster-api.service';
import { ConnectionService } from '../../core/connection.service';
import { DialogService } from '../../core/dialog.service';
import { failureMessage } from '../../core/errors';
import { pluralize } from '../../core/format';
import { RefreshService } from '../../core/refresh.service';
import { EmptyStateComponent } from '../../shared/empty-state.component';
import { BytesPipe, DurationPipe, NumberPipe, PluralPipe } from '../../shared/format.pipes';
import { MeterComponent } from '../../shared/meter.component';
import { PagerComponent, clampPage, pageSlice } from '../../shared/pager.component';
import { SearchInputComponent } from '../../shared/search-input.component';
import { Recovery, RecoveryGroup, RecoverySample, RecoverySortField } from './recovery.models';
import {
  RECOVERY_TYPES,
  STAGES,
  bytesRemaining,
  describeLoadError,
  estimateRemaining,
  filterRecoveries,
  groupBytesLabel,
  groupRecoveries,
  metricView,
  parseRecoveries,
  recoveryPercent,
  recoveryRates,
  sortGroups,
  stageIndex,
  stageLabel,
  summarizeRecoveries,
  takeSample,
  typeCounts,
  typeMeta,
} from './recovery.utils';

/** Delay between reloads while recoveries are running. */
const LIVE_POLL_MS = 2_000;
const PAGE_SIZE = 20;

type Mode = 'active' | 'all';

const SORT_OPTIONS: readonly { readonly value: RecoverySortField; readonly label: string }[] = [
  { value: 'index', label: 'Index name' },
  { value: 'remaining', label: 'Most remaining' },
  { value: 'time', label: 'Longest running' },
];

@Component({
  selector: 'cerebro-recovery',
  imports: [
    BytesPipe,
    DatePipe,
    DurationPipe,
    EmptyStateComponent,
    FormsModule,
    MeterComponent,
    NumberPipe,
    PagerComponent,
    PluralPipe,
    RouterLink,
    SearchInputComponent,
  ],
  templateUrl: './recovery.component.html',
  styleUrl: './recovery.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RecoveryComponent {
  private readonly api = inject(ClusterApiService);
  private readonly alerts = inject(AlertService);
  private readonly dialogs = inject(DialogService);
  private readonly refreshService = inject(RefreshService);
  private readonly route = inject(ActivatedRoute);
  private readonly document = inject(DOCUMENT);
  readonly connection = inject(ConnectionService);

  readonly pageSize = PAGE_SIZE;
  readonly sortOptions = SORT_OPTIONS;
  readonly stages = STAGES.slice(0, -1);
  readonly livePollSeconds = LIVE_POLL_MS / 1_000;

  readonly mode = signal<Mode>('active');
  readonly recoveries = signal<readonly Recovery[] | undefined>(undefined);
  readonly raw = signal<unknown>(undefined);
  readonly failed = signal(false);
  /** Plain-language reason of the last failed load. */
  readonly failure = signal('');
  readonly loading = signal(false);
  readonly updatedAt = signal<number | null>(null);
  readonly rates = signal<ReadonlyMap<string, number>>(new Map());

  readonly query = signal(this.route.snapshot.queryParamMap.get('index') ?? '');
  readonly hiddenTypes = signal<ReadonlySet<string>>(new Set());
  readonly sortField = signal<RecoverySortField>('index');
  readonly page = signal(1);

  readonly paused = this.refreshService.paused;

  readonly filtered = computed(() =>
    filterRecoveries(this.recoveries() ?? [], { text: this.query(), hiddenTypes: this.hiddenTypes() }),
  );

  readonly groups = computed(() => sortGroups(groupRecoveries(this.filtered()), this.sortField()));
  readonly visibleGroups = computed(() =>
    pageSlice(this.groups(), clampPage(this.page(), this.groups().length, PAGE_SIZE), PAGE_SIZE),
  );
  readonly currentPage = computed(() => clampPage(this.page(), this.groups().length, PAGE_SIZE));

  /** Tiles describe the whole cluster; the index and type filters only narrow the list. */
  readonly summary = computed(() => summarizeRecoveries(this.recoveries() ?? []));
  readonly counts = computed(() => typeCounts(this.recoveries() ?? []));

  /** Types offered as filter chips: the known ones present plus any unknown ones. */
  readonly typeFilters = computed(() => {
    const counts = this.counts();
    const types = [...new Set([...RECOVERY_TYPES.filter((type) => counts.has(type)), ...counts.keys()])];
    return types.map((type) => ({ type, meta: typeMeta(type), count: counts.get(type) ?? 0 }));
  });

  readonly filtersActive = computed(() => this.query().trim() !== '' || this.hiddenTypes().size > 0);

  readonly throughput = computed(() => {
    const rates = this.rates();
    if (rates.size === 0) {
      return null;
    }
    let total = 0;
    for (const recovery of this.recoveries() ?? []) {
      total += rates.get(recovery.key) ?? 0;
    }
    return total;
  });

  readonly eta = computed(() => estimateRemaining(this.summary().bytesRemaining, this.throughput() ?? undefined));

  readonly live = computed(
    () =>
      this.mode() === 'active' &&
      !this.failed() &&
      !this.paused() &&
      (this.recoveries() ?? []).some((recovery) => !recovery.done),
  );

  private loadSequence = 0;
  private pollTimer: ReturnType<typeof setTimeout> | undefined;
  private previousSample: { readonly mode: Mode; readonly sample: RecoverySample } | null = null;
  private destroyed = false;
  /** A fast poll was skipped because the tab was hidden; resume it on return. */
  private pollSkipped = false;

  constructor() {
    effect(() => {
      this.refreshService.tick();
      if (this.connection.connected()) {
        untracked(() => void this.load());
      }
    });
    // Resuming auto refresh restarts the fast polling when recoveries are running.
    effect(() => {
      if (this.paused()) {
        untracked(() => this.cancelPoll());
      }
    });
    const onVisibility = () => {
      if (!this.document.hidden && this.pollSkipped) {
        this.pollSkipped = false;
        void this.load();
      }
    };
    this.document.addEventListener('visibilitychange', onVisibility);
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
      this.cancelPoll();
      this.document.removeEventListener('visibilitychange', onVisibility);
    });
  }

  async load(): Promise<void> {
    const sequence = ++this.loadSequence;
    const mode = this.mode();
    this.cancelPoll();
    this.pollSkipped = false;
    this.loading.set(true);
    let succeeded = false;
    try {
      const rows = await this.api.post<unknown>('recovery', { active_only: mode === 'active' });
      if (sequence !== this.loadSequence) {
        return;
      }
      const recoveries = parseRecoveries(rows);
      const now = Date.now();
      const sample = takeSample(recoveries, now);
      const previous = this.previousSample?.mode === mode ? this.previousSample.sample : null;
      this.rates.set(recoveryRates(previous, sample));
      this.previousSample = { mode, sample };
      this.recoveries.set(recoveries);
      this.raw.set(rows);
      this.updatedAt.set(now);
      this.failed.set(false);
      this.failure.set('');
      succeeded = true;
    } catch (error: unknown) {
      if (sequence !== this.loadSequence) {
        return;
      }
      // One toast per outage, not one per refresh.
      if (!this.failed()) {
        this.alerts.error(failureMessage('Could not load shard recoveries', error), error);
      }
      this.failed.set(true);
      this.failure.set(describeLoadError(error));
    } finally {
      if (sequence === this.loadSequence) {
        this.loading.set(false);
        // After a failure, fall back to the regular refresh tick instead of hammering the cluster.
        if (succeeded) {
          this.schedulePoll();
        }
      }
    }
  }

  setMode(mode: Mode): void {
    if (this.mode() === mode) {
      return;
    }
    this.mode.set(mode);
    this.recoveries.set(undefined);
    this.rates.set(new Map());
    this.failed.set(false);
    this.failure.set('');
    this.page.set(1);
    void this.load();
  }

  toggleType(type: string): void {
    this.hiddenTypes.update((hidden) => {
      const next = new Set(hidden);
      if (next.has(type)) {
        next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
    this.page.set(1);
  }

  setQuery(value: string): void {
    this.query.set(value);
    this.page.set(1);
  }

  setSort(field: RecoverySortField): void {
    this.sortField.set(field);
    this.page.set(1);
  }

  resetFilters(): void {
    this.query.set('');
    this.hiddenTypes.set(new Set());
    this.page.set(1);
  }

  viewJson(): void {
    this.dialogs.showJson(
      'Recoveries',
      this.raw(),
      this.mode() === 'active' ? '_cat/recovery?active_only=true' : '_cat/recovery',
    );
  }

  indexQuery(index: string): Record<string, string | null> {
    return { ...this.connection.hostQuery(), index };
  }

  groupLabel(group: RecoveryGroup): string {
    if (group.active === 0) {
      return pluralize(group.recoveries.length, 'recovery', 'recoveries') + ' completed';
    }
    return `${pluralize(group.active, 'shard')} recovering`;
  }

  /** "es-node-1 → es-node-3" or a description of where the data comes from. */
  source(recovery: Recovery): string {
    switch (recovery.type) {
      case 'snapshot':
        return recovery.repository && recovery.snapshot
          ? `${recovery.repository} / ${recovery.snapshot}`
          : (recovery.snapshot ?? recovery.repository ?? 'Snapshot');
      case 'existing_store':
        return 'Local data';
      case 'empty_store':
        return 'New, empty shard';
      case 'local_shards':
        return 'Local shards';
      default:
        return recovery.sourceNode ?? recovery.sourceHost ?? 'Unknown source';
    }
  }

  rate(recovery: Recovery): number | undefined {
    return recovery.done ? undefined : this.rates().get(recovery.key);
  }

  remainingTime(recovery: Recovery): number | null {
    return estimateRemaining(bytesRemaining(recovery), this.rate(recovery));
  }

  stageState(recovery: Recovery, step: number): 'done' | 'current' | 'todo' {
    const current = stageIndex(recovery.stage);
    if (recovery.done || step < current) {
      return 'done';
    }
    return step === current ? 'current' : 'todo';
  }

  readonly metricKinds = [
    { kind: 'bytes', label: 'Bytes' },
    { kind: 'files', label: 'Files' },
    { kind: 'translog', label: 'Translog' },
  ] as const;
  readonly metricView = metricView;
  readonly groupBytesLabel = groupBytesLabel;
  readonly typeMeta = typeMeta;
  readonly stageLabel = stageLabel;
  readonly recoveryPercent = recoveryPercent;
  readonly bytesRemaining = bytesRemaining;
  readonly pluralize = pluralize;

  /** Fast polling only while something recovers in "In progress" mode and the tab is visible. */
  private schedulePoll(): void {
    if (this.destroyed || !this.live()) {
      return;
    }
    if (this.document.hidden) {
      this.pollSkipped = true;
      return;
    }
    this.pollTimer = setTimeout(() => {
      this.pollTimer = undefined;
      void this.load();
    }, LIVE_POLL_MS);
  }

  private cancelPoll(): void {
    if (this.pollTimer !== undefined) {
      clearTimeout(this.pollTimer);
      this.pollTimer = undefined;
    }
  }
}
