import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { AlertService } from '../../core/alert.service';
import { ClusterApiService } from '../../core/cluster-api.service';
import { ConnectionService } from '../../core/connection.service';
import { DialogService } from '../../core/dialog.service';
import { failureMessage, readableReason } from '../../core/errors';
import { formatDuration } from '../../core/format';
import { MetricKey, NodeSeries, formatMetric, metricParts, seriesTone } from '../../core/metrics';
import { MetricsService } from '../../core/metrics.service';
import { RefreshService, refreshIntervalLabel } from '../../core/refresh.service';
import { EmptyStateComponent } from '../../shared/empty-state.component';
import { BytesPipe, DurationPipe, NumberPipe, PluralPipe } from '../../shared/format.pipes';
import { MenuComponent } from '../../shared/menu.component';
import { MeterComponent } from '../../shared/meter.component';
import { SearchInputComponent } from '../../shared/search-input.component';
import { createSort } from '../../shared/sort-state';
import { SparklineComponent } from '../../shared/sparkline.component';
import { NodeSortField, NodesFilter, NodesNode } from './nodes.models';
import {
  attributeEntries,
  filterNodes,
  findNodeByName,
  matchesNode,
  nodeCharts,
  nodeRoles,
  prettyByteString,
  sortNodes,
  summarizeNodes,
  threadPoolRows,
  withLiveGauges,
} from './nodes.utils';

type RoleKey = 'master' | 'data' | 'ingest' | 'coordinating';

interface RoleFilter {
  readonly key: RoleKey;
  readonly label: string;
}

/** The two rates of the Activity column. */
const ACTIVITY_RATES: readonly { readonly key: MetricKey; readonly label: string; readonly title: string; readonly chart: string }[] = [
  { key: 'indexingRate', label: 'Indexing', title: 'Documents indexed per second', chart: 'Indexing rate' },
  { key: 'searchRate', label: 'Search', title: 'Shard queries per second', chart: 'Search rate' },
];

const ROLE_FILTERS: readonly RoleFilter[] = [
  { key: 'master', label: 'Master' },
  { key: 'data', label: 'Data' },
  { key: 'ingest', label: 'Ingest' },
  { key: 'coordinating', label: 'Coordinating' },
];

@Component({
  selector: 'cerebro-nodes',
  imports: [
    BytesPipe,
    DatePipe,
    DurationPipe,
    EmptyStateComponent,
    MenuComponent,
    MeterComponent,
    NumberPipe,
    PluralPipe,
    SearchInputComponent,
    SparklineComponent,
  ],
  templateUrl: './nodes.component.html',
  styleUrl: './nodes.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NodesComponent {
  private readonly api = inject(ClusterApiService);
  private readonly alerts = inject(AlertService);
  private readonly dialogs = inject(DialogService);
  private readonly refreshService = inject(RefreshService);
  private readonly connection = inject(ConnectionService);
  private readonly metrics = inject(MetricsService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly injector = inject(Injector);

  readonly roleFilters = ROLE_FILTERS;
  readonly activityRates = ACTIVITY_RATES;
  readonly nodes = signal<readonly NodesNode[] | undefined>(undefined);
  readonly loading = signal(false);
  readonly failed = signal(false);
  /** Sentence explaining the last failed load. */
  readonly loadError = signal<string | undefined>(undefined);
  /** Time of the last successful load, shown while a refresh fails. */
  readonly loadedAt = signal<number | null>(null);
  readonly name = signal('');
  readonly roles = signal<Readonly<Record<RoleKey, boolean>>>({
    master: true,
    data: true,
    ingest: true,
    coordinating: true,
  });
  // Resource columns are most useful with the busiest node first.
  readonly sort = createSort<NodeSortField>('name', { descendingFirst: (field) => field !== 'name' });
  readonly showInternalAttributes = signal(false);

  readonly filter = computed<NodesFilter>(() => ({ name: this.name(), ...this.roles() }));

  /**
   * The nodes with CPU, load and heap of the latest metrics sample, so each
   * cell agrees with its sparkline (not while sampling fails: the nodes
   * request is then the fresher one).
   */
  private readonly liveNodes = computed(() => {
    const nodes = this.nodes() ?? [];
    return this.metrics.failed() ? nodes : withLiveGauges(nodes, this.metrics.latest());
  });

  readonly visibleNodes = computed(() =>
    sortNodes(
      filterNodes(this.liveNodes(), this.filter()),
      this.sort.field(),
      this.sort.reverse(),
    ),
  );

  /** True while the name or role filters hide some nodes. */
  readonly filtered = computed(
    () => this.name().trim() !== '' || Object.values(this.roles()).some((enabled) => !enabled),
  );

  readonly summary = computed(() => summarizeNodes(this.liveNodes()));

  readonly roleCounts = computed<Readonly<Record<RoleKey, number>>>(() => {
    const nodes = this.nodes() ?? [];
    return {
      master: nodes.filter((node) => node.master).length,
      data: nodes.filter((node) => node.data).length,
      ingest: nodes.filter((node) => node.ingest).length,
      coordinating: nodes.filter((node) => node.coordinating).length,
    };
  });

  /** Name of the node whose live activity is expanded (mirrored in `?node=`). */
  readonly expanded = signal<string | null>(null);
  readonly metricsReady = this.metrics.ready;
  readonly metricsFailed = this.metrics.failed;
  readonly metricsError = this.metrics.lastError;
  readonly metricsPaused = this.metrics.paused;
  readonly metricsSampling = this.metrics.sampling;
  readonly metricsLate = this.metrics.late;
  readonly metricsSampledAt = this.metrics.sampledAt;
  readonly hasSamples = computed(() => this.metrics.samples().length > 0);
  /** "Every 15s" or "Paused": the stable part, announced when it changes. */
  readonly samplingLabel = computed(() =>
    this.metrics.paused() ? 'Paused' : `Every ${refreshIntervalLabel(this.metrics.interval())}`,
  );
  /** "last 3m 5s": grows with every sample, so it is kept out of the live region. */
  readonly windowLabel = computed(() => {
    const span = this.metrics.history().span;
    return span > 0 ? `last ${formatDuration(span)}` : '';
  });
  /** "2 of 3 nodes answered" while some nodes fail their statistics. */
  readonly partialLabel = computed(() => {
    const answered = this.metrics.history().answered;
    return answered && answered.answered < answered.total
      ? `${answered.answered} of ${answered.total} nodes answered`
      : undefined;
  });
  /** Live series by node id. */
  private readonly series = computed(
    () => new Map(this.metrics.nodes().map((node) => [node.id, node] as const)),
  );
  /** Formatters per metric, created once so the sparklines keep their inputs. */
  private readonly formatters = new Map<MetricKey, (value: number) => string>();

  private loadSequence = 0;
  /** Cluster the nodes were loaded from; the route is reused when only `?host=` changes. */
  private loadedHost: string | undefined;
  /** `?node=` still to reveal once the nodes are loaded. */
  private pendingReveal: string | undefined;
  /** Navigations started here to sync the URL; their emissions are echoes. */
  private urlWrites = 0;

  constructor() {
    this.metrics.attach(inject(DestroyRef));

    effect(() => {
      this.refreshService.tick();
      this.connection.host();
      if (this.connection.connected()) {
        untracked(() => this.forgetOtherCluster());
        void this.load();
      }
    });

    // `?node=` deep links (cluster doctor, bookmarks): expand that node.
    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      // Back to another cluster: never resolve the node against the old list.
      this.forgetOtherCluster();
      const name = params.get('node');
      if (this.urlWrites > 0 || name === untracked(this.expanded)) {
        return;
      }
      this.expanded.set(name);
      this.pendingReveal = name ?? undefined;
      this.revealPending();
    });
  }

  async load(): Promise<void> {
    const sequence = ++this.loadSequence;
    this.loading.set(true);
    try {
      const nodes = await this.api.post<readonly NodesNode[]>('nodes');
      if (sequence === this.loadSequence) {
        this.nodes.set(nodes);
        this.loadedAt.set(Date.now());
        this.failed.set(false);
        this.loadError.set(undefined);
        this.revealPending();
      }
    } catch (error: unknown) {
      if (sequence === this.loadSequence) {
        // A failed refresh keeps the last figures on screen, marked as stale.
        this.failed.set(true);
        this.loadError.set(readableReason(error));
        this.alerts.error(failureMessage('Could not load nodes', error), error);
      }
    } finally {
      if (sequence === this.loadSequence) {
        this.loading.set(false);
      }
    }
  }

  toggleRole(role: RoleKey): void {
    this.roles.update((roles) => ({ ...roles, [role]: !roles[role] }));
  }

  resetFilters(): void {
    this.name.set('');
    this.roles.set({ master: true, data: true, ingest: true, coordinating: true });
  }

  async showStats(node: NodesNode): Promise<void> {
    try {
      const stats = await this.api.post<unknown>('commons/get_node_stats', { node: node.id });
      this.dialogs.showJson(`${node.name} stats`, stats, node.host ?? node.id);
    } catch (error: unknown) {
      this.alerts.error(failureMessage(`Could not load stats for ${node.name}`, error), error);
    }
  }

  // ---- Live activity ------------------------------------------------------

  toggleExpanded(node: NodesNode): void {
    const next = this.expanded() === node.name ? null : node.name;
    this.expanded.set(next);
    this.writeNodeToUrl(next);
  }

  isExpanded(node: NodesNode): boolean {
    return this.expanded() === node.name;
  }

  live(node: NodesNode): NodeSeries | undefined {
    return this.series().get(node.id);
  }

  /** Current value and unit of a metric in a table cell. */
  reading(node: NodesNode, key: MetricKey): { readonly value: string; readonly unit: string } {
    const points = this.live(node)?.series[key];
    return metricParts(key, points?.[points.length - 1]?.value ?? null);
  }

  tone(node: NodesNode, key: MetricKey): 'accent' | 'yellow' | 'red' {
    return seriesTone(key, this.live(node)?.series[key]);
  }

  charts(node: NodesNode) {
    return nodeCharts(this.live(node));
  }

  threadPools(node: NodesNode) {
    return threadPoolRows(this.live(node), this.metrics.latest().get(node.id));
  }

  format(key: MetricKey): (value: number) => string {
    let formatter = this.formatters.get(key);
    if (!formatter) {
      formatter = (value: number) => formatMetric(key, value);
      this.formatters.set(key, formatter);
    }
    return formatter;
  }

  resumeRefresh(): void {
    this.refreshService.resume();
  }

  retryMetrics(): void {
    void this.metrics.sampleNow();
  }

  /** Drops the nodes of the previous cluster after a host change. */
  private forgetOtherCluster(): void {
    const host = untracked(this.connection.host);
    if (host === this.loadedHost) {
      return;
    }
    const switched = this.loadedHost !== undefined;
    this.loadedHost = host;
    if (switched) {
      this.loadSequence++;
      this.nodes.set(undefined);
      this.loadedAt.set(null);
      this.loading.set(false);
      this.failed.set(false);
      this.loadError.set(undefined);
    }
  }

  /** Expands the `?node=` node once known: clears filters that hide it and scrolls to it. */
  private revealPending(): void {
    const name = this.pendingReveal;
    const nodes = this.nodes();
    if (name === undefined || !nodes) {
      return;
    }
    this.pendingReveal = undefined;
    const node = findNodeByName(nodes, name);
    if (!node) {
      this.alerts.warn(`Node ${name} is not in the cluster`);
      this.expanded.set(null);
      this.writeNodeToUrl(null);
      return;
    }
    if (!matchesNode(node, this.filter())) {
      this.resetFilters();
    }
    afterNextRender(
      () => document.getElementById(`node-row-${node.id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }),
      { injector: this.injector },
    );
  }

  /** Mirrors the expanded node in `?node=` without adding history entries. */
  private writeNodeToUrl(name: string | null): void {
    if (this.route.snapshot.queryParamMap.get('node') === name) {
      return;
    }
    this.urlWrites++;
    void this.router
      .navigate([], {
        relativeTo: this.route,
        queryParams: { node: name },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      })
      .finally(() => this.urlWrites--);
  }

  readonly roleBadges = nodeRoles;
  readonly bytesString = prettyByteString;

  attributes(node: NodesNode): readonly (readonly [string, string])[] {
    return attributeEntries(node.attributes, this.showInternalAttributes());
  }

  diskUsed(node: NodesNode): number | null {
    return node.disk ? node.disk.total - node.disk.available : null;
  }
}
