/**
 * Cluster doctor: the shapes of the backend report (`POST doctor`), the
 * normalized input the checks read and the findings they produce.
 *
 * The backend answers with one Elasticsearch response per source. Only
 * `health` is guaranteed; every other source may be `null` (and is then listed
 * in `unavailable` with the Elasticsearch error), so the raw report is typed
 * loosely and parsed defensively in `doctor.utils.ts`.
 */

/* ------------------------------------------------------------------ */
/* Raw report                                                          */
/* ------------------------------------------------------------------ */

export type DoctorSource =
  | 'health'
  | 'info'
  | 'nodes'
  | 'settings'
  | 'indices'
  | 'shards'
  | 'blocks'
  | 'ilm'
  | 'deprecations'
  | 'health_report';

/** `POST doctor` body: one Elasticsearch response per source. */
export interface RawDoctorReport {
  readonly health?: unknown;
  readonly info?: unknown;
  readonly nodes?: unknown;
  readonly settings?: unknown;
  readonly indices?: unknown;
  readonly shards?: unknown;
  readonly blocks?: unknown;
  readonly ilm?: unknown;
  readonly deprecations?: unknown;
  readonly health_report?: unknown;
  /** Sources Elasticsearch refused: `{ nodes: { status: 403, error: {…} } }`. */
  readonly unavailable?: unknown;
}

/* ------------------------------------------------------------------ */
/* Normalized input                                                    */
/* ------------------------------------------------------------------ */

export interface ClusterHealthInfo {
  readonly clusterName: string | null;
  readonly status: string;
  readonly nodes: number;
  readonly dataNodes: number;
  readonly activePrimaries: number;
  readonly activeShards: number;
  readonly unassigned: number;
  readonly initializing: number;
  readonly relocating: number;
  readonly delayedUnassigned: number;
}

export interface EsVersion {
  readonly text: string;
  readonly major: number;
  readonly minor: number;
}

export interface NodeDisk {
  /** Data path the numbers come from (the one with the least available space). */
  readonly path: string | null;
  readonly total: number;
  /** Space Elasticsearch may use (`available`, not `free`: the disk deciders use it). */
  readonly available: number;
  /** Free space each watermark requires, as computed by Elasticsearch 8.x for this path. */
  readonly reported: Readonly<{ low: number | null; high: number | null; flood: number | null }>;
}

export interface NodeBreaker {
  readonly name: string;
  readonly tripped: number;
  readonly limit: number | null;
  readonly estimated: number | null;
}

export interface NodeInfo {
  readonly id: string;
  readonly name: string;
  /** `null` when Elasticsearch did not report roles (very old versions). */
  readonly roles: readonly string[] | null;
  readonly disk: NodeDisk | null;
  readonly heapPercent: number | null;
  readonly heapUsed: number | null;
  readonly heapMax: number | null;
  /** Old-generation pool (`jvm.mem.pools.old`): what is left after collections. */
  readonly oldGenUsed: number | null;
  readonly oldGenMax: number | null;
  readonly uptime: number | null;
  readonly oldGcCount: number | null;
  readonly oldGcTime: number | null;
  readonly breakers: readonly NodeBreaker[];
}

/** Flat cluster settings by layer (`flat_settings=true&include_defaults=true`). */
export interface ClusterSettingsLayers {
  readonly persistent: Readonly<Record<string, string>>;
  readonly transient: Readonly<Record<string, string>>;
  readonly defaults: Readonly<Record<string, string>>;
}

export interface IndexRow {
  readonly name: string;
  readonly health: string;
  readonly status: string;
  readonly primaries: number;
  readonly replicas: number;
  readonly docs: number | null;
  readonly size: number | null;
  readonly primarySize: number | null;
}

export interface ShardRow {
  readonly index: string;
  readonly shard: number;
  readonly primary: boolean;
  readonly state: string;
  readonly store: number | null;
  readonly node: string | null;
  readonly reason: string | null;
}

export interface IlmErrorRow {
  readonly index: string;
  readonly policy: string | null;
  readonly phase: string | null;
  readonly action: string | null;
  readonly failedStep: string | null;
  readonly errorType: string | null;
  readonly reason: string | null;
  readonly retryCount: number | null;
  readonly autoRetry: boolean;
  /**
   * The index points to a policy that does not exist: explain reports it as
   * step ERROR without a failed step, and `_ilm/retry` rejects it.
   */
  readonly missingPolicy: boolean;
}

export interface UnavailableSource {
  readonly status: number | null;
  readonly error: unknown;
}

export interface DoctorInput {
  readonly health: ClusterHealthInfo;
  readonly version: EsVersion | null;
  readonly nodes: readonly NodeInfo[] | null;
  readonly settings: ClusterSettingsLayers | null;
  readonly indices: readonly IndexRow[] | null;
  readonly shards: readonly ShardRow[] | null;
  /**
   * Index name → flat `index.blocks.*` settings plus `index.store.type` and
   * `index.store.snapshot.partial` (searchable snapshot detection).
   */
  readonly blocks: ReadonlyMap<string, Readonly<Record<string, unknown>>> | null;
  readonly ilm: readonly IlmErrorRow[] | null;
  readonly deprecations: Readonly<Record<string, unknown>> | null;
  readonly healthReport: Readonly<Record<string, unknown>> | null;
  readonly unavailable: ReadonlyMap<string, UnavailableSource>;
}

/* ------------------------------------------------------------------ */
/* Findings                                                            */
/* ------------------------------------------------------------------ */

export type DoctorSeverity = 'critical' | 'warning' | 'info';

export type DoctorCategory =
  | 'health'
  | 'disk'
  | 'shards'
  | 'indices'
  | 'lifecycle'
  | 'nodes'
  | 'settings'
  | 'upgrade';

export interface SeverityMeta {
  readonly key: DoctorSeverity;
  readonly label: string;
  readonly icon: string;
  /** Badge / tone colour. */
  readonly tone: 'red' | 'yellow' | 'blue';
}

export const SEVERITIES: readonly SeverityMeta[] = [
  { key: 'critical', label: 'Critical', icon: 'bi-x-octagon', tone: 'red' },
  { key: 'warning', label: 'Warning', icon: 'bi-exclamation-triangle', tone: 'yellow' },
  { key: 'info', label: 'Info', icon: 'bi-info-circle', tone: 'blue' },
];

export interface CategoryMeta {
  readonly key: DoctorCategory;
  readonly label: string;
  readonly icon: string;
}

export const CATEGORIES: readonly CategoryMeta[] = [
  { key: 'health', label: 'Health', icon: 'bi-heart-pulse' },
  { key: 'disk', label: 'Disk', icon: 'bi-device-hdd' },
  { key: 'shards', label: 'Shards', icon: 'bi-grid-3x3-gap' },
  { key: 'indices', label: 'Indices', icon: 'bi-box' },
  { key: 'lifecycle', label: 'Lifecycle', icon: 'bi-hourglass-split' },
  { key: 'nodes', label: 'JVM & nodes', icon: 'bi-cpu' },
  { key: 'settings', label: 'Settings', icon: 'bi-sliders' },
  { key: 'upgrade', label: 'Upgrade readiness', icon: 'bi-arrow-up-circle' },
];

/** A page of this application (`route` without the host query, which the page adds). */
export interface DoctorLink {
  readonly label: string;
  readonly icon: string;
  readonly route: string;
  readonly params?: Readonly<Record<string, string>>;
}

/** Documentation outside the application (opens in a new tab). */
export interface ExternalLink {
  readonly label: string;
  readonly url: string;
}

/** A one-click fix: confirmed first, then sent to a backend endpoint. */
export interface DoctorFix {
  /** Stable key (to show which fix is running). */
  readonly key: string;
  readonly label: string;
  readonly icon: string;
  readonly tone: 'default' | 'warning' | 'danger';
  readonly confirmTitle: string;
  readonly confirmMessage: string;
  readonly confirmItems: readonly string[];
  readonly confirmLabel: string;
  readonly path: string;
  readonly payload: Readonly<Record<string, unknown>>;
  /** Toast after it worked. */
  readonly success: string;
  /** Start of the error toast ("Could not remove the block"). */
  readonly failure: string;
}

export type ResourceKind =
  | 'index'
  | 'node'
  | 'shard'
  | 'setting'
  | 'template'
  | 'policy'
  | 'data-stream'
  | 'other';

export interface DoctorResource {
  readonly kind: ResourceKind;
  readonly name: string;
  /** Short explanation for this item ("90.6% used · 23.6 GB free"). */
  readonly detail?: string;
  readonly link?: DoctorLink;
  /** A fix for this item alone (the finding's fixes apply to all items). */
  readonly fix?: DoctorFix;
}

export interface DoctorFact {
  readonly label: string;
  readonly value: string;
}

export interface DoctorFinding {
  /** Stable across runs (`checkId:key`). */
  readonly id: string;
  readonly checkId: string;
  readonly severity: DoctorSeverity;
  readonly category: DoctorCategory;
  readonly title: string;
  /** What is wrong. */
  readonly summary: string;
  /** Why it matters. */
  readonly impact: string;
  /** What to do. */
  readonly advice?: string;
  /** Extra caveat shown as a callout. */
  readonly note?: string;
  readonly facts?: readonly DoctorFact[];
  readonly resources: readonly DoctorResource[];
  /** Heading of the resource list ("Affected indices"). */
  readonly resourceLabel?: string;
  readonly fixes: readonly DoctorFix[];
  readonly links: readonly DoctorLink[];
  readonly external?: readonly ExternalLink[];
}

export interface DoctorCheck {
  readonly id: string;
  readonly category: DoctorCategory;
  readonly title: string;
  /** What the check verifies (shown when it passed). */
  readonly description: string;
  /** Sources the check cannot run without. */
  readonly sources: readonly DoctorSource[];
  readonly run: (input: DoctorInput) => readonly DoctorFinding[];
}

export type CheckStatus = 'passed' | 'failed' | 'skipped';

export interface CheckOutcome {
  readonly id: string;
  readonly category: DoctorCategory;
  readonly title: string;
  readonly description: string;
  readonly status: CheckStatus;
  readonly findings: readonly DoctorFinding[];
  /** Why a skipped check could not run ("Needs the monitor privilege (403)"). */
  readonly reason?: string;
  /**
   * Skipped because the feature does not exist on this cluster (health report
   * before 8.7, ILM without X-Pack…): not a gap in the report.
   */
  readonly unsupported?: boolean;
}

/* ------------------------------------------------------------------ */
/* Health report panel                                                 */
/* ------------------------------------------------------------------ */

export interface HealthImpactView {
  readonly severity: number | null;
  readonly description: string;
  readonly areas: readonly string[];
}

export interface HealthResourceGroup {
  readonly label: string;
  readonly names: readonly string[];
}

export interface HealthDiagnosisView {
  readonly cause: string;
  readonly action: string;
  readonly helpUrl: string | null;
  readonly resources: readonly HealthResourceGroup[];
}

export interface HealthIndicatorView {
  readonly name: string;
  readonly label: string;
  readonly status: string;
  readonly tone: 'green' | 'yellow' | 'red' | 'gray';
  readonly statusLabel: string;
  readonly symptom: string;
  readonly impacts: readonly HealthImpactView[];
  readonly diagnoses: readonly HealthDiagnosisView[];
}

export type HealthReportView =
  | {
      readonly kind: 'report';
      readonly status: string;
      readonly tone: 'green' | 'yellow' | 'red' | 'gray';
      readonly indicators: readonly HealthIndicatorView[];
    }
  /** The cluster is older than 8.7. */
  | { readonly kind: 'unsupported'; readonly version: string | null }
  | { readonly kind: 'unavailable'; readonly reason: string };

/* ------------------------------------------------------------------ */
/* Report                                                              */
/* ------------------------------------------------------------------ */

export interface DoctorVerdict {
  /** Blue: no problems found, but some checks could not run. */
  readonly tone: 'red' | 'yellow' | 'green' | 'blue';
  readonly icon: string;
  readonly title: string;
  readonly text: string;
}

export interface DoctorReport {
  readonly clusterName: string | null;
  readonly version: string | null;
  readonly findings: readonly DoctorFinding[];
  readonly outcomes: readonly CheckOutcome[];
  readonly counts: Readonly<Record<DoctorSeverity, number>>;
  readonly ran: number;
  readonly passed: number;
  readonly skipped: number;
  /** Skipped checks that leave a gap (not merely unsupported by this version). */
  readonly gaps: number;
  readonly verdict: DoctorVerdict;
  readonly healthReport: HealthReportView;
}
