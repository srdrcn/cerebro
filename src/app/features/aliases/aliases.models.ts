import { JsonRecord, isRecord } from '../../core/json';
import { INVALID_INDEX_NAME_CHARACTERS, invalidCharacters } from '../../core/names';

/** One alias → index assignment as returned by `aliases/get_aliases`. */
export interface AliasRecord {
  alias: string;
  index: string;
  filter?: unknown;
  index_routing?: string;
  search_routing?: string;
  /**
   * Explicit write index flag. Absent when it is not set: a single index
   * alias then writes to its only index, a multi index alias rejects writes.
   */
  is_write_index?: boolean;
  /** Only `true` is kept: Elasticsearch treats unset and `false` alike. */
  is_hidden?: boolean;
}

/** The backend reports absent properties as `null`. */
export interface RawAliasRecord {
  readonly alias: string;
  readonly index: string;
  readonly filter?: unknown;
  readonly index_routing?: string | number | null;
  readonly search_routing?: string | number | null;
  readonly is_write_index?: boolean | string | null;
  readonly is_hidden?: boolean | string | null;
}

export interface AliasDraft {
  alias: string;
  index: string;
  filterText: string;
  indexRouting: string;
  searchRouting: string;
  /** `undefined` leaves the flag unset. */
  writeIndex?: boolean;
  hidden?: boolean;
}

export type AliasChange =
  | { kind: 'add'; alias: AliasRecord }
  | { kind: 'remove'; alias: AliasRecord };

export type AliasAction =
  | { add: AliasRecord }
  | { remove: { alias: string; index: string } };

export const EMPTY_ALIAS_DRAFT: Readonly<AliasDraft> = {
  alias: '',
  index: '',
  filterText: '',
  indexRouting: '',
  searchRouting: '',
  writeIndex: undefined,
  hidden: false,
};

export function parseAliasFilter(source: string): JsonRecord | undefined {
  if (!source.trim()) {
    return undefined;
  }
  const parsed: unknown = JSON.parse(source);
  if (!isRecord(parsed)) {
    throw new Error('Alias filter must be a JSON object');
  }
  return parsed;
}

function cleanOptional(value: string): string | undefined {
  const cleaned = value.trim();
  return cleaned || undefined;
}

/**
 * Alias names keep their case: unlike index names, Elasticsearch accepts
 * upper case aliases, and lower casing would address a different alias.
 */
export function normalizeAliasName(name: string): string {
  return name.trim();
}

export function buildAliasAdd(draft: AliasDraft): { add: AliasRecord } {
  const alias = normalizeAliasName(draft.alias);
  const index = draft.index.trim().toLowerCase();
  if (!alias) {
    throw new Error('Alias must have a non empty name');
  }
  if (!index) {
    throw new Error('Alias must have a valid index name');
  }

  const add: AliasRecord = {
    alias,
    index,
    filter: parseAliasFilter(draft.filterText),
    index_routing: cleanOptional(draft.indexRouting),
    search_routing: cleanOptional(draft.searchRouting),
  };
  // Elasticsearch replaces the whole assignment on "add": the flags must be
  // sent again or an update would silently reset them.
  if (draft.writeIndex !== undefined) {
    add.is_write_index = draft.writeIndex;
  }
  if (draft.hidden === true) {
    add.is_hidden = true;
  }
  return { add };
}

export function buildAliasActions(changes: readonly AliasChange[]): AliasAction[] {
  return changes.map((change) =>
    change.kind === 'add'
      ? { add: change.alias }
      : { remove: { index: change.alias.index, alias: change.alias.alias } },
  );
}

function optionalString(value: string | number | null | undefined): string | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  const text = String(value);
  return text === '' ? undefined : text;
}

/** `true`/`false` (also as strings); anything else means unset. */
export function parseFlag(value: unknown): boolean | undefined {
  if (value === true || value === 'true') {
    return true;
  }
  if (value === false || value === 'false') {
    return false;
  }
  return undefined;
}

/** Converts the backend's `null` placeholders into absent properties. */
export function normalizeAliasRecords(raw: readonly RawAliasRecord[]): AliasRecord[] {
  if (!Array.isArray(raw)) {
    throw new TypeError('Unexpected aliases response: expected a list of aliases');
  }
  return raw.map((item) => {
    const record: AliasRecord = { alias: item.alias, index: item.index };
    if (item.filter !== null && item.filter !== undefined) {
      record.filter = item.filter;
    }
    const indexRouting = optionalString(item.index_routing);
    if (indexRouting !== undefined) {
      record.index_routing = indexRouting;
    }
    const searchRouting = optionalString(item.search_routing);
    if (searchRouting !== undefined) {
      record.search_routing = searchRouting;
    }
    const writeIndex = parseFlag(item.is_write_index);
    if (writeIndex !== undefined) {
      record.is_write_index = writeIndex;
    }
    if (parseFlag(item.is_hidden) === true) {
      record.is_hidden = true;
    }
    return record;
  });
}

/** Pre-fills the form with an existing (or staged) assignment. */
export function draftFromRecord(record: AliasRecord): AliasDraft {
  return {
    alias: record.alias,
    index: record.index,
    filterText: record.filter === undefined ? '' : JSON.stringify(record.filter, null, 2),
    indexRouting: record.index_routing ?? '',
    searchRouting: record.search_routing ?? '',
    writeIndex: record.is_write_index,
    hidden: record.is_hidden === true,
  };
}

/**
 * The write flag once the "Write index" box is toggled. Unticking restores
 * an explicit `false` the assignment had rather than unsetting it: on a
 * single index alias the two differ (unset means "write here").
 */
export function writeFlagFor(checked: boolean, original: boolean | undefined): boolean | undefined {
  if (checked) {
    return true;
  }
  return original === false ? false : undefined;
}

// --------------------------------------------------------------------------
// Validation
// --------------------------------------------------------------------------

export interface AliasDraftErrors {
  alias?: string;
  index?: string;
  indexRouting?: string;
  filter?: string;
}

/**
 * Mirrors Elasticsearch's alias name rules
 * (MetadataCreateIndexService#validateIndexOrAliasName). Date math names
 * such as `<logs-{now/d}>` are accepted as they are resolved server side.
 */
export function aliasNameError(name: string): string | undefined {
  const value = normalizeAliasName(name);
  if (!value) {
    return 'Enter an alias name.';
  }
  if (value.startsWith('<') && value.endsWith('>') && value.length > 2) {
    return undefined;
  }
  if (value === '.' || value === '..') {
    return 'An alias cannot be named "." or "..".';
  }
  if (/^[_\-+]/.test(value)) {
    return 'An alias cannot start with _, - or +.';
  }
  if (value.includes(' ')) {
    return 'An alias cannot contain spaces.';
  }
  const invalid = invalidCharacters(value, INVALID_INDEX_NAME_CHARACTERS);
  if (invalid.length > 0) {
    return `An alias cannot contain ${invalid.map((character) => `"${character}"`).join(', ')}.`;
  }
  if (new TextEncoder().encode(value).length > 255) {
    return 'An alias name cannot be longer than 255 bytes.';
  }
  return undefined;
}

export function aliasFilterError(source: string): string | undefined {
  try {
    parseAliasFilter(source);
    return undefined;
  } catch (error: unknown) {
    if (error instanceof SyntaxError) {
      return `Invalid JSON: ${error.message}`;
    }
    return error instanceof Error ? `${error.message}.` : 'Invalid filter.';
  }
}

export function validateAliasDraft(
  draft: AliasDraft,
  indices: readonly string[],
): AliasDraftErrors {
  const errors: AliasDraftErrors = {};
  const aliasError = aliasNameError(draft.alias);
  if (aliasError) {
    errors.alias = aliasError;
  } else if (indices.includes(normalizeAliasName(draft.alias))) {
    errors.alias = 'An index with this name already exists.';
  }
  if (!draft.index.trim()) {
    errors.index = 'Select the index the alias points to.';
  }
  if (draft.indexRouting.includes(',')) {
    errors.indexRouting = 'Index routing accepts a single value.';
  }
  const filterError = aliasFilterError(draft.filterText);
  if (filterError) {
    errors.filter = filterError;
  }
  return errors;
}

export function hasDraftErrors(errors: AliasDraftErrors): boolean {
  return Object.values(errors).some((value) => value !== undefined);
}

/**
 * "Required" errors wait for a submit attempt; format errors show as soon as
 * the user leaves a field they typed in.
 */
export function shouldShowFieldError(
  error: string | undefined,
  submitted: boolean,
  touched: boolean,
  value: string,
): boolean {
  if (error === undefined) {
    return false;
  }
  return submitted || (touched && value.trim() !== '');
}
