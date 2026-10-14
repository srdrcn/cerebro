import type { RestMethod } from './rest.utils';

/**
 * A request the user saved under a name. Saved requests are global (they
 * work with every cluster) and only hold what the editor holds: never the
 * host or credentials.
 */
export interface SavedRequest {
  readonly name: string;
  readonly method: RestMethod;
  readonly path: string;
  readonly body: string;
  /** Epoch milliseconds. */
  readonly createdAt: number;
  /** Epoch milliseconds of the last change (save, update, rename). */
  readonly updatedAt: number;
  /** Epoch milliseconds of the last time it was loaded into the editor. */
  readonly lastUsedAt: number | null;
}

/** Shape written to localStorage and to exported files. */
export interface SavedRequestsDocument {
  readonly format: typeof SAVED_REQUESTS_FORMAT;
  readonly version: number;
  readonly exportedAt?: string;
  readonly requests: readonly SavedRequest[];
}

export const SAVED_REQUESTS_FORMAT = 'cerebro-saved-requests';

/** Current version of the stored and exported document. */
export const SAVED_REQUESTS_VERSION = 1;

export type SavedSort = 'name' | 'recent';

export type ImportStrategy = 'skip' | 'overwrite';

/** Requests read back from storage or a file, and how many were unusable. */
export interface ParsedSavedRequests {
  readonly requests: readonly SavedRequest[];
  /** Entries that were malformed, or repeated a name already in the list. */
  readonly invalid: number;
}

export type ImportFileResult =
  | ({ readonly ok: true } & ParsedSavedRequests)
  | { readonly ok: false; readonly message: string };

/** How the requests of an imported file relate to the saved ones. */
export interface ImportPlan {
  readonly incoming: readonly SavedRequest[];
  /** Names that are not saved yet. */
  readonly added: readonly string[];
  /** Names already saved with exactly the same request: nothing to do. */
  readonly identical: readonly string[];
  /** Names already saved with a different request. */
  readonly conflicts: readonly string[];
  readonly invalid: number;
}

export interface ImportOutcome {
  readonly requests: readonly SavedRequest[];
  readonly added: number;
  readonly overwritten: number;
  /** Identical requests plus conflicts that were kept as they were. */
  readonly skipped: number;
}

export type NameProblem =
  | { readonly kind: 'empty' }
  | { readonly kind: 'too-long'; readonly max: number }
  | { readonly kind: 'duplicate'; readonly existing: string };
