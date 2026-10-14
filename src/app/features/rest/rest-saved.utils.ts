import { formatNumber, matchesText, pluralize } from '../../core/format';
import type { RestDraft } from './rest.models';
import {
  SAVED_REQUESTS_FORMAT,
  SAVED_REQUESTS_VERSION,
  type ImportFileResult,
  type ImportOutcome,
  type ImportPlan,
  type ImportStrategy,
  type NameProblem,
  type ParsedSavedRequests,
  type SavedRequest,
  type SavedRequestsDocument,
  type SavedSort,
  type StoredSavedRequests,
} from './rest-saved.models';
import { MAX_STORED_BODY_LENGTH, describeBody, isRestMethod, requestPath } from './rest.utils';

export const MAX_SAVED_NAME_LENGTH = 120;

/** Upper bound of entries read from storage or a file (defensive). */
export const MAX_SAVED_REQUESTS = 2_000;

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

/** Trims and collapses whitespace: what is stored as the name. */
export function normalizeName(name: string): string {
  return name.replace(/\s+/g, ' ').trim();
}

/** Names are unique regardless of case and surrounding whitespace. */
export function nameKey(name: string): string {
  return normalizeName(name).toLocaleLowerCase();
}

export function sameName(left: string, right: string): boolean {
  return nameKey(left) === nameKey(right);
}

export function findSaved(
  requests: readonly SavedRequest[],
  name: string | null | undefined,
): SavedRequest | undefined {
  if (name === null || name === undefined) {
    return undefined;
  }
  const key = nameKey(name);
  return requests.find((request) => nameKey(request.name) === key);
}

/**
 * Why a name cannot be used, or null when it can. `ignore` is the name of
 * the request being renamed (keeping its own name, or changing its case, is
 * not a duplicate).
 */
export function nameProblem(
  name: string,
  requests: readonly SavedRequest[],
  ignore?: string,
): NameProblem | null {
  const normalized = normalizeName(name);
  if (normalized === '') {
    return { kind: 'empty' };
  }
  if (normalized.length > MAX_SAVED_NAME_LENGTH) {
    return { kind: 'too-long', max: MAX_SAVED_NAME_LENGTH };
  }
  const existing = findSaved(requests, normalized);
  if (existing && !(ignore !== undefined && sameName(existing.name, ignore))) {
    return { kind: 'duplicate', existing: existing.name };
  }
  return null;
}

/** Plain language for a name problem (shown under the field). */
export function nameProblemText(problem: NameProblem): string {
  switch (problem.kind) {
    case 'empty':
      return 'Enter a name for the request.';
    case 'too-long':
      return `Use at most ${problem.max} characters.`;
    case 'duplicate':
      return `A saved request named “${problem.existing}” already exists.`;
  }
}

/** "GET _cluster/health" — the default name of a new saved request. */
export function suggestName(draft: Pick<RestDraft, 'method' | 'path'>): string {
  const path = requestPath(draft.path).split(/[?#]/, 1)[0]?.replace(/\/+$/, '') ?? '';
  const base = path === '' ? `${draft.method} request` : `${draft.method} ${path}`;
  return truncateName(base);
}

function truncateName(name: string, reserve = 0): string {
  const max = MAX_SAVED_NAME_LENGTH - reserve;
  const normalized = normalizeName(name);
  return normalized.length > max ? `${normalized.slice(0, max - 1).trimEnd()}…` : normalized;
}

/** `base`, or `base (2)`, `base (3)` … — the first name not used yet. */
export function uniqueName(base: string, requests: readonly SavedRequest[]): string {
  const name = truncateName(base) || 'Saved request';
  if (!findSaved(requests, name)) {
    return name;
  }
  const stem = truncateName(name.replace(/ \(\d+\)$/, ''), 8);
  for (let counter = 2; ; counter++) {
    const candidate = `${stem} (${counter})`;
    if (!findSaved(requests, candidate)) {
      return candidate;
    }
  }
}

/** `name (copy)`, `name (copy 2)` … — name of a duplicated request. */
export function copyName(name: string, requests: readonly SavedRequest[]): string {
  const stem = truncateName(name.replace(/ \(copy(?: \d+)?\)$/, ''), 12);
  const first = `${stem} (copy)`;
  if (!findSaved(requests, first)) {
    return first;
  }
  for (let counter = 2; ; counter++) {
    const candidate = `${stem} (copy ${counter})`;
    if (!findSaved(requests, candidate)) {
      return candidate;
    }
  }
}

// ---------------------------------------------------------------------------
// Validation of stored / imported data
// ---------------------------------------------------------------------------

function timestamp(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return Math.round(value);
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  }
  return null;
}

/**
 * Removes a `user:password@` part should a full URL have been typed as the
 * path: credentials never end up in storage or in exported files.
 */
export function withoutCredentials(path: string): string {
  return path.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/@\s]*@/i, '$1');
}

function bodyOf(value: unknown): string | null {
  if (value === undefined || value === null) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  // Hand written files may hold the body as JSON rather than as a string.
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Validates one saved request read from storage or a file. Unknown fields
 * (a host, credentials …) are dropped; anything unusable yields null.
 */
export function parseSavedRequest(value: unknown, now: number): SavedRequest | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const rawName = record['name'];
  const rawMethod = record['method'];
  const rawPath = record['path'];
  if (typeof rawName !== 'string' || typeof rawMethod !== 'string' || typeof rawPath !== 'string') {
    return null;
  }
  const name = normalizeName(rawName);
  const method = rawMethod.trim().toUpperCase();
  const body = bodyOf(record['body']);
  if (
    name === '' ||
    name.length > MAX_SAVED_NAME_LENGTH ||
    !isRestMethod(method) ||
    body === null ||
    body.length > MAX_STORED_BODY_LENGTH
  ) {
    return null;
  }
  const createdAt = timestamp(record['createdAt']) ?? now;
  const updatedAt = timestamp(record['updatedAt']) ?? createdAt;
  return {
    name,
    method,
    path: withoutCredentials(rawPath.trim()),
    body,
    createdAt,
    updatedAt,
    lastUsedAt: timestamp(record['lastUsedAt']),
  };
}

/** Validates a list of entries; repeated names keep the first entry. */
export function parseSavedList(values: readonly unknown[], now: number): ParsedSavedRequests {
  const requests: SavedRequest[] = [];
  const seen = new Set<string>();
  let invalid = 0;
  for (const value of values.slice(0, MAX_SAVED_REQUESTS)) {
    const request = parseSavedRequest(value, now);
    if (request === null || seen.has(nameKey(request.name))) {
      invalid++;
      continue;
    }
    seen.add(nameKey(request.name));
    requests.push(request);
  }
  invalid += Math.max(0, values.length - MAX_SAVED_REQUESTS);
  return { requests, invalid };
}

/**
 * Reads the stored document defensively. Anything that is not a saved
 * requests document gives an empty list; newer versions are read as far as
 * their entries still look like requests, and are flagged (`newerVersion`)
 * so that this version does not rewrite them and lose what it does not know.
 */
export function parseStoredSavedRequests(value: unknown, now: number): StoredSavedRequests {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { requests: [], invalid: 0, newerVersion: null };
  }
  const record = value as Record<string, unknown>;
  const version = record['version'];
  const requests = record['requests'];
  if (typeof version !== 'number' || version < 1 || !Array.isArray(requests)) {
    return { requests: [], invalid: 0, newerVersion: null };
  }
  return {
    ...parseSavedList(requests, now),
    newerVersion: version > SAVED_REQUESTS_VERSION ? version : null,
  };
}

function cleanEntry(request: SavedRequest): SavedRequest {
  // Explicit fields only: nothing else can slip into storage.
  return {
    name: request.name,
    method: request.method,
    path: withoutCredentials(request.path),
    body: request.body,
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
    lastUsedAt: request.lastUsedAt,
  };
}

/** The document written to localStorage. */
export function storedDocument(requests: readonly SavedRequest[]): SavedRequestsDocument {
  return {
    format: SAVED_REQUESTS_FORMAT,
    version: SAVED_REQUESTS_VERSION,
    requests: requests.map(cleanEntry),
  };
}

/** The document written to an exported file (sorted by name). */
export function exportDocument(requests: readonly SavedRequest[], now: Date): SavedRequestsDocument {
  return {
    format: SAVED_REQUESTS_FORMAT,
    version: SAVED_REQUESTS_VERSION,
    exportedAt: now.toISOString(),
    requests: sortSavedRequests(requests, 'name').map(cleanEntry),
  };
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** `cerebro-saved-requests-2026-10-14.json` (local date). */
export function exportFileName(now: Date): string {
  return `cerebro-saved-requests-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.json`;
}

/**
 * Reads an imported file: an exported document, or a plain array of
 * requests. Explains in plain words why a file cannot be used.
 */
export function parseImportFile(text: string, now: number): ImportFileResult {
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    return { ok: false, message: 'The file is not valid JSON.' };
  }
  let entries: unknown;
  if (Array.isArray(value)) {
    entries = value;
  } else if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    const version = record['version'];
    if (typeof version === 'number' && version > SAVED_REQUESTS_VERSION) {
      return {
        ok: false,
        message: `The file was exported by a newer version of Cerebro (format version ${version}).`,
      };
    }
    entries = record['requests'];
  }
  if (!Array.isArray(entries)) {
    return { ok: false, message: 'The file does not contain saved requests.' };
  }
  const parsed = parseSavedList(entries, now);
  if (parsed.requests.length === 0) {
    return {
      ok: false,
      message:
        entries.length === 0
          ? 'The file does not contain any saved request.'
          : `None of the ${pluralize(entries.length, 'entry', 'entries')} in the file is a valid saved request.`,
    };
  }
  return { ok: true, ...parsed };
}

// ---------------------------------------------------------------------------
// Comparing and changing the list
// ---------------------------------------------------------------------------

function normalizedBody(body: string): string {
  return body.replace(/\r\n?/g, '\n').trimEnd();
}

/** True when both describe the same request (method, path and body). */
export function sameRequest(
  left: Pick<RestDraft, 'method' | 'path' | 'body'>,
  right: Pick<RestDraft, 'method' | 'path' | 'body'>,
): boolean {
  return (
    left.method === right.method &&
    requestPath(left.path) === requestPath(right.path) &&
    normalizedBody(left.body) === normalizedBody(right.body)
  );
}

/**
 * True when the body is longer than what is kept in storage: such a request
 * would be dropped when the saved requests are read back, so it is refused
 * up front.
 */
export function bodyTooLarge(body: string): boolean {
  return body.length > MAX_STORED_BODY_LENGTH;
}

/** Plain-language explanation for a body that is too large to save. */
export function bodyTooLargeText(body: string): string {
  return `Saved requests hold bodies of at most ${formatNumber(MAX_STORED_BODY_LENGTH)} characters (this one has ${formatNumber(body.length)}).`;
}

/** What is stored for the request in the editor. */
export function savedFromDraft(
  name: string,
  draft: RestDraft,
  now: number,
  previous?: SavedRequest,
): SavedRequest {
  return {
    name: normalizeName(name),
    method: draft.method,
    path: withoutCredentials(requestPath(draft.path)),
    body: draft.body,
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
    lastUsedAt: previous?.lastUsedAt ?? now,
  };
}

/** Adds `request`, replacing a saved request with the same name. */
export function upsertSaved(
  requests: readonly SavedRequest[],
  request: SavedRequest,
): SavedRequest[] {
  const key = nameKey(request.name);
  const index = requests.findIndex((item) => nameKey(item.name) === key);
  if (index < 0) {
    return [...requests, request];
  }
  return requests.map((item, position) => (position === index ? request : item));
}

export function removeSaved(requests: readonly SavedRequest[], name: string): SavedRequest[] {
  const key = nameKey(name);
  return requests.filter((item) => nameKey(item.name) !== key);
}

/** Renames `from`; returns the list unchanged when the new name is taken. */
export function renameSaved(
  requests: readonly SavedRequest[],
  from: string,
  to: string,
  now: number,
): SavedRequest[] {
  const target = findSaved(requests, from);
  const name = normalizeName(to);
  if (!target || nameProblem(name, requests, target.name) !== null) {
    return [...requests];
  }
  return requests.map((item) => (item === target ? { ...item, name, updatedAt: now } : item));
}

export function markSavedUsed(
  requests: readonly SavedRequest[],
  name: string,
  now: number,
): SavedRequest[] {
  const key = nameKey(name);
  return requests.map((item) => (nameKey(item.name) === key ? { ...item, lastUsedAt: now } : item));
}

/** A copy under the next free "(copy)" name; it was never used. */
export function duplicateSaved(
  requests: readonly SavedRequest[],
  name: string,
  now: number,
): { readonly requests: SavedRequest[]; readonly copy: SavedRequest | null } {
  const source = findSaved(requests, name);
  if (!source) {
    return { requests: [...requests], copy: null };
  }
  const copy: SavedRequest = {
    ...source,
    name: copyName(source.name, requests),
    createdAt: now,
    updatedAt: now,
    lastUsedAt: null,
  };
  const index = requests.indexOf(source);
  return { requests: [...requests.slice(0, index + 1), copy, ...requests.slice(index + 1)], copy };
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

export function planImport(
  existing: readonly SavedRequest[],
  incoming: readonly SavedRequest[],
  invalid = 0,
): ImportPlan {
  const added: string[] = [];
  const identical: string[] = [];
  const conflicts: string[] = [];
  for (const request of incoming) {
    const current = findSaved(existing, request.name);
    if (!current) {
      added.push(request.name);
    } else if (sameRequest(current, request)) {
      identical.push(current.name);
    } else {
      conflicts.push(current.name);
    }
  }
  return { incoming, added, identical, conflicts, invalid };
}

/**
 * Merges imported requests. New names are added; requests with a name that
 * is already used either keep the saved version (`skip`) or replace its
 * method, path and body (`overwrite`, keeping when it was created and used).
 */
export function applyImport(
  existing: readonly SavedRequest[],
  incoming: readonly SavedRequest[],
  strategy: ImportStrategy,
  now: number,
): ImportOutcome {
  let requests: SavedRequest[] = [...existing];
  let added = 0;
  let overwritten = 0;
  let skipped = 0;
  for (const request of incoming) {
    const current = findSaved(requests, request.name);
    if (!current) {
      requests.push(request);
      added++;
    } else if (sameRequest(current, request) || strategy === 'skip') {
      skipped++;
    } else {
      requests = upsertSaved(requests, {
        ...current,
        method: request.method,
        path: request.path,
        body: request.body,
        updatedAt: now,
      });
      overwritten++;
    }
  }
  return { requests, added, overwritten, skipped };
}

/** "Imported 3 saved requests" + details for the toast. */
export function importSummary(outcome: Omit<ImportOutcome, 'requests'>, invalid: number): {
  readonly message: string;
  readonly details: string;
} {
  const imported = outcome.added + outcome.overwritten;
  const message =
    imported === 0
      ? 'Nothing new to import'
      : `Imported ${pluralize(imported, 'saved request')}`;
  const details: string[] = [];
  if (outcome.added > 0 && outcome.overwritten > 0) {
    details.push(`${outcome.added} added`);
  }
  if (outcome.overwritten > 0) {
    details.push(`${outcome.overwritten} replaced`);
  }
  if (outcome.skipped > 0) {
    details.push(`${outcome.skipped} skipped (already saved)`);
  }
  if (invalid > 0) {
    details.push(`${pluralize(invalid, 'invalid entry', 'invalid entries')} ignored`);
  }
  return { message, details: details.join(', ') };
}

/** "No body", "JSON body", "NDJSON · 4 lines" — what a request carries. */
export function bodySummary(path: string, body: string): string {
  const state = describeBody(path, body);
  switch (state.kind) {
    case 'empty':
      return 'No body';
    case 'json':
      return 'JSON body';
    case 'ndjson':
      return `NDJSON · ${pluralize(state.lines, 'line')}`;
    case 'text':
      return `Plain text · ${pluralize(state.lines, 'line')}`;
    case 'invalid':
      return 'Body is not valid JSON';
  }
}

// ---------------------------------------------------------------------------
// Listing
// ---------------------------------------------------------------------------

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/**
 * Most recently used first. Requests never loaded come after every used
 * one (a rename, duplicate or import is not a use); ties fall back to the
 * most recent change, then to the name.
 */
function byRecentUse(left: SavedRequest, right: SavedRequest): number {
  const leftUsed = left.lastUsedAt ?? Number.NEGATIVE_INFINITY;
  const rightUsed = right.lastUsedAt ?? Number.NEGATIVE_INFINITY;
  if (leftUsed !== rightUsed) {
    return rightUsed > leftUsed ? 1 : -1;
  }
  return right.updatedAt - left.updatedAt;
}

export function sortSavedRequests(
  requests: readonly SavedRequest[],
  sort: SavedSort,
): SavedRequest[] {
  const byName = (left: SavedRequest, right: SavedRequest) =>
    collator.compare(left.name, right.name);
  return [...requests].sort(
    sort === 'name'
      ? byName
      : (left, right) => byRecentUse(left, right) || byName(left, right),
  );
}

export function matchesSaved(request: SavedRequest, query: string): boolean {
  return matchesText(`${request.name} ${request.method} ${request.path} ${request.body}`, query);
}

export function filterSavedRequests(
  requests: readonly SavedRequest[],
  query: string,
): readonly SavedRequest[] {
  const trimmed = query.trim();
  return trimmed === '' ? requests : requests.filter((request) => matchesSaved(request, trimmed));
}

export function isSavedSort(value: unknown): value is SavedSort {
  return value === 'name' || value === 'recent';
}
