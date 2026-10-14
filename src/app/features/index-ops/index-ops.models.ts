/** Raw and view models of the index operations wizard. */

export type JsonObject = Readonly<Record<string, unknown>>;

export type OperationKind = 'shrink' | 'split' | 'clone' | 'rollover' | 'reindex';
export type ResizeKind = 'shrink' | 'split' | 'clone';

export const OPERATION_KINDS: readonly OperationKind[] = ['shrink', 'split', 'clone', 'rollover', 'reindex'];

export function isOperationKind(value: unknown): value is OperationKind {
  return typeof value === 'string' && (OPERATION_KINDS as readonly string[]).includes(value);
}

export function isResizeKind(kind: OperationKind | null | undefined): kind is ResizeKind {
  return kind === 'shrink' || kind === 'split' || kind === 'clone';
}

/** The text of an operation card (step 1). */
export interface OperationInfo {
  readonly kind: OperationKind;
  readonly label: string;
  readonly icon: string;
  /** What it does, one sentence. */
  readonly summary: string;
  readonly whenToUse: string;
  readonly requirements: readonly string[];
  /** What step 2 picks ("Source index", "Alias or data stream", "Source indices"). */
  readonly sourceLabel: string;
  /** Label of the button that runs it ("Shrink index"). */
  readonly runLabel: string;
}

export type WizardStep = 'operation' | 'source' | 'options' | 'review' | 'run';

export const WIZARD_STEPS: readonly { readonly key: WizardStep; readonly label: string }[] = [
  { key: 'operation', label: 'Operation' },
  { key: 'source', label: 'Source' },
  { key: 'options', label: 'Options' },
  { key: 'review', label: 'Review' },
  { key: 'run', label: 'Run' },
];

/* ---- Raw responses -------------------------------------------------------- */

/** `_cat/shards` row as returned by the index_detail endpoint. */
export interface CatShardRow {
  readonly index: string;
  readonly shard: string;
  readonly prirep: string;
  readonly state: string;
  readonly docs: string | null;
  readonly store: string | null;
  readonly ip?: string | null;
  readonly node: string | null;
  readonly 'unassigned.reason'?: string | null;
  readonly 'unassigned.for'?: string | null;
}

export interface IndexStatsEntry {
  readonly uuid?: string;
  readonly health?: string;
  readonly status?: string;
  readonly primaries?: JsonObject;
  readonly total?: JsonObject;
}

/** Response of the `index_detail` endpoint (the parts the wizard reads). */
export interface IndexDetailResponse {
  readonly settings: Readonly<Record<string, { readonly settings?: JsonObject }>>;
  readonly mappings?: JsonObject | null;
  readonly stats: { readonly indices?: Readonly<Record<string, IndexStatsEntry>> } | null;
  readonly aliases: Readonly<Record<string, { readonly aliases?: Readonly<Record<string, JsonObject>> }>> | null;
  readonly shards: readonly CatShardRow[] | null;
  /**
   * `index.routing_num_shards` from the cluster state metadata of the index
   * that was asked for (`null` for an alias, or when Elasticsearch refused it).
   */
  readonly routing_num_shards?: number | null;
}

/** One node of the `nodes` endpoint (the parts the wizard reads). */
export interface RawNode {
  readonly id: string;
  readonly name: string;
  readonly data: boolean;
  readonly disk: { readonly total: number; readonly available: number; readonly percent: number } | null;
  /** Host name or address the node reports (matches `_host` filters). */
  readonly host?: string | null;
  /** Custom node attributes (`node.attr.*`). */
  readonly attributes?: Readonly<Record<string, string>> | null;
  /** Elasticsearch version of the node ("8.15.0"). */
  readonly version?: string | null;
  /** Raw roles (`data`, `data_hot`, `data_warm`, …); empty on clusters that do not report them. */
  readonly roles?: readonly string[] | null;
}

/**
 * One row of `commons/indices/lookup`: `_cat/indices/<expression>` of open
 * and closed indices, sizes in bytes (numbers as strings, `null` when closed).
 */
export interface LookupIndexRow {
  readonly health?: string | null;
  readonly status?: string | null;
  readonly index: string;
  readonly pri?: string | null;
  readonly rep?: string | null;
  readonly 'docs.count'?: string | null;
  readonly 'store.size'?: string | null;
  readonly 'pri.store.size'?: string | null;
}

/** One row of `aliases/get_aliases`. */
export interface RawAliasRow {
  readonly alias: string;
  readonly index: string;
  readonly is_write_index?: boolean | null;
  readonly is_hidden?: boolean | null;
}

export interface RawDataStream {
  readonly name: string;
  readonly indices?: readonly { readonly index_name: string }[];
  readonly hidden?: boolean;
  readonly system?: boolean;
  readonly status?: string;
}

export interface DataStreamsResponse {
  readonly data_streams?: readonly RawDataStream[];
}

export interface RolloverResponse {
  readonly acknowledged?: boolean;
  readonly shards_acknowledged?: boolean;
  readonly old_index?: string;
  readonly new_index?: string;
  readonly rolled_over?: boolean;
  readonly dry_run?: boolean;
  readonly lazy?: boolean;
  readonly conditions?: Readonly<Record<string, boolean>>;
}

export interface ResizeResponse {
  readonly acknowledged?: boolean;
  readonly shards_acknowledged?: boolean;
  readonly index?: string;
}

export interface ReindexStartResponse {
  readonly task?: string;
}

/** `GET _tasks/{id}`. */
export interface TaskGetResponse {
  readonly completed?: boolean;
  readonly task?: {
    readonly node?: string;
    readonly id?: number;
    readonly type?: string;
    readonly action?: string;
    readonly description?: string;
    readonly start_time_in_millis?: number;
    readonly running_time_in_nanos?: number;
    readonly cancellable?: boolean;
    readonly cancelled?: boolean;
    readonly headers?: Readonly<Record<string, string>>;
    readonly status?: JsonObject;
  };
  readonly response?: JsonObject;
  readonly error?: unknown;
}

/** One entry of the `tasks` endpoint (`GET _tasks?detailed&group_by=none`). */
export interface RawListedTask {
  readonly node: string;
  readonly id: number;
  readonly action: string;
  readonly parent_task_id?: string;
  readonly status?: JsonObject;
}

export interface TaskListResponse {
  readonly tasks?: readonly RawListedTask[];
}

/* ---- Source ------------------------------------------------------------------ */

export type ShardState = 'started' | 'relocating' | 'initializing' | 'unassigned' | 'unknown';

/** One copy of a shard (a `_cat/shards` row). */
export interface ShardCopy {
  readonly shard: number;
  readonly primary: boolean;
  readonly state: ShardState;
  /** Node the copy is on (the source node while relocating). */
  readonly node: string | null;
  /** Node a relocating copy moves to. */
  readonly relocatingTo: string | null;
  readonly docs: number | null;
  readonly size: number | null;
}

export type HealthColor = 'green' | 'yellow' | 'red' | 'gray';

/**
 * Where the routing shards came from: the cluster state (`metadata`, exact),
 * the explicit setting, or an estimate (`default`, `resized`) when the
 * cluster state was not available. A one-shard index can be split into any
 * count whatever its routing shards (`single-shard`).
 */
export type RoutingShardsOrigin = 'metadata' | 'setting' | 'default' | 'single-shard' | 'resized';

export interface RoutingShards {
  readonly value: number;
  readonly origin: RoutingShardsOrigin;
}

/** What the wizard knows about a concrete index. */
export interface SourceIndex {
  readonly name: string;
  readonly primaries: number | null;
  readonly replicas: number | null;
  readonly docs: number | null;
  readonly deletedDocs: number | null;
  readonly primarySize: number | null;
  readonly totalSize: number | null;
  readonly health: HealthColor;
  /** `null` when Elasticsearch did not say (no statistics). */
  readonly open: boolean | null;
  /** `index.blocks.write` (writes refused, metadata changes allowed). */
  readonly writeBlock: boolean;
  /** Any write-level block (write, read_only, read_only_allow_delete). */
  readonly writeBlocked: boolean;
  /** Block settings that are `true` (`index.blocks.write`, …). */
  readonly blockSettings: readonly string[];
  /** `index.routing.allocation.require._name`. */
  readonly requiredNode: string | null;
  /** `index.routing.allocation.include._tier_preference`, in order (`data_warm`, `data_hot`). */
  readonly tierPreference: readonly string[];
  readonly routingShards: RoutingShards | null;
  readonly codec: string | null;
  readonly aliases: readonly string[];
  readonly writeAliases: readonly string[];
  readonly dataStream: string | null;
  /** The index is the current write index of its data stream. */
  readonly dataStreamWriteIndex: boolean;
  readonly createdAt: number | null;
  readonly shards: readonly ShardCopy[];
  /** `false` when `_cat/shards` was unavailable. */
  readonly shardsKnown: boolean;
  /** `index.hidden`. */
  readonly hidden: boolean;
  /** `index.lifecycle.name`. */
  readonly lifecyclePolicy: string | null;
  /**
   * Allocation settings other than `require._name` (`index.routing.allocation.*`:
   * require, include and exclude filters, `total_shards_per_node`), by full key.
   */
  readonly allocation: Readonly<Record<string, string>>;
  /** `index.version.created` (7.2.0 is 7020099). */
  readonly versionCreated: number | null;
  /** `index.resize.source.name`: the index this one was shrunk, split or cloned from. */
  readonly resizedFrom: string | null;
}

/** What the wizard itself changed on a source, so it lifts only that. */
export interface WizardChanges {
  readonly index: string;
  /** The wizard set `index.blocks.write: true`. */
  readonly writeBlock: boolean;
  /** The wizard set `index.routing.allocation.require._name` to this node. */
  readonly requiredNode: string | null;
}

/** A disk watermark: a share of the disk used, or the free space it requires. */
export type Watermark =
  | { readonly kind: 'ratio'; readonly used: number; readonly headroom: number | null; readonly text: string }
  | { readonly kind: 'bytes'; readonly free: number; readonly text: string };

/** The disk-based allocation settings of the cluster. */
export interface DiskWatermarks {
  readonly enabled: boolean;
  readonly low: Watermark | null;
  readonly high: Watermark | null;
  readonly flood: Watermark | null;
}

/** Where a node stands against the disk watermarks. */
export type DiskLevel = 'ok' | 'low' | 'high' | 'flood';

export interface NodeOption {
  readonly id: string;
  readonly name: string;
  readonly diskAvailable: number | null;
  readonly diskTotal: number | null;
  readonly diskPercent: number | null;
  /** Shards of the source that already have a started copy here. */
  readonly shardsHere: number;
  /** Against the disk watermarks, `null` when unknown or the watermarks are off. */
  readonly diskLevel: DiskLevel | null;
  /**
   * Why the source's allocation filters or tier preference keep its shards
   * off this node (a sentence without final period), or `null`.
   */
  readonly excluded: string | null;
}

/* ---- Checks ---------------------------------------------------------------- */

export type CheckStatus = 'pass' | 'fail' | 'warn' | 'pending';

/** Action a check offers to fix itself. */
export type CheckFix = 'write-block' | 'prepare' | 'create-destination' | 'open-index' | 'make-write-index';

export interface Check {
  readonly id: string;
  readonly status: CheckStatus;
  readonly title: string;
  readonly detail: string;
  readonly fix?: CheckFix;
}

export interface CheckSummary {
  readonly pass: number;
  readonly fail: number;
  readonly warn: number;
  readonly pending: number;
  /** No failed and no pending check. */
  readonly ready: boolean;
}

/* ---- Requests --------------------------------------------------------------- */

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

/** A request as Elasticsearch receives it, for the review step. */
export interface RequestPreview {
  readonly method: HttpMethod;
  readonly path: string;
  readonly body: JsonObject | null;
  readonly title: string;
}

/** A Play endpoint call plus the Elasticsearch request it sends. */
export interface PlannedRequest {
  readonly endpoint: string;
  readonly payload: Record<string, unknown>;
  readonly preview: RequestPreview;
}

/* ---- Resize ----------------------------------------------------------------- */

export interface ResizeOptions {
  readonly target: string;
  readonly shards: number | null;
  readonly replicas: number | null;
  readonly bestCompression: boolean;
  readonly aliases: readonly string[];
}

export interface Compatibility {
  readonly ok: boolean;
  readonly reason: string | null;
}

/** Shards of the resize target and how far they are from green. */
export interface TargetRecovery {
  readonly total: number;
  readonly started: number;
  readonly initializing: number;
  readonly relocating: number;
  readonly unassigned: number;
  readonly primariesStarted: number;
  readonly primaries: number;
  /** Shard numbers whose primary is unassigned. */
  readonly unassignedPrimaries: readonly number[];
  readonly percent: number;
  readonly health: HealthColor;
  readonly done: boolean;
}

/** Where the copies of the source stand while it is prepared for a shrink. */
export interface Colocation {
  readonly node: string;
  /** Shards with a started copy on the node. */
  readonly covered: number;
  readonly total: number;
  /** Copies on their way to the node. */
  readonly moving: number;
  /** Copies of the index that are not started (any node). */
  readonly unsettled: number;
  readonly done: boolean;
}

/* ---- Rollover ----------------------------------------------------------------- */

export type RolloverTargetKind = 'alias' | 'data-stream';

export interface RolloverTarget {
  readonly name: string;
  readonly kind: RolloverTargetKind;
  /** The index a rollover replaces, `null` when there is none. */
  readonly writeIndex: string | null;
  readonly indices: readonly string[];
  /** Why the target cannot be rolled over, or `null`. */
  readonly problem: string | null;
  readonly hidden: boolean;
  /**
   * An alias whose only index is its write index without `is_write_index: true`:
   * a rollover moves the alias to the new index, so the old one leaves it.
   */
  readonly implicitWrite: boolean;
}

export interface RolloverConditionsInput {
  readonly maxAge: string;
  readonly maxDocs: string;
  readonly maxSize: string;
  readonly maxPrimaryShardSize: string;
  readonly maxPrimaryShardDocs: string;
}

export type RolloverConditionKey = keyof RolloverConditionsInput;

export interface ConditionResult {
  readonly key: string;
  readonly label: string;
  readonly value: string;
  readonly met: boolean;
}

export interface RolloverPreview {
  readonly oldIndex: string | null;
  readonly newIndex: string | null;
  readonly rolledOver: boolean;
  readonly dryRun: boolean;
  readonly conditions: readonly ConditionResult[];
  readonly metCount: number;
  /** A rollover with these conditions would happen now. */
  readonly wouldRollOver: boolean;
}

/** Current values of the write index next to the conditions. */
export interface WriteIndexFacts {
  readonly index: string;
  readonly docs: number | null;
  readonly primarySize: number | null;
  readonly largestPrimarySize: number | null;
  readonly largestPrimaryDocs: number | null;
  readonly createdAt: number | null;
}

/* ---- Reindex ------------------------------------------------------------------ */

export type ConflictsMode = 'abort' | 'proceed';
/** What happens to documents the destination already has: `skip` is `op_type: create`. */
export type ExistingDocuments = 'overwrite' | 'skip';
export type SlicesMode = 'none' | 'auto' | 'custom';

export interface ReindexOptions {
  readonly sources: string;
  readonly query: string;
  readonly dest: string;
  readonly existing: ExistingDocuments;
  readonly conflicts: ConflictsMode;
  readonly maxDocs: string;
  readonly slicesMode: SlicesMode;
  readonly slices: string;
  readonly throttled: boolean;
  readonly requestsPerSecond: string;
  readonly script: string;
}

/** What a source expression resolves to. */
export interface SourceResolution {
  readonly indices: readonly string[];
  /** Expressions that match nothing. */
  readonly unmatched: readonly string[];
}

export interface ReindexFailure {
  readonly index: string | null;
  readonly id: string | null;
  readonly reason: string;
  readonly status: number | null;
}

/** Failures with the same index, status and reason. */
export interface FailureGroup {
  readonly index: string | null;
  readonly status: number | null;
  /** The reason without the document id it names. */
  readonly reason: string;
  readonly count: number;
  /** The first few document ids. */
  readonly ids: readonly string[];
}

export type TaskOutcome = 'running' | 'succeeded' | 'partial' | 'failed' | 'cancelled';

export interface ReindexProgress {
  readonly outcome: TaskOutcome;
  readonly completed: boolean;
  readonly description: string | null;
  readonly total: number | null;
  readonly created: number;
  readonly updated: number;
  readonly deleted: number;
  readonly noops: number;
  readonly versionConflicts: number;
  /** Documents handled so far (created + updated + deleted + noops + conflicts). */
  readonly processed: number;
  /** 0–100, `null` while the total is unknown. */
  readonly percent: number | null;
  readonly batches: number;
  readonly runningMillis: number;
  /** Documents per second over the running time. */
  readonly rate: number | null;
  readonly etaMillis: number | null;
  readonly throttledMillis: number;
  /** `null` when unthrottled. */
  readonly requestsPerSecond: number | null;
  readonly slices: number | null;
  /** Slices whose progress is not reported yet. */
  readonly pendingSlices: number;
  readonly failures: readonly ReindexFailure[];
  readonly error: string | null;
  readonly cancelReason: string | null;
}
