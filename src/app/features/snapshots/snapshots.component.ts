import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  linkedSignal,
  signal,
  untracked,
  viewChild,
  viewChildren,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AlertService } from '../../core/alert.service';
import { ClipboardService } from '../../core/clipboard.service';
import { ClusterApiService } from '../../core/cluster-api.service';
import { ConnectionService } from '../../core/connection.service';
import { DialogService } from '../../core/dialog.service';
import { failureMessage, readableReason } from '../../core/errors';
import { formatDuration, formatRelative, formatTimestamp, pluralize, sortByName } from '../../core/format';
import { readPreference, writePreference } from '../../core/preferences';
import { RefreshService } from '../../core/refresh.service';
import { EmptyStateComponent } from '../../shared/empty-state.component';
import { NumberPipe, PluralPipe } from '../../shared/format.pipes';
import { MenuComponent } from '../../shared/menu.component';
import { PagerComponent, clampPage, pageSlice } from '../../shared/pager.component';
import { SearchInputComponent } from '../../shared/search-input.component';
import { createSort } from '../../shared/sort-state';
import { ChecklistOption, IndexChecklistComponent } from './index-checklist.component';
import { SnapshotRestoreComponent } from './snapshot-restore.component';
import {
  SnapshotLandingData,
  SnapshotRecord,
  SnapshotState,
  buildCreateSnapshotPayload,
} from './snapshots.models';
import {
  SNAPSHOT_STATES,
  SnapshotSortField,
  badgeClass,
  failedShards,
  filterSnapshots,
  isInProgress,
  isRestorable,
  snapshotDuration,
  snapshotIndices,
  snapshotKey,
  snapshotStart,
  sortSnapshots,
  stateMeta,
  suggestSnapshotName,
  summarizeSnapshots,
  uniqueName,
  validateSnapshotName,
} from './snapshots.utils';

const REPOSITORY_PREFERENCE = 'cerebro.snapshots.repository';
/** Delay between reloads while a snapshot is running. */
const IN_PROGRESS_POLL_MS = 3_000;
const PAGE_SIZE = 25;

type CreateScope = 'all' | 'selected';

interface SnapshotRow {
  readonly key: string;
  readonly record: SnapshotRecord;
  readonly state: ReturnType<typeof stateMeta>;
  readonly badgeClass: string;
  readonly running: boolean;
  readonly restorable: boolean;
  readonly started: string;
  readonly relative: string;
  readonly duration: string;
  readonly indices: readonly string[];
  readonly indexPreview: string;
  readonly shardsTotal: number | null;
  readonly shardsFailed: number;
}

interface PendingSnapshots {
  readonly repository: string;
  readonly list: readonly SnapshotRecord[];
}

interface RestoreTarget {
  readonly repository: string;
  readonly snapshot: SnapshotRecord;
}

@Component({
  selector: 'cerebro-snapshots',
  imports: [
    EmptyStateComponent,
    FormsModule,
    IndexChecklistComponent,
    MenuComponent,
    NumberPipe,
    PagerComponent,
    PluralPipe,
    RouterLink,
    SearchInputComponent,
    SnapshotRestoreComponent,
  ],
  templateUrl: './snapshots.component.html',
  styleUrl: './snapshots.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SnapshotsComponent {
  private readonly api = inject(ClusterApiService);
  private readonly alerts = inject(AlertService);
  private readonly dialogs = inject(DialogService);
  private readonly clipboard = inject(ClipboardService);
  private readonly refreshService = inject(RefreshService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  readonly connection = inject(ConnectionService);

  readonly pageSize = PAGE_SIZE;

  // Repositories and cluster indices.
  readonly landing = signal<SnapshotLandingData | undefined>(undefined);
  readonly landingFailed = signal(false);
  /** Why the last landing request failed, as Elasticsearch put it. */
  readonly landingError = signal<string | undefined>(undefined);
  readonly repository = signal('');

  // Snapshots of the selected repository.
  readonly snapshots = signal<readonly SnapshotRecord[] | undefined>(undefined);
  readonly snapshotsFailed = signal(false);
  /** Why the last snapshot-list request failed, as Elasticsearch put it. */
  readonly snapshotsError = signal<string | undefined>(undefined);
  readonly now = signal(Date.now());
  readonly deleting = signal<ReadonlySet<string>>(new Set());

  // List filters.
  readonly query = signal('');
  readonly hiddenStates = signal<ReadonlySet<string>>(new Set());
  /** Newest first; dates and counts start largest first, names alphabetically. */
  readonly sort = createSort<SnapshotSortField>('start', {
    reverse: true,
    descendingFirst: (field) => field !== 'name',
  });
  readonly page = signal(1);

  readonly restoreTarget = signal<RestoreTarget | undefined>(undefined);

  // Create form.
  readonly createRepository = linkedSignal(() => this.repository());
  readonly createName = signal(suggestSnapshotName(new Date()));
  readonly createScope = signal<CreateScope>('all');
  readonly createSelected = signal<ReadonlySet<string>>(new Set());
  readonly showSpecial = signal(false);
  readonly createIgnoreUnavailable = signal(false);
  readonly createIncludeGlobalState = signal(true);
  readonly createSubmitted = signal(false);
  readonly creating = signal(false);

  /**
   * A row menu closes as soon as anything scrolls, so background reloads
   * (in-progress polling, auto refresh) are held back while one is open.
   */
  private readonly menus = viewChildren(MenuComponent);
  private readonly createChecklist = viewChild(IndexChecklistComponent);
  readonly menuOpen = computed(() => this.menus().some((menu) => menu.open()));
  private readonly pendingSnapshots = signal<PendingSnapshots | null>(null);

  readonly repositories = computed(() => this.landing()?.repositories ?? []);
  readonly clusterIndexNames = computed(() => (this.landing()?.indices ?? []).map((index) => index.name));
  readonly specialCount = computed(
    () => (this.landing()?.indices ?? []).filter((index) => index.special).length,
  );
  readonly regularCount = computed(
    () => (this.landing()?.indices ?? []).filter((index) => !index.special).length,
  );

  readonly indexOptions = computed<ChecklistOption[]>(() =>
    (this.landing()?.indices ?? [])
      .filter((index) => this.showSpecial() || !index.special)
      .map((index) => (index.special ? { name: index.name, badge: 'special' } : { name: index.name }))
      .sort((left, right) => left.name.localeCompare(right.name)),
  );

  readonly createSelection = computed(() =>
    this.indexOptions()
      .map((option) => option.name)
      .filter((name) => this.createSelected().has(name)),
  );

  private readonly takenNames = computed(() =>
    this.createRepository() === this.repository()
      ? new Set((this.snapshots() ?? []).map((snapshot) => snapshot.snapshot))
      : new Set<string>(),
  );

  readonly nameError = computed(() => validateSnapshotName(this.createName(), this.takenNames()));
  readonly showNameError = computed(
    () => !!this.nameError() && (this.createSubmitted() || this.createName().trim() !== ''),
  );
  readonly repositoryError = computed(() =>
    this.createRepository() ? null : 'Select the repository to write the snapshot to',
  );
  readonly selectionError = computed(() =>
    this.createScope() === 'selected' && this.createSelection().length === 0
      ? 'Select at least one index, or snapshot all indices'
      : null,
  );
  readonly createValid = computed(
    () => !this.nameError() && !this.repositoryError() && !this.selectionError(),
  );

  readonly summary = computed(() => summarizeSnapshots(this.snapshots() ?? []));

  readonly stateChips = computed(() => {
    const counts = this.summary().states;
    return SNAPSHOT_STATES.filter((state) => (counts[state] ?? 0) > 0).map((state) => ({
      state,
      label: stateMeta(state).label,
      count: counts[state] ?? 0,
    }));
  });

  readonly visible = computed(() =>
    sortSnapshots(
      filterSnapshots(this.snapshots() ?? [], this.query(), this.hiddenStates()),
      this.sort.field(),
      this.sort.reverse(),
    ),
  );

  readonly currentPage = computed(() => clampPage(this.page(), this.visible().length, PAGE_SIZE));

  readonly rows = computed<SnapshotRow[]>(() => {
    const now = this.now();
    return pageSlice(this.visible(), this.currentPage(), PAGE_SIZE).map((record) => {
      const start = snapshotStart(record);
      const indices = [...snapshotIndices(record)].sort((left, right) => left.localeCompare(right));
      const duration = snapshotDuration(record, now);
      return {
        key: snapshotKey(record),
        record,
        state: stateMeta(record.state),
        badgeClass: badgeClass(stateMeta(record.state).tone),
        running: isInProgress(record),
        restorable: isRestorable(record),
        started: formatTimestamp(start),
        relative: formatRelative(start, now),
        duration: duration === null ? '–' : formatDuration(duration),
        indices,
        indexPreview: indices.join(', '),
        shardsTotal: typeof record.shards?.total === 'number' ? record.shards.total : null,
        shardsFailed: failedShards(record),
      };
    });
  });

  readonly sortDescription = computed(() => {
    const reverse = this.sort.reverse();
    switch (this.sort.field()) {
      case 'name':
        return reverse ? 'Sorted by name, Z to A' : 'Sorted by name, A to Z';
      case 'indices':
        return reverse ? 'Most indices first' : 'Fewest indices first';
      default:
        return reverse ? 'Newest snapshots first' : 'Oldest snapshots first';
    }
  });

  readonly repositoriesLink = computed(() => ({
    ...this.connection.hostQuery(),
    repository: this.repository() || null,
  }));

  readonly filtersActive = computed(() => !!this.query().trim() || this.hiddenStates().size > 0);

  readonly pluralize = pluralize;
  readonly formatRelative = formatRelative;
  readonly snapshotStart = snapshotStart;

  private loadSequence = 0;
  private snapshotSequence = 0;
  private pollTimer: ReturnType<typeof setTimeout> | undefined;
  private destroyed = false;
  /** Pending URL updates of our own: their echoes are not user navigation. */
  private urlWrites = 0;
  /**
   * `?repository=` from a link, a bookmark or a hash pasted into the address
   * bar; it wins over the current repository on the next landing load.
   */
  private requestedRepository = this.route.snapshot.queryParamMap.get('repository') ?? '';

  constructor() {
    effect(() => {
      this.refreshService.tick();
      if (this.connection.connected()) {
        untracked(() => void this.load());
      }
    });
    effect(() => {
      const pending = this.pendingSnapshots();
      if (pending && !this.menuOpen()) {
        untracked(() => {
          this.pendingSnapshots.set(null);
          if (pending.repository === this.repository()) {
            this.applySnapshots(pending.repository, pending.list);
          }
        });
      }
    });
    // The page stays mounted when only the query changes, so follow
    // `?repository=` while it is open.
    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      const requested = params.get('repository');
      if (this.urlWrites > 0 || !requested || requested === untracked(this.repository)) {
        return;
      }
      if (untracked(this.repositories).includes(requested)) {
        this.requestedRepository = '';
        this.selectRepository(requested);
        return;
      }
      // Not loaded yet, or unknown (maybe registered since): the next
      // landing load opens it, or puts the repository it shows in the URL.
      this.requestedRepository = requested;
      if (untracked(this.landing) !== undefined) {
        void this.load();
      }
    });
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
      this.cancelPoll();
    });
  }

  async load(): Promise<void> {
    const sequence = ++this.loadSequence;
    try {
      const data = await this.api.post<SnapshotLandingData>('snapshots');
      if (sequence !== this.loadSequence) {
        return;
      }
      const repositories = sortByName(Array.isArray(data.repositories) ? data.repositories : []);
      this.landing.set({ indices: Array.isArray(data.indices) ? data.indices : [], repositories });
      this.landingFailed.set(false);

      const repository = this.pickRepository(repositories);
      if (repository !== this.repository()) {
        this.repository.set(repository);
        this.snapshots.set(undefined);
        this.pendingSnapshots.set(null);
        this.page.set(1);
      }
      if (repository) {
        this.rememberRepository(repository);
        await this.loadSnapshots(repository);
      } else {
        this.snapshots.set([]);
        this.writeRepositoryParam(null);
      }
    } catch (error: unknown) {
      if (sequence === this.loadSequence) {
        this.landingError.set(readableReason(error));
        this.landingFailed.set(true);
        this.alerts.error(failureMessage('Could not load snapshot repositories', error), error);
      }
    }
  }

  async loadSnapshots(repository: string): Promise<void> {
    const sequence = ++this.snapshotSequence;
    this.cancelPoll();
    try {
      const list = await this.api.post<SnapshotRecord[]>('snapshots/load', { repository });
      if (sequence !== this.snapshotSequence || repository !== this.repository()) {
        return;
      }
      const snapshots = Array.isArray(list) ? list : [];
      if (this.menuOpen() && this.snapshots() !== undefined) {
        // Applied (and polling resumed) once the menu closes.
        this.pendingSnapshots.set({ repository, list: snapshots });
        return;
      }
      this.applySnapshots(repository, snapshots);
    } catch (error: unknown) {
      if (sequence === this.snapshotSequence && repository === this.repository()) {
        this.snapshotsError.set(readableReason(error));
        this.snapshotsFailed.set(true);
        this.alerts.error(failureMessage(`Could not load the snapshots of ${repository}`, error), error);
      }
    }
  }

  private applySnapshots(repository: string, snapshots: readonly SnapshotRecord[]): void {
    this.snapshots.set(snapshots);
    this.snapshotsFailed.set(false);
    this.now.set(Date.now());
    if (snapshots.some(isInProgress)) {
      this.cancelPoll();
      this.pollTimer = setTimeout(() => {
        if (this.repository() === repository) {
          void this.loadSnapshots(repository);
        }
      }, IN_PROGRESS_POLL_MS);
    }
  }

  selectRepository(repository: string): void {
    if (repository === this.repository()) {
      return;
    }
    this.repository.set(repository);
    this.snapshots.set(undefined);
    this.snapshotsFailed.set(false);
    this.pendingSnapshots.set(null);
    this.page.set(1);
    this.query.set('');
    this.hiddenStates.set(new Set());
    this.rememberRepository(repository);
    void this.loadSnapshots(repository);
  }

  /**
   * Remembers the repository for the next visit and keeps it in the URL so
   * the view can be bookmarked and shared, also when it was picked
   * automatically.
   */
  private rememberRepository(repository: string): void {
    writePreference(REPOSITORY_PREFERENCE, repository);
    this.writeRepositoryParam(repository);
  }

  /** Replaces `?repository=` (null drops it) without adding a history entry. */
  private writeRepositoryParam(repository: string | null): void {
    // A load that finishes after the user left must not navigate back here.
    if (this.destroyed || this.route.snapshot.queryParamMap.get('repository') === repository) {
      return;
    }
    this.urlWrites++;
    this.router
      .navigate([], {
        relativeTo: this.route,
        queryParams: { repository },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      })
      .catch(() => false)
      .finally(() => this.urlWrites--);
  }

  retrySnapshots(): void {
    const repository = this.repository();
    if (repository) {
      this.snapshotsFailed.set(false);
      void this.loadSnapshots(repository);
    }
  }

  // ---- List ----

  setQuery(query: string): void {
    this.query.set(query);
    this.page.set(1);
  }

  toggleState(state: SnapshotState): void {
    this.hiddenStates.update((hidden) => {
      const next = new Set(hidden);
      if (next.has(state)) {
        next.delete(state);
      } else {
        next.add(state);
      }
      return next;
    });
    this.page.set(1);
  }

  resetFilters(): void {
    this.query.set('');
    this.hiddenStates.set(new Set());
    this.page.set(1);
  }

  changePage(page: number, card: HTMLElement): void {
    this.page.set(page);
    if (card.getBoundingClientRect().top < 0) {
      card.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
  }

  stateCount(state: SnapshotState): number {
    return this.summary().states[state] ?? 0;
  }

  // ---- Row actions ----

  view(snapshot: SnapshotRecord): void {
    this.dialogs.showJson(snapshot.snapshot, snapshot, `Snapshot in ${this.repository()}`);
  }

  async copyName(snapshot: SnapshotRecord): Promise<void> {
    await this.clipboard.copy(
      snapshot.snapshot,
      () => this.alerts.success('Snapshot name copied'),
      (error) => this.alerts.error('Could not copy to clipboard', error),
    );
  }

  openRestore(snapshot: SnapshotRecord): void {
    this.restoreTarget.set({ repository: this.repository(), snapshot });
  }

  onRestored(): void {
    // Restored indices show up in the cluster: refresh every live view.
    this.refreshService.refresh();
  }

  async remove(snapshot: SnapshotRecord): Promise<void> {
    const repository = this.repository();
    const name = snapshot.snapshot;
    const running = isInProgress(snapshot);
    const confirmed = await this.dialogs.confirm({
      title: `Delete snapshot ${name}?`,
      message: running
        ? `The snapshot is still running. Deleting it aborts the snapshot and removes what was written to ${repository}.`
        : `The snapshot is removed from ${repository}. Indices in the cluster are not affected. This cannot be undone.`,
      confirmLabel: running ? 'Abort and delete' : 'Delete snapshot',
      tone: 'danger',
    });
    if (!confirmed) {
      return;
    }
    const key = snapshotKey(snapshot);
    this.deleting.update((keys) => new Set(keys).add(key));
    try {
      const response = await this.api.post<unknown>('snapshots/delete', { repository, snapshot: name });
      this.alerts.success(`Snapshot ${name} deleted`, response);
      if (repository === this.repository()) {
        await this.loadSnapshots(repository);
      }
    } catch (error: unknown) {
      this.alerts.error(failureMessage(`Could not delete snapshot ${name}`, error), error);
    } finally {
      this.deleting.update((keys) => {
        const next = new Set(keys);
        next.delete(key);
        return next;
      });
    }
  }

  // ---- Create ----

  regenerateName(): void {
    this.createName.set(uniqueName(suggestSnapshotName(new Date()), this.takenNames()));
  }

  setScope(scope: CreateScope): void {
    this.createScope.set(scope);
  }

  async create(): Promise<void> {
    this.createSubmitted.set(true);
    if (this.creating()) {
      return;
    }
    if (!this.createValid()) {
      this.focusFirstInvalid();
      return;
    }
    const repository = this.createRepository();
    const name = this.createName().trim();
    const payload = buildCreateSnapshotPayload({
      repository,
      snapshot: name,
      ignoreUnavailable: this.createIgnoreUnavailable(),
      includeGlobalState: this.createIncludeGlobalState(),
      indices: this.createScope() === 'selected' ? this.createSelection() : [],
    });
    this.creating.set(true);
    try {
      const response = await this.api.post<unknown>('snapshots/create', payload);
      this.alerts.success(`Snapshot ${name} started in ${repository}`, response);
      this.createSubmitted.set(false);
      this.createName.set(
        uniqueName(suggestSnapshotName(new Date()), new Set([...this.takenNames(), name])),
      );
      if (repository === this.repository()) {
        await this.loadSnapshots(repository);
      }
    } catch (error: unknown) {
      this.alerts.error(failureMessage(`Could not create snapshot ${name}`, error), error);
    } finally {
      this.creating.set(false);
    }
  }

  focusCreate(): void {
    const input = document.getElementById('create-snapshot-name');
    input?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    input?.focus({ preventScroll: true });
  }

  private focusFirstInvalid(): void {
    if (this.repositoryError()) {
      document.getElementById('create-snapshot-repository')?.focus();
    } else if (this.nameError()) {
      document.getElementById('create-snapshot-name')?.focus();
    } else if (this.selectionError()) {
      this.createChecklist()?.focus();
    }
  }

  private pickRepository(repositories: readonly string[]): string {
    const candidates = [
      this.requestedRepository,
      this.repository(),
      readPreference(REPOSITORY_PREFERENCE) ?? '',
    ];
    const requested = this.requestedRepository;
    this.requestedRepository = '';
    if (requested && !repositories.includes(requested)) {
      this.alerts.warn(`Repository ${requested} does not exist`);
    }
    return candidates.find((name) => name && repositories.includes(name)) ?? repositories[0] ?? '';
  }

  private cancelPoll(): void {
    if (this.pollTimer !== undefined) {
      clearTimeout(this.pollTimer);
      this.pollTimer = undefined;
    }
  }
}
