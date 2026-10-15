import { DestroyRef, Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { AlertService } from '../../core/alert.service';
import { ClusterApiError } from '../../core/api-envelope';
import { ClusterApiService } from '../../core/cluster-api.service';
import { ClusterChangesService } from '../../core/cluster-changes.service';
import { ConnectionService } from '../../core/connection.service';
import { DialogService } from '../../core/dialog.service';
import { failureMessage, readableReason } from '../../core/errors';
import { formatBytes, pluralize } from '../../core/format';
import { isRecord } from '../../core/json';
import { RefreshService } from '../../core/refresh.service';
import {
  Check,
  DataStreamsResponse,
  DiskWatermarks,
  IndexDetailResponse,
  LookupIndexRow,
  OperationKind,
  PlannedRequest,
  RawAliasRow,
  RawNode,
  ReindexOptions,
  ReindexProgress,
  ReindexStartResponse,
  ResizeKind,
  ResizeOptions,
  ResizeResponse,
  RolloverConditionsInput,
  RolloverPreview,
  RolloverResponse,
  SourceIndex,
  TargetRecovery,
  TaskGetResponse,
  TaskListResponse,
  WIZARD_STEPS,
  WizardChanges,
  WizardStep,
  WriteIndexFacts,
  isResizeKind,
} from './index-ops.models';
import {
  DEFAULT_REINDEX_OPTIONS,
  EMPTY_CONDITIONS,
  Lookup,
  OPERATIONS,
  TakenNames,
  buildReindexRequest,
  buildResizeRequest,
  buildRolloverRequest,
  blankSource,
  catShardRows,
  colocation,
  conditionErrors,
  dataStreamMembership,
  describedReindex,
  diskWatermarks,
  explicitWriteIndexRequest,
  indexNameFormatError,
  interpretRollover,
  minNodeVersion,
  needsSliceChildren,
  newIndexNameError,
  nextRolloverName,
  nodeOptions,
  parseAliasList,
  parseCount,
  parseIndices,
  parseLookupRows,
  prepareShrinkRequest,
  recordChanges,
  refreshSource,
  remainingChanges,
  reindexChecks,
  reindexErrors,
  reindexProgress,
  releaseSourceRequest,
  resizeChecks,
  rolloverChecks,
  readableSources,
  rolloverTargets,
  shardCopies,
  shardCountCompatibility,
  shrinkChoices,
  sourceExpressions,
  splitChoices,
  steadyProgress,
  suggestTargetName,
  suggestedShrinkNode,
  summarizeChecks,
  targetAliasesError,
  targetRecovery,
  withBlocks,
  writeBlockRequest,
  writeIndexFacts,
} from './index-ops.utils';

/** Polling intervals (milliseconds). */
const SOURCE_POLL = 2_000;
const TARGET_POLL = 2_000;
/** Task polls: quick for the first minute, then slower for long runs. */
const TASK_POLL = 1_500;
const TASK_POLL_SLOW = 5_000;
const TASK_POLL_SLOW_AFTER = 60_000;
const LOOKUP_DELAY = 400;
const DRY_RUN_DELAY = 500;
/** Polls with an unassigned primary before the run step calls it stuck. */
export const STUCK_PRIMARY_POLLS = 3;
/** Polls that may find the new index missing before giving up. */
const MISSING_TARGET_POLLS = 3;

/** sessionStorage key of what the wizard changed on a source (survives reloads). */
const CHANGES_KEY = 'cerebro.index-ops.changes';

export type DryRunState =
  | { readonly state: 'idle' | 'loading' }
  | { readonly state: 'ready'; readonly preview: RolloverPreview }
  | { readonly state: 'error'; readonly reason: string };

export type RunState =
  | { readonly kind: 'idle' }
  | {
      readonly kind: 'resize';
      readonly operation: ResizeKind;
      readonly phase: 'sending' | 'recovering' | 'done' | 'failed';
      readonly source: SourceIndex;
      readonly target: string;
      readonly recovery: TargetRecovery | null;
      readonly error: string | null;
      readonly startedAt: number;
      /** Consecutive polls that found a primary of the new index unassigned. */
      readonly stuckPolls: number;
    }
  | {
      readonly kind: 'rollover';
      readonly phase: 'sending' | 'done' | 'failed';
      readonly target: string;
      readonly targetKind: 'alias' | 'data-stream';
      /** The alias moved to the new index (no explicit write index). */
      readonly implicitWrite: boolean;
      readonly preview: RolloverPreview | null;
      readonly error: string | null;
    }
  | {
      readonly kind: 'reindex';
      /** `lost`: Elasticsearch no longer knows the task (its node left, or the result was not stored). */
      readonly phase: 'starting' | 'running' | 'done' | 'failed' | 'lost';
      readonly dest: string;
      /** The throttle the request asked for (Elasticsearch reports -1 once the task ended). */
      readonly requestedRps: number | null;
      readonly taskId: string | null;
      readonly progress: ReindexProgress | null;
      readonly raw: TaskGetResponse | null;
      readonly error: string | null;
      /** The last poll failed (the task keeps running on the cluster). */
      readonly stale: string | null;
      readonly cancelling: boolean;
    };

/** Field errors of the options step. */
export type FieldErrors = Readonly<Record<string, string | undefined>>;

/**
 * Runs `task` every `interval` until stopped (the next run waits for the
 * previous one). `interval` may depend on the time since the start.
 */
class Poller {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private generation = 0;

  constructor(private readonly interval: number | ((elapsed: number) => number)) {}

  private delay(started: number): number {
    return typeof this.interval === 'number' ? this.interval : this.interval(Date.now() - started);
  }

  get active(): boolean {
    return this.timer !== undefined;
  }

  start(task: () => Promise<boolean | void>, immediately = true): void {
    this.stop();
    const generation = ++this.generation;
    const started = Date.now();
    const tick = async (): Promise<void> => {
      let keepGoing: boolean | void = true;
      try {
        keepGoing = await task();
      } catch {
        // The task reports its own errors; keep polling.
      }
      if (generation === this.generation && keepGoing !== false) {
        this.timer = setTimeout(() => void tick(), this.delay(started));
      } else if (generation === this.generation) {
        this.timer = undefined;
      }
    };
    this.timer = setTimeout(() => void tick(), immediately ? 0 : this.delay(started));
  }

  stop(): void {
    this.generation++;
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
    }
    this.timer = undefined;
  }
}

/** Every piece of state of the wizard, shared by its step components. */
@Injectable()
export class IndexOpsStore {
  private readonly api = inject(ClusterApiService);
  private readonly alerts = inject(AlertService);
  private readonly dialogs = inject(DialogService);
  private readonly changes = inject(ClusterChangesService);
  private readonly refreshService = inject(RefreshService);
  private readonly connection = inject(ConnectionService);

  /* ---- Cluster catalog ---------------------------------------------------- */

  readonly indices = signal<readonly string[] | undefined>(undefined);
  readonly aliasRows = signal<readonly RawAliasRow[]>([]);
  readonly dataStreamList = signal<DataStreamsResponse | null>(null);
  readonly nodes = signal<readonly RawNode[] | null>(null);
  /** Disk watermarks of the cluster, `null` while unknown. */
  readonly watermarks = signal<DiskWatermarks | null>(null);
  /** The oldest node version (decides which rollover conditions exist). */
  readonly clusterVersion = computed(() => minNodeVersion(this.nodes()));
  readonly catalogError = signal<string | undefined>(undefined);
  /** The aliases, data streams and nodes were asked for at least once. */
  readonly catalogLoaded = signal(false);

  readonly taken = computed<TakenNames>(() => ({
    indices: this.indices() ?? [],
    aliases: [...new Set(this.aliasRows().map((row) => row.alias))],
    dataStreams: (this.dataStreamList()?.data_streams ?? []).map((stream) => stream.name),
  }));
  readonly membership = computed(() => dataStreamMembership(this.dataStreamList()));
  readonly rolloverTargets = computed(() => rolloverTargets(this.aliasRows(), this.dataStreamList()));

  /* ---- Wizard --------------------------------------------------------------- */

  readonly operation = signal<OperationKind | null>(null);
  readonly step = signal<WizardStep>('operation');
  /** Index in WIZARD_STEPS of the furthest step reached with the current choices. */
  readonly furthest = signal(0);
  /** Index (shrink, split, clone) or alias / data stream (rollover). */
  readonly source = signal('');
  /** Set by the first Continue of the options step: field errors show from then on. */
  readonly submitted = signal(false);
  /** The user typed or picked something since the operation was chosen. */
  readonly edited = signal(false);
  /** Short status for screen readers (step changes, async results). */
  readonly announcement = signal('');

  readonly info = computed(() => {
    const operation = this.operation();
    return operation ? OPERATIONS[operation] : null;
  });

  /* ---- Resize ---------------------------------------------------------------- */

  readonly sourceLookup = signal<Lookup>({ state: 'idle' });
  /** The indices of an alias given as source, to pick one from. */
  readonly sourceCandidates = signal<readonly string[]>([]);
  readonly sourceIndex = computed<SourceIndex | null>(() => {
    const lookup = this.sourceLookup();
    return lookup.state === 'ready' ? (lookup.indices[0] ?? null) : null;
  });
  /** The source loaded and refreshed by polling while it is being prepared. */
  readonly preparing = signal(false);
  readonly sourceBusy = signal<'prepare' | 'write-block' | 'release' | 'open' | null>(null);
  /**
   * What the wizard set on a source (write block, node requirement) and did
   * not lift yet. It survives resets and reloads (sessionStorage), so leaving
   * or switching asks first, and only these changes are offered to undo.
   */
  readonly sourceChanged = signal<WizardChanges | null>(null);
  /** The wizard's changes on the current source (`null` when they concern another index). */
  readonly ownChanges = computed(() => {
    const changes = this.sourceChanged();
    return changes && changes.index === this.sourceIndex()?.name ? changes : null;
  });

  readonly target = signal('');
  private targetEdited = false;
  readonly shards = signal<number | null>(null);
  readonly customShards = signal('');
  readonly replicas = signal('');
  readonly bestCompression = signal(false);
  readonly aliasesText = signal('');
  readonly prepareNode = signal('');

  readonly nodeOptions = computed(() => {
    const nodes = this.nodes();
    const source = this.sourceIndex();
    return nodes
      ? nodeOptions(nodes, source?.shards ?? [], {
          watermarks: this.watermarks(),
          allocation: source?.allocation ?? {},
          tierPreference: source?.tierPreference ?? [],
        })
      : null;
  });

  /** The node a shrink preparation uses: the user's pick, else the suggestion. */
  readonly shrinkNode = computed(() => {
    const options = this.nodeOptions();
    return this.prepareNode() || (options ? (suggestedShrinkNode(options)?.name ?? '') : '');
  });

  readonly shardOptions = computed<readonly number[]>(() => {
    const operation = this.operation();
    const source = this.sourceIndex();
    if (!source?.primaries || !isResizeKind(operation)) {
      return [];
    }
    switch (operation) {
      case 'shrink':
        return shrinkChoices(source.primaries);
      case 'split':
        return splitChoices(source.primaries, source.routingShards);
      case 'clone':
        return [source.primaries];
    }
  });

  readonly resizeErrors = computed<FieldErrors>(() => {
    const operation = this.operation();
    const source = this.sourceIndex();
    if (!isResizeKind(operation) || !source) {
      return {};
    }
    const replicasText = this.replicas().trim();
    const compatibility = shardCountCompatibility(operation, source.primaries ?? 0, this.shards(), source.routingShards);
    return {
      target: newIndexNameError(this.target().trim(), this.taken()) ?? undefined,
      shards: compatibility.ok ? undefined : (compatibility.reason ?? undefined),
      replicas: replicasText === '' || /^\d+$/.test(replicasText) ? undefined : 'Enter a whole number, 0 or more',
      aliases: targetAliasesError(this.aliasesText(), this.taken(), this.target().trim()) ?? undefined,
    };
  });

  readonly resizeOptions = computed<ResizeOptions>(() => ({
    target: this.target().trim(),
    shards: this.shards(),
    replicas: /^\d+$/.test(this.replicas().trim()) ? Number(this.replicas().trim()) : null,
    bestCompression: this.bestCompression(),
    aliases: parseAliasList(this.aliasesText()).names,
  }));

  readonly colocation = computed(() => {
    const source = this.sourceIndex();
    return source?.requiredNode && source.primaries ? colocation(source.shards, source.primaries, source.requiredNode) : null;
  });

  /* ---- Rollover -------------------------------------------------------------- */

  readonly conditions = signal<RolloverConditionsInput>(EMPTY_CONDITIONS);
  readonly newIndex = signal('');
  readonly writeFacts = signal<WriteIndexFacts | null>(null);
  readonly dryRun = signal<DryRunState>({ state: 'idle' });
  readonly now = signal(Date.now());

  readonly rolloverTarget = computed(() => this.rolloverTargets().find((target) => target.name === this.source()) ?? null);
  readonly conditionErrors = computed(() => conditionErrors(this.conditions()));
  readonly generatedName = computed(() => {
    const target = this.rolloverTarget();
    return target?.kind === 'alias' && target.writeIndex ? nextRolloverName(target.writeIndex) : null;
  });
  readonly newIndexError = computed(() => {
    const name = this.newIndex().trim();
    const target = this.rolloverTarget();
    if (!target || target.kind !== 'alias') {
      return null;
    }
    if (!name) {
      return this.generatedName() ? null : 'Enter a name: the write index does not end with "-" and a number';
    }
    return newIndexNameError(name, this.taken());
  });

  /* ---- Reindex ---------------------------------------------------------------- */

  readonly reindex = signal<ReindexOptions>(DEFAULT_REINDEX_OPTIONS);
  readonly sourcesLookup = signal<Lookup>({ state: 'idle' });
  readonly destLookup = signal<Lookup>({ state: 'idle' });
  readonly reindexFieldErrors = computed(() => reindexErrors(this.reindex()));
  readonly destIsDataStream = computed(() => this.taken().dataStreams.includes(this.reindex().dest.trim()));

  /* ---- Checks and requests -------------------------------------------------------- */

  readonly checks = computed<readonly Check[]>(() => {
    const operation = this.operation();
    if (isResizeKind(operation)) {
      const source = this.sourceIndex();
      return source
        ? resizeChecks({
            kind: operation,
            source,
            targetShards: this.shards(),
            nodes: this.nodeOptions(),
            candidateNode: this.shrinkNode() || null,
            watermarks: this.watermarks(),
          })
        : [];
    }
    if (operation === 'rollover') {
      const target = this.rolloverTarget();
      return target
        ? rolloverChecks({
            target,
            newIndex: this.newIndex(),
            newIndexError: this.newIndex().trim() ? this.newIndexError() : null,
            conditionsValid: Object.keys(this.conditionErrors()).length === 0,
            dryRun: this.dryRun(),
          })
        : [];
    }
    if (operation === 'reindex') {
      return reindexChecks({
        sources: this.sourcesLookup(),
        dest: this.destLookup(),
        destName: this.reindex().dest,
        destIsDataStream: this.destIsDataStream(),
        skipExisting: this.reindex().existing === 'skip',
        conflicts: this.reindex().conflicts,
        slicesMode: this.reindex().slicesMode,
        maxDocs: parseCount(this.reindex().maxDocs),
      });
    }
    return [];
  });
  readonly checkSummary = computed(() => summarizeChecks(this.checks()));

  /** Field errors of the options step, by field id. */
  readonly fieldErrors = computed<FieldErrors>(() => {
    const operation = this.operation();
    if (isResizeKind(operation)) {
      return this.resizeErrors();
    }
    if (operation === 'rollover') {
      return { ...this.conditionErrors(), newIndex: this.newIndexError() ?? undefined };
    }
    if (operation === 'reindex') {
      const { sources: _sources, ...errors } = this.reindexFieldErrors();
      return errors;
    }
    return {};
  });
  readonly hasFieldErrors = computed(() => Object.values(this.fieldErrors()).some((error) => !!error));

  /** The requests the run step sends, for the review. */
  readonly requests = computed<readonly PlannedRequest[]>(() => {
    const operation = this.operation();
    if (isResizeKind(operation)) {
      const source = this.sourceIndex();
      return source ? [buildResizeRequest(operation, source, this.resizeOptions())] : [];
    }
    if (operation === 'rollover') {
      const target = this.rolloverTarget();
      return target ? [buildRolloverRequest(target.name, this.conditions(), target.kind === 'alias' ? this.newIndex() : '', false)] : [];
    }
    if (operation === 'reindex') {
      return [buildReindexRequest(this.reindex(), this.destIsDataStream())];
    }
    return [];
  });

  /** Why running the operation puts data at risk, or `null`. */
  readonly risk = computed<string | null>(() => {
    const operation = this.operation();
    if (operation === 'reindex') {
      const dest = this.destLookup();
      const options = this.reindex();
      if (dest.state === 'ready' && !this.destIsDataStream() && options.existing === 'overwrite') {
        return `${options.dest.trim()} already exists: its documents with the same ids as the source documents are overwritten.`;
      }
      return null;
    }
    return null;
  });

  /* ---- Run ------------------------------------------------------------------------ */

  readonly run = signal<RunState>({ kind: 'idle' });
  readonly running = computed(() => {
    const run = this.run();
    return run.kind !== 'idle' && (run.phase === 'sending' || run.phase === 'starting' || run.phase === 'running');
  });
  readonly finishBusy = signal<'release' | 'delete' | null>(null);
  /** The source after the resize (block and allocation requirement still set?). */
  readonly finishedSource = signal<SourceIndex | null>(null);
  readonly sourceDeleted = signal(false);

  /** Unsaved input a navigation would drop, or a block the wizard set and did not lift. */
  readonly dirty = computed(() => (this.edited() && this.run().kind === 'idle') || !!this.sourceChanged());

  private readonly sourcePoller = new Poller(SOURCE_POLL);
  private readonly targetPoller = new Poller(TARGET_POLL);
  private readonly taskPoller = new Poller((elapsed) => (elapsed > TASK_POLL_SLOW_AFTER ? TASK_POLL_SLOW : TASK_POLL));
  /** Whether the checks of the options step passed at the last look (for the announcement). */
  private checksPassed: boolean | null = null;
  private catalogSequence = 0;
  private nodesSequence = 0;
  private sourceSequence = 0;
  private factsSequence = 0;
  private dryRunSequence = 0;
  private sourcesSequence = 0;
  private destSequence = 0;
  private host: string | undefined;
  /** Source whose defaults (target name, shards, replicas) were filled in. */
  private defaultsFor = '';

  constructor() {
    const destroyRef = inject(DestroyRef);
    destroyRef.onDestroy(() => {
      this.sourcePoller.stop();
      this.targetPoller.stop();
      this.taskPoller.stop();
    });

    // Catalog: on load and when the cluster changes (not on every refresh:
    // listing indices makes every node compute index statistics). The
    // wizard reloads it after its own changes; Try again after a failure.
    effect(() => {
      const host = this.connection.host();
      untracked(() => {
        if (host !== this.host) {
          this.host = host;
          this.nodesSequence++;
          this.indices.set(undefined);
          this.watermarks.set(null);
          this.catalogLoaded.set(false);
        }
        if (host) {
          void this.loadCatalog();
        }
      });
    });

    // The nodes' disk usage and shard counts are live: refreshed on every tick.
    effect(() => {
      this.refreshService.tick();
      untracked(() => {
        this.now.set(Date.now());
        if (this.host && this.catalogLoaded()) {
          void this.loadNodes();
        }
      });
    });

    // Resize source: load when it changes, reload on refresh unless polling.
    effect(() => {
      this.refreshService.tick();
      const operation = this.operation();
      const source = this.source();
      const host = this.connection.host();
      untracked(() => {
        if (!host || !isResizeKind(operation) || !source || this.run().kind !== 'idle') {
          return;
        }
        if (!this.sourcePoller.active) {
          void this.loadSource(source);
        }
      });
    });

    // Rollover: facts of the write index.
    effect(() => {
      this.refreshService.tick();
      const target = this.operation() === 'rollover' ? this.rolloverTarget() : null;
      const writeIndex = target?.writeIndex ?? null;
      untracked(() => {
        if (writeIndex && this.run().kind === 'idle') {
          void this.loadWriteFacts(writeIndex);
        } else {
          this.writeFacts.set(null);
        }
      });
    });

    // Rollover: dry run once the input settles.
    effect((onCleanup) => {
      const step = this.step();
      const target = this.operation() === 'rollover' && (step === 'options' || step === 'review') ? this.rolloverTarget() : null;
      const conditions = this.conditions();
      const newIndex = this.newIndex().trim();
      // A name the alias needs but does not have yet keeps the dry run idle (the name check says so).
      const valid = Object.keys(this.conditionErrors()).length === 0 && !this.newIndexError();
      this.refreshService.tick();
      if (this.run().kind !== 'idle' || step === 'source') {
        // Keeps the last answer for the summary; nothing to ask any more.
        untracked(() => this.dryRunSequence++);
        return;
      }
      if (!target || !target.writeIndex || !valid) {
        untracked(() => {
          this.dryRunSequence++;
          this.dryRun.set({ state: 'idle' });
        });
        return;
      }
      untracked(() => {
        if (this.dryRun().state !== 'ready') {
          this.dryRun.set({ state: 'loading' });
        }
      });
      const timer = setTimeout(() => void this.runDryRun(target.name, target.kind, conditions, newIndex), DRY_RUN_DELAY);
      onCleanup(() => clearTimeout(timer));
    });

    // Reindex: resolve the sources and the destination as they are typed and
    // when a step is entered (not on every refresh: a pattern can match
    // thousands of indices).
    effect((onCleanup) => {
      this.step();
      const sources = this.operation() === 'reindex' ? sourceExpressions(this.reindex().sources).join(',') : '';
      if (!sources) {
        untracked(() => {
          this.sourcesSequence++;
          this.sourcesLookup.set({ state: 'idle' });
        });
        return;
      }
      const timer = setTimeout(() => void this.lookupSources(sources), LOOKUP_DELAY);
      onCleanup(() => clearTimeout(timer));
    });
    effect((onCleanup) => {
      this.step();
      const dest = this.operation() === 'reindex' ? this.reindex().dest.trim() : '';
      // Any well-formed name is looked up, even one of the sources (its checks say more).
      if (!dest || indexNameFormatError(dest)) {
        untracked(() => {
          this.destSequence++;
          this.destLookup.set({ state: 'idle' });
        });
        return;
      }
      const timer = setTimeout(() => void this.lookupDest(dest), LOOKUP_DELAY);
      onCleanup(() => clearTimeout(timer));
    });

    // Tell screen readers when the checks of the options step turn green.
    effect(() => {
      const options = this.step() === 'options' && this.run().kind === 'idle';
      const passed = options && this.checks().length > 0 && this.checkSummary().ready && !this.hasFieldErrors();
      untracked(() => {
        if (options && passed && this.checksPassed === false) {
          const warnings = this.checkSummary().warn;
          const checks = warnings > 0 ? `Checks passed with ${pluralize(warnings, 'warning')}` : 'All checks passed';
          // Keep a dry run result announced at the same time.
          const current = this.announcement();
          this.announcement.set(current.startsWith('Dry run') ? `${current}. ${checks}` : checks);
        }
        this.checksPassed = options ? passed : null;
      });
    });
  }

  /* ---- Loading ------------------------------------------------------------------------ */

  async loadCatalog(): Promise<void> {
    const sequence = ++this.catalogSequence;
    const settle = <T>(promise: Promise<T>) =>
      promise.then((value) => ({ ok: true as const, value })).catch((error: unknown) => ({ ok: false as const, error }));
    const firstLoad = !this.catalogLoaded();
    const [indices, aliases, streams, nodes, settings] = await Promise.all([
      settle(this.api.post<readonly string[]>('commons/indices')),
      settle(this.api.post<readonly RawAliasRow[]>('aliases/get_aliases')),
      settle(this.api.post<DataStreamsResponse>('data_streams')),
      settle(this.api.post<readonly RawNode[]>('nodes')),
      // The watermarks rarely change: read once per cluster.
      firstLoad || !this.watermarks() ? settle(this.api.post<unknown>('cluster_settings')) : Promise.resolve(null),
    ]);
    if (sequence !== this.catalogSequence) {
      return;
    }
    this.catalogLoaded.set(true);
    if (indices.ok) {
      this.indices.set(Array.isArray(indices.value) ? indices.value : []);
      this.catalogError.set(undefined);
    } else if (this.indices() === undefined) {
      this.catalogError.set(readableReason(indices.error) ?? 'The cluster did not answer the request for its index list.');
      this.alerts.error(failureMessage('Could not load the index list', indices.error), indices.error);
    }
    // The other lists are best effort: they refine names and choices.
    if (aliases.ok && Array.isArray(aliases.value)) {
      this.aliasRows.set(aliases.value);
    }
    if (streams.ok) {
      this.dataStreamList.set(streams.value);
    }
    if (nodes.ok && Array.isArray(nodes.value)) {
      this.nodesSequence++;
      this.nodes.set(nodes.value);
    }
    if (settings?.ok) {
      this.watermarks.set(diskWatermarks(settings.value));
    }
  }

  private async loadNodes(): Promise<void> {
    const sequence = ++this.nodesSequence;
    try {
      const nodes = await this.api.post<readonly RawNode[]>('nodes');
      if (sequence === this.nodesSequence && Array.isArray(nodes)) {
        this.nodes.set(nodes);
      }
    } catch {
      // Best effort: the last answer stays, the next refresh tries again.
    }
  }

  retryCatalog(): void {
    this.catalogError.set(undefined);
    void this.loadCatalog();
  }

  /** Loads the resize source; returns it, or `null` when it is missing, ambiguous or the answer is stale. */
  async loadSource(name: string, quiet = false): Promise<SourceIndex | null> {
    const sequence = ++this.sourceSequence;
    if (!quiet && this.sourceLookup().state !== 'ready') {
      this.sourceLookup.set({ state: 'loading' });
    }
    try {
      const response = await this.api.post<IndexDetailResponse>('index_detail', { index: name });
      if (sequence !== this.sourceSequence || name !== this.source()) {
        return null;
      }
      const indices = parseIndices(response, this.membership());
      const exact = indices.find((index) => index.name === name);
      if (indices.length === 0) {
        this.sourceLookup.set({ state: 'missing' });
        return null;
      }
      if (!exact && indices.length === 1 && indices[0]) {
        // An alias of a single index: work on the index itself.
        this.source.set(indices[0].name);
      } else if (!exact) {
        this.sourceCandidates.set(indices.map((index) => index.name));
        this.sourceLookup.set({
          state: 'error',
          reason: `${name} is an alias of ${pluralize(indices.length, 'index', 'indices')}: pick one of them.`,
        });
        return null;
      }
      this.sourceCandidates.set([]);
      const index = exact ?? indices[0] ?? null;
      if (index) {
        this.sourceLookup.set({ state: 'ready', indices: [index] });
        this.restoreChanges(index);
        this.applyResizeDefaults(index);
      }
      return index;
    } catch (error: unknown) {
      if (sequence !== this.sourceSequence) {
        return null;
      }
      if (error instanceof ClusterApiError && error.status === 404) {
        this.sourceLookup.set({ state: 'missing' });
      } else if (this.sourceLookup().state !== 'ready') {
        this.sourceLookup.set({ state: 'error', reason: readableReason(error) ?? 'The cluster did not answer the request for the index.' });
        if (!quiet) {
          this.alerts.error(failureMessage(`Could not load index ${name}`, error), error);
        }
      }
      return null;
    }
  }

  retrySource(): void {
    const source = this.source();
    if (source) {
      this.sourceLookup.set({ state: 'loading' });
      void this.loadSource(source);
    }
  }

  private applyResizeDefaults(index: SourceIndex): void {
    const operation = this.operation();
    const key = `${operation}:${index.name}`;
    if (!isResizeKind(operation) || this.defaultsFor === key) {
      return;
    }
    this.defaultsFor = key;
    if (!this.targetEdited) {
      this.target.set(suggestTargetName(index.name, operation, this.taken()));
    }
    const primaries = index.primaries ?? 0;
    const options =
      operation === 'shrink' ? shrinkChoices(primaries) : operation === 'split' ? splitChoices(primaries, index.routingShards) : [primaries];
    this.shards.set(options[0] ?? null);
    this.customShards.set('');
    this.replicas.set(index.replicas !== null ? String(index.replicas) : '');
    this.bestCompression.set(index.codec === 'best_compression');
    this.prepareNode.set(index.requiredNode ?? '');
  }

  private async loadWriteFacts(index: string): Promise<void> {
    const sequence = ++this.factsSequence;
    try {
      const response = await this.api.post<IndexDetailResponse>('index_detail', { index });
      if (sequence === this.factsSequence) {
        const parsed = parseIndices(response).find((entry) => entry.name === index);
        this.writeFacts.set(parsed ? writeIndexFacts(parsed) : null);
        this.now.set(Date.now());
      }
    } catch {
      // The facts only decorate the conditions; the dry run is authoritative.
      if (sequence === this.factsSequence) {
        this.writeFacts.set(null);
      }
    }
  }

  private async runDryRun(target: string, kind: 'alias' | 'data-stream', conditions: RolloverConditionsInput, newIndex: string): Promise<void> {
    const sequence = ++this.dryRunSequence;
    const request = buildRolloverRequest(target, conditions, kind === 'alias' ? newIndex : '', true);
    try {
      const response = await this.api.post<RolloverResponse>(request.endpoint, request.payload);
      if (sequence === this.dryRunSequence) {
        const preview = interpretRollover(response);
        this.dryRun.set({ state: 'ready', preview });
        this.announcement.set(
          preview.wouldRollOver
            ? `Dry run: would roll over to ${preview.newIndex ?? 'a new index'}`
            : `Dry run: no condition is met, ${preview.oldIndex ?? 'the write index'} stays`,
        );
      }
    } catch (error: unknown) {
      if (sequence === this.dryRunSequence) {
        const reason = readableReason(error) ?? 'Elasticsearch refused the dry run.';
        this.dryRun.set({ state: 'error', reason });
        this.announcement.set(`Dry run failed: ${reason}`);
      }
    }
  }

  /** Looks the reindex destination up again (after it was created in another tab). */
  recheckDest(): void {
    const dest = this.reindex().dest.trim();
    if (this.operation() === 'reindex' && dest && this.destLookup().state === 'missing' && this.run().kind === 'idle') {
      void this.lookupDest(dest);
    }
  }

  private async lookupSources(expression: string): Promise<void> {
    const sequence = ++this.sourcesSequence;
    if (this.sourcesLookup().state !== 'ready') {
      this.sourcesLookup.set({ state: 'loading' });
    }
    try {
      // _cat/indices of the expression: states, documents and sizes without settings and mappings, even for `*`.
      const rows = await this.api.post<readonly LookupIndexRow[]>('commons/indices/lookup', { expression });
      if (sequence === this.sourcesSequence) {
        const { read, skipped } = readableSources(parseLookupRows(rows, this.membership()), sourceExpressions(expression), this.aliasRows());
        this.sourcesLookup.set({ state: 'ready', indices: read, skipped });
      }
    } catch (error: unknown) {
      if (sequence === this.sourcesSequence) {
        this.sourcesLookup.set({
          state: 'error',
          reason:
            readableReason(error) ??
            (error instanceof ClusterApiError && error.status === 404 ? 'No index matches the sources.' : 'The cluster did not answer the request for the sources.'),
        });
      }
    }
  }

  /** The destination's indices (an index, the indices of an alias or a data stream) with their blocks. */
  private async lookupDest(dest: string): Promise<void> {
    const sequence = ++this.destSequence;
    if (this.destLookup().state !== 'ready' && this.destLookup().state !== 'missing') {
      this.destLookup.set({ state: 'loading' });
    }
    try {
      const [rows, settings] = await Promise.all([
        this.api.post<readonly LookupIndexRow[]>('commons/indices/lookup', { expression: dest }),
        // Blocks are settings: read them, but a refusal only leaves them unknown.
        this.api.post<unknown>('commons/get_index_settings', { index: dest }).catch(() => null),
      ]);
      if (sequence === this.destSequence) {
        const indices = withBlocks(parseLookupRows(rows, this.membership()), settings);
        this.destLookup.set(indices.length > 0 ? { state: 'ready', indices } : { state: 'missing' });
      }
    } catch (error: unknown) {
      if (sequence !== this.destSequence) {
        return;
      }
      if (error instanceof ClusterApiError && error.status === 404) {
        this.destLookup.set({ state: 'missing' });
      } else {
        this.destLookup.set({ state: 'error', reason: readableReason(error) ?? 'The cluster did not answer the request for the destination.' });
      }
    }
  }

  /* ---- Navigation --------------------------------------------------------------------- */

  /** Applies `?op=&index=` (deep links); lands on the furthest step they allow. */
  applyParams(op: OperationKind | null, index: string): void {
    if (op === this.operation() && index === this.currentSourceParam() && this.run().kind === 'idle') {
      return;
    }
    this.resetAll();
    if (!op) {
      return;
    }
    this.operation.set(op);
    if (index) {
      if (op === 'reindex') {
        this.reindex.set({ ...DEFAULT_REINDEX_OPTIONS, sources: index });
      } else {
        this.source.set(index);
      }
      this.step.set('options');
      this.furthest.set(2);
    } else {
      this.step.set('source');
      this.furthest.set(1);
    }
  }

  /** The value of `?index=` for the current state. */
  currentSourceParam(): string {
    return this.operation() === 'reindex' ? this.reindex().sources.trim() : this.source();
  }

  /** Switches the operation; asks first when that leaves a block the wizard set behind. */
  async chooseOperation(kind: OperationKind): Promise<void> {
    if (kind !== this.operation()) {
      const keepIndex = isResizeKind(kind) && isResizeKind(this.operation()) ? this.source() : '';
      await this.settleChanges(keepIndex);
      this.resetAll();
      this.operation.set(kind);
      if (keepIndex) {
        this.source.set(keepIndex);
      }
    }
    this.goTo('source');
  }

  async chooseSource(name: string): Promise<void> {
    if (name !== this.source()) {
      await this.settleChanges(name);
      this.resetOptions();
      this.furthest.set(1);
      this.source.set(name);
    }
  }

  /**
   * Before the wizard moves away from a source it blocked (another source or
   * operation): offers to lift the block; keeping it forgets the change.
   */
  private async settleChanges(nextSource: string): Promise<void> {
    const changes = this.sourceChanged();
    if (!changes || changes.index === nextSource) {
      return;
    }
    const what = changes.requiredNode
      ? `blocked writes to ${changes.index} and requires its shards on ${changes.requiredNode}`
      : `blocked writes to ${changes.index}`;
    const lift = await this.dialogs.confirm({
      title: `Allow writes to ${changes.index} again?`,
      message: `The wizard ${what}. Lift that before moving on, or keep it (Index settings can lift it later).`,
      confirmLabel: 'Allow writes again',
      cancelLabel: `Keep ${changes.index} blocked`,
      tone: 'warning',
    });
    if (lift) {
      await this.liftChanges(changes);
    } else {
      this.setChanges(null);
    }
  }

  /** Lifts the wizard's changes on an index that may not be the loaded source. */
  private async liftChanges(changes: WizardChanges): Promise<boolean> {
    const current = this.sourceIndex();
    const source =
      current?.name === changes.index
        ? current
        : { ...blankSource(changes.index), writeBlock: changes.writeBlock, requiredNode: changes.requiredNode };
    const request = releaseSourceRequest(source, changes);
    if (!request) {
      this.setChanges(null);
      return true;
    }
    try {
      await this.api.post<unknown>(request.endpoint, request.payload);
      this.setChanges(null);
      this.alerts.success(`${changes.index} accepts writes again`);
      this.announcement.set(`${changes.index} accepts writes again`);
      return true;
    } catch (error: unknown) {
      this.alerts.error(failureMessage(`Could not update the settings of ${changes.index}`, error), error);
      return false;
    }
  }

  goTo(step: WizardStep): void {
    this.step.set(step);
    const position = WIZARD_STEPS.findIndex((entry) => entry.key === step);
    this.furthest.update((furthest) => Math.max(furthest, position));
    this.announcement.set(`Step ${WIZARD_STEPS[position]?.label ?? step}`);
  }

  /**
   * Resets the whole wizard (Start over, another operation). What the wizard
   * set on a source is kept: it is still in place on the cluster.
   */
  resetAll(): void {
    this.sourcePoller.stop();
    this.targetPoller.stop();
    this.taskPoller.stop();
    this.operation.set(null);
    this.step.set('operation');
    this.furthest.set(0);
    this.source.set('');
    this.reindex.set(DEFAULT_REINDEX_OPTIONS);
    this.run.set({ kind: 'idle' });
    this.finishedSource.set(null);
    this.sourceDeleted.set(false);
    this.edited.set(false);
    this.resetOptions();
  }

  private resetOptions(): void {
    this.sourcePoller.stop();
    this.preparing.set(false);
    this.sourceSequence++;
    this.sourceLookup.set({ state: 'idle' });
    this.sourceCandidates.set([]);
    this.target.set('');
    this.targetEdited = false;
    this.defaultsFor = '';
    this.shards.set(null);
    this.customShards.set('');
    this.replicas.set('');
    this.bestCompression.set(false);
    this.aliasesText.set('');
    this.prepareNode.set('');
    this.conditions.set(EMPTY_CONDITIONS);
    this.newIndex.set('');
    this.dryRun.set({ state: 'idle' });
    this.writeFacts.set(null);
    this.submitted.set(false);
  }

  /** After a failed or stopped run: back to the review with the same choices. */
  backToReview(): void {
    this.targetPoller.stop();
    this.taskPoller.stop();
    this.run.set({ kind: 'idle' });
    this.finishedSource.set(null);
    this.sourceDeleted.set(false);
    this.goTo('review');
  }

  /** After a failed or stopped run: back to the options. */
  changeOptions(): void {
    this.backToReview();
    this.goTo('options');
  }

  /** A reindex stopped by version conflicts: run it again counting them instead. */
  retryWithProceed(): void {
    this.reindex.update((options) => ({ ...options, conflicts: 'proceed' }));
    this.backToReview();
  }

  setTarget(value: string): void {
    this.targetEdited = true;
    this.target.set(value);
    this.edited.set(true);
  }

  /** Marks the form as edited (any option input). */
  touch(): void {
    this.edited.set(true);
  }

  /* ---- What the wizard changed ------------------------------------------------------------ */

  private setChanges(changes: WizardChanges | null): void {
    this.sourceChanged.set(changes);
    try {
      if (changes) {
        globalThis.sessionStorage?.setItem(CHANGES_KEY, JSON.stringify({ host: this.connection.host() ?? null, changes }));
      } else {
        globalThis.sessionStorage?.removeItem(CHANGES_KEY);
      }
    } catch {
      // Without storage the record lasts as long as the page.
    }
  }

  /** The record of a reload, for `index` on this cluster. */
  private storedChanges(index: string): WizardChanges | null {
    try {
      const raw = globalThis.sessionStorage?.getItem(CHANGES_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : null;
      if (!isRecord(parsed) || parsed['host'] !== (this.connection.host() ?? null)) {
        return null;
      }
      const changes = parsed['changes'];
      if (!isRecord(changes) || changes['index'] !== index) {
        return null;
      }
      return {
        index,
        writeBlock: changes['writeBlock'] === true,
        requiredNode: typeof changes['requiredNode'] === 'string' ? changes['requiredNode'] : null,
      };
    } catch {
      return null;
    }
  }

  /** Picks up what an earlier visit changed on `index`, as far as it is still in place. */
  private restoreChanges(index: SourceIndex): void {
    if (this.sourceChanged()) {
      return;
    }
    const stored = this.storedChanges(index.name);
    if (!stored) {
      return;
    }
    const live: WizardChanges = {
      index: index.name,
      writeBlock: stored.writeBlock && index.writeBlock,
      requiredNode: stored.requiredNode && stored.requiredNode === index.requiredNode ? stored.requiredNode : null,
    };
    this.setChanges(live.writeBlock || live.requiredNode ? live : null);
  }

  /** Forgets the record (the user chose to leave the block in place). */
  forgetChanges(): void {
    this.setChanges(null);
  }

  /* ---- Source preparation --------------------------------------------------------------- */

  async prepareSource(): Promise<boolean> {
    const source = this.sourceIndex();
    const node = this.shrinkNode();
    if (!source || !node || this.sourceBusy()) {
      return false;
    }
    const request = prepareShrinkRequest(source.name, node);
    const confirmed = await this.dialogs.confirm({
      title: `Prepare ${source.name} for a shrink?`,
      message: `Writes to ${source.name} fail from now on, and a copy of each shard moves to ${node}. The last step offers to lift both again.`,
      items: Object.entries(request.payload['settings'] as Record<string, unknown>).map(([key, value]) => `${key}: ${String(value)}`),
      confirmLabel: 'Prepare source',
      tone: 'warning',
    });
    if (!confirmed) {
      return false;
    }
    const done = await this.applySettings(request, 'prepare', `${source.name} prepared: copies are moving to ${node}`);
    if (done) {
      this.watchSource();
    }
    return done;
  }

  async blockWrites(): Promise<boolean> {
    const source = this.sourceIndex();
    if (!source || this.sourceBusy()) {
      return false;
    }
    const confirmed = await this.dialogs.confirm({
      title: `Block writes to ${source.name}?`,
      message: 'Indexing, updates and deletes fail until the block is lifted; searches keep working. The last step offers to lift it again.',
      items: ['index.blocks.write: true'],
      confirmLabel: 'Block writes',
      tone: 'warning',
    });
    return confirmed ? this.applySettings(writeBlockRequest(source.name), 'write-block', `Writes to ${source.name} are blocked`) : false;
  }

  /** Undoes what the wizard set before running (Options step). */
  async releaseSource(): Promise<boolean> {
    const source = this.sourceIndex();
    const request = source ? releaseSourceRequest(source, this.sourceChanged()) : null;
    if (!source || !request || this.sourceBusy()) {
      return false;
    }
    this.sourcePoller.stop();
    this.preparing.set(false);
    return this.applySettings(request, 'release', `${source.name} accepts writes again`);
  }

  /** Opens a closed source that cannot be resized while closed. */
  async openSource(): Promise<boolean> {
    const source = this.sourceIndex();
    if (!source || this.sourceBusy()) {
      return false;
    }
    const confirmed = await this.dialogs.confirm({
      title: `Open ${source.name}?`,
      message: 'Its shards are loaded on the nodes again and it can be searched and written to.',
      confirmLabel: 'Open index',
    });
    if (!confirmed) {
      return false;
    }
    this.sourceBusy.set('open');
    try {
      await this.api.post<unknown>('overview/open_indices', { indices: source.name });
      this.alerts.success(`Index ${source.name} opened`);
      this.announcement.set(`Index ${source.name} opened`);
      await this.loadSource(source.name, true);
      return true;
    } catch (error: unknown) {
      this.alerts.error(failureMessage(`Could not open ${source.name}`, error), error);
      return false;
    } finally {
      this.sourceBusy.set(null);
    }
  }

  private async applySettings(request: PlannedRequest, busy: 'prepare' | 'write-block' | 'release', done: string): Promise<boolean> {
    const name = String(request.payload['index']);
    const settings = (request.payload['settings'] ?? {}) as Record<string, unknown>;
    this.sourceBusy.set(busy);
    this.edited.set(true);
    try {
      await this.api.post<unknown>(request.endpoint, request.payload);
      this.setChanges(
        busy === 'release' ? remainingChanges(this.sourceChanged(), settings) : recordChanges(this.sourceChanged(), name, settings),
      );
      this.alerts.success(done);
      this.announcement.set(done);
      await this.loadSource(name, true);
      return true;
    } catch (error: unknown) {
      this.alerts.error(failureMessage(`Could not update the settings of ${name}`, error), error);
      return false;
    } finally {
      this.sourceBusy.set(null);
    }
  }

  /**
   * Polls the source until a copy of every shard is on the required node.
   * Each poll reads `_cat/shards` and the settings only (no mappings, no stats).
   */
  watchSource(): void {
    const name = this.source();
    this.preparing.set(true);
    this.sourcePoller.start(async () => {
      const index = await this.pollSource(name);
      const state = index?.requiredNode && index.primaries ? colocation(index.shards, index.primaries, index.requiredNode) : null;
      const settled = !!index && (!state || (state.done && state.unsettled === 0));
      if (settled) {
        this.preparing.set(false);
        if (state?.done) {
          this.announcement.set(`A copy of every shard of ${name} is on ${state.node}`);
        }
        return false;
      }
      return name === this.source();
    }, false);
  }

  private async pollSource(name: string): Promise<SourceIndex | null> {
    const previous = this.sourceIndex();
    if (!previous || previous.name !== name) {
      return this.loadSource(name, true);
    }
    const sequence = ++this.sourceSequence;
    try {
      const [rows, settings] = await Promise.all([
        this.api.post<readonly Record<string, unknown>[]>('cat', { api: `shards/${name}` }),
        this.api.post<Record<string, { readonly settings?: unknown }>>('commons/get_index_settings', { index: name }),
      ]);
      if (sequence !== this.sourceSequence || name !== this.source()) {
        return null;
      }
      const index = refreshSource(
        previous,
        catShardRows(rows).filter((row) => row.index === name),
        settings[name]?.settings,
      );
      this.sourceLookup.set({ state: 'ready', indices: [index] });
      return index;
    } catch {
      // A failed poll keeps the last state; the next one tries again.
      return null;
    }
  }

  /* ---- Running ---------------------------------------------------------------------------- */

  async execute(): Promise<void> {
    const operation = this.operation();
    const request = this.requests()[0];
    if (!operation || !request || this.running()) {
      return;
    }
    this.goTo('run');
    if (isResizeKind(operation)) {
      await this.executeResize(operation, request);
    } else if (operation === 'rollover') {
      await this.executeRollover(request);
    } else {
      await this.executeReindex(request);
    }
  }

  private async executeResize(operation: ResizeKind, request: PlannedRequest): Promise<void> {
    const source = this.sourceIndex();
    const target = this.resizeOptions().target;
    if (!source) {
      return;
    }
    this.sourcePoller.stop();
    this.run.set({ kind: 'resize', operation, phase: 'sending', source, target, recovery: null, error: null, startedAt: Date.now(), stuckPolls: 0 });
    this.changes.expect({ created: [target] });
    try {
      await this.api.post<ResizeResponse>(request.endpoint, request.payload);
      this.finishedSource.set(source);
      void this.loadCatalog();
      this.updateRun('resize', { phase: 'recovering' });
      this.announcement.set(`${target} created; waiting for its shards to start`);
      this.watchTarget(target);
    } catch (error: unknown) {
      // The run step still offers to lift what the wizard set on the source before running.
      this.finishedSource.set(source);
      this.updateRun('resize', { phase: 'failed', error: readableReason(error) ?? 'Elasticsearch refused the request.' });
      this.alerts.error(failureMessage(`Could not ${OPERATIONS[operation].label.toLowerCase()} ${source.name}`, error), error);
      this.announcement.set('The operation failed');
    }
  }

  /**
   * Picks up a resize after a reload (`?op=shrink&index=<source>&target=<new>`):
   * follows the new index and offers the finishing actions again.
   */
  async resumeResize(operation: ResizeKind, sourceName: string, target: string): Promise<void> {
    this.resetAll();
    this.operation.set(operation);
    this.source.set(sourceName);
    this.step.set('run');
    this.furthest.set(WIZARD_STEPS.length - 1);
    this.run.set({
      kind: 'resize',
      operation,
      phase: 'recovering',
      source: blankSource(sourceName),
      target,
      recovery: null,
      error: null,
      startedAt: Date.now(),
      stuckPolls: 0,
    });
    this.watchTarget(target);
    try {
      const response = await this.api.post<IndexDetailResponse>('index_detail', { index: sourceName });
      const index = parseIndices(response, this.membership()).find((entry) => entry.name === sourceName);
      const run = this.run();
      if (index && run.kind === 'resize' && run.target === target) {
        this.updateRun('resize', { source: index });
        this.finishedSource.set(index);
        this.restoreChanges(index);
      }
    } catch (error: unknown) {
      const run = this.run();
      if (run.kind === 'resize' && run.target === target && error instanceof ClusterApiError && error.status === 404) {
        this.sourceDeleted.set(true);
      }
    }
  }

  /**
   * Follows the new index until every shard copy is started. Each poll reads
   * `_cat/shards` of the index only.
   */
  watchTarget(target: string): void {
    let missing = 0;
    this.targetPoller.start(async () => {
      try {
        const rows = await this.api.post<readonly Record<string, unknown>[]>('cat', { api: `shards/${target}` });
        const run = this.run();
        if (run.kind !== 'resize' || run.target !== target) {
          return false;
        }
        missing = 0;
        const recovery = targetRecovery(shardCopies(catShardRows(rows).filter((row) => row.index === target)));
        const stuckPolls = recovery.unassignedPrimaries.length > 0 ? run.stuckPolls + 1 : 0;
        this.updateRun('resize', { recovery, stuckPolls, phase: recovery.done ? 'done' : 'recovering' });
        if (stuckPolls === STUCK_PRIMARY_POLLS) {
          this.announcement.set(`A primary shard of ${target} cannot be allocated`);
        }
        if (recovery.done) {
          this.announcement.set(`${target} is green`);
          void this.refreshFinishedSource();
          return false;
        }
        return true;
      } catch (error: unknown) {
        const run = this.run();
        if (run.kind !== 'resize' || run.target !== target) {
          return false;
        }
        // Right after the request the index may not be visible yet; one that stays missing is gone.
        if (error instanceof ClusterApiError && error.status === 404 && ++missing >= MISSING_TARGET_POLLS) {
          this.updateRun('resize', { phase: 'failed', error: `${target} does not exist (any more).` });
          this.announcement.set(`${target} does not exist`);
          return false;
        }
        return true;
      }
    });
  }

  private async refreshFinishedSource(): Promise<void> {
    const source = this.finishedSource();
    if (!source || this.sourceDeleted()) {
      return;
    }
    try {
      const response = await this.api.post<IndexDetailResponse>('index_detail', { index: source.name });
      const index = parseIndices(response, this.membership()).find((entry) => entry.name === source.name);
      if (index) {
        this.finishedSource.set(index);
      }
    } catch {
      // Keeps the snapshot taken before the resize.
    }
  }

  private async executeRollover(request: PlannedRequest): Promise<void> {
    const target = this.rolloverTarget();
    if (!target) {
      return;
    }
    this.run.set({ kind: 'rollover', phase: 'sending', target: target.name, targetKind: target.kind, implicitWrite: target.implicitWrite, preview: null, error: null });
    const dry = this.dryRun();
    const expected = dry.state === 'ready' ? dry.preview.newIndex : null;
    if (expected) {
      this.changes.expect({ created: [expected] });
    }
    try {
      const response = await this.api.post<RolloverResponse>(request.endpoint, request.payload);
      const preview = interpretRollover(response);
      this.updateRun('rollover', { phase: 'done', preview });
      this.announcement.set(preview.rolledOver ? `Rolled over to ${preview.newIndex ?? 'a new index'}` : 'Not rolled over: no condition is met');
      if (preview.rolledOver) {
        this.alerts.success(`${target.name} rolled over to ${preview.newIndex ?? 'a new index'}`);
      }
      void this.loadCatalog();
    } catch (error: unknown) {
      this.updateRun('rollover', { phase: 'failed', error: readableReason(error) ?? 'Elasticsearch refused the request.' });
      this.alerts.error(failureMessage(`Could not roll over ${target.name}`, error), error);
      this.announcement.set('The rollover failed');
    }
  }

  /** Marks the write index of an alias explicitly, so a rollover keeps the old index in the alias. */
  async makeExplicitWriteIndex(): Promise<boolean> {
    const target = this.rolloverTarget();
    if (!target?.implicitWrite || !target.writeIndex) {
      return false;
    }
    const request = explicitWriteIndexRequest(target.name, target.writeIndex);
    const confirmed = await this.dialogs.confirm({
      title: `Make ${target.writeIndex} the write index of ${target.name}?`,
      message: `A rollover then keeps ${target.writeIndex} in ${target.name}, so searches through the alias still see its documents.`,
      items: [`${request.preview.method} ${request.preview.path}`, `add: { index: ${target.writeIndex}, alias: ${target.name}, is_write_index: true }`],
      confirmLabel: 'Set write index',
    });
    if (!confirmed) {
      return false;
    }
    try {
      await this.api.post<unknown>(request.endpoint, request.payload);
      const done = `${target.writeIndex} is the write index of ${target.name}`;
      this.alerts.success(done);
      this.announcement.set(done);
      await this.loadCatalog();
      return true;
    } catch (error: unknown) {
      this.alerts.error(failureMessage(`Could not update the alias ${target.name}`, error), error);
      return false;
    }
  }

  private async executeReindex(request: PlannedRequest): Promise<void> {
    const dest = this.reindex().dest.trim();
    const rps = this.reindex().throttled ? Number(this.reindex().requestsPerSecond.trim()) : null;
    this.run.set({
      kind: 'reindex',
      phase: 'starting',
      dest,
      requestedRps: rps !== null && Number.isFinite(rps) && rps > 0 ? rps : null,
      taskId: null,
      progress: null,
      raw: null,
      error: null,
      stale: null,
      cancelling: false,
    });
    if (this.destLookup().state === 'missing') {
      this.changes.expect({ created: [dest] });
    }
    try {
      const response = await this.api.post<ReindexStartResponse>(request.endpoint, request.payload);
      const taskId = response.task ?? null;
      if (!taskId) {
        throw new Error('Elasticsearch did not return a task id');
      }
      this.updateRun('reindex', { phase: 'running', taskId });
      this.announcement.set('Reindex started');
      this.watchTask(taskId);
    } catch (error: unknown) {
      this.updateRun('reindex', { phase: 'failed', error: readableReason(error) ?? 'Elasticsearch refused the request.' });
      this.alerts.error(failureMessage('Could not start the reindex', error), error);
      this.announcement.set('The reindex could not start');
    }
  }

  /** Picks up a reindex after a reload (`?op=reindex&task=<id>`) instead of offering to start another one. */
  resumeReindex(taskId: string, sources: string): void {
    this.resetAll();
    this.operation.set('reindex');
    if (sources) {
      this.reindex.set({ ...DEFAULT_REINDEX_OPTIONS, sources });
    }
    this.step.set('run');
    this.furthest.set(WIZARD_STEPS.length - 1);
    this.run.set({
      kind: 'reindex',
      phase: 'running',
      dest: '',
      requestedRps: null,
      taskId,
      progress: null,
      raw: null,
      error: null,
      stale: null,
      cancelling: false,
    });
    this.watchTask(taskId);
  }

  watchTask(taskId: string): void {
    this.taskPoller.start(async () => {
      try {
        const response = await this.api.post<TaskGetResponse>('tasks/get', { task_id: taskId });
        const children = needsSliceChildren(response) ? await this.runningSlices(taskId) : [];
        const run = this.run();
        if (run.kind !== 'reindex' || run.taskId !== taskId) {
          return false;
        }
        const progress = steadyProgress(run.progress, reindexProgress(response, children, taskId));
        this.updateRun('reindex', { progress, raw: response, stale: null, phase: progress.completed ? 'done' : 'running' });
        if (!run.dest) {
          this.adoptDescription(progress.description);
        }
        if (progress.completed) {
          this.announcement.set(
            progress.outcome === 'succeeded'
              ? `Reindex finished: ${pluralize(progress.processed, 'document')}`
              : progress.outcome === 'cancelled'
                ? 'Reindex cancelled'
                : 'Reindex finished with failures',
          );
          void this.loadCatalog();
          return false;
        }
        return true;
      } catch (error: unknown) {
        const run = this.run();
        if (run.kind !== 'reindex' || run.taskId !== taskId) {
          return false;
        }
        if (error instanceof ClusterApiError && error.status === 404) {
          // The node that ran it left, or the result was not stored: polling cannot learn more.
          this.updateRun('reindex', { phase: 'lost', error: readableReason(error) ?? 'Elasticsearch does not know the task.' });
          this.announcement.set('Elasticsearch no longer knows the reindex task');
          return false;
        }
        this.updateRun('reindex', { stale: readableReason(error) ?? 'The cluster did not answer.' });
        return true;
      }
    });
  }

  /**
   * The running slices of a sliced reindex (its sub-tasks, by parent task id).
   * A failed read gives none: the progress then counts the finished slices
   * only, and `steadyProgress` keeps it from going back.
   */
  private async runningSlices(taskId: string): Promise<NonNullable<TaskListResponse['tasks']>> {
    try {
      return (await this.api.post<TaskListResponse>('tasks', { parent_task_id: taskId })).tasks ?? [];
    } catch {
      return [];
    }
  }

  /** A resumed reindex learns its sources and destination from the task description. */
  private adoptDescription(description: string | null): void {
    const described = describedReindex(description);
    if (!described) {
      return;
    }
    this.updateRun('reindex', { dest: described.dest });
    this.reindex.update((options) => ({
      ...options,
      sources: options.sources.trim() ? options.sources : described.sources,
      dest: options.dest.trim() ? options.dest : described.dest,
    }));
  }

  async cancelTask(): Promise<void> {
    const run = this.run();
    if (run.kind !== 'reindex' || !run.taskId || run.phase !== 'running' || run.cancelling) {
      return;
    }
    const confirmed = await this.dialogs.confirm({
      title: 'Cancel the reindex?',
      message: `Documents already copied stay in ${run.dest || 'the destination'}; the rest is not copied.`,
      confirmLabel: 'Cancel reindex',
      cancelLabel: 'Keep running',
      tone: 'danger',
    });
    // The run may have ended (or another started) while the dialog was open.
    const current = this.run();
    if (!confirmed || current.kind !== 'reindex' || current.taskId !== run.taskId || current.phase !== 'running' || current.cancelling) {
      return;
    }
    this.updateRun('reindex', { cancelling: true });
    try {
      const response = await this.api.post<unknown>('tasks/cancel', { task_id: run.taskId });
      // `_cancel` answers 200 even when nothing was cancelled: the reason then sits in a failure list.
      const failures = isRecord(response) ? [response['task_failures'], response['node_failures']].find((list) => Array.isArray(list) && list.length > 0) : undefined;
      if (Array.isArray(failures)) {
        const reason = readableReason(failures[0]) ?? 'Elasticsearch reported a failure while cancelling the task.';
        this.alerts.error(`Could not cancel the reindex: ${reason}`);
        this.updateRun('reindex', { cancelling: false });
        return;
      }
      this.announcement.set('Cancelling the reindex');
    } catch (error: unknown) {
      this.alerts.error(failureMessage('Could not cancel the reindex', error), error);
      this.updateRun('reindex', { cancelling: false });
    }
  }

  /* ---- Finishing actions ------------------------------------------------------------------------ */

  /** Lifts what the wizard set on the source (nothing else). */
  async releaseFinishedSource(): Promise<boolean> {
    const source = this.finishedSource();
    const request = source ? releaseSourceRequest(source, this.sourceChanged()) : null;
    if (!source || !request || this.finishBusy()) {
      return false;
    }
    this.finishBusy.set('release');
    try {
      await this.api.post<unknown>(request.endpoint, request.payload);
      this.setChanges(remainingChanges(this.sourceChanged(), (request.payload['settings'] ?? {}) as Record<string, unknown>));
      this.alerts.success(`${source.name} accepts writes again`);
      this.announcement.set(`${source.name} accepts writes again`);
      await this.refreshFinishedSource();
      // After a refused run the options step may come back: its checks read the loaded source.
      if (this.sourceIndex()?.name === source.name) {
        await this.loadSource(source.name, true);
      }
      return true;
    } catch (error: unknown) {
      this.alerts.error(failureMessage(`Could not update the settings of ${source.name}`, error), error);
      return false;
    } finally {
      this.finishBusy.set(null);
    }
  }

  async deleteFinishedSource(): Promise<boolean> {
    const source = this.finishedSource();
    const run = this.run();
    if (!source || this.finishBusy() || run.kind !== 'resize' || source.dataStream) {
      return false;
    }
    const confirmed = await this.dialogs.confirm({
      title: `Delete index ${source.name}?`,
      message: `${run.target} keeps a copy of its documents. ${source.name} and its ${pluralize(source.docs ?? 0, 'document')} (${formatBytes(source.totalSize)}) cannot be recovered except from a snapshot.`,
      confirmLabel: 'Delete index',
      tone: 'danger',
    });
    if (!confirmed) {
      return false;
    }
    this.finishBusy.set('delete');
    try {
      await this.api.post<unknown>('overview/delete_indices', { indices: source.name });
      this.sourceDeleted.set(true);
      if (this.sourceChanged()?.index === source.name) {
        this.setChanges(null);
      }
      this.alerts.success(`Index ${source.name} deleted`);
      this.announcement.set(`Index ${source.name} deleted`);
      void this.loadCatalog();
      return true;
    } catch (error: unknown) {
      this.alerts.error(failureMessage(`Could not delete ${source.name}`, error), error);
      return false;
    } finally {
      this.finishBusy.set(null);
    }
  }

  private updateRun<K extends Exclude<RunState['kind'], 'idle'>>(kind: K, patch: Partial<Extract<RunState, { kind: K }>>): void {
    const run = this.run();
    if (run.kind === kind) {
      this.run.set({ ...run, ...patch } as RunState);
    }
  }
}
