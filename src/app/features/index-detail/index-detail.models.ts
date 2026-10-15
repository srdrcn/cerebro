/** Raw and view models of the index details page. */

export type JsonObject = Readonly<Record<string, unknown>>;

/** `_cat/shards` row as returned by the index_detail endpoint. */
export interface CatShardRow {
  readonly index: string;
  readonly shard: string;
  readonly prirep: string;
  readonly state: string;
  readonly docs: string | null;
  readonly store: string | null;
  readonly ip: string | null;
  readonly node: string | null;
  readonly 'unassigned.reason': string | null;
  readonly 'unassigned.for': string | null;
}

export interface IndexStatsEntry {
  readonly uuid?: string;
  readonly health?: string;
  readonly status?: string;
  readonly primaries?: JsonObject;
  readonly total?: JsonObject;
}

export interface IndexStatsResponse {
  readonly _all?: JsonObject;
  readonly _shards?: JsonObject;
  readonly indices?: Readonly<Record<string, IndexStatsEntry>>;
}

/** Response of the `index_detail` endpoint. */
export interface IndexDetailResponse {
  readonly settings: Readonly<Record<string, { readonly settings?: JsonObject }>>;
  readonly mappings: Readonly<Record<string, { readonly mappings?: JsonObject }>> | null;
  readonly stats: IndexStatsResponse | null;
  readonly aliases: Readonly<Record<string, { readonly aliases?: Readonly<Record<string, JsonObject>> }>> | null;
  readonly shards: readonly CatShardRow[] | null;
}

/** The sections of one concrete index taken out of the multi-index response. */
export interface IndexDetail {
  readonly name: string;
  readonly settings: JsonObject;
  readonly mappings: JsonObject | null;
  readonly stats: IndexStatsEntry | null;
  readonly aliases: Readonly<Record<string, JsonObject>> | null;
  readonly shards: readonly CatShardRow[] | null;
}

export type IndexResolution =
  | { readonly kind: 'single'; readonly detail: IndexDetail }
  | { readonly kind: 'multiple'; readonly indices: readonly string[] }
  | { readonly kind: 'missing' };

export type DetailTab =
  | 'overview'
  | 'mappings'
  | 'settings'
  | 'stats'
  | 'shards'
  | 'aliases'
  | 'lifecycle';

export interface DetailTabDefinition {
  readonly key: DetailTab;
  readonly label: string;
  readonly icon: string;
}

export const DETAIL_TABS: readonly DetailTabDefinition[] = [
  { key: 'overview', label: 'Overview', icon: 'bi-grid-1x2' },
  { key: 'mappings', label: 'Mappings', icon: 'bi-diagram-3' },
  { key: 'settings', label: 'Settings', icon: 'bi-sliders' },
  { key: 'stats', label: 'Stats', icon: 'bi-bar-chart-line' },
  { key: 'shards', label: 'Shards', icon: 'bi-grid-3x3-gap' },
  { key: 'aliases', label: 'Aliases', icon: 'bi-link-45deg' },
  { key: 'lifecycle', label: 'Lifecycle', icon: 'bi-recycle' },
];

/** Key settings shown on the overview tab. */
export type IndexOpenState = 'open' | 'closed' | 'unknown';

export interface KeySettings {
  readonly primaries: number | null;
  readonly replicas: string | null;
  readonly autoExpandReplicas: string | null;
  readonly refreshInterval: string;
  readonly refreshIntervalIsDefault: boolean;
  readonly createdAt: Date | null;
  readonly uuid: string | null;
  readonly versionCreated: string | null;
  readonly versionCreatedRaw: string | null;
  readonly lifecyclePolicy: string | null;
  readonly tierPreference: string | null;
  readonly defaultPipeline: string | null;
  readonly hidden: boolean;
  readonly blocks: readonly string[];
  readonly closed: boolean;
  /** "unknown" when statistics are missing for another reason than the index being closed. */
  readonly openState: IndexOpenState;
}

export interface IndexSummary {
  readonly docs: number | null;
  readonly deletedDocs: number | null;
  readonly primarySize: number | null;
  readonly totalSize: number | null;
  readonly segments: number | null;
  readonly primaries: number | null;
  readonly replicas: number | null;
  /** Statistics came from `_cat/shards` because index stats were unavailable. */
  readonly estimated: boolean;
}

/* ---- Mappings ----------------------------------------------------------- */

export interface MappingField {
  /** Full dotted path, multi-fields included (`message.keyword`). */
  readonly path: string;
  /** Last path segment. */
  readonly name: string;
  readonly depth: number;
  readonly type: string;
  /** Property of a multi-field (`fields`) rather than a real sub-object. */
  readonly multiField: boolean;
  readonly runtime: boolean;
  readonly hasChildren: boolean;
  readonly details: readonly MappingDetail[];
}

export interface MappingDetail {
  readonly key: string;
  readonly value: string;
}

export interface MappingInfo {
  readonly fields: readonly MappingField[];
  readonly dynamic: string | null;
  readonly sourceEnabled: boolean;
  readonly dynamicTemplates: number;
  readonly dataStreamTimestamp: boolean;
  readonly meta: JsonObject | null;
  readonly routingRequired: boolean;
}

/* ---- Settings ------------------------------------------------------------ */

export interface FlatSetting {
  readonly key: string;
  readonly value: string;
}

/* ---- Stats ---------------------------------------------------------------- */

export type StatKind = 'count' | 'bytes' | 'rate' | 'millis' | 'percent' | 'text';

export interface StatItem {
  readonly label: string;
  readonly value: string;
  readonly hint?: string;
}

export interface StatSection {
  readonly key: string;
  readonly title: string;
  readonly icon: string;
  readonly items: readonly StatItem[];
}

/* ---- Shards -------------------------------------------------------------- */

export type ShardState = 'started' | 'initializing' | 'relocating' | 'unassigned' | 'unknown';

export interface ShardRow {
  readonly key: string;
  readonly shard: number;
  readonly primary: boolean;
  readonly state: ShardState;
  readonly stateLabel: string;
  readonly docs: number | null;
  readonly size: number | null;
  readonly node: string | null;
  readonly ip: string | null;
  /** Target node while relocating. */
  readonly relocatingTo: string | null;
  readonly unassignedReason: string | null;
  readonly unassignedReasonLabel: string | null;
  readonly unassignedFor: string | null;
}

export type ShardSortField = 'shard' | 'state' | 'docs' | 'size' | 'node';

export interface ShardHealthSummary {
  readonly total: number;
  readonly started: number;
  readonly initializing: number;
  readonly relocating: number;
  readonly unassigned: number;
  readonly unassignedPrimaries: number;
  readonly nodes: readonly { readonly name: string; readonly primaries: number; readonly replicas: number }[];
  readonly groups: readonly ShardGroup[];
}

/** Every copy of one shard number, primary first. */
export interface ShardGroup {
  readonly shard: number;
  readonly copies: readonly ShardRow[];
}

/* ---- Aliases ------------------------------------------------------------- */

export interface AliasDetail {
  readonly name: string;
  readonly filter: JsonObject | null;
  readonly indexRouting: string | null;
  readonly searchRouting: string | null;
  readonly isWriteIndex: boolean | null;
  readonly hidden: boolean;
}

/* ---- Lifecycle ----------------------------------------------------------- */

export interface IlmExplainResponse {
  readonly indices?: Readonly<Record<string, JsonObject>>;
}

export interface LifecycleTimes {
  readonly label: string;
  readonly at: Date;
}

export interface LifecycleStepError {
  readonly failedStep: string | null;
  readonly type: string | null;
  readonly reason: string;
  readonly retries: number | null;
  readonly autoRetryable: boolean | null;
}

export interface LifecyclePhaseAction {
  readonly name: string;
  readonly params: readonly MappingDetail[];
}

export interface StepInfoSummary {
  readonly message: string | null;
  readonly details: readonly MappingDetail[];
  /** Objects or arrays that only the JSON view shows. */
  readonly hasNested: boolean;
}

export type LifecycleState =
  | { readonly kind: 'unmanaged' }
  | { readonly kind: 'unavailable'; readonly reason: string | null }
  | {
      readonly kind: 'managed';
      readonly policy: string | null;
      readonly phase: string | null;
      readonly action: string | null;
      readonly step: string | null;
      readonly age: string | null;
      readonly times: readonly LifecycleTimes[];
      readonly error: LifecycleStepError | null;
      readonly stepInfo: JsonObject | null;
      readonly phaseActions: readonly LifecyclePhaseAction[];
      readonly phaseMinAge: string | null;
      readonly policyVersion: number | null;
      readonly raw: JsonObject;
    };

/* ---- Operations ---------------------------------------------------------- */

export type IndexOperation = 'refresh' | 'flush' | 'merge' | 'cache' | 'open' | 'close' | 'delete';

export interface IndexOperationDefinition {
  readonly path: string;
  readonly label: string;
  /** Verb phrase of the failure toast: "Could not <verb> products". */
  readonly verb: string;
  readonly icon: string;
  /** Past participle used in the success toast. */
  readonly done: string;
  readonly confirm: null | {
    readonly title: (index: string) => string;
    readonly message: string;
    readonly confirmLabel: string;
    readonly tone: 'default' | 'warning' | 'danger';
  };
}
