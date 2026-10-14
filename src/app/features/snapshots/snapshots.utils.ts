import { matchesText } from '../../core/format';
import { SnapshotRecord, SnapshotState } from './snapshots.models';

export type SnapshotSortField = 'name' | 'start' | 'indices';
/** `neutral` maps to the plain grey `.badge` of the design system. */
export type SnapshotTone = 'green' | 'yellow' | 'red' | 'blue' | 'neutral';

interface StateMeta {
  readonly label: string;
  readonly tone: SnapshotTone;
  readonly icon: string;
}

const STATE_META: Readonly<Record<SnapshotState, StateMeta>> = {
  SUCCESS: { label: 'Success', tone: 'green', icon: 'bi-check-circle-fill' },
  PARTIAL: { label: 'Partial', tone: 'yellow', icon: 'bi-exclamation-circle-fill' },
  FAILED: { label: 'Failed', tone: 'red', icon: 'bi-x-circle-fill' },
  IN_PROGRESS: { label: 'In progress', tone: 'blue', icon: 'bi-arrow-repeat' },
  INCOMPATIBLE: { label: 'Incompatible', tone: 'neutral', icon: 'bi-slash-circle' },
};

const UNKNOWN_STATE: StateMeta = { label: 'Unknown', tone: 'neutral', icon: 'bi-question-circle' };

/** Display order of the state filter chips. */
export const SNAPSHOT_STATES: readonly SnapshotState[] = [
  'SUCCESS',
  'PARTIAL',
  'FAILED',
  'IN_PROGRESS',
  'INCOMPATIBLE',
];

export function stateMeta(state: string | undefined): StateMeta {
  return state && Object.hasOwn(STATE_META, state) ? STATE_META[state as SnapshotState] : UNKNOWN_STATE;
}

/** Design-system badge classes for a tone (the base `.badge` is neutral). */
export function badgeClass(tone: SnapshotTone): string {
  return tone === 'neutral' ? 'badge' : `badge badge-${tone}`;
}

export function isInProgress(snapshot: SnapshotRecord): boolean {
  return snapshot.state === 'IN_PROGRESS';
}

/** Snapshots that hold restorable data. */
export function isRestorable(snapshot: SnapshotRecord): boolean {
  return snapshot.state === 'SUCCESS' || snapshot.state === 'PARTIAL';
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function parseTime(value: string | undefined): number | null {
  if (!value) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

/** Start of the snapshot in epoch milliseconds. */
export function snapshotStart(snapshot: SnapshotRecord): number | null {
  return finite(snapshot.start_time_in_millis) ?? parseTime(snapshot.start_time);
}

/** Duration in milliseconds; running snapshots are measured against `now`. */
export function snapshotDuration(snapshot: SnapshotRecord, now: number): number | null {
  const reported = finite(snapshot.duration_in_millis);
  const start = snapshotStart(snapshot);
  if (isInProgress(snapshot)) {
    return start === null ? null : Math.max(0, now - start);
  }
  if (reported !== null && reported >= 0) {
    return reported;
  }
  const end = finite(snapshot.end_time_in_millis) ?? parseTime(snapshot.end_time);
  return start !== null && end !== null && end >= start ? end - start : null;
}

export function snapshotIndices(snapshot: SnapshotRecord): readonly string[] {
  return Array.isArray(snapshot.indices) ? snapshot.indices : [];
}

/** Failed shard count, falling back to the failure list. */
export function failedShards(snapshot: SnapshotRecord): number {
  return finite(snapshot.shards?.failed) ?? (Array.isArray(snapshot.failures) ? snapshot.failures.length : 0);
}

export function snapshotKey(snapshot: SnapshotRecord): string {
  return snapshot.uuid || snapshot.snapshot;
}

/** Matches the snapshot name or any index it contains. */
export function matchesSnapshot(snapshot: SnapshotRecord, query: string): boolean {
  if (!query.trim()) {
    return true;
  }
  return (
    matchesText(snapshot.snapshot, query) ||
    snapshotIndices(snapshot).some((index) => matchesText(index, query))
  );
}

export function filterSnapshots(
  snapshots: readonly SnapshotRecord[],
  query: string,
  hiddenStates: ReadonlySet<string>,
): SnapshotRecord[] {
  return snapshots.filter(
    (snapshot) => !hiddenStates.has(snapshot.state ?? '') && matchesSnapshot(snapshot, query),
  );
}

/**
 * Sorts a copy of the list. `reverse` means descending, so the default view
 * (`start`, reverse) lists the newest snapshot first. Ties fall back to name.
 */
export function sortSnapshots(
  snapshots: readonly SnapshotRecord[],
  field: SnapshotSortField,
  reverse: boolean,
): SnapshotRecord[] {
  const direction = reverse ? -1 : 1;
  const byName = (left: SnapshotRecord, right: SnapshotRecord) =>
    left.snapshot.localeCompare(right.snapshot, undefined, { numeric: true });
  return [...snapshots].sort((left, right) => {
    let result = 0;
    if (field === 'start') {
      result = (snapshotStart(left) ?? -Infinity) - (snapshotStart(right) ?? -Infinity);
      if (Number.isNaN(result)) {
        result = 0;
      }
    } else if (field === 'indices') {
      result = snapshotIndices(left).length - snapshotIndices(right).length;
    }
    return (result || byName(left, right)) * direction;
  });
}

export interface SnapshotSummary {
  readonly total: number;
  readonly states: Readonly<Record<string, number>>;
  readonly problems: number;
  readonly running: number;
  readonly latest?: SnapshotRecord;
  readonly lastSuccess?: SnapshotRecord;
  readonly indices: number;
  readonly shards: number;
}

export function summarizeSnapshots(snapshots: readonly SnapshotRecord[]): SnapshotSummary {
  const states: Record<string, number> = {};
  const indices = new Set<string>();
  let shards = 0;
  for (const snapshot of snapshots) {
    const state = snapshot.state ?? 'UNKNOWN';
    states[state] = (states[state] ?? 0) + 1;
    snapshotIndices(snapshot).forEach((index) => indices.add(index));
    shards += finite(snapshot.shards?.total) ?? 0;
  }
  const newestFirst = sortSnapshots(snapshots, 'start', true);
  const latest = newestFirst[0];
  const lastSuccess = newestFirst.find((snapshot) => snapshot.state === 'SUCCESS');
  return {
    total: snapshots.length,
    states,
    problems: (states['FAILED'] ?? 0) + (states['PARTIAL'] ?? 0),
    running: states['IN_PROGRESS'] ?? 0,
    ...(latest ? { latest } : {}),
    ...(lastSuccess ? { lastSuccess } : {}),
    indices: indices.size,
    shards,
  };
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** `snapshot-2026.10.14-1530` in local time. */
export function suggestSnapshotName(date: Date, prefix = 'snapshot'): string {
  const day = `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())}`;
  return `${prefix}-${day}-${pad(date.getHours())}${pad(date.getMinutes())}`.toLowerCase();
}

/** Appends `-2`, `-3`, … until the name is not taken. */
export function uniqueName(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) {
    return base;
  }
  let counter = 2;
  while (taken.has(`${base}-${counter}`)) {
    counter += 1;
  }
  return `${base}-${counter}`;
}

const INVALID_NAME_CHARACTERS = ['\\', '/', '*', '?', '"', '<', '>', '|', ',', '#'];

/** Date math names such as `<nightly-{now/d}>` are resolved by Elasticsearch. */
export function isDateMathName(name: string): boolean {
  return /^<.+>$/.test(name);
}

/**
 * Mirrors the snapshot name rules of Elasticsearch so mistakes are reported
 * before the request is sent. Returns an error message or `null`.
 */
export function validateSnapshotName(
  value: string,
  existing: ReadonlySet<string> = new Set(),
): string | null {
  const name = value.trim();
  if (!name) {
    return 'Enter a snapshot name.';
  }
  if (isDateMathName(name)) {
    return null;
  }
  if (/\s/.test(name)) {
    return 'Snapshot names cannot contain whitespace.';
  }
  if (name !== name.toLowerCase()) {
    return 'Snapshot names must be lowercase.';
  }
  if (name.startsWith('_')) {
    return 'Snapshot names cannot start with an underscore.';
  }
  const invalid = INVALID_NAME_CHARACTERS.find((character) => name.includes(character));
  if (invalid) {
    return `Snapshot names cannot contain “${invalid}”.`;
  }
  if (existing.has(name)) {
    return 'A snapshot with this name already exists in the repository.';
  }
  return null;
}

/** Returns an error message when the rename pattern is not a valid expression. */
export function validateRenamePattern(pattern: string): string | null {
  if (!pattern.trim()) {
    return null;
  }
  try {
    new RegExp(pattern.trim());
    return null;
  } catch {
    return 'This is not a valid regular expression.';
  }
}

export interface RenameErrors {
  readonly pattern: string | null;
  readonly replacement: string | null;
}

/**
 * Elasticsearch only renames restored indices when both a pattern and a
 * replacement are set; either one alone is silently ignored. An empty
 * replacement cannot be sent either, so stripping a prefix needs a group
 * (`tmp-(.+)` → `$1`).
 */
export function validateRename(pattern: string, replacement: string): RenameErrors {
  const hasPattern = !!pattern.trim();
  const hasReplacement = !!replacement.trim();
  let replacementError: string | null = null;
  if (hasPattern && !hasReplacement) {
    replacementError = 'Set a replacement: Elasticsearch ignores a pattern without one.';
  } else if (!hasPattern && hasReplacement) {
    replacementError = 'Set a rename pattern to use a replacement.';
  }
  return { pattern: validateRenamePattern(pattern), replacement: replacementError };
}

/** True when Elasticsearch will actually rename the restored indices. */
export function isRenaming(pattern: string, replacement: string): boolean {
  const errors = validateRename(pattern, replacement);
  return !!pattern.trim() && !errors.pattern && !errors.replacement;
}

/**
 * Previews the name Elasticsearch gives to a restored index
 * (`index.replaceAll(pattern, replacement)`). Without both a valid pattern
 * and a replacement the index keeps its name, as in Elasticsearch.
 */
export function renameIndex(index: string, pattern: string, replacement: string): string {
  if (!isRenaming(pattern, replacement)) {
    return index;
  }
  return index.replace(new RegExp(pattern.trim(), 'g'), replacement.trim());
}

/**
 * What already sits at the name a snapshot index is restored to:
 * nothing, an open index (the restore fails) or a closed index (it is
 * replaced). Without status information every known name counts as open.
 */
export type RestoreTargetState = 'free' | 'open' | 'closed';

export function restoreTargetState(
  target: string,
  statuses: ReadonlyMap<string, string> | null,
  knownIndices: ReadonlySet<string>,
): RestoreTargetState {
  if (statuses) {
    const status = statuses.get(target);
    if (status === undefined) {
      return 'free';
    }
    return status === 'close' ? 'closed' : 'open';
  }
  return knownIndices.has(target) ? 'open' : 'free';
}

/** `index → status` from a `_cat/indices?format=json` response. */
export function indexStatuses(rows: unknown): Map<string, string> {
  const statuses = new Map<string, string>();
  if (!Array.isArray(rows)) {
    return statuses;
  }
  for (const row of rows as unknown[]) {
    if (row && typeof row === 'object') {
      const { index, status } = row as Record<string, unknown>;
      if (typeof index === 'string') {
        statuses.set(index, typeof status === 'string' ? status : 'open');
      }
    }
  }
  return statuses;
}

export interface IndexAlias {
  readonly alias: string;
  /** The index is the alias' explicit write index (`is_write_index: true`). */
  readonly write: boolean;
}

/** `index → aliases` from a `_cat/aliases?format=json` response. */
export function aliasesByIndex(rows: unknown): Map<string, IndexAlias[]> {
  const aliases = new Map<string, IndexAlias[]>();
  if (!Array.isArray(rows)) {
    return aliases;
  }
  for (const row of rows as unknown[]) {
    if (row && typeof row === 'object') {
      const { alias, index, is_write_index: write } = row as Record<string, unknown>;
      if (typeof alias === 'string' && typeof index === 'string') {
        const entry = { alias, write: write === true || write === 'true' };
        aliases.set(index, [...(aliases.get(index) ?? []), entry]);
      }
    }
  }
  return aliases;
}

/**
 * The aliases the given indices belong to, sorted by name. An alias counts
 * as a write alias when it is the write alias of any of them.
 */
export function aliasesOf(
  indices: readonly string[],
  aliases: ReadonlyMap<string, readonly IndexAlias[]>,
): IndexAlias[] {
  const merged = new Map<string, boolean>();
  for (const index of indices) {
    for (const { alias, write } of aliases.get(index) ?? []) {
      merged.set(alias, (merged.get(alias) ?? false) || write);
    }
  }
  return [...merged]
    .map(([alias, write]) => ({ alias, write }))
    .sort((left, right) => left.alias.localeCompare(right.alias));
}

/** `2026-10-14 15:30` in local time. */
export function formatTimestamp(milliseconds: number | null | undefined): string {
  if (milliseconds === null || milliseconds === undefined || !Number.isFinite(milliseconds)) {
    return '–';
  }
  const date = new Date(milliseconds);
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

const RELATIVE_UNITS: readonly (readonly [string, number])[] = [
  ['y', 31_536_000_000],
  ['mo', 2_592_000_000],
  ['d', 86_400_000],
  ['h', 3_600_000],
  ['m', 60_000],
];

/** "just now", "5m ago", "3h ago", "2d ago" (or "in 5m" for clock skew). */
export function formatRelative(milliseconds: number | null | undefined, now: number): string {
  if (milliseconds === null || milliseconds === undefined || !Number.isFinite(milliseconds)) {
    return '–';
  }
  const delta = now - milliseconds;
  const distance = Math.abs(delta);
  const unit = RELATIVE_UNITS.find(([, size]) => distance >= size);
  if (!unit) {
    return 'just now';
  }
  const amount = `${Math.floor(distance / unit[1])}${unit[0]}`;
  return delta >= 0 ? `${amount} ago` : `in ${amount}`;
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/**
 * Best-effort human readable reason of a failed request. For Elasticsearch
 * errors the root cause is preferred over generic wrappers such as
 * "failed to create repository"; plain strings and `Error`s work too.
 */
export function errorReason(value: unknown, depth = 0): string | null {
  if (depth > 6 || value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'string') {
    return value.trim() || null;
  }
  if (typeof value !== 'object') {
    return null;
  }
  const record = value as Record<string, unknown>;
  const rootCause = record['root_cause'];
  const candidates: unknown[] = [
    Array.isArray(rootCause) ? rootCause[0] : undefined,
    record['caused_by'],
  ];
  for (const candidate of candidates) {
    const reason = errorReason(candidate, depth + 1);
    if (reason) {
      return reason;
    }
  }
  if (typeof record['reason'] === 'string' && record['reason'].trim()) {
    return record['reason'];
  }
  const nested = errorReason(record['error'], depth + 1) ?? errorReason(record['body'], depth + 1);
  if (nested) {
    return nested;
  }
  return value instanceof Error && value.message ? value.message : null;
}

