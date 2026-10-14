import { JsonRecord, isRecord } from '../../core/json';
import { INVALID_INDEX_NAME_CHARACTERS, invalidCharacters } from '../../core/names';

export interface IndexMetadata {
  settings?: unknown;
  mappings?: unknown;
}

function asObject(value: unknown): JsonRecord {
  if (!isRecord(value)) {
    throw new Error('Index settings must be a JSON object');
  }
  return value;
}

/**
 * Builds the body of `PUT /<index>`. A non-empty custom JSON body is sent as
 * is and wins over the shard and replica fields; otherwise those fields are
 * used (blank fields are left to the cluster defaults).
 */
export function buildIndexMetadata(
  source: string,
  shards: string,
  replicas: string,
): Record<string, unknown> {
  const parsed = source.trim() ? asObject(JSON.parse(source)) : {};
  if (Object.keys(parsed).length > 0) {
    return parsed;
  }

  const indexSettings: Record<string, unknown> = {};
  if (shards.trim()) indexSettings['number_of_shards'] = shards.trim();
  if (replicas.trim()) indexSettings['number_of_replicas'] = replicas.trim();
  return { settings: { index: indexSettings } };
}

/* ------------------------------------------------------------------ */
/* Custom JSON body                                                    */
/* ------------------------------------------------------------------ */

export type BodyState =
  | { readonly kind: 'empty' }
  | { readonly kind: 'invalid'; readonly message: string }
  | { readonly kind: 'object'; readonly value: JsonRecord; readonly keys: number };

/** Classifies the custom JSON editor content without throwing. */
export function analyzeBody(source: string): BodyState {
  if (!source.trim()) {
    return { kind: 'empty' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch (error: unknown) {
    return { kind: 'invalid', message: error instanceof Error ? error.message : String(error) };
  }
  if (!isRecord(parsed)) {
    return { kind: 'invalid', message: 'The body must be a JSON object' };
  }
  return { kind: 'object', value: parsed, keys: Object.keys(parsed).length };
}

/** True when the custom JSON body replaces the shard and replica fields. */
export function bodyOverridesFields(state: BodyState): boolean {
  return state.kind === 'object' && state.keys > 0;
}

function readSetting(settings: unknown, name: string): string | null {
  if (!isRecord(settings)) {
    return null;
  }
  const index = settings['index'];
  const candidates = [
    isRecord(index) ? index[name] : undefined,
    settings[`index.${name}`],
    settings[name],
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' || typeof candidate === 'number') {
      return String(candidate);
    }
  }
  return null;
}

export interface ShardLayout {
  readonly shards: string | null;
  readonly replicas: string | null;
}

/** Shard and replica counts declared by a request body (nested or flat settings). */
export function shardLayout(metadata: JsonRecord): ShardLayout {
  const settings = metadata['settings'];
  return {
    shards: readSetting(settings, 'number_of_shards'),
    replicas: readSetting(settings, 'number_of_replicas'),
  };
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

export interface NameCheck {
  readonly error: string | null;
  readonly warning: string | null;
}

const MAX_INDEX_NAME_BYTES = 255;

function utf8Length(value: string): number {
  return new TextEncoder().encode(value).length;
}

/**
 * Mirrors the index name rules enforced by Elasticsearch. `existing` and
 * `aliases` are the index and alias names already used on the cluster.
 */
export function validateIndexName(
  name: string,
  existing: readonly string[] = [],
  aliases: readonly string[] = [],
): NameCheck {
  const ok = (warning: string | null = null): NameCheck => ({ error: null, warning });
  const fail = (error: string): NameCheck => ({ error, warning: null });

  if (!name) {
    return fail('Enter a name for the index');
  }
  if (name !== name.toLowerCase()) {
    return fail('Index names must be lowercase');
  }
  if (/\s/.test(name)) {
    return fail('Index names cannot contain spaces');
  }
  if (name === '.' || name === '..') {
    return fail('Index names cannot be "." or ".."');
  }
  const first = name.charAt(0);
  if (first === '-' || first === '_' || first === '+') {
    return fail(`Index names cannot start with "${first}"`);
  }
  const invalid = invalidCharacters(name, INVALID_INDEX_NAME_CHARACTERS);
  if (invalid.length > 0) {
    const list = invalid.map((character) => `"${character}"`).join(', ');
    return fail(`Index names cannot contain ${list}`);
  }
  const bytes = utf8Length(name);
  if (bytes > MAX_INDEX_NAME_BYTES) {
    return fail(`Index names are limited to ${MAX_INDEX_NAME_BYTES} bytes (this one has ${bytes})`);
  }
  if (existing.includes(name)) {
    return fail(`An index named "${name}" already exists`);
  }
  if (aliases.includes(name)) {
    return fail(`An alias named "${name}" already exists`);
  }
  if (first === '.') {
    return ok('Names starting with "." are reserved for hidden and system indices');
  }
  return ok();
}

export const MAX_SHARDS = 1024;

/** Validates an optional whole number field ("" means "use the default"). */
export function validateCount(value: string, minimum: number, maximum?: number): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (!/^\d+$/.test(trimmed)) {
    return 'Use a whole number';
  }
  const amount = Number(trimmed);
  if (amount < minimum) {
    return `Must be at least ${minimum}`;
  }
  if (maximum !== undefined && amount > maximum) {
    return `Must be at most ${maximum}`;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Copying settings and mappings from an existing index                */
/* ------------------------------------------------------------------ */

/**
 * Settings Elasticsearch generates for an index and refuses on creation
 * (paths relative to `index.`).
 */
const PRIVATE_INDEX_SETTINGS: readonly string[] = [
  'uuid',
  'creation_date',
  'creation_date_string',
  'provided_name',
  'version',
  'resize',
  'shrink',
  'routing.allocation.initial_recovery',
  'verified_before_close',
  'history.uuid',
];

export interface ClonedMetadata {
  readonly metadata: Record<string, unknown>;
  /** Fully qualified names of the internal settings that were dropped. */
  readonly removedSettings: readonly string[];
  /** Mapping type that was unwrapped (`_doc` on 7.x+ indices), if any. */
  readonly unwrappedType: string | null;
}

function deepCopy<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

function removePath(target: JsonRecord, path: readonly string[]): boolean {
  const [head, ...rest] = path;
  if (head === undefined || !(head in target)) {
    return false;
  }
  if (rest.length === 0) {
    delete target[head];
    return true;
  }
  const child = target[head];
  if (!isRecord(child)) {
    return false;
  }
  const removed = removePath(child, rest);
  if (removed && Object.keys(child).length === 0) {
    delete target[head];
  }
  return removed;
}

function stripPrivateSettings(settings: unknown): { settings: unknown; removed: string[] } {
  if (!isRecord(settings)) {
    return { settings: settings ?? {}, removed: [] };
  }
  const copy = deepCopy(settings);
  const removed: string[] = [];
  for (const setting of PRIVATE_INDEX_SETTINGS) {
    const index = copy['index'];
    if (isRecord(index) && removePath(index, setting.split('.'))) {
      removed.push(`index.${setting}`);
    }
    if (isRecord(index) && Object.keys(index).length === 0) {
      delete copy['index'];
    }
    const flat = `index.${setting}`;
    for (const key of Object.keys(copy)) {
      if (key === flat || key.startsWith(`${flat}.`)) {
        delete copy[key];
        if (!removed.includes(flat)) {
          removed.push(flat);
        }
      }
    }
  }
  return { settings: copy, removed };
}

/** Elasticsearch index version id, e.g. "8512000" or "7170099". */
function createdVersion(settings: unknown): number | null {
  if (!isRecord(settings)) {
    return null;
  }
  const index = settings['index'];
  const version = isRecord(index) ? index['version'] : undefined;
  const created =
    (isRecord(version) ? version['created'] : undefined) ?? settings['index.version.created'];
  const value = typeof created === 'string' || typeof created === 'number' ? Number(created) : NaN;
  return Number.isFinite(value) ? value : null;
}

/**
 * Cluster state reports mappings of 7.x+ indices wrapped in the `_doc` type,
 * which Elasticsearch rejects on creation. Indices created before 7.0 keep
 * their type (it is required there).
 */
function unwrapMappings(mappings: unknown, version: number | null): { mappings: unknown; type: string | null } {
  if (!isRecord(mappings)) {
    return { mappings: mappings ?? {}, type: null };
  }
  const keys = Object.keys(mappings);
  const inner = mappings['_doc'];
  const typed = version !== null && version < 7_000_000;
  if (!typed && keys.length === 1 && keys[0] === '_doc' && isRecord(inner)) {
    return { mappings: deepCopy(inner), type: '_doc' };
  }
  return { mappings: deepCopy(mappings), type: null };
}

/** Settings and mappings of an existing index, ready to be sent on creation. */
export function cloneIndexMetadata(source: IndexMetadata): ClonedMetadata {
  const version = createdVersion(source.settings);
  const { settings, removed } = stripPrivateSettings(source.settings);
  const { mappings, type } = unwrapMappings(source.mappings, version);
  return {
    metadata: { settings, mappings },
    removedSettings: removed,
    unwrappedType: type,
  };
}

/** A small, valid starting point for the custom JSON body. */
export const EXAMPLE_INDEX_BODY = JSON.stringify(
  {
    settings: {
      index: {
        number_of_shards: 1,
        number_of_replicas: 1,
        refresh_interval: '1s',
      },
    },
    mappings: {
      properties: {
        '@timestamp': { type: 'date' },
        message: { type: 'text' },
      },
    },
  },
  null,
  2,
);

/** Sorts index names, regular indices first and dot-prefixed ones last. */
export function sortIndexNames(names: readonly string[]): { regular: string[]; special: string[] } {
  const sorted = [...new Set(names)].sort((left, right) => left.localeCompare(right));
  return {
    regular: sorted.filter((name) => !name.startsWith('.')),
    special: sorted.filter((name) => name.startsWith('.')),
  };
}

/** Alias names reported by `_cat/aliases` (one row per alias and index). */
export function aliasNames(rows: unknown): string[] {
  if (!Array.isArray(rows)) {
    return [];
  }
  const names = rows
    .map((row: unknown) => (isRecord(row) ? row['alias'] : undefined))
    .filter((alias): alias is string => typeof alias === 'string' && alias !== '');
  return [...new Set(names)];
}
