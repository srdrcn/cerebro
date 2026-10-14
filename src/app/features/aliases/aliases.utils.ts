import { matchesText, plural } from '../../core/format';
import { isRecord } from '../../core/json';
import { AliasChange, AliasRecord } from './aliases.models';

/** `added`: new assignment, `updated`: existing one re-added with new settings. */
export type AliasRowState = 'current' | 'added' | 'updated' | 'removed';
export type PendingKind = 'add' | 'update' | 'remove';
export type AliasSortField = 'alias' | 'index';

export interface AliasRow {
  readonly key: string;
  readonly record: AliasRecord;
  readonly state: AliasRowState;
}

export interface PendingItem {
  readonly key: string;
  readonly kind: PendingKind;
  readonly record: AliasRecord;
  /** Why the change can no longer be applied as staged, if it cannot. */
  readonly problem?: string;
  /** An update that takes the write index flag away from the assignment. */
  readonly writeCleared?: boolean;
}

export interface RoutingTag {
  readonly label: string;
  readonly value: string;
  readonly title: string;
}

export function assignmentKey(record: Pick<AliasRecord, 'alias' | 'index'>): string {
  return `${record.index}\u0000${record.alias}`;
}

function keySet(aliases: readonly AliasRecord[]): Set<string> {
  return new Set(aliases.map(assignmentKey));
}

/**
 * Stages an addition. Any change already staged for the same assignment is
 * replaced: re-adding an assignment whose removal was staged turns it into an
 * update, which Elasticsearch applies by overwriting routing and filter.
 */
export function stageAddition(
  changes: readonly AliasChange[],
  record: AliasRecord,
): AliasChange[] {
  const key = assignmentKey(record);
  return [
    ...changes.filter((change) => assignmentKey(change.alias) !== key),
    { kind: 'add', alias: record },
  ];
}

/**
 * Stages a removal. Removing an assignment that only exists as a staged
 * addition simply drops that addition.
 */
export function stageRemoval(
  changes: readonly AliasChange[],
  record: AliasRecord,
  aliases: readonly AliasRecord[],
): AliasChange[] {
  const key = assignmentKey(record);
  const others = changes.filter((change) => assignmentKey(change.alias) !== key);
  const exists = aliases.some((alias) => assignmentKey(alias) === key);
  return exists ? [...others, { kind: 'remove', alias: record }] : others;
}

export function revertChange(changes: readonly AliasChange[], key: string): AliasChange[] {
  return changes.filter((change) => assignmentKey(change.alias) !== key);
}

export function changeFor(
  changes: readonly AliasChange[],
  key: string,
): AliasChange | undefined {
  return changes.find((change) => assignmentKey(change.alias) === key);
}

/** The table shows the cluster as it will look once the changes apply. */
export function buildAliasRows(
  aliases: readonly AliasRecord[],
  changes: readonly AliasChange[],
): AliasRow[] {
  const staged = new Map(changes.map((change) => [assignmentKey(change.alias), change]));
  const rows: AliasRow[] = aliases.map((record) => {
    const key = assignmentKey(record);
    const change = staged.get(key);
    if (!change) {
      return { key, record, state: 'current' };
    }
    return change.kind === 'remove'
      ? { key, record, state: 'removed' }
      : { key, record: change.alias, state: 'updated' };
  });
  const existing = keySet(aliases);
  for (const change of changes) {
    const key = assignmentKey(change.alias);
    if (change.kind === 'add' && !existing.has(key)) {
      rows.push({ key, record: change.alias, state: 'added' });
    }
  }
  return rows;
}

/** The alias list as Elasticsearch reports it once `changes` are applied. */
export function applyChangesLocally(
  aliases: readonly AliasRecord[],
  changes: readonly AliasChange[],
): AliasRecord[] {
  const staged = new Map(changes.map((change) => [assignmentKey(change.alias), change]));
  const result: AliasRecord[] = [];
  for (const record of aliases) {
    const change = staged.get(assignmentKey(record));
    if (!change) {
      result.push(record);
    } else if (change.kind === 'add') {
      result.push(change.alias);
    }
  }
  const existing = keySet(aliases);
  for (const change of changes) {
    if (change.kind === 'add' && !existing.has(assignmentKey(change.alias))) {
      result.push(change.alias);
    }
  }
  return result;
}

export function filterAliasRows(
  rows: readonly AliasRow[],
  aliasQuery: string,
  indexQuery: string,
): AliasRow[] {
  return rows.filter(
    (row) => matchesText(row.record.alias, aliasQuery) && matchesText(row.record.index, indexQuery),
  );
}

export function sortAliasRows(
  rows: readonly AliasRow[],
  field: AliasSortField,
  reverse: boolean,
): AliasRow[] {
  const secondary: AliasSortField = field === 'alias' ? 'index' : 'alias';
  const direction = reverse ? -1 : 1;
  return [...rows].sort(
    (left, right) =>
      direction * left.record[field].localeCompare(right.record[field]) ||
      left.record[secondary].localeCompare(right.record[secondary]),
  );
}

export function describePendingChanges(
  changes: readonly AliasChange[],
  aliases: readonly AliasRecord[],
  indices: readonly string[] | undefined,
): PendingItem[] {
  const existing = keySet(aliases);
  const currentWriters = new Set(
    aliases.filter((record) => record.is_write_index === true).map(assignmentKey),
  );
  const knownIndices = indices ? new Set(indices) : undefined;
  const writers = writeIndicesByAlias(applyChangesLocally(aliases, changes));
  return changes.map((change) => {
    const key = assignmentKey(change.alias);
    if (change.kind === 'remove') {
      return existing.has(key)
        ? { key, kind: 'remove', record: change.alias }
        : {
            key,
            kind: 'remove',
            record: change.alias,
            problem: 'This assignment no longer exists.',
          };
    }
    const kind: PendingKind = existing.has(key) ? 'update' : 'add';
    const base: PendingItem =
      currentWriters.has(key) && change.alias.is_write_index !== true
        ? { key, kind, record: change.alias, writeCleared: true }
        : { key, kind, record: change.alias };
    if (knownIndices !== undefined && !knownIndices.has(change.alias.index)) {
      return { ...base, problem: 'The index no longer exists.' };
    }
    const competing =
      change.alias.is_write_index === true
        ? (writers.get(change.alias.alias) ?? []).filter((index) => index !== change.alias.index)
        : [];
    return competing.length > 0
      ? {
          ...base,
          problem: `${competing.join(', ')} ${plural(competing.length, 'is', 'are')} also a write index of this alias.`,
        }
      : base;
  });
}

function writeIndicesByAlias(aliases: readonly AliasRecord[]): Map<string, string[]> {
  const writers = new Map<string, string[]>();
  for (const record of aliases) {
    if (record.is_write_index === true) {
      writers.set(record.alias, [...(writers.get(record.alias) ?? []), record.index]);
    }
  }
  return writers;
}

/**
 * The other assignments of `alias` that are write indices once `changes`
 * apply. Elasticsearch accepts one write index per alias, so making `index`
 * the write index has to clear the flag on these.
 */
export function otherWriteIndices(
  aliases: readonly AliasRecord[],
  changes: readonly AliasChange[],
  alias: string,
  index: string,
): AliasRecord[] {
  return applyChangesLocally(aliases, changes).filter(
    (record) => record.alias === alias && record.index !== index && record.is_write_index === true,
  );
}

const SUMMARY_WORDS: Readonly<Record<PendingKind, readonly [string, string]>> = {
  add: ['Add', 'to'],
  update: ['Update', 'on'],
  remove: ['Remove', 'from'],
};

/** One line per change, used by the confirmation dialog. */
export function summarizePendingItem(item: PendingItem): string {
  const [verb, preposition] = SUMMARY_WORDS[item.kind];
  const summary = `${verb} ${item.record.alias} ${preposition} ${item.record.index}`;
  if (item.kind !== 'remove' && item.record.is_write_index === true) {
    return `${summary} (write index)`;
  }
  return item.writeCleared ? `${summary} (no longer the write index)` : summary;
}

export function countByKind(items: readonly PendingItem[]): Readonly<Record<PendingKind, number>> {
  return {
    add: items.filter((item) => item.kind === 'add').length,
    update: items.filter((item) => item.kind === 'update').length,
    remove: items.filter((item) => item.kind === 'remove').length,
  };
}

/** Collapses identical index/search routing into a single tag. */
export function routingTags(record: AliasRecord): RoutingTag[] {
  const indexRouting = record.index_routing;
  const searchRouting = record.search_routing;
  if (indexRouting !== undefined && indexRouting === searchRouting) {
    return [{ label: 'routing', value: indexRouting, title: `Index and search routing: ${indexRouting}` }];
  }
  const tags: RoutingTag[] = [];
  if (indexRouting !== undefined) {
    tags.push({ label: 'index', value: indexRouting, title: `Index routing: ${indexRouting}` });
  }
  if (searchRouting !== undefined) {
    tags.push({ label: 'search', value: searchRouting, title: `Search routing: ${searchRouting}` });
  }
  return tags;
}

/** Short label for a filter: its top level query type ("range", "bool"). */
export function filterLabel(filter: unknown): string {
  if (!isRecord(filter)) {
    return 'filter';
  }
  const keys = Object.keys(filter);
  if (keys.length === 1) {
    return keys[0] ?? 'filter';
  }
  return keys.length === 0 ? 'empty' : `${keys.length} clauses`;
}

export function prettyJson(value: unknown): string {
  return JSON.stringify(value, null, 2) ?? '';
}

/** Regular indices first, hidden/system (dot-prefixed) ones last. */
export function sortIndexOptions(indices: readonly string[]): string[] {
  const unique = [...new Set(indices)];
  const regular = unique.filter((name) => !name.startsWith('.')).sort((a, b) => a.localeCompare(b));
  const special = unique.filter((name) => name.startsWith('.')).sort((a, b) => a.localeCompare(b));
  return [...regular, ...special];
}

export function aliasNames(aliases: readonly AliasRecord[]): string[] {
  return [...new Set(aliases.map((alias) => alias.alias))].sort((a, b) => a.localeCompare(b));
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonical);
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonical(nested)]),
    );
  }
  return value;
}

/** True when both assignments carry the same routing, filter and flags. */
export function sameSettings(left: AliasRecord, right: AliasRecord): boolean {
  return (
    left.index_routing === right.index_routing &&
    left.search_routing === right.search_routing &&
    left.is_write_index === right.is_write_index &&
    (left.is_hidden === true) === (right.is_hidden === true) &&
    JSON.stringify(canonical(left.filter)) === JSON.stringify(canonical(right.filter))
  );
}

/** How staging the form relates to what exists or is already staged. */
export type DraftStatus = 'new' | 'update' | 'same' | 'restage';

/**
 * `restage`: a change is staged for this assignment and staging replaces it;
 * `same`: it exists with exactly these settings; `update`: it exists with
 * other settings; `new`: it does not exist. Names compare case sensitively.
 */
export function draftStatusFor(
  alias: string,
  index: string,
  record: AliasRecord | undefined,
  aliases: readonly AliasRecord[],
  changes: readonly AliasChange[],
): DraftStatus {
  if (!alias || !index) {
    return 'new';
  }
  const key = assignmentKey({ alias, index });
  if (changeFor(changes, key)) {
    return 'restage';
  }
  const existing = aliases.find((candidate) => assignmentKey(candidate) === key);
  if (!existing) {
    return 'new';
  }
  return record && sameSettings(existing, record) ? 'same' : 'update';
}
