/** Raw shapes returned by the ILM endpoints and the view models built from them. */

export type IlmPhaseName = 'hot' | 'warm' | 'cold' | 'frozen' | 'delete';

/** Phases in the order Elasticsearch runs them. */
export const PHASE_ORDER: readonly IlmPhaseName[] = ['hot', 'warm', 'cold', 'frozen', 'delete'];

export interface IlmPhaseBody {
  readonly min_age?: string;
  readonly actions?: Readonly<Record<string, unknown>>;
}

/** The inner policy object (what PUT _ilm/policy/<name> takes under "policy"). */
export interface IlmPolicyBody {
  readonly phases?: Readonly<Record<string, IlmPhaseBody>>;
  readonly _meta?: Readonly<Record<string, unknown>>;
  readonly deprecated?: boolean;
  readonly [key: string]: unknown;
}

export interface IlmInUseBy {
  readonly indices?: readonly string[];
  readonly data_streams?: readonly string[];
  readonly composable_templates?: readonly string[];
}

export interface IlmPolicyEntry {
  readonly version?: number;
  readonly modified_date?: string;
  readonly policy?: IlmPolicyBody;
  readonly in_use_by?: IlmInUseBy;
}

/** GET _ilm/policy */
export type IlmPoliciesResponse = Readonly<Record<string, IlmPolicyEntry>>;

export interface IlmUsage {
  readonly indices: readonly string[];
  readonly dataStreams: readonly string[];
  readonly templates: readonly string[];
  readonly total: number;
}

export type PhaseTone = IlmPhaseName | 'other';

export interface ActionView {
  readonly type: string;
  /** Plain language description, e.g. "Roll over at 1d or 10 GB primary shard". */
  readonly label: string;
  /** Secondary detail, e.g. "Only once it holds at least 1 document". */
  readonly detail: string | null;
  readonly icon: string;
}

export interface PhaseView {
  readonly name: string;
  readonly label: string;
  readonly tone: PhaseTone;
  /** min_age as written in the policy, null when the phase starts right away. */
  readonly minAge: string | null;
  /** "Immediately", "7d after rollover", … */
  readonly startLabel: string;
  readonly actions: readonly ActionView[];
}

export interface IlmPolicySummary {
  readonly name: string;
  readonly version: number | null;
  readonly modifiedDate: string | null;
  readonly description: string | null;
  readonly managed: boolean;
  readonly deprecated: boolean;
  readonly phases: readonly PhaseView[];
  readonly usage: IlmUsage;
  readonly policy: IlmPolicyBody;
  readonly entry: IlmPolicyEntry;
}

/** One index of GET <target>/_ilm/explain */
export interface IlmExplainEntry {
  readonly index?: string;
  readonly managed?: boolean;
  readonly policy?: string;
  readonly phase?: string;
  readonly action?: string;
  readonly step?: string;
  readonly age?: string;
  readonly lifecycle_date_millis?: number;
  readonly phase_time_millis?: number;
  readonly failed_step?: string;
  readonly is_auto_retryable_error?: boolean;
  readonly failed_step_retry_count?: number;
  readonly step_info?: unknown;
  readonly [key: string]: unknown;
}

export interface IlmExplainResponse {
  readonly indices?: Readonly<Record<string, IlmExplainEntry>>;
}

export interface ExplainRow {
  readonly index: string;
  readonly managed: boolean;
  readonly policy: string | null;
  readonly phase: string | null;
  readonly phaseTone: PhaseTone;
  readonly action: string | null;
  readonly step: string | null;
  readonly age: string | null;
  readonly ageMillis: number | null;
  readonly failed: boolean;
  /**
   * ILM is retrying a failed step automatically: between polls explain shows
   * the retried step instead of ERROR, with failed_step_retry_count > 0.
   */
  readonly retrying: boolean;
  readonly failedStep: string | null;
  /** Reason from step_info, for failed steps or waiting conditions. */
  readonly info: string | null;
  readonly retryable: boolean;
  readonly retryCount: number | null;
  readonly raw: IlmExplainEntry;
}

export type ExplainSortField = 'index' | 'policy' | 'phase' | 'age';
export type ExplainFilter = 'all' | 'managed' | 'errors';

export interface ExplainSummary {
  readonly total: number;
  readonly managed: number;
  /** Rows that need attention: failed or being retried. */
  readonly errors: number;
  readonly retrying: number;
  readonly phases: readonly { readonly name: string; readonly tone: PhaseTone; readonly count: number }[];
}

/** What to explain for a policy: the target, plus a filter when it had to widen. */
export interface UsageExplainTarget {
  readonly target: string;
  readonly query: string;
}

export type PolicyBodyState =
  | { readonly ok: true; readonly value: IlmPolicyBody }
  | { readonly ok: false; readonly message: string };

export type SaveMode = 'create' | 'update' | 'overwrite' | 'copy';
