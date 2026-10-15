/** Raw shapes of the ingest pipeline endpoints and the view models built from them. */

/** One processor as stored: `{ "<type>": { ...options } }`. */
export type ProcessorBody = Readonly<Record<string, unknown>>;

export interface PipelineBody {
  readonly description?: string;
  readonly processors?: readonly ProcessorBody[];
  readonly on_failure?: readonly ProcessorBody[];
  readonly version?: number;
  readonly _meta?: Readonly<Record<string, unknown>>;
  readonly deprecated?: boolean;
  readonly [key: string]: unknown;
}

/** GET _ingest/pipeline */
export type PipelinesResponse = Readonly<Record<string, PipelineBody>>;

export interface PipelineSummary {
  readonly id: string;
  readonly description: string | null;
  readonly processorCount: number;
  readonly hasOnFailure: boolean;
  readonly managed: boolean;
  readonly deprecated: boolean;
  readonly version: number | null;
  readonly pipeline: PipelineBody;
}

export interface ProcessorField {
  readonly label: string;
  readonly value: string;
}

export interface ProcessorView {
  /** 1-based position. */
  readonly position: number;
  readonly type: string;
  readonly tag: string | null;
  readonly description: string | null;
  /** One line summary in plain language, e.g. "msg → message". */
  readonly summary: string | null;
  readonly fields: readonly ProcessorField[];
  readonly condition: string | null;
  readonly ignoreFailure: boolean;
  readonly onFailureCount: number;
  /** Malformed entries (not a single-key object) are flagged instead of crashing. */
  readonly invalid: boolean;
}

export type PipelineBodyState =
  | { readonly ok: true; readonly value: PipelineBody }
  | { readonly ok: false; readonly message: string };

export interface SimulateDoc {
  readonly _index?: string;
  readonly _id?: string;
  readonly _source: Readonly<Record<string, unknown>>;
}

export type SampleDocsState =
  | { readonly ok: true; readonly docs: readonly SimulateDoc[] }
  | { readonly ok: false; readonly message: string };

export type ProcessorStatus = 'success' | 'error' | 'skipped' | 'error_ignored' | 'dropped';

/** Raw verbose step. */
export interface ProcessorResultBody {
  readonly processor_type?: string;
  readonly status?: string;
  readonly tag?: string;
  readonly description?: string;
  readonly doc?: { readonly _source?: Readonly<Record<string, unknown>>; readonly [key: string]: unknown };
  readonly error?: unknown;
  readonly ignored_error?: unknown;
  readonly if?: { readonly condition?: string; readonly result?: boolean };
}

export interface SimulateResponse {
  readonly docs?: readonly (Readonly<Record<string, unknown>> | null)[];
}

export interface FieldChange {
  readonly path: string;
  readonly kind: 'added' | 'removed' | 'changed';
}

export interface SimulationStep {
  readonly position: number;
  readonly type: string;
  readonly status: ProcessorStatus | string;
  readonly tag: string | null;
  readonly condition: string | null;
  readonly error: string | null;
  readonly source: Readonly<Record<string, unknown>> | null;
  readonly changes: readonly FieldChange[];
}

export type SimulationOutcome = 'ok' | 'error' | 'dropped';

export interface SimulationResult {
  readonly position: number;
  readonly outcome: SimulationOutcome;
  readonly error: string | null;
  /** The processor that failed, when known (verbose mode). */
  readonly failedProcessor: string | null;
  readonly source: Readonly<Record<string, unknown>> | null;
  readonly metadata: Readonly<Record<string, unknown>> | null;
  /** Index the pipeline routed the document to, when it changed _index. */
  readonly targetIndex: string | null;
  readonly steps: readonly SimulationStep[] | null;
  readonly raw: unknown;
}
