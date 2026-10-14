import { JsonPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterRenderEffect,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { map } from 'rxjs';
import { AlertService } from '../../core/alert.service';
import { ClusterApiError } from '../../core/api-envelope';
import { ClipboardService } from '../../core/clipboard.service';
import { ClusterApiService } from '../../core/cluster-api.service';
import { ConnectionService } from '../../core/connection.service';
import { DialogService } from '../../core/dialog.service';
import { failureMessage, readableReason } from '../../core/errors';
import { formatRelative, formatTimestamp, pluralize } from '../../core/format';
import { healthLabel } from '../../core/health';
import { RefreshService } from '../../core/refresh.service';
import { EmptyStateComponent } from '../../shared/empty-state.component';
import { BytesPipe, NumberPipe, PluralPipe } from '../../shared/format.pipes';
import { IndexPickerComponent } from '../../shared/index-picker.component';
import { MenuComponent } from '../../shared/menu.component';
import { SearchInputComponent } from '../../shared/search-input.component';
import { createSort } from '../../shared/sort-state';
import {
  AliasDetail,
  DETAIL_TABS,
  DetailTab,
  IlmExplainResponse,
  IndexDetail,
  IndexDetailResponse,
  IndexOperation,
  LifecycleState,
  MappingField,
  ShardRow,
  ShardSortField,
} from './index-detail.models';
import {
  INDEX_OPERATIONS,
  aliasDetails,
  countLeafFields,
  dataStreamOf,
  describeFilter,
  explainQuery,
  filterMappingFields,
  filterSettings,
  flattenSettings,
  indexHealth,
  indexSummary,
  isObjectType,
  keySettings,
  lifecycleLabel,
  lifecycleState,
  mappingInfo,
  nextTab,
  parseTab,
  resolveIndexDetail,
  settingHint,
  shardRows,
  shardStateTone,
  sortShards,
  statSections,
  stepInfoSummary,
  summarizeShards,
  typeTone,
} from './index-detail.utils';

type LoadState = 'idle' | 'loading' | 'ready' | 'missing' | 'multiple' | 'error';
type StatsScope = 'primaries' | 'total';
type ShardFilter = 'all' | 'primaries' | 'replicas' | 'problems';

const QUICK_PICKS = 8;

@Component({
  selector: 'cerebro-index-detail',
  imports: [
    BytesPipe,
    EmptyStateComponent,
    IndexPickerComponent,
    JsonPipe,
    MenuComponent,
    NumberPipe,
    PluralPipe,
    RouterLink,
    SearchInputComponent,
  ],
  templateUrl: './index-detail.component.html',
  styleUrl: './index-detail.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class IndexDetailComponent {
  private readonly api = inject(ClusterApiService);
  private readonly alerts = inject(AlertService);
  private readonly dialogs = inject(DialogService);
  private readonly clipboard = inject(ClipboardService);
  private readonly refreshService = inject(RefreshService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly connection = inject(ConnectionService);

  readonly tabs = DETAIL_TABS;
  readonly operations = INDEX_OPERATIONS;
  readonly maintenance: readonly IndexOperation[] = ['refresh', 'flush', 'merge', 'cache'];

  /** The `index` query parameter (an index, or an alias resolving to one). */
  readonly index = toSignal(this.route.queryParamMap.pipe(map((params) => params.get('index') ?? '')), {
    initialValue: '',
  });
  readonly tab = toSignal(this.route.queryParamMap.pipe(map((params) => parseTab(params.get('tab')))), {
    initialValue: 'overview' as DetailTab,
  });

  readonly state = signal<LoadState>('idle');
  readonly detail = signal<IndexDetail | undefined>(undefined);
  readonly candidates = signal<readonly string[]>([]);
  readonly loadError = signal<string | undefined>(undefined);
  readonly lifecycle = signal<LifecycleState | undefined>(undefined);
  readonly busy = signal<IndexOperation | null>(null);
  readonly loading = signal(false);
  readonly now = signal(Date.now());

  readonly mappingQuery = signal('');
  readonly settingsQuery = signal('');
  readonly statsScope = signal<StatsScope>('primaries');
  readonly shardFilter = signal<ShardFilter>('all');
  // Document counts and sizes are most useful largest first.
  readonly shardSort = createSort<ShardSortField>('shard', {
    descendingFirst: (field) => field === 'docs' || field === 'size',
  });

  readonly quickPicks = QUICK_PICKS;

  readonly name = computed(() => this.detail()?.name ?? this.index());
  readonly shards = computed(() => shardRows(this.detail()?.shards ?? null));
  readonly settings = computed(() => {
    const detail = this.detail();
    return detail ? keySettings(detail) : undefined;
  });
  readonly health = computed(() => {
    const detail = this.detail();
    return detail ? indexHealth(detail, this.shards()) : 'gray';
  });
  readonly summary = computed(() => {
    const detail = this.detail();
    return detail ? indexSummary(detail, this.shards()) : undefined;
  });
  readonly shardSummary = computed(() => summarizeShards(this.shards()));
  readonly stepInfo = computed(() => {
    const life = this.lifecycle();
    return life?.kind === 'managed' && life.stepInfo ? stepInfoSummary(life.stepInfo) : null;
  });
  readonly dataStream = computed(() => {
    const detail = this.detail();
    return detail ? dataStreamOf(detail.name) : null;
  });

  readonly mapping = computed(() => mappingInfo(this.detail()?.mappings ?? null));
  readonly visibleFields = computed(() => filterMappingFields(this.mapping().fields, this.mappingQuery()));
  readonly leafFieldCount = computed(() => countLeafFields(this.mapping().fields));

  readonly flatSettings = computed(() => flattenSettings(this.detail()?.settings ?? {}));
  readonly visibleSettings = computed(() => filterSettings(this.flatSettings(), this.settingsQuery()));

  readonly statGroups = computed(() => {
    const stats = this.detail()?.stats;
    return statSections(this.statsScope() === 'primaries' ? stats?.primaries : stats?.total);
  });

  readonly aliases = computed<readonly AliasDetail[]>(() => aliasDetails(this.detail()?.aliases ?? null));

  readonly visibleShards = computed(() => {
    const filter = this.shardFilter();
    const rows = this.shards().filter((row) => {
      switch (filter) {
        case 'all':
          return true;
        case 'primaries':
          return row.primary;
        case 'replicas':
          return !row.primary;
        case 'problems':
          return row.state !== 'started';
      }
    });
    return sortShards(rows, this.shardSort.field(), this.shardSort.reverse());
  });

  readonly problemShards = computed(() => this.shards().filter((row) => row.state !== 'started').length);

  private readonly tablist = viewChild<ElementRef<HTMLElement>>('tablist');
  private loadSequence = 0;
  private loadedIndex = '';
  private loadedHost: string | undefined;
  private lastResponse = '';
  private lastLifecycle = '';
  private ilmRaw: unknown = undefined;

  readonly typeTone = typeTone;
  readonly isObjectType = isObjectType;
  readonly lifecycleLabel = lifecycleLabel;
  readonly describeFilter = describeFilter;
  readonly shardTone = shardStateTone;
  readonly pluralize = pluralize;
  readonly settingHint = settingHint;
  readonly healthLabel = healthLabel;
  readonly formatTimestamp = formatTimestamp;

  constructor() {
    // Keep the selected tab visible in the horizontally scrolling tab strip.
    afterRenderEffect(() => {
      const tab = this.tab();
      const list = this.tablist()?.nativeElement;
      const button = list?.querySelector<HTMLElement>(`#index-tab-${tab}`);
      if (list && button && list.scrollWidth > list.clientWidth) {
        const left = button.getBoundingClientRect().left - list.getBoundingClientRect().left + list.scrollLeft;
        if (left < list.scrollLeft || left + button.offsetWidth > list.scrollLeft + list.clientWidth) {
          list.scrollLeft = Math.max(0, left - (list.clientWidth - button.offsetWidth) / 2);
        }
      }
    });

    effect(() => {
      this.refreshService.tick();
      const index = this.index();
      const host = this.connection.host();
      untracked(() => {
        if (host !== this.loadedHost || index !== this.loadedIndex) {
          this.loadedHost = host;
          this.reset(index);
        }
        if (host && index) {
          void this.load(index);
        }
      });
    });
  }

  /** Background refreshes keep the current view until the answer arrives. */
  async load(index: string): Promise<void> {
    const sequence = ++this.loadSequence;
    const current = (): boolean => sequence === this.loadSequence && index === this.index();
    this.loading.set(true);
    const lifecycleRequest = this.api
      .post<IlmExplainResponse>('ilm/explain', { index })
      .then((value) => ({ ok: true as const, value }))
      .catch((error: unknown) => ({ ok: false as const, error }));
    try {
      const response = await this.api.post<IndexDetailResponse>('index_detail', { index });
      if (!current()) {
        return;
      }
      this.now.set(Date.now());
      const serialized = JSON.stringify(response);
      if (serialized !== this.lastResponse || this.state() !== 'ready') {
        this.lastResponse = serialized;
        this.apply(response, index);
      }
      const ilm = await lifecycleRequest;
      const resolved = this.detail();
      if (!current() || !resolved) {
        return;
      }
      if (ilm.ok) {
        const serializedIlm = JSON.stringify(ilm.value);
        if (serializedIlm !== this.lastLifecycle || this.lifecycle() === undefined) {
          this.lastLifecycle = serializedIlm;
          this.ilmRaw = ilm.value.indices?.[resolved.name] ?? ilm.value;
          this.lifecycle.set(lifecycleState(ilm.value, resolved.name));
        }
      } else if (this.lifecycle() === undefined || this.lifecycle()?.kind === 'unavailable') {
        this.lastLifecycle = '';
        this.ilmRaw = undefined;
        this.lifecycle.set({ kind: 'unavailable', reason: readableReason(ilm.error) ?? null });
      }
    } catch (error: unknown) {
      if (!current()) {
        return;
      }
      if (error instanceof ClusterApiError && error.status === 404) {
        this.clear();
        this.state.set('missing');
      } else {
        if (this.state() !== 'ready') {
          this.loadError.set(readableReason(error));
          this.state.set('error');
        }
        this.alerts.error(failureMessage(`Could not load index ${index}`, error), error);
      }
    } finally {
      if (sequence === this.loadSequence) {
        this.loading.set(false);
      }
    }
  }

  private apply(response: IndexDetailResponse, index: string): void {
    const resolved = resolveIndexDetail(response, index);
    if (resolved.kind === 'single') {
      this.detail.set(resolved.detail);
      this.candidates.set([]);
      this.state.set('ready');
    } else {
      this.clear();
      this.candidates.set(resolved.kind === 'multiple' ? resolved.indices : []);
      this.state.set(resolved.kind);
    }
  }

  retry(): void {
    const index = this.index();
    if (index) {
      this.state.set('loading');
      void this.load(index);
    }
  }

  reload(): void {
    this.refreshService.refresh();
  }

  navigate(index: string): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { index: index || null },
      queryParamsHandling: 'merge',
    });
  }

  selectTab(tab: DetailTab): void {
    if (tab === this.tab()) {
      return;
    }
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { tab: tab === 'overview' ? null : tab },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  onTabKeydown(event: KeyboardEvent): void {
    const next = nextTab(this.tab(), event.key);
    if (!next) {
      return;
    }
    event.preventDefault();
    this.selectTab(next);
    const tablist = (event.currentTarget as HTMLElement | null)?.parentElement;
    tablist?.querySelector<HTMLElement>(`#index-tab-${next}`)?.focus();
  }

  tabCount(tab: DetailTab): number | null {
    switch (tab) {
      case 'mappings':
        return this.leafFieldCount();
      case 'shards':
        return this.shards().length;
      case 'aliases':
        return this.aliases().length;
      default:
        return null;
    }
  }

  // ---- Operations -----------------------------------------------------------

  async run(operation: IndexOperation): Promise<void> {
    const name = this.detail()?.name;
    if (!name || this.busy()) {
      return;
    }
    const definition = INDEX_OPERATIONS[operation];
    if (definition.confirm) {
      const confirmed = await this.dialogs.confirm({
        title: definition.confirm.title(name),
        message: definition.confirm.message,
        confirmLabel: definition.confirm.confirmLabel,
        tone: definition.confirm.tone,
      });
      if (!confirmed) {
        return;
      }
    }
    this.busy.set(operation);
    try {
      const response = await this.api.post<unknown>(definition.path, { indices: name });
      this.alerts.success(`Index ${name} ${definition.done}`, response);
      if (operation === 'delete') {
        await this.router.navigate(['/overview'], { queryParams: this.connection.hostQuery() });
        return;
      }
    } catch (error: unknown) {
      this.alerts.error(failureMessage(`Could not ${definition.verb} ${name}`, error), error);
    } finally {
      this.busy.set(null);
      this.refreshService.refresh();
    }
  }

  // ---- JSON escape hatches ----------------------------------------------------

  showSettingsJson(): void {
    const detail = this.detail();
    if (detail) {
      this.dialogs.showJson(`${detail.name} settings`, detail.settings, `GET /${detail.name}/_settings`);
    }
  }

  showMappingsJson(): void {
    const detail = this.detail();
    if (detail) {
      this.dialogs.showJson(`${detail.name} mappings`, detail.mappings ?? {}, `GET /${detail.name}/_mapping`);
    }
  }

  showStatsJson(): void {
    const detail = this.detail();
    if (detail) {
      this.dialogs.showJson(`${detail.name} stats`, detail.stats ?? {}, `GET /${detail.name}/_stats`);
    }
  }

  showShardsJson(): void {
    const detail = this.detail();
    if (detail) {
      this.dialogs.showJson(`${detail.name} shards`, detail.shards ?? [], `GET /_cat/shards/${detail.name}`);
    }
  }

  showAliasJson(alias: AliasDetail): void {
    const detail = this.detail();
    if (detail) {
      this.dialogs.showJson(`Alias ${alias.name}`, detail.aliases?.[alias.name] ?? {}, `on index ${detail.name}`);
    }
  }

  showAliasesJson(): void {
    const detail = this.detail();
    if (detail) {
      this.dialogs.showJson(`${detail.name} aliases`, detail.aliases ?? {}, `GET /${detail.name}/_alias`);
    }
  }

  showLifecycleJson(): void {
    const detail = this.detail();
    if (detail && this.ilmRaw !== undefined) {
      this.dialogs.showJson(`${detail.name} lifecycle`, this.ilmRaw, `GET /${detail.name}/_ilm/explain`);
    }
  }

  showStepInfoJson(): void {
    const detail = this.detail();
    const life = this.lifecycle();
    if (detail && life?.kind === 'managed' && life.stepInfo) {
      this.dialogs.showJson(`${detail.name} step info`, life.stepInfo, 'step_info of GET /' + detail.name + '/_ilm/explain');
    }
  }

  copy(value: string, what: string): void {
    void this.clipboard.copy(
      value,
      () => this.alerts.info(`${what} copied to the clipboard`),
      (error) => this.alerts.error(`Could not copy the ${what.toLowerCase()}`, error),
    );
  }

  // ---- Table helpers -----------------------------------------------------------

  explainParams(row: ShardRow): Record<string, string | number | boolean | null> {
    return { ...this.connection.hostQuery(), ...explainQuery(this.name(), row) };
  }

  linkParams(extra: Record<string, string>): Record<string, string | null> {
    return { ...this.connection.hostQuery(), ...extra };
  }

  age(date: Date | null): string {
    return formatRelative(date?.getTime(), this.now());
  }

  fieldIndent(field: MappingField): number {
    return this.mappingQuery().trim() ? 0 : field.depth;
  }

  private clear(): void {
    this.detail.set(undefined);
    this.lifecycle.set(undefined);
    this.ilmRaw = undefined;
    this.lastLifecycle = '';
  }

  private reset(index: string): void {
    this.loadedIndex = index;
    this.loadSequence++;
    this.lastResponse = '';
    this.clear();
    this.candidates.set([]);
    this.loadError.set(undefined);
    this.mappingQuery.set('');
    this.settingsQuery.set('');
    this.shardFilter.set('all');
    this.state.set(index ? 'loading' : 'idle');
  }
}
