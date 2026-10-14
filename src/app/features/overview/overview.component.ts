import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  ViewEncapsulation,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AlertService } from '../../core/alert.service';
import { ClusterApiService } from '../../core/cluster-api.service';
import { ConnectionService } from '../../core/connection.service';
import { DialogService } from '../../core/dialog.service';
import { failureMessage } from '../../core/errors';
import { formatBytes, pluralize } from '../../core/format';
import { readPreference, writePreference } from '../../core/preferences';
import { RefreshService } from '../../core/refresh.service';
import { EmptyStateComponent } from '../../shared/empty-state.component';
import { BytesPipe, CompactNumberPipe, NumberPipe } from '../../shared/format.pipes';
import { MenuComponent } from '../../shared/menu.component';
import { MeterComponent } from '../../shared/meter.component';
import { PagerComponent } from '../../shared/pager.component';
import { SearchInputComponent } from '../../shared/search-input.component';
import {
  AllocationKind,
  IndexOperation,
  JsonEndpoint,
  OverviewData,
  OverviewIndex,
  OverviewIndexFilter,
  OverviewNode,
  OverviewShard,
  RawOverviewData,
} from './overview.models';
import {
  NodeRole,
  OPERATIONS,
  UNASSIGNED,
  activeShardPercent,
  allocationExplainParams,
  canReceiveShard,
  describeShard,
  filterOverviewIndices,
  hasShardActivity,
  healthLabel,
  healthTone,
  indexBreakdown,
  indexSummary,
  indicesPayload,
  isSameShard,
  loadPercent,
  nodeAttributes,
  nodeRoleIcons,
  normalizeOverview,
  operationConfirmation,
  operationFailure,
  operationSuccess,
  operationTargets,
  pageOfIndex,
  primaryStoreSize,
  requiresOpenIndex,
  revealFlags,
  revealIndexFilter,
  shardActivityLabel,
  shardChipClass,
  shardHeading,
  shardMapLayout,
  shardState,
  shardsOn,
  stillRelocatable,
  visibleDataNodes,
} from './overview.utils';

const EXPANDED_PREFERENCE = 'cerebro.overview.expanded';

interface ShardView {
  readonly key: string;
  readonly shard: OverviewShard;
  readonly chipClass: string;
  readonly label: string;
  /** Short heading of the chip menu: "Shard 0 · replica · unassigned". */
  readonly heading: string;
  /** Assigned shards of open indices also offer stats and relocation. */
  readonly interactive: boolean;
  /** Query params of the allocation explain link (every chip offers one). */
  readonly explainQuery: Readonly<Record<string, string | null>>;
  readonly started: boolean;
  readonly selected: boolean;
}

interface CellView {
  readonly index: OverviewIndex;
  readonly shards: readonly ShardView[];
  readonly target: boolean;
}

interface RowView {
  readonly node: OverviewNode;
  readonly roles: readonly NodeRole[];
  readonly attributes: readonly (readonly [string, string])[];
  readonly load: number;
  readonly cells: readonly CellView[];
}

interface IndexColumn {
  readonly index: OverviewIndex;
  readonly summary: string;
  readonly aliasTitle: string;
}

interface AllocationOption {
  readonly kind: AllocationKind;
  readonly label: string;
  readonly description: string;
  readonly icon: string;
}

const ALLOCATION_OPTIONS: readonly AllocationOption[] = [
  {
    kind: 'none',
    label: 'Disable all',
    description: 'No shard is allocated at all',
    icon: 'bi-pause-circle',
  },
  {
    kind: 'primaries',
    label: 'Primaries only',
    description: 'Replicas stay where they are or unassigned',
    icon: 'bi-1-circle',
  },
  {
    kind: 'new_primaries',
    label: 'New primaries only',
    description: 'Only primaries of newly created indices',
    icon: 'bi-plus-circle',
  },
];

const BULK_OPERATIONS: readonly IndexOperation[] = ['open', 'close', 'merge', 'refresh', 'flush', 'cache'];

@Component({
  selector: 'cerebro-overview',
  imports: [
    BytesPipe,
    CompactNumberPipe,
    EmptyStateComponent,
    MenuComponent,
    MeterComponent,
    NumberPipe,
    PagerComponent,
    RouterLink,
    SearchInputComponent,
  ],
  templateUrl: './overview.component.html',
  styleUrl: './overview.component.css',
  // Shard chips are rendered as <cerebro-menu> triggers, so the page styles
  // must reach into child views; every rule is scoped to `cerebro-overview`.
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:keydown.escape)': 'onEscape()',
  },
})
export class OverviewComponent {
  private readonly api = inject(ClusterApiService);
  private readonly alerts = inject(AlertService);
  private readonly dialogs = inject(DialogService);
  private readonly refreshService = inject(RefreshService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  readonly connection = inject(ConnectionService);
  readonly pluralize = pluralize;

  readonly allocationOptions = ALLOCATION_OPTIONS;
  readonly bulkOperations = BULK_OPERATIONS;
  readonly operations = OPERATIONS;
  readonly skeletonRows = [1, 2, 3];
  readonly skeletonStats = [1, 2, 3, 4, 5, 6];

  readonly data = signal<OverviewData | undefined>(undefined);
  readonly loading = signal(false);
  readonly failed = signal(false);
  /** Time of the last successful load, shown when a later refresh fails. */
  readonly loadedAt = signal<Date | undefined>(undefined);
  /** Keys of running operations: `allocation`, `bulk`, `index:<name>`. */
  readonly busy = signal<ReadonlySet<string>>(new Set());

  readonly indexName = signal('');
  readonly includeClosed = signal(false);
  readonly includeSpecial = signal(false);
  readonly affectedOnly = signal(false);
  readonly ascending = signal(true);
  readonly nodeName = signal('');
  readonly expanded = signal(readPreference(EXPANDED_PREFERENCE) === 'true');

  /** Position of the first visible index; survives column count changes. */
  private readonly offset = signal(0);
  private readonly gridWidth = signal(0);
  readonly selected = signal<OverviewShard | undefined>(undefined);
  readonly relocating = signal(false);

  /** Name passed with `?filter=` whose closed/special chips still need revealing. */
  private pendingReveal: string | undefined;
  private loadSequence = 0;
  /** Pending debounced write of the index filter to the `?filter=` query param. */
  private urlTimer: ReturnType<typeof setTimeout> | undefined;
  /** Navigations started by this component to sync the URL; their emissions are echoes. */
  private urlWrites = 0;

  private readonly gridHost = viewChild<ElementRef<HTMLElement>>('gridHost');

  readonly layout = computed(() => shardMapLayout(this.gridWidth()));
  readonly pageSize = computed(() => this.layout().columns);

  readonly indexFilter = computed<OverviewIndexFilter>(() => ({
    name: this.indexName(),
    closed: this.includeClosed(),
    special: this.includeSpecial(),
    healthy: !this.affectedOnly(),
    ascending: this.ascending(),
  }));

  readonly filteredIndices = computed(() =>
    filterOverviewIndices(this.data()?.indices ?? [], this.indexFilter()),
  );

  readonly currentPage = computed(() => {
    const total = this.filteredIndices().length;
    const size = this.pageSize();
    const pages = Math.max(1, Math.ceil(total / size));
    return Math.min(pages, Math.floor(this.offset() / size) + 1);
  });

  readonly pageIndices = computed(() => {
    const size = this.pageSize();
    const start = (this.currentPage() - 1) * size;
    return this.filteredIndices().slice(start, start + size);
  });

  readonly columns = computed<readonly IndexColumn[]>(() =>
    this.pageIndices().map((index) => ({
      index,
      summary: indexSummary(index),
      aliasTitle: index.aliases.join(', '),
    })),
  );

  /** Filtered open indices: merge, refresh, flush and cache skip closed ones. */
  readonly openFilteredCount = computed(
    () => this.filteredIndices().filter((index) => !index.closed).length,
  );

  readonly fillerColumn = computed(() => this.pageIndices().length < this.pageSize());

  readonly tableWidth = computed(() => {
    const layout = this.layout();
    return layout.nodeColumn + layout.columns * layout.columnWidth;
  });

  readonly nodes = computed(() => visibleDataNodes(this.data()?.nodes ?? [], this.nodeName()));
  readonly dataNodeCount = computed(() => (this.data()?.nodes ?? []).filter((node) => node.data).length);
  readonly masterNodeCount = computed(() => (this.data()?.nodes ?? []).filter((node) => node.master).length);

  readonly nodeNames = computed(
    () => new Map((this.data()?.nodes ?? []).map((node) => [node.id, node.name] as const)),
  );

  readonly rows = computed<readonly RowView[]>(() => {
    const indices = this.pageIndices();
    const selected = this.selected();
    const names = this.nodeNames();
    const host = this.connection.hostQuery();
    return this.nodes().map((node) => ({
      node,
      roles: nodeRoleIcons(node),
      attributes: nodeAttributes(node.attributes),
      load: loadPercent(node),
      cells: indices.map((index) => ({
        index,
        shards: this.shardViews(index, node.id, selected, names, host),
        target: !this.relocating() && canReceiveShard(selected, index, node.id),
      })),
    }));
  });

  readonly unassignedCells = computed<readonly CellView[]>(() => {
    const names = this.nodeNames();
    const host = this.connection.hostQuery();
    return this.pageIndices().map((index) => ({
      index,
      shards: this.shardViews(index, UNASSIGNED, undefined, names, host),
      target: false,
    }));
  });

  /** Only when a visible column has unassigned shards; the callout reports the rest. */
  readonly showUnassignedRow = computed(() =>
    this.pageIndices().some((index) => (index.shards[UNASSIGNED]?.length ?? 0) > 0),
  );

  readonly counts = computed(() => {
    const data = this.data();
    return {
      unassigned: data?.unassigned_shards ?? 0,
      relocating: data?.relocating_shards ?? 0,
      initializing: data?.initializing_shards ?? 0,
    };
  });

  readonly hasActivity = computed(() => hasShardActivity(this.counts()));
  readonly activityLabel = computed(() => shardActivityLabel(this.counts()));
  readonly affectedCount = computed(
    () => (this.data()?.indices ?? []).filter((index) => index.unhealthy).length,
  );
  readonly activePercent = computed(() => {
    const data = this.data();
    return data ? activeShardPercent(data) : 0;
  });
  readonly primarySize = computed(() => primaryStoreSize(this.data()?.indices ?? []));
  readonly health = computed(() => healthTone(this.data()?.status));
  readonly healthLabel = computed(() => healthLabel(this.data()?.status));
  readonly indicesMeta = computed(() => {
    const data = this.data();
    return indexBreakdown(data?.total_indices ?? 0, data?.closed_indices ?? 0, data?.special_indices ?? 0);
  });
  readonly loadedAtLabel = computed(() => this.loadedAt()?.toLocaleTimeString() ?? '');

  readonly selectedNodeName = computed(() => {
    const shard = this.selected();
    return shard?.node ? (this.nodeNames().get(shard.node) ?? shard.node) : '';
  });

  readonly selectedOnPage = computed(() => {
    const shard = this.selected();
    return Boolean(shard && this.pageIndices().some((index) => index.name === shard.index));
  });

  readonly targetCount = computed(() =>
    this.rows().reduce(
      (sum, row) => sum + row.cells.filter((cell) => cell.target).length,
      0,
    ),
  );

  constructor() {
    effect(() => {
      this.refreshService.tick();
      if (this.connection.connected()) {
        void this.load();
      }
    });

    effect((onCleanup) => {
      const element = this.gridHost()?.nativeElement;
      if (!element) {
        return;
      }
      this.gridWidth.set(element.clientWidth);
      const observer = new ResizeObserver((entries) => {
        const width = entries[0]?.contentRect.width;
        if (width !== undefined && Math.abs(width - this.gridWidth()) >= 1) {
          this.gridWidth.set(width);
        }
      });
      observer.observe(element);
      onCleanup(() => observer.disconnect());
    });

    // `?filter=` deep links (command palette). The URL mirrors the index
    // filter (see the effect below), so a later link to the same index is a
    // real navigation again, and a plain /overview link clears the filter.
    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      const filter = params.get('filter');
      if (this.urlWrites > 0 || (filter ?? '') === untracked(this.indexName)) {
        return;
      }
      this.indexName.set(filter ?? '');
      this.offset.set(0);
      if (filter !== null) {
        this.affectedOnly.set(false);
        this.pendingReveal = filter;
        this.revealPending();
      }
    });

    effect(() => {
      const name = this.indexName();
      clearTimeout(this.urlTimer);
      this.urlTimer = setTimeout(() => this.writeFilterToUrl(name), 300);
    });
    this.destroyRef.onDestroy(() => clearTimeout(this.urlTimer));
  }

  async load(): Promise<void> {
    const sequence = ++this.loadSequence;
    this.loading.set(true);
    try {
      const raw = await this.api.post<RawOverviewData>('overview');
      if (sequence !== this.loadSequence) {
        return;
      }
      const data = normalizeOverview(raw);
      this.data.set(data);
      this.failed.set(false);
      this.loadedAt.set(new Date());
      this.selected.set(stillRelocatable(data, this.selected()));
      if (!hasShardActivity({
        unassigned: data.unassigned_shards,
        relocating: data.relocating_shards,
        initializing: data.initializing_shards,
      }) && data.indices.every((index) => !index.unhealthy)) {
        this.affectedOnly.set(false);
      }
      this.revealPending();
    } catch (error: unknown) {
      if (sequence !== this.loadSequence) {
        return;
      }
      this.failed.set(true);
      // A network failure was already reported by ClusterApiService; AlertService skips it.
      this.alerts.error(failureMessage('Could not load the cluster overview', error), error);
    } finally {
      if (sequence === this.loadSequence) {
        this.loading.set(false);
      }
    }
  }

  retry(): void {
    this.data.set(undefined);
    this.failed.set(false);
    void this.load();
  }

  isBusy(key: string): boolean {
    return this.busy().has(key);
  }

  // ---- Filters -------------------------------------------------------

  setIndexName(value: string): void {
    this.indexName.set(value);
    this.offset.set(0);
  }

  setNodeName(value: string): void {
    this.nodeName.set(value);
  }

  toggleClosed(): void {
    this.includeClosed.update((value) => !value);
    this.offset.set(0);
  }

  toggleSpecial(): void {
    this.includeSpecial.update((value) => !value);
    this.offset.set(0);
  }

  toggleAffected(): void {
    this.affectedOnly.update((value) => !value);
    this.offset.set(0);
  }

  toggleSort(): void {
    this.ascending.update((value) => !value);
    this.offset.set(0);
  }

  setExpanded(value: boolean): void {
    this.expanded.set(value);
    writePreference(EXPANDED_PREFERENCE, String(value));
  }

  clearFilters(): void {
    this.indexName.set('');
    this.nodeName.set('');
    this.affectedOnly.set(false);
    this.offset.set(0);
  }

  goToPage(page: number): void {
    this.offset.set(Math.max(0, (page - 1) * this.pageSize()));
  }

  // ---- Cluster actions -------------------------------------------------

  async disableAllocation(option: AllocationOption): Promise<void> {
    await this.run(
      'allocation',
      'overview/disable_shard_allocation',
      { kind: option.kind },
      `Shard allocation set to “${option.label.toLowerCase()}”`,
      'Could not disable shard allocation',
    );
  }

  async enableAllocation(): Promise<void> {
    await this.run(
      'allocation',
      'overview/enable_shard_allocation',
      {},
      'Shard allocation enabled',
      'Could not enable shard allocation',
    );
  }

  async operateOnIndex(operation: IndexOperation, index: OverviewIndex): Promise<void> {
    const definition = OPERATIONS[operation];
    if (definition.confirmSingle) {
      const confirmed = await this.dialogs.confirm(operationConfirmation(operation, [index.name]));
      if (!confirmed) {
        return;
      }
    }
    const done = await this.run(
      `index:${index.name}`,
      definition.path,
      indicesPayload([index.name]),
      operationSuccess(operation, [index.name]),
      operationFailure(operation, [index.name]),
    );
    this.keepClosedVisible(operation, done);
  }

  async operateOnFiltered(operation: IndexOperation): Promise<void> {
    const filtered = this.filteredIndices();
    if (filtered.length === 0) {
      this.alerts.warn('No index matches the current filters');
      return;
    }
    const definition = OPERATIONS[operation];
    const { names, skipped } = operationTargets(operation, filtered);
    if (names.length === 0) {
      this.alerts.warn(`${definition.label} only works on open indices, and every filtered index is closed`);
      return;
    }
    if (!(await this.dialogs.confirm(operationConfirmation(operation, names, skipped)))) {
      return;
    }
    const done = await this.run(
      'bulk',
      definition.path,
      indicesPayload(names),
      operationSuccess(operation, names, skipped),
      operationFailure(operation, names),
    );
    this.keepClosedVisible(operation, done);
  }

  /** Closed indices are hidden by default: keep the ones just closed on screen. */
  private keepClosedVisible(operation: IndexOperation, done: boolean): void {
    if (done && operation === 'close' && !this.includeClosed()) {
      this.includeClosed.set(true);
      this.alerts.info('Closed indices are now shown on the map');
    }
  }

  // ---- JSON viewers ------------------------------------------------------

  showNodeStats(node: OverviewNode): Promise<void> {
    return this.showJson(`${node.name} stats`, 'commons/get_node_stats', { node: node.id }, node.host ?? node.id);
  }

  showIndexJson(kind: 'settings' | 'mappings' | 'stats', index: OverviewIndex): Promise<void> {
    const path: JsonEndpoint =
      kind === 'settings'
        ? 'commons/get_index_settings'
        : kind === 'mappings'
          ? 'commons/get_index_mapping'
          : 'commons/get_index_stats';
    return this.showJson(`${index.name} ${kind}`, path, { index: index.name }, `Index ${kind}`);
  }

  showShardStats(shard: OverviewShard): Promise<void> {
    if (!shard.node) {
      return Promise.resolve();
    }
    const node = this.nodeNames().get(shard.node) ?? shard.node;
    return this.showJson(
      `Shard ${shard.shard} of ${shard.index}`,
      'overview/get_shard_stats',
      { index: shard.index, node: shard.node, shard: shard.shard },
      `${shard.primary ? 'Primary' : 'Replica'} on ${node}`,
      `shard ${shard.shard} of ${shard.index}`,
    );
  }

  // ---- Relocation ------------------------------------------------------

  toggleSelection(shard: OverviewShard): void {
    this.selected.update((current) => (isSameShard(current, shard) ? undefined : shard));
  }

  cancelSelection(): void {
    this.selected.set(undefined);
  }

  showSelectedIndex(): void {
    const shard = this.selected();
    const data = this.data();
    if (!shard || !data) {
      return;
    }
    // Relax the filters just enough for the index to be visible again.
    const filter = revealIndexFilter(data.indices, this.indexFilter(), shard.index);
    this.indexName.set(filter.name);
    this.includeClosed.set(filter.closed);
    this.includeSpecial.set(filter.special);
    this.affectedOnly.set(!filter.healthy);
    const page = pageOfIndex(this.filteredIndices(), shard.index, this.pageSize());
    this.goToPage(page ?? 1);
  }

  async relocateTo(node: OverviewNode): Promise<void> {
    const shard = this.selected();
    if (!shard?.node || this.relocating()) {
      return;
    }
    const from = this.nodeNames().get(shard.node) ?? shard.node;
    this.relocating.set(true);
    try {
      const response = await this.api.post<unknown>('overview/relocate_shard', {
        shard: shard.shard,
        index: shard.index,
        from: shard.node,
        to: node.id,
      });
      this.selected.set(undefined);
      this.alerts.success(
        `Moving shard ${shard.shard} of ${shard.index} from ${from} to ${node.name}`,
        response,
      );
      this.refreshService.refresh();
    } catch (error: unknown) {
      this.alerts.error(failureMessage(`Could not move shard ${shard.shard} of ${shard.index}`, error), error);
    } finally {
      this.relocating.set(false);
    }
  }

  onEscape(): void {
    if (this.selected() && !document.querySelector(':popover-open, dialog[open]')) {
      this.cancelSelection();
    }
  }

  // ---- Template helpers --------------------------------------------------

  /** Bulk menu hint: how many filtered indices an open-only operation reaches. */
  bulkHint(operation: IndexOperation): string {
    const open = this.openFilteredCount();
    return requiresOpenIndex(operation) && open < this.filteredIndices().length ? `${open} open` : '';
  }

  indexSettingsQuery(index: OverviewIndex): Record<string, string | null> {
    return { ...this.connection.hostQuery(), index: index.name };
  }

  /** `/index_detail` takes the same `?index=` parameter as `/index_settings`. */
  indexDetailQuery(index: OverviewIndex): Record<string, string | null> {
    return this.indexSettingsQuery(index);
  }

  bytes(value: number | null | undefined): string {
    return formatBytes(value);
  }

  private shardViews(
    index: OverviewIndex,
    nodeId: string,
    selected: OverviewShard | undefined,
    names: ReadonlyMap<string, string>,
    host: Readonly<Record<string, string | null>>,
  ): ShardView[] {
    return shardsOn(index, nodeId).map((shard, position) => {
      const state = shardState(shard);
      const isSelected = isSameShard(selected, shard);
      return {
        key: `${shard.shard}-${shard.primary ? 'p' : 'r'}-${position}`,
        shard,
        chipClass: shardChipClass(shard, index.closed, isSelected),
        label: describeShard(shard, names, index.closed),
        heading: shardHeading(shard, index.closed),
        interactive: !index.closed && nodeId !== UNASSIGNED && Boolean(shard.node),
        explainQuery: { ...host, ...allocationExplainParams(shard) },
        started: !index.closed && state === 'started',
        selected: isSelected,
      };
    });
  }

  private revealPending(): void {
    const name = this.pendingReveal;
    const data = this.data();
    if (name === undefined || !data) {
      return;
    }
    this.pendingReveal = undefined;
    const flags = revealFlags(data.indices, name);
    if (flags.closed) {
      this.includeClosed.set(true);
    }
    if (flags.special) {
      this.includeSpecial.set(true);
    }
  }

  /** Runs a mutation and refreshes the map; resolves `true` on success. */
  private async run(
    busyKey: string,
    path: string,
    payload: Record<string, unknown>,
    success: string,
    failure: string,
  ): Promise<boolean> {
    this.busy.update((keys) => new Set([...keys, busyKey]));
    try {
      const response = await this.api.post<unknown>(path, payload);
      this.alerts.success(success, response);
      return true;
    } catch (error: unknown) {
      this.alerts.error(failureMessage(failure, error), error);
      return false;
    } finally {
      this.busy.update((keys) => {
        const next = new Set(keys);
        next.delete(busyKey);
        return next;
      });
      this.refreshService.refresh();
    }
  }

  /** Mirrors the index filter in `?filter=` without adding history entries. */
  private writeFilterToUrl(name: string): void {
    const value = name === '' ? null : name;
    if (this.route.snapshot.queryParamMap.get('filter') === value) {
      return;
    }
    this.urlWrites++;
    void this.router
      .navigate([], {
        relativeTo: this.route,
        queryParams: { filter: value },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      })
      .finally(() => this.urlWrites--);
  }

  private async showJson(
    title: string,
    path: JsonEndpoint,
    payload: Record<string, unknown>,
    subtitle?: string,
    what = title,
  ): Promise<void> {
    try {
      const response = await this.api.post<unknown>(path, payload);
      this.dialogs.showJson(title, response, subtitle);
    } catch (error: unknown) {
      this.alerts.error(failureMessage(`Could not load ${what}`, error), error);
    }
  }
}
