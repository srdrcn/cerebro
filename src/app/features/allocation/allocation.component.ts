import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AlertService } from '../../core/alert.service';
import { ClusterApiService } from '../../core/cluster-api.service';
import { ConnectionService } from '../../core/connection.service';
import { DialogService } from '../../core/dialog.service';
import { RefreshService } from '../../core/refresh.service';
import { EmptyStateComponent } from '../../shared/empty-state.component';
import { BytesPipe } from '../../shared/format.pipes';
import { MeterComponent } from '../../shared/meter.component';
import {
  DeciderView,
  ExplainRequest,
  ExplanationView,
  NodeDecisionView,
  NodeSortField,
  RawAllocationExplain,
  ShardCopy,
} from './allocation.models';
import {
  ExplainFailure,
  buildExplainPayload,
  commonBlockers,
  copiesOf,
  copyLabel,
  describeExplainError,
  explainQueryParams,
  formatRelative,
  formatTimestamp,
  isNoUnassignedShards,
  normalizeExplanation,
  ordinal,
  parseExplainParams,
  parseShardCopies,
  pluralize,
  requestFor,
  sameRequest,
  shardCount,
  sortIndexNames,
  sortNodeDecisions,
  summarizeDecisions,
  unassignedGroups,
} from './allocation.utils';

/** Node rows start expanded when the table is this small. */
const EXPAND_ALL_UP_TO = 6;
/** Unassigned indices listed in the side panel before "and N more". */
const UNASSIGNED_LIMIT = 25;

type ExplainState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'all-assigned'; readonly at: number }
  | { readonly kind: 'error'; readonly failure: ExplainFailure; readonly body: unknown }
  | {
      readonly kind: 'done';
      readonly view: ExplanationView;
      readonly raw: RawAllocationExplain;
      readonly at: number;
      /** The shard this explanation is about (used to re-run it). */
      readonly target: ExplainRequest;
    };

@Component({
  selector: 'cerebro-allocation',
  imports: [BytesPipe, EmptyStateComponent, FormsModule, MeterComponent, RouterLink],
  templateUrl: './allocation.component.html',
  styleUrl: './allocation.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AllocationComponent {
  private readonly api = inject(ClusterApiService);
  private readonly alerts = inject(AlertService);
  private readonly dialogs = inject(DialogService);
  private readonly refreshService = inject(RefreshService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  readonly connection = inject(ConnectionService);

  readonly unassignedLimit = UNASSIGNED_LIMIT;

  // Cluster data for the form and the side panel.
  readonly indices = signal<readonly string[] | undefined>(undefined);
  readonly copies = signal<readonly ShardCopy[] | undefined>(undefined);
  readonly copiesFailed = signal(false);

  // Form.
  readonly formIndex = signal('');
  readonly formShard = signal<number | null>(0);
  readonly formPrimary = signal(true);
  readonly submitted = signal(false);

  // Explanation.
  readonly state = signal<ExplainState>({ kind: 'idle' });
  /** What the URL asks for; `null` = the next unassigned shard. */
  readonly request = signal<ExplainRequest | null>(null);
  readonly explaining = signal(false);
  readonly now = signal(Date.now());
  /** Screen reader announcement; only meaningful changes, never silent refreshes. */
  readonly announcement = signal('');

  // Node decisions table.
  readonly sortField = signal<NodeSortField>('decision');
  readonly reverse = signal(false);
  readonly expanded = signal<ReadonlySet<string>>(new Set());

  readonly indexOptions = computed(() => {
    const names = sortIndexNames(this.indices() ?? []);
    const selected = this.formIndex();
    return selected && !names.includes(selected) ? [selected, ...names] : names;
  });

  readonly formShardCount = computed(() => shardCount(this.copies() ?? [], this.formIndex()));

  readonly formError = computed(() => {
    const shard = this.formShard();
    if (!this.formIndex()) {
      return 'Choose the index of the shard to explain.';
    }
    if (shard === null || !Number.isInteger(shard) || shard < 0) {
      return 'The shard number is a whole number starting at 0.';
    }
    const count = this.formShardCount();
    if (count > 0 && shard >= count) {
      return `${this.formIndex()} has ${pluralize(count, 'shard')} (0–${count - 1}).`;
    }
    return null;
  });

  readonly formCopies = computed(() => {
    const shard = this.formShard();
    return shard === null ? [] : copiesOf(this.copies() ?? [], this.formIndex(), shard);
  });

  readonly unassigned = computed(() => unassignedGroups(this.copies() ?? []));
  readonly unassignedCount = computed(() =>
    this.unassigned().reduce((sum, group) => sum + group.copies.length, 0),
  );
  readonly visibleUnassigned = computed(() => this.unassigned().slice(0, UNASSIGNED_LIMIT));

  readonly view = computed(() => {
    const state = this.state();
    return state.kind === 'done' ? state.view : undefined;
  });

  readonly explainedAt = computed(() => {
    const state = this.state();
    return state.kind === 'done' ? state.at : null;
  });

  readonly sortedNodes = computed(() =>
    sortNodeDecisions(this.view()?.nodes ?? [], this.sortField(), this.reverse()),
  );

  readonly decisionSummary = computed(() => {
    const summary = summarizeDecisions(this.view()?.nodes ?? []);
    const parts: string[] = [];
    if (summary.yes > 0) {
      parts.push(`${pluralize(summary.yes, 'node')} can take it`);
    }
    if (summary.throttled > 0) {
      parts.push(`${summary.throttled} throttled`);
    }
    if (summary.no > 0) {
      parts.push(`${summary.no} said no`);
    }
    if (summary.other > 0) {
      parts.push(`${summary.other} other`);
    }
    return parts.join(' · ');
  });

  readonly blockers = computed(() => commonBlockers(this.view()?.nodes ?? []));
  /** Unassigned shards get a "what is blocking it" digest instead of per-node hints. */
  readonly showBlockerSummary = computed(() => {
    const view = this.view();
    return !!view && !view.assigned && view.verdict.tone !== 'blue' && this.blockers().length > 0;
  });
  readonly hasRanking = computed(() =>
    (this.view()?.nodes ?? []).some((node) => node.weightRanking !== null),
  );

  readonly expandableCount = computed(
    () => (this.view()?.nodes ?? []).filter((node) => node.blockers.length > 0).length,
  );
  readonly allExpanded = computed(() => {
    const expanded = this.expanded();
    const nodes = (this.view()?.nodes ?? []).filter((node) => node.blockers.length > 0);
    return nodes.length > 0 && nodes.every((node) => expanded.has(node.id));
  });

  private explainSequence = 0;
  private liveSequence = 0;
  private firstTick = true;

  constructor() {
    // Deep links (?index=&shard=&primary=&node=) and back/forward navigation.
    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      const request = parseExplainParams((name) => params.get(name));
      this.request.set(request);
      if (request) {
        this.formIndex.set(request.index);
        this.formShard.set(request.shard);
        this.formPrimary.set(request.primary);
      }
      this.submitted.set(false);
      void this.explain(request);
    });

    effect(() => {
      this.refreshService.tick();
      if (!this.connection.connected()) {
        return;
      }
      untracked(() => {
        this.now.set(Date.now());
        void this.loadClusterData();
        if (this.firstTick) {
          this.firstTick = false;
        } else {
          this.rerun(true);
        }
      });
    });
  }

  /** Index names and shard copies (form options and the unassigned list). */
  async loadClusterData(): Promise<void> {
    const sequence = ++this.liveSequence;
    const [indices, shards] = await Promise.allSettled([
      this.api.post<readonly string[]>('commons/indices'),
      this.api.post<unknown>('cat', { api: 'shards' }),
    ]);
    if (sequence !== this.liveSequence) {
      return;
    }
    if (indices.status === 'fulfilled') {
      this.indices.set(Array.isArray(indices.value) ? indices.value : []);
    } else if (this.indices() === undefined) {
      this.indices.set([]);
      this.alerts.error('Could not load the index list', indices.reason);
    }
    if (shards.status === 'fulfilled') {
      this.copies.set(parseShardCopies(shards.value));
      this.copiesFailed.set(false);
    } else {
      this.copiesFailed.set(true);
      if (this.copies() === undefined) {
        this.alerts.error('Could not load the shard list', shards.reason);
      }
    }
  }

  async explain(request: ExplainRequest | null, silent = false): Promise<void> {
    const sequence = ++this.explainSequence;
    this.explaining.set(true);
    if (!silent) {
      this.state.set({ kind: 'loading' });
    }
    try {
      const raw = await this.api.post<RawAllocationExplain>(
        'allocation/explain',
        buildExplainPayload(request),
      );
      if (sequence !== this.explainSequence) {
        return;
      }
      const view = normalizeExplanation(raw);
      const previous = this.state();
      this.state.set({ kind: 'done', view, raw, at: Date.now(), target: requestFor(view, request) });
      this.now.set(Date.now());
      const sameShard =
        previous.kind === 'done' &&
        previous.view.index === view.index &&
        previous.view.shard === view.shard &&
        previous.view.primary === view.primary;
      if (!silent || !sameShard || previous.view.verdict.title !== view.verdict.title) {
        this.announcement.set(
          `Explanation loaded for ${view.index} shard ${view.shard} ${view.primary ? 'primary' : 'replica'}: ${view.verdict.title}.`,
        );
      }
      if (!sameShard) {
        this.expanded.set(this.defaultExpanded(view.nodes));
      }
      if (!request) {
        // Show which shard Elasticsearch picked in the form.
        this.formIndex.set(view.index);
        this.formShard.set(view.shard);
        this.formPrimary.set(view.primary);
      }
    } catch (error: unknown) {
      if (sequence !== this.explainSequence) {
        return;
      }
      if (request === null && isNoUnassignedShards(error)) {
        if (!silent || this.state().kind !== 'all-assigned') {
          this.announcement.set('All shards are assigned.');
        }
        this.state.set({ kind: 'all-assigned', at: Date.now() });
      } else if (!silent || this.state().kind !== 'done') {
        const failure = describeExplainError(error, request);
        if (!silent || this.state().kind !== 'error') {
          this.announcement.set(`${failure.title}. ${failure.message}`);
        }
        this.state.set({ kind: 'error', failure, body: this.errorBody(error) });
      }
    } finally {
      if (sequence === this.explainSequence) {
        this.explaining.set(false);
      }
    }
  }

  /** Re-runs the current explanation (same shard, even when it was "next unassigned"). */
  rerun(silent = false): void {
    const state = this.state();
    if (state.kind === 'done') {
      void this.explain(state.target, silent);
    } else if (state.kind === 'all-assigned') {
      void this.explain(null, silent);
    } else if (!silent && state.kind === 'error') {
      void this.explain(this.request());
    }
  }

  submit(event?: Event): void {
    event?.preventDefault();
    this.submitted.set(true);
    const shard = this.formShard();
    if (this.formError() || shard === null) {
      return;
    }
    this.go({ index: this.formIndex(), shard, primary: this.formPrimary() });
  }

  explainNext(): void {
    this.go(null);
  }

  /** Drops the `node` of the current request (e.g. a stale deep link) and explains again. */
  explainWithoutNode(): void {
    const request = this.request();
    if (request) {
      this.go({ index: request.index, shard: request.shard, primary: request.primary });
    }
  }

  explainCopy(copy: ShardCopy): void {
    this.formIndex.set(copy.index);
    this.formShard.set(copy.shard);
    this.formPrimary.set(copy.primary);
    this.go({
      index: copy.index,
      shard: copy.shard,
      primary: copy.primary,
      // Replicas are told apart by the node holding them; an unassigned one is picked by default.
      ...(!copy.primary && copy.node ? { node: copy.node } : {}),
    });
  }

  selectIndex(index: string): void {
    this.formIndex.set(index);
    const shard = this.formShard();
    const count = shardCount(this.copies() ?? [], index);
    if (shard === null || (count > 0 && shard >= count)) {
      this.formShard.set(0);
    }
  }

  setShard(value: unknown): void {
    if (value === null || value === undefined || value === '') {
      this.formShard.set(null);
      return;
    }
    const shard = Number(value);
    this.formShard.set(Number.isFinite(shard) ? shard : null);
  }

  viewJson(): void {
    const state = this.state();
    if (state.kind === 'done') {
      const { view } = state;
      this.dialogs.showJson(
        'Allocation explanation',
        state.raw,
        `${view.index} · shard ${view.shard} · ${view.primary ? 'primary' : 'replica'}`,
      );
    } else if (state.kind === 'error') {
      this.dialogs.showJson('Elasticsearch response', state.body, state.failure.title);
    }
  }

  sortBy(field: NodeSortField): void {
    if (this.sortField() === field) {
      this.reverse.update((value) => !value);
    } else {
      this.sortField.set(field);
      this.reverse.set(false);
    }
  }

  ariaSort(field: NodeSortField): 'ascending' | 'descending' | 'none' {
    if (this.sortField() !== field) {
      return 'none';
    }
    return this.reverse() ? 'descending' : 'ascending';
  }

  sortIcon(field: NodeSortField): string {
    if (this.sortField() !== field) {
      return 'bi-arrow-down-up';
    }
    return this.reverse() ? 'bi-arrow-down' : 'bi-arrow-up';
  }

  toggleNode(node: NodeDecisionView): void {
    this.expanded.update((current) => {
      const next = new Set(current);
      if (next.has(node.id)) {
        next.delete(node.id);
      } else {
        next.add(node.id);
      }
      return next;
    });
  }

  toggleAll(): void {
    const nodes = this.view()?.nodes ?? [];
    this.expanded.set(
      this.allExpanded()
        ? new Set()
        : new Set(nodes.filter((node) => node.blockers.length > 0).map((node) => node.id)),
    );
  }

  isCurrentCopy(copy: ShardCopy): boolean {
    const state = this.state();
    if (state.kind !== 'done') {
      return false;
    }
    const { view } = state;
    if (view.index !== copy.index || view.shard !== copy.shard || view.primary !== copy.primary) {
      return false;
    }
    if (copy.primary) {
      return true;
    }
    return view.currentNode ? view.currentNode.name === copy.node : copy.node === null;
  }

  blockerSummary(blockers: readonly DeciderView[]): string {
    const no = blockers.filter((decider) => decider.decision === 'no').length;
    const other = blockers.length - no;
    if (no > 0 && other > 0) {
      return `${pluralize(no, 'decider')} said no, ${other} throttled`;
    }
    if (no > 0) {
      return `${pluralize(no, 'decider')} said no`;
    }
    return `Throttled by ${pluralize(other, 'decider')}`;
  }

  stateQuery(index: string): Record<string, string | null> {
    return { ...this.connection.hostQuery(), filter: index };
  }

  nodeSpread(nodes: readonly string[]): string {
    const total = this.view()?.nodes.length ?? 0;
    if (nodes.length === total && total > 1) {
      return `on all ${total} nodes`;
    }
    if (nodes.length <= 2) {
      return `on ${nodes.join(' and ')}`;
    }
    return `on ${nodes.length} of ${total} nodes`;
  }

  readonly copyLabel = copyLabel;
  readonly ordinal = ordinal;
  readonly formatRelative = formatRelative;
  readonly formatTimestamp = formatTimestamp;

  private go(request: ExplainRequest | null): void {
    if (sameRequest(request, this.request())) {
      void this.explain(request);
      return;
    }
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: explainQueryParams(request),
      queryParamsHandling: 'merge',
    });
  }

  private defaultExpanded(nodes: readonly NodeDecisionView[]): ReadonlySet<string> {
    return nodes.length <= EXPAND_ALL_UP_TO
      ? new Set(nodes.filter((node) => node.blockers.length > 0).map((node) => node.id))
      : new Set();
  }

  private errorBody(error: unknown): unknown {
    return typeof error === 'object' && error !== null && 'body' in error
      ? (error as { body: unknown }).body
      : error instanceof Error
        ? error.message
        : error;
  }
}
