import { elasticsearchReason } from '../../core/errors';
import { formatBytes, formatNumber, humanize, pluralize, sentence } from '../../core/format';
import { healthTone } from '../../core/health';
import { isRecord } from '../../core/json';
import { INVALID_INDEX_NAME_CHARACTERS, invalidCharacters } from '../../core/names';
import {
  CatShardRow,
  Check,
  CheckSummary,
  Colocation,
  Compatibility,
  ConditionResult,
  DataStreamsResponse,
  DiskLevel,
  DiskWatermarks,
  FailureGroup,
  HealthColor,
  IndexDetailResponse,
  JsonObject,
  LookupIndexRow,
  NodeOption,
  OperationInfo,
  OperationKind,
  PlannedRequest,
  RawAliasRow,
  RawListedTask,
  RawNode,
  ReindexFailure,
  ReindexOptions,
  ReindexProgress,
  RequestPreview,
  SlicesMode,
  ResizeKind,
  ResizeOptions,
  RolloverConditionKey,
  RolloverConditionsInput,
  RolloverPreview,
  RolloverResponse,
  RolloverTarget,
  RoutingShards,
  ShardCopy,
  ShardState,
  SourceIndex,
  TargetRecovery,
  TaskGetResponse,
  TaskOutcome,
  Watermark,
  WizardChanges,
  WriteIndexFacts,
} from './index-ops.models';

/* ---- Operations ------------------------------------------------------------------ */

export const OPERATIONS: Readonly<Record<OperationKind, OperationInfo>> = {
  shrink: {
    kind: 'shrink',
    label: 'Shrink',
    icon: 'bi-arrows-angle-contract',
    summary: 'Copies an index into a new index with fewer primary shards.',
    whenToUse: 'An index that no longer receives writes was created with more shards than it needs (an old daily index, a bulk load).',
    requirements: [
      'Writes blocked on the source',
      'A copy of every shard on one node, with room for the result',
      'Green health',
      'A shard count that divides the source’s',
    ],
    sourceLabel: 'Source index',
    runLabel: 'Shrink index',
  },
  split: {
    kind: 'split',
    label: 'Split',
    icon: 'bi-arrows-angle-expand',
    summary: 'Copies an index into a new index with more primary shards.',
    whenToUse: 'Shards have grown too large or too busy and the index needs to spread over more nodes.',
    requirements: [
      'Writes blocked on the source',
      'Green health',
      'A multiple of the source’s shard count that its routing shards allow',
    ],
    sourceLabel: 'Source index',
    runLabel: 'Split index',
  },
  clone: {
    kind: 'clone',
    label: 'Clone',
    icon: 'bi-copy',
    summary: 'Copies an index into a new index with the same shards, mappings and data.',
    whenToUse: 'You need a point-in-time copy to experiment with, or a renamed copy of an index.',
    requirements: ['Writes blocked on the source', 'Green health'],
    sourceLabel: 'Source index',
    runLabel: 'Clone index',
  },
  rollover: {
    kind: 'rollover',
    label: 'Roll over',
    icon: 'bi-skip-forward',
    summary: 'Creates a new write index for an alias or a data stream, now or once conditions are met.',
    whenToUse: 'The current write index is old or large enough and new documents should go to a fresh index.',
    requirements: [
      'An alias with a write index, or a data stream',
      'For aliases, an index name ending in a number, or a new name',
    ],
    sourceLabel: 'Alias or data stream',
    runLabel: 'Roll over',
  },
  reindex: {
    kind: 'reindex',
    label: 'Reindex',
    icon: 'bi-arrow-left-right',
    summary: 'Copies documents from one or more indices into another index, optionally filtered or transformed.',
    whenToUse: 'Mappings or analysis must change, indices should be merged, or documents need a script applied.',
    requirements: [
      'Open source indices',
      'A destination, ideally created first with the right mappings',
    ],
    sourceLabel: 'Source indices',
    runLabel: 'Start reindex',
  },
};

/** Lucene's limit of documents in one shard (`IndexWriter.MAX_DOCS`). */
export const MAX_DOCS_PER_SHARD = 2_147_483_519;
/** Elasticsearch's limit of primary shards per index. */
export const MAX_SHARDS_PER_INDEX = 1024;
/** Elasticsearch's limit of index name length in bytes. */
export const MAX_INDEX_NAME_BYTES = 255;

/* ---- Settings and numbers ---------------------------------------------------------- */

/**
 * A setting from nested (`{ index: { blocks: { write: "true" } } }`), flat
 * (`{ "index.blocks.write": "true" }`) or mixed settings. `null` stands for
 * a setting that is not set (Elasticsearch keeps an explicit `null` after a
 * resize cleared it).
 */
export function settingValue(settings: unknown, key: string): unknown {
  if (!isRecord(settings)) {
    return undefined;
  }
  if (key in settings) {
    return settings[key];
  }
  const parts = key.split('.');
  for (let length = parts.length - 1; length > 0; length--) {
    const head = parts.slice(0, length).join('.');
    if (isRecord(settings[head])) {
      const value = settingValue(settings[head], parts.slice(length).join('.'));
      if (value !== undefined) {
        return value;
      }
    }
  }
  return undefined;
}

function settingString(settings: unknown, key: string): string | null {
  const value = settingValue(settings, key);
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? String(value) : null;
}

function settingTrue(settings: unknown, key: string): boolean {
  const value = settingValue(settings, key);
  return value === true || value === 'true';
}

/** A finite number from a number or a numeric string, else `null`. */
export function toNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }
  return null;
}

function pathNumber(source: unknown, path: string): number | null {
  let current: unknown = source;
  for (const part of path.split('.')) {
    if (!isRecord(current)) {
      return null;
    }
    current = current[part];
  }
  return toNumber(current);
}

/** Positive integer typed in a field, `null` when blank or invalid. */
export function parseCount(value: string): number | null {
  const text = value.trim();
  return /^\d+$/.test(text) && Number(text) > 0 ? Number(text) : null;
}

/* ---- Shards -------------------------------------------------------------------------- */

function shardState(state: string): ShardState {
  switch (state.toUpperCase()) {
    case 'STARTED':
      return 'started';
    case 'RELOCATING':
      return 'relocating';
    case 'INITIALIZING':
      return 'initializing';
    case 'UNASSIGNED':
      return 'unassigned';
    default:
      return 'unknown';
  }
}

/**
 * `_cat/shards` rows as shard copies. A relocating copy reads
 * `es-node-2 -> 127.0.0.1 nodeId es-node-1`: it stays on es-node-2 and moves
 * to es-node-1.
 */
export function shardCopies(rows: readonly CatShardRow[] | null | undefined): ShardCopy[] {
  return (rows ?? []).map((row) => {
    let node = row.node?.trim() || null;
    let relocatingTo: string | null = null;
    if (node && node.includes('->')) {
      const [from, to] = node.split('->');
      node = from?.trim() || null;
      relocatingTo = to?.trim().split(/\s+/).pop() ?? null;
    }
    return {
      shard: Number(row.shard),
      primary: row.prirep === 'p' || row.prirep === 'primary',
      state: shardState(row.state ?? ''),
      node,
      relocatingTo,
      docs: toNumber(row.docs),
      size: toNumber(row.store),
    };
  });
}

function healthFromCopies(copies: readonly ShardCopy[]): HealthColor {
  if (copies.length === 0) {
    return 'gray';
  }
  if (copies.some((copy) => copy.primary && (copy.state === 'unassigned' || copy.state === 'initializing'))) {
    return 'red';
  }
  return copies.some((copy) => copy.state === 'unassigned' || copy.state === 'initializing') ? 'yellow' : 'green';
}

/* ---- Routing shards ------------------------------------------------------------------ */

/** `index.version.created` of 7.0.0. */
const VERSION_7_0_0 = 7_000_099;

/**
 * Elasticsearch's default `index.number_of_routing_shards` for an index
 * created in 7.0 or later: the largest `shards × 2^n` up to 1024, with at
 * least one split (`MetadataCreateIndexService.calculateNumRoutingShards`).
 */
export function defaultRoutingShards(primaries: number): number {
  const log2 = 32 - Math.clz32(Math.max(1, primaries) - 1);
  const splits = Math.max(1, 10 - log2);
  return primaries * 2 ** splits;
}

/**
 * The routing shards of an index. `metadata` is `index.routing_num_shards`
 * from the cluster state, which is exact. Without it, the index settings only
 * carry the value when it was set explicitly; otherwise it is estimated as
 * Elasticsearch's default for the shard count (an index resized from another
 * index inherits the routing shards of its source, which the settings do not
 * show).
 */
export function routingShardsOf(settings: unknown, primaries: number | null, metadata: number | null = null): RoutingShards | null {
  if (primaries === null || primaries < 1) {
    return null;
  }
  const explicit = toNumber(settingValue(settings, 'index.number_of_routing_shards'));
  if (primaries === 1) {
    // Elasticsearch splits a one-shard index into any count, whatever its routing shards.
    return { value: metadata ?? explicit ?? defaultRoutingShards(1), origin: 'single-shard' };
  }
  if (explicit !== null && explicit > 0 && (metadata === null || metadata === explicit)) {
    return { value: explicit, origin: 'setting' };
  }
  if (metadata !== null && metadata > 0) {
    return { value: metadata, origin: 'metadata' };
  }
  if (settingString(settings, 'index.resize.source.name')) {
    // A resized index keeps the routing shards of its source, which its settings do not show.
    return { value: defaultRoutingShards(primaries), origin: 'resized' };
  }
  const version = toNumber(settingValue(settings, 'index.version.created'));
  if (version !== null && version < VERSION_7_0_0) {
    return { value: primaries, origin: 'default' };
  }
  return { value: defaultRoutingShards(primaries), origin: 'default' };
}

/** The routing shards as an exact, positive whole number of shards, else `null`. */
function routingNumShards(value: unknown): number | null {
  const number = toNumber(value);
  return number !== null && Number.isInteger(number) && number > 0 ? number : null;
}

/* ---- Index details ------------------------------------------------------------------- */

/** Block settings that refuse writes. */
const BLOCK_KEYS = ['index.blocks.write', 'index.blocks.read_only', 'index.blocks.read_only_allow_delete'] as const;

/** A comma separated list of tiers (`data_warm,data_hot`), blanks left out. */
function tierList(value: string | null): string[] {
  return (value ?? '').split(',').map((tier) => tier.trim()).filter(Boolean);
}

/** Settings as flat `key: value` strings (nested, flat or mixed input; nulls left out). */
export function flattenSettings(settings: unknown, prefix = ''): Record<string, string> {
  const flat: Record<string, string> = {};
  if (!isRecord(settings)) {
    return flat;
  }
  for (const [key, value] of Object.entries(settings)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (isRecord(value)) {
      Object.assign(flat, flattenSettings(value, path));
    } else if (Array.isArray(value)) {
      flat[path] = value.map(String).join(',');
    } else if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      flat[path] = String(value);
    }
  }
  return flat;
}

const ALLOCATION_PREFIX = 'index.routing.allocation.';

/**
 * The allocation settings of an index that decide where its shards may go,
 * except `require._name` (the wizard's own) and `_tier_preference` (set on
 * nearly every index): require, include and exclude filters and
 * `total_shards_per_node`.
 */
export function allocationSettings(settings: unknown): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(flattenSettings(settings))) {
    if (!key.startsWith(ALLOCATION_PREFIX) || !value) {
      continue;
    }
    const rest = key.slice(ALLOCATION_PREFIX.length);
    const filter = /^(require|include|exclude)\./.test(rest);
    if (
      (filter && rest !== 'require._name' && rest !== 'include._tier_preference') ||
      (rest === 'total_shards_per_node' && value !== '-1')
    ) {
      result[key] = value;
    }
  }
  return result;
}

/** Data stream membership of backing indices, from the `data_streams` endpoint. */
export interface DataStreamMembership {
  readonly dataStream: string;
  readonly writeIndex: boolean;
}

export function dataStreamMembership(response: DataStreamsResponse | null | undefined): Map<string, DataStreamMembership> {
  const map = new Map<string, DataStreamMembership>();
  for (const stream of response?.data_streams ?? []) {
    const indices = stream.indices ?? [];
    indices.forEach((entry, position) => {
      map.set(entry.index_name, { dataStream: stream.name, writeIndex: position === indices.length - 1 });
    });
  }
  return map;
}

/** Concrete indices of an `index_detail` response, sorted by name. */
export function parseIndices(
  response: IndexDetailResponse | null | undefined,
  membership: ReadonlyMap<string, DataStreamMembership> = new Map(),
): SourceIndex[] {
  if (!response || !isRecord(response.settings)) {
    return [];
  }
  const names = Object.keys(response.settings).sort((left, right) => left.localeCompare(right));
  // The cluster state value belongs to the name that was asked for: an alias gets none.
  const routing = names.length === 1 ? routingNumShards(response.routing_num_shards) : null;
  return names.map((name) => parseIndex(response, name, membership.get(name) ?? null, routing));
}

function parseIndex(
  response: IndexDetailResponse,
  name: string,
  member: DataStreamMembership | null,
  routing: number | null = null,
): SourceIndex {
  const settings = response.settings[name]?.settings ?? {};
  const stats = response.stats?.indices?.[name] ?? null;
  const copies = shardCopies(response.shards?.filter((row) => row.index === name) ?? null);
  const primaries = toNumber(settingValue(settings, 'index.number_of_shards'));
  const replicas = toNumber(settingValue(settings, 'index.number_of_replicas'));
  const aliasEntries = Object.entries(response.aliases?.[name]?.aliases ?? {});
  const blockSettings = BLOCK_KEYS.filter((key) => settingTrue(settings, key));
  const status = stats?.status;
  const open =
    status === 'open' ? true : status === 'close' || settingTrue(settings, 'index.verified_before_close') ? false : stats ? true : null;
  const reported = healthTone(stats?.health);
  const primaryCopies = copies.filter((copy) => copy.primary && copy.docs !== null);
  const sum = (values: readonly (number | null)[]): number | null =>
    values.length === 0 ? null : values.reduce<number>((total, value) => total + (value ?? 0), 0);
  const created = toNumber(settingValue(settings, 'index.creation_date'));
  return {
    name,
    primaries,
    replicas,
    docs: pathNumber(stats?.primaries, 'docs.count') ?? sum(primaryCopies.map((copy) => copy.docs)),
    deletedDocs: pathNumber(stats?.primaries, 'docs.deleted'),
    primarySize: pathNumber(stats?.primaries, 'store.size_in_bytes') ?? sum(primaryCopies.map((copy) => copy.size)),
    totalSize: pathNumber(stats?.total, 'store.size_in_bytes') ?? sum(copies.filter((copy) => copy.size !== null).map((copy) => copy.size)),
    // Closed indices have no statistics; their copies (replicated since 7.2) still tell the health.
    health: reported !== 'gray' ? reported : healthFromCopies(copies),
    open,
    writeBlock: settingTrue(settings, 'index.blocks.write'),
    writeBlocked: blockSettings.length > 0,
    blockSettings,
    requiredNode: settingString(settings, 'index.routing.allocation.require._name') || null,
    tierPreference: tierList(settingString(settings, 'index.routing.allocation.include._tier_preference')),
    routingShards: routingShardsOf(settings, primaries, routing),
    codec: settingString(settings, 'index.codec'),
    aliases: aliasEntries.map(([alias]) => alias).sort((left, right) => left.localeCompare(right)),
    writeAliases: aliasEntries
      .filter(([, value]) => isRecord(value) && value['is_write_index'] === true)
      .map(([alias]) => alias)
      .sort((left, right) => left.localeCompare(right)),
    dataStream: member?.dataStream ?? null,
    dataStreamWriteIndex: member?.writeIndex ?? false,
    createdAt: created !== null && created > 0 ? created : null,
    shards: copies,
    shardsKnown: response.shards !== null && response.shards !== undefined,
    hidden: settingTrue(settings, 'index.hidden'),
    lifecyclePolicy: settingString(settings, 'index.lifecycle.name') || null,
    allocation: allocationSettings(settings),
    versionCreated: toNumber(settingValue(settings, 'index.version.created')),
    resizedFrom: settingString(settings, 'index.resize.source.name') || null,
  };
}

/** A source with nothing known but its name (a run restored from the URL). */
export function blankSource(name: string): SourceIndex {
  return {
    name,
    primaries: null,
    replicas: null,
    docs: null,
    deletedDocs: null,
    primarySize: null,
    totalSize: null,
    health: 'gray',
    open: null,
    writeBlock: false,
    writeBlocked: false,
    blockSettings: [],
    requiredNode: null,
    tierPreference: [],
    routingShards: null,
    codec: null,
    aliases: [],
    writeAliases: [],
    dataStream: null,
    dataStreamWriteIndex: false,
    createdAt: null,
    shards: [],
    shardsKnown: false,
    hidden: false,
    lifecyclePolicy: null,
    allocation: {},
    versionCreated: null,
    resizedFrom: null,
  };
}

/** "1.2mb", "498b", "150GB" in bytes; `null` for anything else ("-1", ""). */
export function parseByteSize(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0 ? value : null;
  }
  if (typeof value !== 'string') {
    return null;
  }
  const match = /^\s*(\d+(?:\.\d+)?)\s*(b|kb|mb|gb|tb|pb)?\s*$/i.exec(value);
  if (!match) {
    return null;
  }
  const units = ['b', 'kb', 'mb', 'gb', 'tb', 'pb'];
  const power = units.indexOf((match[2] ?? 'b').toLowerCase());
  return Math.round(Number(match[1]) * 1024 ** power);
}

/**
 * Indices of a `commons/indices/lookup` answer (`_cat/indices` of open and
 * closed indices, sizes in bytes): enough for the reindex sources and the
 * destination (state, health, documents and sizes) without reading mappings.
 */
export function parseLookupRows(
  rows: readonly LookupIndexRow[] | null | undefined,
  membership: ReadonlyMap<string, DataStreamMembership> = new Map(),
): SourceIndex[] {
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => typeof row?.index === 'string')
    .map((row) => {
      const member = membership.get(row.index) ?? null;
      const open = row.status === 'open' ? true : row.status === 'close' ? false : null;
      return {
        ...blankSource(row.index),
        primaries: toNumber(row.pri),
        replicas: toNumber(row.rep),
        docs: toNumber(row['docs.count']),
        primarySize: toNumber(row['pri.store.size']),
        totalSize: toNumber(row['store.size']),
        health: healthTone(row.health ?? undefined),
        open,
        dataStream: member?.dataStream ?? null,
        dataStreamWriteIndex: member?.writeIndex ?? false,
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

/** The indices a reindex reads, and the closed ones a pattern matched that it skips. */
export interface ReadableSources {
  readonly read: SourceIndex[];
  readonly skipped: SourceIndex[];
}

/**
 * Splits the lookup of the sources. The lookup lists closed indices too, a
 * search does not: a closed index that only a pattern reached is skipped,
 * one that is named (directly, through an alias or its data stream) makes
 * Elasticsearch refuse the reindex, so it stays to be reported.
 */
export function readableSources(
  indices: readonly SourceIndex[],
  expressions: readonly string[],
  aliasRows: readonly RawAliasRow[] = [],
): ReadableSources {
  const named = new Set(expressions);
  const viaAlias = new Set(aliasRows.filter((row) => named.has(row.alias)).map((row) => row.index));
  const read: SourceIndex[] = [];
  const skipped: SourceIndex[] = [];
  for (const index of indices) {
    const explicit = named.has(index.name) || viaAlias.has(index.name) || (index.dataStream !== null && named.has(index.dataStream));
    (index.open === false && !explicit ? skipped : read).push(index);
  }
  return { read, skipped };
}

/** Index blocks from the settings of `commons/get_index_settings` (by index name). */
export function withBlocks(indices: readonly SourceIndex[], settings: unknown): SourceIndex[] {
  return indices.map((index) => {
    const entry = isRecord(settings) ? settings[index.name] : undefined;
    const own = isRecord(entry) ? entry['settings'] : undefined;
    if (!isRecord(own)) {
      return index;
    }
    const blockSettings = BLOCK_KEYS.filter((key) => settingTrue(own, key));
    return { ...index, writeBlock: settingTrue(own, 'index.blocks.write'), writeBlocked: blockSettings.length > 0, blockSettings };
  });
}

/**
 * `_cat/shards` rows of the `cat` endpoint (human sizes) as the rows
 * `index_detail` returns, for the light polls of the source and the target.
 */
export function catShardRows(rows: readonly Record<string, unknown>[] | null | undefined): CatShardRow[] {
  const text = (value: unknown): string | null => (typeof value === 'string' || typeof value === 'number' ? String(value) : null);
  return (Array.isArray(rows) ? rows : []).filter(isRecord).map((row) => {
    const store = parseByteSize(row['store']);
    return {
      index: text(row['index']) ?? '',
      shard: text(row['shard']) ?? '',
      prirep: text(row['prirep']) ?? '',
      state: text(row['state']) ?? '',
      docs: text(row['docs']),
      store: store === null ? null : String(store),
      node: text(row['node']),
    };
  });
}

/**
 * The source after a light poll: its shard copies and settings are fresh,
 * sizes the poll does not carry keep the values of the full load.
 */
export function refreshSource(previous: SourceIndex, rows: readonly CatShardRow[], settings: unknown): SourceIndex {
  const response: IndexDetailResponse = {
    settings: { [previous.name]: { settings: isRecord(settings) ? settings : {} } },
    stats: null,
    aliases: null,
    shards: rows,
  };
  const fresh = parseIndex(response, previous.name, null);
  return {
    ...previous,
    shards: fresh.shards,
    shardsKnown: true,
    health: fresh.health,
    writeBlock: fresh.writeBlock,
    writeBlocked: fresh.writeBlocked,
    blockSettings: fresh.blockSettings,
    requiredNode: fresh.requiredNode,
    tierPreference: fresh.tierPreference,
    allocation: fresh.allocation,
  };
}

/* ---- Nodes ----------------------------------------------------------------------------- */

/** Distinct shard numbers with a started copy on `node`. */
function shardsOn(copies: readonly ShardCopy[], node: string): Set<number> {
  return new Set(copies.filter((copy) => copy.state === 'started' && copy.node === node).map((copy) => copy.shard));
}

/* ---- Disk watermarks ---------------------------------------------------------------------- */

const DISK_PREFIX = 'cluster.routing.allocation.disk.';

/** A watermark value: "85%", "0.85" (a share of the disk used) or "500mb" (free space). */
export function parseWatermark(value: string | null | undefined, headroom: number | null = null): Watermark | null {
  const text = (value ?? '').trim();
  if (!text) {
    return null;
  }
  const percent = /^(\d+(?:\.\d+)?)%$/.exec(text);
  if (percent) {
    return { kind: 'ratio', used: Number(percent[1]) / 100, headroom, text };
  }
  if (/^\d+(\.\d+)?$/.test(text)) {
    const number = Number(text);
    return number <= 1 ? { kind: 'ratio', used: number, headroom, text: `${formatNumber(number * 100)}%` } : null;
  }
  const bytes = parseByteSize(text);
  return bytes === null ? null : { kind: 'bytes', free: bytes, text };
}

/**
 * The disk watermarks from `cluster_settings` (flat, with defaults). Explicit
 * settings win over defaults, transient over persistent. A `max_headroom`
 * caps the free space a percentage asks for; Elasticsearch ignores the default
 * headroom once the watermark itself was set.
 */
export function diskWatermarks(response: unknown): DiskWatermarks | null {
  if (!isRecord(response)) {
    return null;
  }
  const section = (name: string): Record<string, unknown> => (isRecord(response[name]) ? response[name] : {});
  const explicit = { ...flattenSettings(section('persistent')), ...flattenSettings(section('transient')) };
  const all = { ...flattenSettings(section('defaults')), ...explicit };
  if (!Object.keys(all).some((key) => key.startsWith(DISK_PREFIX))) {
    return null;
  }
  const mark = (level: 'low' | 'high' | 'flood_stage'): Watermark | null => {
    const key = `${DISK_PREFIX}watermark.${level}`;
    const headroomKey = `${key}.max_headroom`;
    const headroomText = key in explicit && !(headroomKey in explicit) ? undefined : all[headroomKey];
    const headroom = headroomText === undefined ? null : parseByteSize(headroomText);
    return parseWatermark(all[key], headroom);
  };
  return {
    enabled: all[`${DISK_PREFIX}threshold_enabled`] !== 'false',
    low: mark('low'),
    high: mark('high'),
    flood: mark('flood_stage'),
  };
}

/** Free bytes a watermark asks for on a disk of `total` bytes. */
export function requiredFree(mark: Watermark, total: number): number {
  if (mark.kind === 'bytes') {
    return mark.free;
  }
  const free = total * (1 - mark.used);
  return mark.headroom !== null ? Math.min(free, mark.headroom) : free;
}

/** The highest watermark a node with `available` of `total` bytes free is past. */
export function diskLevel(available: number | null, total: number | null, marks: DiskWatermarks | null): DiskLevel | null {
  if (!marks?.enabled || available === null || total === null || total <= 0) {
    return null;
  }
  const past = (mark: Watermark | null): boolean => mark !== null && available < requiredFree(mark, total);
  return past(marks.flood) ? 'flood' : past(marks.high) ? 'high' : past(marks.low) ? 'low' : 'ok';
}

/** "90%" or "150 GB free", for the explanation of a watermark. */
function watermarkText(mark: Watermark, total: number): string {
  if (mark.kind === 'bytes') {
    return `${formatBytes(mark.free)} free`;
  }
  const free = requiredFree(mark, total);
  return free < total * (1 - mark.used) ? `${formatBytes(free)} free (max_headroom)` : `${mark.text} used`;
}

/* ---- Nodes ----------------------------------------------------------------------------- */

/** `*` wildcards of allocation filters. */
function globMatch(pattern: string, value: string): boolean {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`).test(value);
}

/** What a filter attribute reads on a node, `undefined` when the node data does not say. */
function nodeAttribute(node: RawNode, attribute: string): string | null | undefined {
  switch (attribute) {
    case '_name':
      return node.name;
    case '_id':
      return node.id;
    default:
      // `_host`, `_ip`, `_publish_ip`…: Elasticsearch matches `_host` against the host name and the
      // address, and the nodes endpoint only carries the name, so these are not judged.
      if (attribute.startsWith('_')) {
        return undefined;
      }
      return node.attributes ? (node.attributes[attribute] ?? null) : undefined;
  }
}

/** The data tiers of Elasticsearch, hottest first. */
const DATA_TIERS = ['data_content', 'data_hot', 'data_warm', 'data_cold', 'data_frozen'] as const;

/** Whether the node reports its roles (7.10+ and the nodes endpoint carries them). */
function rolesKnown(node: RawNode): boolean {
  return Array.isArray(node.roles) && node.roles.length > 0;
}

/** A node with the generic `data` role belongs to every tier. */
function inTier(node: RawNode, tier: string): boolean {
  const roles = node.roles ?? [];
  return roles.includes(tier) || roles.includes('data');
}

/**
 * The tier `index.routing.allocation.include._tier_preference` places the
 * shards on: the first tier of the list that has a node, like Elasticsearch.
 * `null` when no node is in any of them, `undefined` when there is no
 * preference or the nodes do not report their roles.
 */
export function preferredTier(preference: readonly string[], nodes: readonly RawNode[]): string | null | undefined {
  if (preference.length === 0 || !nodes.some(rolesKnown)) {
    return undefined;
  }
  return preference.find((tier) => nodes.some((node) => rolesKnown(node) && inTier(node, tier))) ?? null;
}

/** "the warm tier (data_warm)". */
function tierText(tier: string): string {
  const name = tier.replace(/^data_/, '');
  return (DATA_TIERS as readonly string[]).includes(tier) ? `the ${name} tier (${tier})` : tier;
}

/** "data_warm or data_hot". */
function orList(values: readonly string[]): string {
  return values.length <= 1 ? (values[0] ?? '') : `${values.slice(0, -1).join(', ')} or ${values[values.length - 1] ?? ''}`;
}

/**
 * Why the tier preference keeps the shards off `node`, or `null`. `tier` is
 * the result of `preferredTier`.
 */
export function tierExclusion(node: RawNode, preference: readonly string[], tier: string | null | undefined): string | null {
  const key = 'index.routing.allocation.include._tier_preference';
  if (tier === undefined || !rolesKnown(node)) {
    return null;
  }
  if (tier === null) {
    return `No node is in ${orList(preference)}, the tiers ${key} asks for`;
  }
  if (inTier(node, tier)) {
    return null;
  }
  const first = preference[0] === tier ? '' : ` (no node is in ${orList(preference.slice(0, preference.indexOf(tier)))})`;
  return `Not in ${tierText(tier)}, where ${key}: ${preference.join(',')} places the shards${first}`;
}

/** Where the tier preference places the shards, for the node choice. */
export interface TierNote {
  /** The tier the shards go to (`data_warm`). */
  readonly tier: string;
  /** "the warm tier"; `null` for a tier Elasticsearch does not define. */
  readonly tierName: string | null;
  /** The whole preference when it lists more than one tier (`data_cold,data_warm`), else `null`. */
  readonly preference: string | null;
}

/**
 * Where the tier preference places the shards, for the node choice; `null`
 * when it changes nothing: every data node is in the tier it asks for first
 * (every 8.x index prefers data_content, which plain `data` nodes are in).
 */
export function tierNote(preference: readonly string[], nodes: readonly RawNode[]): TierNote | null {
  const tier = preferredTier(preference, nodes);
  if (!tier) {
    return null;
  }
  const leftOut = nodes.some((node) => node.data && rolesKnown(node) && !inTier(node, tier));
  if (!leftOut && tier === preference[0]) {
    return null;
  }
  return {
    tier,
    tierName: (DATA_TIERS as readonly string[]).includes(tier) ? `the ${tier.replace(/^data_/, '')} tier` : null,
    preference: preference.length > 1 ? preference.join(',') : null,
  };
}

/**
 * `_tier` filters (Elasticsearch 7.x): `require` needs every listed tier,
 * `include` one of them, `exclude` none. `null` when the node passes.
 */
function tierFilterExclusion(node: RawNode, type: string, key: string, value: string): string | null {
  const tiers = tierList(value);
  const matches = tiers.filter((tier) => inTier(node, tier));
  const failed = type === 'require' ? matches.length < tiers.length : type === 'include' ? matches.length === 0 : matches.length > 0;
  return failed ? `Excluded by ${key}: ${value}` : null;
}

/**
 * Why the allocation filters of the source keep its shards off `node`, or
 * `null` (also when the filter names something the node data does not carry).
 */
export function allocationExclusion(node: RawNode, allocation: Readonly<Record<string, string>>): string | null {
  const includes: [string, string][] = [];
  // An include filter this page cannot judge may be the one that matches: then the includes keep every node.
  let includeUnjudged = false;
  for (const [key, value] of Object.entries(allocation)) {
    const match = /^index\.routing\.allocation\.(require|include|exclude)\.(.+)$/.exec(key);
    if (!match?.[1] || !match[2]) {
      continue;
    }
    if (match[2] === '_tier') {
      const excluded = rolesKnown(node) ? tierFilterExclusion(node, match[1], key, value) : null;
      if (excluded) {
        return excluded;
      }
      continue;
    }
    const actual = nodeAttribute(node, match[2]);
    if (actual === undefined) {
      includeUnjudged ||= match[1] === 'include';
      continue;
    }
    const matches = actual !== null && value.split(',').some((pattern) => globMatch(pattern.trim(), actual));
    // The node name and id are already on the option: only other attributes say what the node has.
    const has = match[2] === '_name' || match[2] === '_id' ? '' : actual === null ? ` (it has no ${match[2]})` : ` (it has ${actual})`;
    if (match[1] === 'require' && !matches) {
      return `Excluded by ${key}: ${value}${has}`;
    }
    if (match[1] === 'exclude' && matches) {
      return `Excluded by ${key}: ${value}`;
    }
    if (match[1] === 'include') {
      includes.push([key, matches ? '' : `${value}${has}`]);
    }
  }
  // Include filters keep a node when any of them matches.
  if (!includeUnjudged && includes.length > 0 && includes.every(([, failed]) => failed)) {
    const [key, value] = includes[0] ?? ['', ''];
    return `Excluded by ${key}: ${value}`;
  }
  return null;
}

export interface NodeOptionContext {
  readonly watermarks?: DiskWatermarks | null;
  /** Allocation settings of the source (`SourceIndex.allocation`). */
  readonly allocation?: Readonly<Record<string, string>>;
  /** Tier preference of the source (`SourceIndex.tierPreference`). */
  readonly tierPreference?: readonly string[];
}

/**
 * Data nodes with their free disk, how many shards of the source they already
 * hold and why the source cannot go there. `nodes` is every node of the
 * cluster: the tier preference looks for the first tier that has one.
 */
export function nodeOptions(nodes: readonly RawNode[], copies: readonly ShardCopy[], context: NodeOptionContext = {}): NodeOption[] {
  const preference = context.tierPreference ?? [];
  const tier = preferredTier(preference, nodes);
  return nodes
    .filter((node) => node.data)
    .map((node) => ({
      id: node.id,
      name: node.name,
      diskAvailable: node.disk?.available ?? null,
      diskTotal: node.disk?.total ?? null,
      diskPercent: node.disk?.percent ?? null,
      shardsHere: shardsOn(copies, node.name).size,
      diskLevel: diskLevel(node.disk?.available ?? null, node.disk?.total ?? null, context.watermarks ?? null),
      excluded: tierExclusion(node, preference, tier) ?? allocationExclusion(node, context.allocation ?? {}),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

/**
 * The node that needs the fewest moves (then has the most free disk); nodes
 * past a disk watermark come last. Nodes the allocation filters or the tier
 * preference exclude are never suggested.
 */
export function suggestedShrinkNode(options: readonly NodeOption[]): NodeOption | null {
  const penalty = (option: NodeOption): number => (option.diskLevel && option.diskLevel !== 'ok' ? 1 : 0);
  return (
    options
      .filter((option) => !option.excluded)
      .sort(
        (left, right) =>
          penalty(left) - penalty(right) ||
          right.shardsHere - left.shardsHere ||
          (right.diskAvailable ?? -1) - (left.diskAvailable ?? -1) ||
          left.name.localeCompare(right.name),
      )[0] ?? null
  );
}

/** Nodes that hold a started copy of every shard. */
export function colocatedNodes(copies: readonly ShardCopy[], primaries: number): string[] {
  const nodes = new Set(copies.map((copy) => copy.node).filter((node): node is string => !!node));
  return [...nodes].filter((node) => shardsOn(copies, node).size >= primaries).sort((left, right) => left.localeCompare(right));
}

/** How far the source is from having a copy of every shard on `node`. */
export function colocation(copies: readonly ShardCopy[], primaries: number, node: string): Colocation {
  const covered = shardsOn(copies, node).size;
  const moving = copies.filter(
    (copy) => (copy.state === 'relocating' && copy.relocatingTo === node) || (copy.state === 'initializing' && copy.node === node),
  ).length;
  const unsettled = copies.filter((copy) => copy.state !== 'started').length;
  return { node, covered, total: primaries, moving, unsettled, done: covered >= primaries && moving === 0 };
}

/**
 * Disk a shrink on `node` needs: the copies still to move there plus room for
 * the shrunken index (a second copy of the primaries; hard links make it
 * cheaper on most file systems, so this errs on the safe side).
 */
export function shrinkDiskNeed(source: SourceIndex, node: string): { readonly toMove: number; readonly need: number } {
  const here = shardsOn(source.shards, node);
  const sizes = new Map<number, number>();
  for (const copy of source.shards) {
    if (copy.size !== null && (copy.primary || !sizes.has(copy.shard))) {
      sizes.set(copy.shard, copy.size);
    }
  }
  let toMove = 0;
  for (const [shard, size] of sizes) {
    if (!here.has(shard)) {
      toMove += size;
    }
  }
  return { toMove, need: toMove + (source.primarySize ?? 0) };
}

/* ---- Shard counts ---------------------------------------------------------------------- */

/** Divisors of `n` in ascending order. */
export function divisors(n: number): number[] {
  if (!Number.isInteger(n) || n < 1) {
    return [];
  }
  const result: number[] = [];
  for (let candidate = 1; candidate <= n; candidate++) {
    if (n % candidate === 0) {
      result.push(candidate);
    }
  }
  return result;
}

/** Valid shrink targets: the factors of the source count below it. */
export function shrinkChoices(primaries: number): number[] {
  return divisors(primaries).filter((value) => value < primaries);
}

/** Suggested split targets of a one-shard index (it can be split into any count). */
const SINGLE_SHARD_SPLITS = [2, 3, 4, 5, 6, 8, 10, 12, 16, 24, 32];

/**
 * Valid split targets: multiples of the source count that divide its routing
 * shards, up to 1024. A one-shard index can be split into any count, so it
 * gets a list of common choices.
 */
export function splitChoices(primaries: number, routing: RoutingShards | null): number[] {
  if (!Number.isInteger(primaries) || primaries < 1) {
    return [];
  }
  if (primaries === 1) {
    return SINGLE_SHARD_SPLITS;
  }
  const result: number[] = [];
  for (let target = primaries * 2; target <= MAX_SHARDS_PER_INDEX; target += primaries) {
    if (!routing || routing.value % target === 0) {
      result.push(target);
    }
  }
  return result;
}

/** "1, 2 or 4"; long lists end with "…". */
function listNumbers(values: readonly number[]): string {
  if (values.length === 0) {
    return 'none';
  }
  const shown = values.map((value) => formatNumber(value));
  if (shown.length > 10) {
    return `${shown.slice(0, 9).join(', ')} …`;
  }
  return shown.length === 1 ? (shown[0] ?? '') : `${shown.slice(0, -1).join(', ')} or ${shown[shown.length - 1] ?? ''}`;
}

/** Whether `target` primary shards are valid for the operation, and why not. */
export function shardCountCompatibility(
  kind: ResizeKind,
  primaries: number,
  target: number | null,
  routing: RoutingShards | null = null,
): Compatibility {
  const fail = (reason: string): Compatibility => ({ ok: false, reason });
  if (target === null || !Number.isInteger(target) || target < 1) {
    return fail('Choose the number of primary shards');
  }
  switch (kind) {
    case 'clone':
      return target === primaries ? { ok: true, reason: null } : fail(`A clone keeps the ${pluralize(primaries, 'shard')} of the source`);
    case 'shrink':
      if (target >= primaries) {
        return fail(`A shrink needs fewer shards than the ${formatNumber(primaries)} of the source`);
      }
      if (primaries % target !== 0) {
        return fail(`${formatNumber(target)} is not a factor of ${formatNumber(primaries)}: choose ${listNumbers(shrinkChoices(primaries))}`);
      }
      return { ok: true, reason: null };
    case 'split':
      if (target <= primaries) {
        return fail(`A split needs more shards than the ${formatNumber(primaries)} of the source`);
      }
      if (target > MAX_SHARDS_PER_INDEX) {
        return fail(`An index cannot have more than ${formatNumber(MAX_SHARDS_PER_INDEX)} primary shards`);
      }
      if (target % primaries !== 0) {
        return fail(`${formatNumber(target)} is not a multiple of ${formatNumber(primaries)}`);
      }
      if (primaries > 1 && routing && routing.value % target !== 0) {
        return fail(
          `${formatNumber(target)} does not divide the ${formatNumber(routing.value)} routing shards of the source: choose ${listNumbers(splitChoices(primaries, routing))}`,
        );
      }
      return { ok: true, reason: null };
  }
}

/**
 * The most documents one target shard of a shrink receives: target shard `i`
 * merges source shards `i × f … i × f + f − 1` with `f = source / target`.
 */
export function maxDocsPerTargetShard(copies: readonly ShardCopy[], primaries: number, target: number): number | null {
  if (target < 1 || primaries % target !== 0) {
    return null;
  }
  const docs = new Map<number, number>();
  for (const copy of copies) {
    if (copy.primary && copy.docs !== null) {
      docs.set(copy.shard, copy.docs);
    }
  }
  if (docs.size < primaries) {
    return null;
  }
  const factor = primaries / target;
  let max = 0;
  for (let shard = 0; shard < target; shard++) {
    let sum = 0;
    for (let source = shard * factor; source < (shard + 1) * factor; source++) {
      sum += docs.get(source) ?? 0;
    }
    max = Math.max(max, sum);
  }
  return max;
}

/* ---- Names ------------------------------------------------------------------------------ */

export interface TakenNames {
  readonly indices: readonly string[];
  readonly aliases: readonly string[];
  readonly dataStreams: readonly string[];
}

function utf8Length(value: string): number {
  return new TextEncoder().encode(value).length;
}

/** Format errors of an index name (not whether it is taken), or `null`. */
export function indexNameFormatError(name: string): string | null {
  if (!name) {
    return 'Enter a name for the index';
  }
  if (name !== name.toLowerCase()) {
    return 'Index names must be lowercase';
  }
  if (/\s/.test(name)) {
    return 'Index names cannot contain spaces';
  }
  if (name === '.' || name === '..') {
    return 'Index names cannot be "." or ".."';
  }
  const first = name.charAt(0);
  if (first === '-' || first === '_' || first === '+') {
    return `Index names cannot start with "${first}"`;
  }
  const invalid = invalidCharacters(name, INVALID_INDEX_NAME_CHARACTERS);
  if (invalid.length > 0) {
    return `Index names cannot contain ${invalid.map((character) => `"${character}"`).join(', ')}`;
  }
  const bytes = utf8Length(name);
  return bytes > MAX_INDEX_NAME_BYTES ? `Index names are limited to ${MAX_INDEX_NAME_BYTES} bytes (this one has ${bytes})` : null;
}

/** Error of a name for a new index: format, then names already in use. */
export function newIndexNameError(name: string, taken: TakenNames): string | null {
  const format = indexNameFormatError(name);
  if (format) {
    return format;
  }
  if (taken.indices.includes(name)) {
    return `An index named "${name}" already exists`;
  }
  if (taken.aliases.includes(name)) {
    return `An alias named "${name}" already exists`;
  }
  return taken.dataStreams.includes(name) ? `A data stream named "${name}" already exists` : null;
}

/** Comma separated alias names; returns the names and the first error. */
export function parseAliasList(value: string): { readonly names: string[]; readonly error: string | null } {
  const names = [...new Set(value.split(',').map((name) => name.trim()).filter(Boolean))];
  for (const name of names) {
    const error = indexNameFormatError(name);
    if (error) {
      return { names, error: `${error.replace(/^Index names/, 'Alias names')} (${name})` };
    }
  }
  return { names, error: null };
}

/** A default target name that is not taken: `logs-shrink`, `logs-shrink-2`, … */
export function suggestTargetName(source: string, kind: ResizeKind, taken: TakenNames): string {
  const base = `${source.replace(/^\.+/, '')}-${kind === 'shrink' ? 'shrunk' : kind === 'split' ? 'split' : 'clone'}`;
  const used = new Set([...taken.indices, ...taken.aliases, ...taken.dataStreams]);
  if (!used.has(base)) {
    return base;
  }
  let counter = 2;
  while (used.has(`${base}-${counter}`)) {
    counter++;
  }
  return `${base}-${counter}`;
}

/* ---- Checks ------------------------------------------------------------------------------ */

export function summarizeChecks(checks: readonly Check[]): CheckSummary {
  const count = (status: Check['status']): number => checks.filter((check) => check.status === status).length;
  const fail = count('fail');
  const pending = count('pending');
  return { pass: count('pass'), fail, warn: count('warn'), pending, ready: fail === 0 && pending === 0 };
}

export interface ResizeCheckInput {
  readonly kind: ResizeKind;
  readonly source: SourceIndex;
  readonly targetShards: number | null;
  /** Data nodes, `null` while unknown. */
  readonly nodes: readonly NodeOption[] | null;
  /** The node a shrink preparation would use (the user's pick or the suggestion). */
  readonly candidateNode?: string | null;
  readonly watermarks?: DiskWatermarks | null;
}

function blockLabel(key: string): string {
  return key.replace(/^index\.blocks\./, '');
}

/** `index.version.created` of 7.2.0: closed indices are replicated (and can be resized) from there on. */
const VERSION_7_2_0 = 7_020_099;

/** Live preflight checks of a shrink, split or clone. */
export function resizeChecks(input: ResizeCheckInput): Check[] {
  const { kind, source } = input;
  const checks: Check[] = [];
  const primaries = source.primaries ?? 0;

  if (source.open === false) {
    const legacy = source.versionCreated !== null && source.versionCreated < VERSION_7_2_0;
    if (legacy || !source.shardsKnown || source.shards.length === 0) {
      checks.push({
        id: 'open',
        status: 'fail',
        title: 'Source is closed',
        detail: legacy
          ? `${source.name} was created before Elasticsearch 7.2, so its shards are not kept while it is closed. Open it first.`
          : `Elasticsearch did not list the shards of ${source.name}, so nothing can be checked. Open it first.`,
        fix: 'open-index',
      });
      return checks;
    }
    checks.push({
      id: 'open',
      status: 'pass',
      title: 'Source is closed',
      detail: `${source.name} stays closed; the new index is created open.`,
    });
  } else if (source.open === null) {
    checks.push({ id: 'open', status: 'warn', title: 'Open state unknown', detail: 'Elasticsearch returned no statistics for the index.' });
  } else {
    checks.push({ id: 'open', status: 'pass', title: 'Source is open', detail: `${source.name} is open.` });
  }

  if (kind !== 'clone' && primaries > 0) {
    const choices = kind === 'shrink' ? shrinkChoices(primaries) : splitChoices(primaries, source.routingShards);
    if (choices.length === 0) {
      checks.push({
        id: 'shards',
        status: 'fail',
        title: kind === 'shrink' ? 'Cannot be shrunk' : 'Cannot be split',
        detail:
          kind === 'shrink'
            ? `${source.name} has a single primary shard.`
            : `No multiple of ${formatNumber(primaries)} divides its ${formatNumber(source.routingShards?.value ?? primaries)} routing shards.`,
      });
    }
  }

  if (source.dataStreamWriteIndex) {
    checks.push({
      id: 'data-stream',
      status: 'fail',
      title: 'Write index of a data stream',
      detail: `${source.name} is the write index of ${source.dataStream}. Roll the data stream over first.`,
    });
  } else if (source.dataStream) {
    checks.push({
      id: 'data-stream',
      status: 'warn',
      title: `Backing index of ${source.dataStream}`,
      detail: `The new index is not part of ${source.dataStream}: searches on the data stream do not see it.${
        source.hidden || source.lifecyclePolicy ? ' The request makes it a regular index (not hidden, no lifecycle policy).' : ''
      } Deleting ${source.name} afterwards removes its documents from the data stream.`,
    });
  }

  if (source.writeBlocked) {
    checks.push({
      id: 'write-block',
      status: 'pass',
      title: 'Writes are blocked',
      detail: `${source.blockSettings.map((key) => `index.blocks.${blockLabel(key)}`).join(', ')} is set to true.`,
    });
  } else {
    checks.push({
      id: 'write-block',
      status: 'fail',
      title: 'Writes are not blocked',
      detail: 'Set index.blocks.write to true so the copy cannot miss documents. Searches keep working.',
      // A shrink also needs the copies on one node, unless they already are.
      fix: kind === 'shrink' && !source.requiredNode && colocatedNodes(source.shards, primaries).length === 0 ? 'prepare' : 'write-block',
    });
  }

  if (kind === 'shrink') {
    checks.push(colocationCheck(source, primaries, input.nodes));
    const offered = shrinkNodesCheck(source, primaries, input.nodes);
    if (offered) {
      checks.push(offered);
    }
  }

  checks.push(healthCheck(source, kind));

  const allocation = allocationCheck(source);
  if (allocation) {
    checks.push(allocation);
  }

  if (kind === 'shrink') {
    checks.push(diskCheck(source, primaries, input.nodes, input.candidateNode ?? null, input.watermarks ?? null));
    checks.push(docsCheck(source, primaries, input.targetShards));
  } else {
    const disk = primaryNodesDiskCheck(source, input.nodes, input.watermarks ?? null);
    if (disk) {
      checks.push(disk);
    }
  }

  if (kind === 'split') {
    checks.push(routingCheck(source, primaries, input.targetShards));
  }
  return checks;
}

function shrinkNode(source: SourceIndex, primaries: number): string | null {
  return source.requiredNode ?? colocatedNodes(source.shards, primaries)[0] ?? null;
}

function colocationCheck(source: SourceIndex, primaries: number, options: readonly NodeOption[] | null): Check {
  const id = 'colocation';
  if (!source.shardsKnown || primaries < 1) {
    return { id, status: 'warn', title: 'Shard locations unknown', detail: 'Elasticsearch did not list the shards of the index.' };
  }
  if (source.requiredNode) {
    const state = colocation(source.shards, primaries, source.requiredNode);
    if (state.done) {
      return {
        id,
        status: 'pass',
        title: `Every shard has a copy on ${source.requiredNode}`,
        detail: primaries === 1 ? 'The shard has a started copy there.' : `All ${formatNumber(primaries)} shards have a started copy there.`,
      };
    }
    if (state.moving > 0) {
      return {
        id,
        status: 'pending',
        title: `Moving copies to ${source.requiredNode}`,
        detail: `${formatNumber(state.covered)} of ${pluralize(primaries, 'shard')} have a copy there; ${pluralize(state.moving, 'copy', 'copies')} on the way.`,
      };
    }
    const excluded = options?.find((node) => node.name === source.requiredNode)?.excluded ?? null;
    return {
      id,
      status: 'fail',
      title: `Copies cannot reach ${source.requiredNode}`,
      detail: excluded
        ? `Only ${formatNumber(state.covered)} of ${pluralize(primaries, 'shard')} have a copy there and none is moving. ${excluded}: undo the preparation and pick another node.`
        : `Only ${formatNumber(state.covered)} of ${pluralize(primaries, 'shard')} have a copy there and none is moving. Check why in Shard allocation, or prepare the source on another node.`,
      fix: 'prepare',
    };
  }
  const nodes = colocatedNodes(source.shards, primaries);
  if (nodes.length > 0) {
    return {
      id,
      status: 'pass',
      title: `Every shard has a copy on ${nodes[0]}`,
      detail: `${nodes[0]} already holds a started copy of every shard.`,
    };
  }
  const spread = new Set(source.shards.filter((copy) => copy.node).map((copy) => copy.node)).size;
  return {
    id,
    status: 'fail',
    title: 'Copies are spread over several nodes',
    detail: `The shards are on ${pluralize(spread, 'node')}. Require one node for the index (Prepare source) and wait until a copy of every shard is there.`,
    fix: 'prepare',
  };
}

/**
 * The nodes the preparation does not offer and why (tier preference,
 * allocation filters). Only while a node is still to be picked.
 */
function shrinkNodesCheck(source: SourceIndex, primaries: number, nodes: readonly NodeOption[] | null): Check | null {
  if (!nodes || nodes.length === 0 || source.requiredNode || primaries < 2) {
    return null;
  }
  const excluded = nodes.filter((node) => node.excluded);
  if (excluded.length === 0) {
    return null;
  }
  // Grouped by the rule alone: what each node has is on its option.
  const reasons = new Map<string, string[]>();
  for (const node of excluded) {
    const reason = (node.excluded ?? '').replace(/ \(it has [^)]*\)$/, '');
    reasons.set(reason, [...(reasons.get(reason) ?? []), node.name]);
  }
  const why = [...reasons].map(([reason, names]) => `${names.join(', ')}: ${reason}.`).join(' ');
  if (excluded.length === nodes.length) {
    return {
      id: 'nodes',
      status: 'fail',
      title: 'No node can gather the copies',
      detail: `${why} Change the allocation settings of ${source.name} in Index settings first.`,
    };
  }
  const offered = nodes.length - excluded.length;
  return {
    id: 'nodes',
    status: 'pass',
    title: `${formatNumber(offered)} of ${pluralize(nodes.length, 'data node')} can gather the copies`,
    detail: `Not offered: ${why}`,
  };
}

function healthCheck(source: SourceIndex, kind: ResizeKind): Check {
  const id = 'health';
  const verb = kind === 'shrink' ? 'shrunk' : kind === 'split' ? 'split' : 'cloned';
  if (!source.shardsKnown) {
    return source.health === 'green'
      ? { id, status: 'pass', title: 'Health is green', detail: 'Every shard copy is started.' }
      : { id, status: 'warn', title: `Health is ${source.health}`, detail: `Only green indices can be ${verb}.` };
  }
  const moving = source.shards.filter((copy) => copy.state === 'relocating' || copy.state === 'initializing').length;
  const unassigned = source.shards.filter((copy) => copy.state === 'unassigned').length;
  if (unassigned > 0) {
    return {
      id,
      status: 'fail',
      title: `Health is ${source.health === 'red' ? 'red' : 'yellow'}`,
      detail: `${pluralize(unassigned, 'shard copy', 'shard copies')} ${unassigned === 1 ? 'is' : 'are'} unassigned. Only green indices can be ${verb}; Shard allocation explains why.`,
    };
  }
  if (moving > 0) {
    return {
      id,
      status: 'pending',
      title: 'Shards are moving',
      detail: `${pluralize(moving, 'copy', 'copies')} ${moving === 1 ? 'is' : 'are'} relocating or starting.`,
    };
  }
  return { id, status: 'pass', title: 'Health is green', detail: `All ${pluralize(source.shards.length, 'shard copy', 'shard copies')} are started.` };
}

/** Allocation filters and limits of the source that the new index inherits. */
function allocationCheck(source: SourceIndex): Check | null {
  const entries = Object.entries(source.allocation);
  if (entries.length === 0) {
    return null;
  }
  return {
    id: 'allocation',
    status: 'warn',
    title: entries.length === 1 ? 'Allocation setting on the source' : 'Allocation settings on the source',
    detail: `${entries.map(([key, value]) => `${key}: ${value}`).join(', ')}. They limit where the shards can go${
      entries.some(([key]) => /require\._(name|id|host)$/.test(key)) ? '; the request clears the node requirements on the new index' : ', and the new index inherits them'
    }.`,
  };
}

/** Disk a node has against what the shrink puts there and the watermarks. */
function diskCheck(
  source: SourceIndex,
  primaries: number,
  nodes: readonly NodeOption[] | null,
  candidate: string | null,
  watermarks: DiskWatermarks | null,
): Check {
  const id = 'disk';
  const settled = shrinkNode(source, primaries);
  const node = settled ?? candidate;
  if (!node) {
    return { id, status: 'warn', title: 'Disk space not checked', detail: 'No data node can hold the copies.' };
  }
  const later = settled ? '' : ' (after preparation)';
  const option = nodes?.find((entry) => entry.name === node);
  const { toMove, need } = shrinkDiskNeed(source, node);
  if (!option || option.diskAvailable === null) {
    return { id, status: 'warn', title: 'Free disk unknown', detail: `Could not read the free disk of ${node}; the shrink needs about ${formatBytes(need)}.` };
  }
  const available = option.diskAvailable;
  const total = option.diskTotal;
  const freeAfter = available - need;
  const needText = `${formatBytes(available)} free; the copies and the shrunken index need about ${formatBytes(need)}`;
  if (freeAfter < 0) {
    return { id, status: 'fail', title: `Not enough disk on ${node}`, detail: `${needText}.` };
  }
  if (watermarks?.enabled && total !== null && total > 0) {
    const usedAfter = Math.round(((total - freeAfter) / total) * 100);
    const usedNow = Math.round(((total - available) / total) * 100);
    const high = watermarks.high;
    const low = watermarks.low;
    if (high && freeAfter < requiredFree(high, total)) {
      return {
        id,
        status: 'fail',
        title: `${node} would pass the high disk watermark`,
        detail: `${needText}, which leaves ${formatBytes(freeAfter)} (${usedAfter}% used). The high watermark asks for ${watermarkText(high, total)}: Elasticsearch would not allocate the new shards there.`,
      };
    }
    if (low && toMove > 0 && available < requiredFree(low, total)) {
      return {
        id,
        status: 'fail',
        title: `${node} is past the low disk watermark`,
        detail: `${usedNow}% used; the low watermark asks for ${watermarkText(low, total)}, so Elasticsearch does not move copies there. Pick another node.`,
      };
    }
    if (high && freeAfter < requiredFree(high, total) + total * 0.05) {
      return {
        id,
        status: 'warn',
        title: `${node} gets close to the high disk watermark${later}`,
        detail: `${needText}, which leaves ${formatBytes(freeAfter)} (${usedAfter}% used); the high watermark asks for ${watermarkText(high, total)}.`,
      };
    }
  }
  return {
    id,
    status: 'pass',
    title: `Enough disk on ${node}${later}`,
    detail: `${needText}.${watermarks && !watermarks.enabled ? ' The disk watermarks are off (cluster.routing.allocation.disk.threshold_enabled: false).' : ''}`,
  };
}

/** Split and clone start the new shards next to the source primaries: warn when those nodes are past the high watermark. */
function primaryNodesDiskCheck(source: SourceIndex, nodes: readonly NodeOption[] | null, watermarks: DiskWatermarks | null): Check | null {
  if (!nodes || !watermarks?.enabled) {
    return null;
  }
  const primaryNodes = new Set(source.shards.filter((copy) => copy.primary && copy.node).map((copy) => copy.node));
  const full = nodes.filter((node) => primaryNodes.has(node.name) && (node.diskLevel === 'high' || node.diskLevel === 'flood'));
  if (full.length === 0) {
    return null;
  }
  return {
    id: 'disk',
    status: 'warn',
    title: full.length === 1 ? `${full[0]?.name} is past the high disk watermark` : 'Nodes past the high disk watermark',
    detail: `${full.map((node) => `${node.name} (${node.diskPercent ?? '?'}% used)`).join(', ')} ${full.length === 1 ? 'holds' : 'hold'} source primaries; the new shards start there, and Elasticsearch may not allocate them.`,
  };
}

function docsCheck(source: SourceIndex, primaries: number, target: number | null): Check {
  const id = 'docs';
  const title = 'Documents per target shard';
  if (target === null || target < 1 || primaries % target !== 0 || target >= primaries) {
    return { id, status: 'warn', title, detail: 'Choose a valid number of primary shards to check this.' };
  }
  const max = maxDocsPerTargetShard(source.shards, primaries, target);
  if (max === null) {
    return {
      id,
      status: 'warn',
      title,
      detail:
        source.open === false
          ? `A closed index does not report its documents; Elasticsearch checks the limit of ${formatNumber(MAX_DOCS_PER_SHARD)} per shard when the request runs.`
          : 'Elasticsearch did not report the documents of every shard.',
    };
  }
  return max > MAX_DOCS_PER_SHARD
    ? {
        id,
        status: 'fail',
        title: 'Too many documents per shard',
        detail: `A target shard would hold ${formatNumber(max)} documents; a shard holds at most ${formatNumber(MAX_DOCS_PER_SHARD)}. Choose more shards.`,
      }
    : {
        id,
        status: 'pass',
        title,
        detail: `At most ${formatNumber(max)} per target shard (the limit is ${formatNumber(MAX_DOCS_PER_SHARD)}).`,
      };
}

function routingCheck(source: SourceIndex, primaries: number, target: number | null): Check {
  const id = 'routing';
  const routing = source.routingShards;
  const title = 'Routing shards allow the split';
  if (target === null) {
    return { id, status: 'warn', title, detail: 'Choose the number of primary shards to check this.' };
  }
  const compatibility = shardCountCompatibility('split', primaries, target, routing);
  if (!compatibility.ok) {
    const reason = compatibility.reason ?? '';
    return { id, status: 'fail', title: 'Shard count not possible', detail: reason.endsWith('…') ? reason : `${reason}.` };
  }
  if (!routing || routing.origin === 'single-shard') {
    return { id, status: 'pass', title, detail: 'An index with one shard can be split into any number of shards.' };
  }
  if (routing.origin === 'metadata') {
    return {
      id,
      status: 'pass',
      title,
      detail: `${formatNumber(target)} divides the ${formatNumber(routing.value)} routing shards of ${source.name} (routing_num_shards in the cluster state${
        source.resizedFrom ? `, kept from ${source.resizedFrom}` : ''
      }).`,
    };
  }
  if (routing.origin === 'resized') {
    return {
      id,
      status: 'warn',
      title: 'Routing shards estimated',
      detail: `${source.name} was created from ${source.resizedFrom ?? 'another index'} by a resize and keeps the routing shards of that index, which its settings do not show. ${formatNumber(target)} divides ${formatNumber(routing.value)}, the default for ${pluralize(primaries, 'shard')}; Elasticsearch confirms it when the request runs.`,
    };
  }
  return {
    id,
    status: 'pass',
    title,
    detail:
      routing.origin === 'setting'
        ? `${formatNumber(target)} divides index.number_of_routing_shards (${formatNumber(routing.value)}).`
        : `${formatNumber(target)} divides ${formatNumber(routing.value)}, the default routing shards of an index with ${pluralize(primaries, 'shard')}.`,
  };
}

/* ---- Resize requests ------------------------------------------------------------------- */

/** `PUT /{index}/_settings` through `index_settings/update`. */
export function settingsRequest(index: string, settings: Record<string, unknown>, title: string): PlannedRequest {
  return {
    endpoint: 'index_settings/update',
    payload: { index, settings },
    preview: { method: 'PUT', path: `/${index}/_settings`, body: settings, title },
  };
}

/** Write block plus the node every copy must move to (shrink preparation). */
export function prepareShrinkRequest(index: string, node: string): PlannedRequest {
  return settingsRequest(
    index,
    { 'index.blocks.write': true, 'index.routing.allocation.require._name': node },
    `Block writes and gather the shards on ${node}`,
  );
}

export function writeBlockRequest(index: string): PlannedRequest {
  return settingsRequest(index, { 'index.blocks.write': true }, 'Block writes');
}

/**
 * Lifts what the wizard set on the source and is still in place, and nothing
 * else (blocks or node requirements set before are left alone); `null` when
 * there is nothing to lift.
 */
export function releaseSourceRequest(source: SourceIndex, changes: WizardChanges | null): PlannedRequest | null {
  if (!changes || changes.index !== source.name) {
    return null;
  }
  const settings: Record<string, unknown> = {};
  if (changes.writeBlock && source.writeBlock) {
    settings['index.blocks.write'] = null;
  }
  if (changes.requiredNode && source.requiredNode === changes.requiredNode) {
    settings['index.routing.allocation.require._name'] = null;
  }
  if (Object.keys(settings).length === 0) {
    return null;
  }
  return settingsRequest(
    source.name,
    settings,
    'index.routing.allocation.require._name' in settings ? 'Allow writes and free the shard placement of the source' : 'Allow writes to the source',
  );
}

/** The changes the wizard made once `settings` were applied to `index` (merged with earlier ones). */
export function recordChanges(previous: WizardChanges | null, index: string, settings: Readonly<Record<string, unknown>>): WizardChanges {
  const base: WizardChanges = previous && previous.index === index ? previous : { index, writeBlock: false, requiredNode: null };
  const node = settings['index.routing.allocation.require._name'];
  return {
    index,
    writeBlock: base.writeBlock || settings['index.blocks.write'] === true,
    requiredNode: typeof node === 'string' ? node : base.requiredNode,
  };
}

/** What is left of the wizard's changes once `released` was lifted (`null` when nothing). */
export function remainingChanges(changes: WizardChanges | null, released: Readonly<Record<string, unknown>>): WizardChanges | null {
  if (!changes) {
    return null;
  }
  const next: WizardChanges = {
    index: changes.index,
    writeBlock: changes.writeBlock && !('index.blocks.write' in released),
    requiredNode: 'index.routing.allocation.require._name' in released ? null : changes.requiredNode,
  };
  return next.writeBlock || next.requiredNode ? next : null;
}

/** Restrictions on the source the wizard did not set, explained (the wizard never lifts them). */
export function foreignRestrictions(source: SourceIndex, changes: WizardChanges | null): string[] {
  const own = changes && changes.index === source.name ? changes : null;
  const notes: string[] = [];
  for (const key of source.blockSettings) {
    if (key === 'index.blocks.write' && own?.writeBlock) {
      continue;
    }
    notes.push(
      key === 'index.blocks.read_only_allow_delete'
        ? `${key} is set: Elasticsearch sets it when a node passes the flood-stage disk watermark and lifts it once the disk has room again.`
        : `${key} was already set before this operation.`,
    );
  }
  if (source.requiredNode && source.requiredNode !== own?.requiredNode) {
    notes.push(`index.routing.allocation.require._name (${source.requiredNode}) was already set before this operation.`);
  }
  return notes;
}

/**
 * The resize request. The target inherits the settings of the source, so the
 * write block and the node requirement the preparation set are cleared on it.
 */
export function buildResizeRequest(kind: ResizeKind, source: SourceIndex, options: ResizeOptions): PlannedRequest {
  const settings: Record<string, unknown> = {};
  if (kind !== 'clone' && options.shards !== null) {
    settings['index.number_of_shards'] = options.shards;
  }
  if (options.replicas !== null) {
    settings['index.number_of_replicas'] = options.replicas;
  }
  if (options.bestCompression) {
    settings['index.codec'] = 'best_compression';
  }
  // The node requirements of the source (the preparation's, or ILM's require._id) must not pin the new index.
  if (source.requiredNode || kind === 'shrink') {
    settings['index.routing.allocation.require._name'] = null;
  }
  for (const key of ['index.routing.allocation.require._id', 'index.routing.allocation.require._host']) {
    if (key in source.allocation) {
      settings[key] = null;
    }
  }
  const blocks = source.blockSettings.length > 0 ? source.blockSettings : ['index.blocks.write'];
  for (const key of blocks) {
    settings[key] = null;
  }
  // A backing index's copy is a regular index: visible, and not managed by the data stream's policy.
  if (source.dataStream && !source.dataStreamWriteIndex) {
    if (source.hidden) {
      settings['index.hidden'] = false;
    }
    if (source.lifecyclePolicy) {
      settings['index.lifecycle.name'] = null;
    }
  }
  const body: Record<string, unknown> = { settings };
  if (options.aliases.length > 0) {
    body['aliases'] = Object.fromEntries(options.aliases.map((alias) => [alias, {}]));
  }
  return {
    endpoint: 'index_ops/resize',
    payload: { kind, index: source.name, target: options.target, body },
    preview: {
      method: 'POST',
      path: `/${source.name}/_${kind}/${options.target}`,
      body,
      title: `${OPERATIONS[kind].label} ${source.name} into ${options.target}`,
    },
  };
}

/** Progress of the new index's shards towards green. */
export function targetRecovery(copies: readonly ShardCopy[]): TargetRecovery {
  const total = copies.length;
  const count = (state: ShardState): number => copies.filter((copy) => copy.state === state).length;
  const started = count('started');
  const primaries = copies.filter((copy) => copy.primary).length;
  const primariesStarted = copies.filter((copy) => copy.primary && copy.state === 'started').length;
  const unassignedPrimaries = [...new Set(copies.filter((copy) => copy.primary && copy.state === 'unassigned').map((copy) => copy.shard))].sort(
    (left, right) => left - right,
  );
  return {
    total,
    started,
    initializing: count('initializing'),
    relocating: count('relocating'),
    unassigned: count('unassigned'),
    primaries,
    primariesStarted,
    unassignedPrimaries,
    percent: total > 0 ? (started / total) * 100 : 0,
    health: healthFromCopies(copies),
    done: total > 0 && started + count('relocating') === total,
  };
}

/* ---- Rollover ------------------------------------------------------------------------------ */

/** Aliases and data streams with the index a rollover would replace. */
export function rolloverTargets(rows: readonly RawAliasRow[], streams: DataStreamsResponse | null): RolloverTarget[] {
  const byAlias = new Map<string, RawAliasRow[]>();
  for (const row of rows) {
    byAlias.set(row.alias, [...(byAlias.get(row.alias) ?? []), row]);
  }
  const aliases: RolloverTarget[] = [...byAlias.entries()].map(([name, entries]) => {
    const indices = entries.map((entry) => entry.index).sort((left, right) => left.localeCompare(right));
    const explicit = entries.find((entry) => entry.is_write_index === true);
    const implicit = entries.length === 1 && entries[0]?.is_write_index !== false ? entries[0] : undefined;
    const writeIndex = explicit?.index ?? implicit?.index ?? null;
    return {
      name,
      kind: 'alias',
      writeIndex,
      indices,
      problem: writeIndex ? null : `Points to ${pluralize(indices.length, 'index', 'indices')} and none is the write index`,
      hidden: entries.some((entry) => entry.is_hidden === true),
      implicitWrite: !explicit && !!implicit,
    };
  });
  const dataStreams: RolloverTarget[] = (streams?.data_streams ?? []).map((stream) => {
    const indices = (stream.indices ?? []).map((entry) => entry.index_name);
    return {
      name: stream.name,
      kind: 'data-stream',
      writeIndex: indices[indices.length - 1] ?? null,
      indices,
      problem: null,
      hidden: stream.hidden === true || stream.system === true,
      implicitWrite: false,
    };
  });
  const byName = (left: RolloverTarget, right: RolloverTarget): number => left.name.localeCompare(right.name);
  return [...aliases.sort(byName), ...dataStreams.sort(byName)];
}

const ROLLOVER_NAME = /^(.*)-(\d+)$/;

/**
 * The name Elasticsearch gives the next index of an alias: the number after
 * the last "-" plus one, zero-padded to six digits (`logs-3` → `logs-000004`),
 * or `null` when the name does not end with "-" and a number.
 */
export function nextRolloverName(index: string): string | null {
  const match = ROLLOVER_NAME.exec(index);
  if (!match) {
    return null;
  }
  const next = Number(match[2]) + 1;
  return `${match[1]}-${String(next).padStart(6, '0')}`;
}

/** Marks the current write index explicitly, so a rollover keeps it in the alias. */
export function explicitWriteIndexRequest(alias: string, index: string): PlannedRequest {
  const actions = [{ add: { index, alias, is_write_index: true } }];
  return {
    endpoint: 'aliases/update_aliases',
    payload: { changes: actions },
    preview: { method: 'POST', path: '/_aliases', body: { actions }, title: `Make ${index} the explicit write index of ${alias}` },
  };
}

export interface RolloverConditionDefinition {
  readonly key: RolloverConditionKey;
  readonly param: string;
  readonly label: string;
  readonly kind: 'age' | 'count' | 'size';
  readonly placeholder: string;
  readonly hint: string;
  /** First Elasticsearch version that knows the condition ([major, minor]). */
  readonly since?: readonly [number, number];
}

/** `[major, minor]` of a version string ("8.15.0"), or `null`. */
export function parseVersion(value: string | null | undefined): readonly [number, number] | null {
  const match = /^(\d+)\.(\d+)/.exec(value ?? '');
  return match ? [Number(match[1]), Number(match[2])] : null;
}

/** The oldest version among the nodes (what the cluster as a whole supports). */
export function minNodeVersion(nodes: readonly RawNode[] | null | undefined): readonly [number, number] | null {
  let oldest: readonly [number, number] | null = null;
  for (const node of nodes ?? []) {
    const version = parseVersion(node.version);
    if (version && (!oldest || version[0] < oldest[0] || (version[0] === oldest[0] && version[1] < oldest[1]))) {
      oldest = version;
    }
  }
  return oldest;
}

/** Whether a cluster of `version` knows the condition (unknown versions get every condition). */
export function conditionSupported(condition: RolloverConditionDefinition, version: readonly [number, number] | null): boolean {
  const since = condition.since;
  return !since || !version || version[0] > since[0] || (version[0] === since[0] && version[1] >= since[1]);
}

export const ROLLOVER_CONDITIONS: readonly RolloverConditionDefinition[] = [
  { key: 'maxAge', param: 'max_age', label: 'Maximum age', kind: 'age', placeholder: 'e.g. 7d', hint: 'Since the index was created (d, h, m, s)' },
  { key: 'maxDocs', param: 'max_docs', label: 'Maximum documents', kind: 'count', placeholder: 'e.g. 10000000', hint: 'Documents in the primaries' },
  { key: 'maxSize', param: 'max_size', label: 'Maximum index size', kind: 'size', placeholder: 'e.g. 200gb', hint: 'All primary shards together' },
  {
    key: 'maxPrimaryShardSize',
    param: 'max_primary_shard_size',
    label: 'Maximum primary shard size',
    kind: 'size',
    placeholder: 'e.g. 50gb',
    hint: 'The largest primary shard',
    since: [7, 12],
  },
  {
    key: 'maxPrimaryShardDocs',
    param: 'max_primary_shard_docs',
    label: 'Maximum primary shard documents',
    kind: 'count',
    placeholder: 'e.g. 200000000',
    hint: 'In the largest primary shard',
    since: [8, 2],
  },
];

export const EMPTY_CONDITIONS: RolloverConditionsInput = {
  maxAge: '',
  maxDocs: '',
  maxSize: '',
  maxPrimaryShardSize: '',
  maxPrimaryShardDocs: '',
};

const AGE = /^\d+(d|h|m|s|ms|micros|nanos)$/;
const SIZE = /^\d+(\.\d+)?(b|kb|mb|gb|tb|pb)$/i;

/** Field errors of the rollover conditions (all optional). */
export function conditionErrors(conditions: RolloverConditionsInput): Partial<Record<RolloverConditionKey, string>> {
  const errors: Partial<Record<RolloverConditionKey, string>> = {};
  for (const condition of ROLLOVER_CONDITIONS) {
    const value = conditions[condition.key].trim();
    if (!value) {
      continue;
    }
    if (condition.kind === 'age' && !AGE.test(value)) {
      errors[condition.key] = 'Enter an age such as 30d, 12h or 90m';
    } else if (condition.kind === 'size' && !SIZE.test(value)) {
      errors[condition.key] = 'Enter a size such as 50gb or 500mb';
    } else if (condition.kind === 'count' && parseCount(value) === null) {
      errors[condition.key] = 'Enter a whole number above 0';
    }
  }
  return errors;
}

/** The `conditions` object of the rollover body (counts as numbers). */
export function conditionsBody(conditions: RolloverConditionsInput): Record<string, string | number> {
  const body: Record<string, string | number> = {};
  for (const condition of ROLLOVER_CONDITIONS) {
    const value = conditions[condition.key].trim();
    if (value) {
      body[condition.param] = condition.kind === 'count' ? Number(value) : value.toLowerCase();
    }
  }
  return body;
}

export function buildRolloverRequest(
  target: string,
  conditions: RolloverConditionsInput,
  newIndex: string,
  dryRun: boolean,
): PlannedRequest {
  const conditionValues = conditionsBody(conditions);
  const body: Record<string, unknown> = Object.keys(conditionValues).length > 0 ? { conditions: conditionValues } : {};
  const name = newIndex.trim();
  const payload: Record<string, unknown> = { alias: target, body, dry_run: dryRun };
  if (name) {
    payload['new_index'] = name;
  }
  return {
    endpoint: 'index_ops/rollover',
    payload,
    preview: {
      method: 'POST',
      path: `/${target}/_rollover${name ? `/${name}` : ''}${dryRun ? '?dry_run=true' : ''}`,
      body: Object.keys(body).length > 0 ? body : null,
      title: dryRun ? `Dry run of the rollover of ${target}` : `Roll over ${target}`,
    },
  };
}

const CONDITION_LABELS: Readonly<Record<string, string>> = Object.fromEntries(
  ROLLOVER_CONDITIONS.map((condition) => [condition.param, condition.label]),
);

/** Reads `"[max_docs: 3]": true` keys of a rollover response. */
export function interpretRollover(response: RolloverResponse | null | undefined): RolloverPreview {
  const conditions: ConditionResult[] = Object.entries(response?.conditions ?? {}).map(([raw, met]) => {
    const match = /^\[([a-z_]+):\s*(.*)\]$/i.exec(raw.trim());
    const key = match?.[1] ?? raw;
    return {
      key,
      label: CONDITION_LABELS[key] ?? humanize(key),
      value: match?.[2] ?? '',
      met: met === true,
    };
  });
  const order = (key: string): number => {
    const index = ROLLOVER_CONDITIONS.findIndex((condition) => condition.param === key);
    return index < 0 ? ROLLOVER_CONDITIONS.length : index;
  };
  conditions.sort((left, right) => order(left.key) - order(right.key) || left.key.localeCompare(right.key));
  const metCount = conditions.filter((condition) => condition.met).length;
  return {
    oldIndex: response?.old_index ?? null,
    newIndex: response?.new_index ?? null,
    rolledOver: response?.rolled_over === true,
    dryRun: response?.dry_run === true,
    conditions,
    metCount,
    // Max conditions roll over when any is met; no condition rolls over unconditionally.
    wouldRollOver: conditions.length === 0 || metCount > 0,
  };
}

/** Docs, sizes and age of the write index, next to the conditions. */
export function writeIndexFacts(index: SourceIndex): WriteIndexFacts {
  const primaries = index.shards.filter((copy) => copy.primary);
  const max = (values: readonly (number | null)[]): number | null => {
    const known = values.filter((value): value is number => value !== null);
    return known.length > 0 ? Math.max(...known) : null;
  };
  return {
    index: index.name,
    docs: index.docs,
    primarySize: index.primarySize,
    largestPrimarySize: max(primaries.map((copy) => copy.size)),
    largestPrimaryDocs: max(primaries.map((copy) => copy.docs)),
    createdAt: index.createdAt,
  };
}

/** The current value a condition is compared with ("12 documents", "3d old"). */
export function conditionCurrent(key: RolloverConditionKey, facts: WriteIndexFacts | null, now: number): number | null {
  if (!facts) {
    return null;
  }
  switch (key) {
    case 'maxAge':
      return facts.createdAt !== null ? Math.max(0, now - facts.createdAt) : null;
    case 'maxDocs':
      return facts.docs;
    case 'maxSize':
      return facts.primarySize;
    case 'maxPrimaryShardSize':
      return facts.largestPrimarySize;
    case 'maxPrimaryShardDocs':
      return facts.largestPrimaryDocs;
  }
}

export interface RolloverCheckInput {
  readonly target: RolloverTarget;
  readonly newIndex: string;
  readonly newIndexError: string | null;
  readonly conditionsValid: boolean;
  readonly dryRun:
    | { readonly state: 'idle' | 'loading' }
    | { readonly state: 'ready'; readonly preview: RolloverPreview }
    | { readonly state: 'error'; readonly reason: string };
}

/** Live preflight checks of a rollover. */
export function rolloverChecks(input: RolloverCheckInput): Check[] {
  const { target } = input;
  const checks: Check[] = [];
  if (target.problem || !target.writeIndex) {
    checks.push({ id: 'write-index', status: 'fail', title: 'No write index', detail: `${target.name}: ${target.problem ?? 'no write index'}.` });
  } else {
    checks.push({
      id: 'write-index',
      status: 'pass',
      title: target.kind === 'alias' ? 'Alias has a write index' : 'Data stream has a write index',
      detail: `New documents go to ${target.writeIndex}.`,
    });
  }
  if (target.implicitWrite && target.writeIndex) {
    checks.push({
      id: 'alias-moves',
      status: 'warn',
      title: `${target.name} moves to the new index`,
      detail: `${target.writeIndex} is not marked is_write_index: true, so the rollover moves the alias: afterwards ${target.name} points only to the new index and searches through it no longer see the documents in ${target.writeIndex}. Mark it as the write index first to keep both searchable.`,
      fix: 'make-write-index',
    });
  }
  let nameReady = true;
  if (target.kind === 'alias' && target.writeIndex) {
    const generated = nextRolloverName(target.writeIndex);
    if (input.newIndex.trim()) {
      nameReady = !input.newIndexError;
      checks.push(
        input.newIndexError
          ? { id: 'new-index', status: 'fail', title: 'New index name is not valid', detail: `${input.newIndexError}.` }
          : { id: 'new-index', status: 'pass', title: 'New index name', detail: `The new index is called ${input.newIndex.trim()}.` },
      );
    } else if (generated) {
      checks.push({ id: 'new-index', status: 'pass', title: 'New index name', detail: `Elasticsearch names the new index ${generated}.` });
    } else {
      nameReady = false;
      checks.push({
        id: 'new-index',
        status: 'fail',
        title: 'New index name needed',
        detail: `${target.writeIndex} does not end with "-" and a number, so Elasticsearch cannot name the next index. Enter a name.`,
      });
    }
  }
  if (!input.conditionsValid) {
    checks.push({ id: 'dry-run', status: 'warn', title: 'Dry run waits for valid conditions', detail: 'Fix the conditions to preview the rollover.' });
    return checks;
  }
  if (!nameReady || !target.writeIndex) {
    // The dry run runs once the new index has a valid name; the name check says what to do.
    return checks;
  }
  switch (input.dryRun.state) {
    case 'idle':
    case 'loading':
      checks.push({ id: 'dry-run', status: 'pending', title: 'Dry run', detail: 'Asking Elasticsearch what a rollover would do…' });
      break;
    case 'error':
      checks.push({ id: 'dry-run', status: 'fail', title: 'Dry run failed', detail: input.dryRun.reason });
      break;
    case 'ready': {
      const preview = input.dryRun.preview;
      const conditionText =
        preview.conditions.length === 0
          ? 'No conditions: the rollover happens unconditionally.'
          : preview.wouldRollOver
            ? `${formatNumber(preview.metCount)} of ${pluralize(preview.conditions.length, 'condition')} met: it would roll over now.`
            : `None of the ${pluralize(preview.conditions.length, 'condition')} is met yet: running it now changes nothing.`;
      checks.push({
        id: 'dry-run',
        status: preview.wouldRollOver ? 'pass' : 'warn',
        title: preview.wouldRollOver ? 'Dry run: would roll over' : 'Dry run: would not roll over',
        detail: conditionText,
      });
    }
  }
  return checks;
}

/* ---- Reindex ------------------------------------------------------------------------------- */

export const DEFAULT_REINDEX_OPTIONS: ReindexOptions = {
  sources: '',
  query: '',
  dest: '',
  existing: 'overwrite',
  conflicts: 'abort',
  maxDocs: '',
  slicesMode: 'none',
  slices: '',
  throttled: false,
  requestsPerSecond: '',
  script: '',
};

/** Comma separated index names and patterns, without blanks and duplicates. */
export function sourceExpressions(value: string): string[] {
  return [...new Set(value.split(',').map((part) => part.trim()).filter(Boolean))];
}

/**
 * The index Create index copies the settings and mappings from for a new
 * destination: the first regular index the sources read. Data stream backing
 * indices and dot-prefixed indices are passed over (a copy would be hidden
 * and bound to the data stream's lifecycle). Until the sources are looked
 * up, the first expression that plainly names an index; `null` when none.
 */
export function copySourceIndex(sources: Lookup, expressions: readonly string[], dataStreams: readonly string[]): string | null {
  if (sources.state === 'ready') {
    return sources.indices.find((index) => index.dataStream === null && !index.hidden && !index.name.startsWith('.'))?.name ?? null;
  }
  return expressions.find((name) => !/[*?]/.test(name) && !/^[.\-_+]/.test(name) && !dataStreams.includes(name)) ?? null;
}

export type QueryParse =
  | { readonly kind: 'empty' }
  | { readonly kind: 'object'; readonly value: JsonObject }
  | { readonly kind: 'invalid'; readonly message: string };

/** The optional query of a reindex: empty, a JSON object, or an error. */
export function parseQuery(text: string): QueryParse {
  if (!text.trim()) {
    return { kind: 'empty' };
  }
  try {
    const value: unknown = JSON.parse(text);
    return isRecord(value) && Object.keys(value).length > 0
      ? { kind: 'object', value }
      : { kind: 'invalid', message: 'The query must be a JSON object such as {"match_all": {}}' };
  } catch (error: unknown) {
    return { kind: 'invalid', message: `Invalid JSON: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export type ReindexField = 'sources' | 'query' | 'dest' | 'maxDocs' | 'slices' | 'requestsPerSecond';

/** Field errors of the reindex options, in the order of the form. */
export function reindexErrors(options: ReindexOptions): Partial<Record<ReindexField, string>> {
  const errors: Partial<Record<ReindexField, string>> = {};
  const sources = sourceExpressions(options.sources);
  if (sources.length === 0) {
    errors.sources = 'Enter at least one source index, alias or pattern';
  }
  const query = parseQuery(options.query);
  if (query.kind === 'invalid') {
    errors.query = query.message;
  }
  const dest = options.dest.trim();
  const destFormat = indexNameFormatError(dest);
  if (!dest) {
    errors.dest = 'Enter the destination index';
  } else if (destFormat) {
    errors.dest = destFormat;
  } else if (sources.includes(dest)) {
    errors.dest = 'The destination cannot be one of the sources';
  }
  if (options.maxDocs.trim() && parseCount(options.maxDocs) === null) {
    errors.maxDocs = 'Enter a whole number above 0, or leave it empty to copy everything';
  }
  if (options.slicesMode === 'custom') {
    const slices = parseCount(options.slices);
    if (slices === null || slices < 2 || slices > 1024) {
      errors.slices = 'Enter a number of slices from 2 to 1,024';
    } else {
      const maxDocs = parseCount(options.maxDocs);
      if (maxDocs !== null && maxDocs < slices && !errors.maxDocs) {
        errors.maxDocs = `Enter at least ${formatNumber(slices)}: Elasticsearch needs as many documents as slices`;
      }
    }
  }
  if (options.throttled) {
    const text = options.requestsPerSecond.trim();
    if (!/^\d+(\.\d+)?$/.test(text) || Number(text) <= 0) {
      errors.requestsPerSecond = 'Enter the documents per second, above 0';
    }
  }
  return errors;
}

export function buildReindexRequest(options: ReindexOptions, destIsDataStream: boolean): PlannedRequest {
  const sources = sourceExpressions(options.sources);
  const source: Record<string, unknown> = { index: sources.length === 1 ? sources[0] : sources };
  const query = parseQuery(options.query);
  if (query.kind === 'object') {
    source['query'] = query.value;
  }
  const dest: Record<string, unknown> = { index: options.dest.trim() };
  if (destIsDataStream || options.existing === 'skip') {
    // Only create documents (data streams accept nothing else): existing ids are version conflicts.
    dest['op_type'] = 'create';
  }
  const body: Record<string, unknown> = { source, dest };
  if (options.conflicts === 'proceed') {
    body['conflicts'] = 'proceed';
  }
  const maxDocs = parseCount(options.maxDocs);
  if (maxDocs !== null) {
    body['max_docs'] = maxDocs;
  }
  if (options.script.trim()) {
    body['script'] = { source: options.script.trim(), lang: 'painless' };
  }
  const payload: Record<string, unknown> = { body };
  const params = ['wait_for_completion=false'];
  if (options.slicesMode === 'auto') {
    payload['slices'] = 'auto';
  } else if (options.slicesMode === 'custom' && parseCount(options.slices) !== null) {
    payload['slices'] = String(parseCount(options.slices));
  }
  if (payload['slices']) {
    params.push(`slices=${String(payload['slices'])}`);
  }
  if (options.throttled && options.requestsPerSecond.trim()) {
    payload['requests_per_second'] = options.requestsPerSecond.trim();
    params.push(`requests_per_second=${options.requestsPerSecond.trim()}`);
  }
  return {
    endpoint: 'index_ops/reindex',
    payload,
    preview: {
      method: 'POST',
      path: `/_reindex?${params.join('&')}`,
      body,
      title: `Reindex into ${options.dest.trim()}`,
    },
  };
}

export type Lookup =
  | { readonly state: 'idle' | 'loading' }
  | { readonly state: 'missing' }
  | {
      readonly state: 'ready';
      readonly indices: readonly SourceIndex[];
      /** Closed indices only a pattern matched: the reindex skips them (sources only). */
      readonly skipped?: readonly SourceIndex[];
    }
  | { readonly state: 'error'; readonly reason: string };

export interface ReindexCheckInput {
  readonly sources: Lookup;
  readonly dest: Lookup;
  readonly destName: string;
  readonly destIsDataStream: boolean;
  /** Documents the destination already has are kept (`op_type: create`). */
  readonly skipExisting?: boolean;
  readonly conflicts?: 'abort' | 'proceed';
  readonly slicesMode?: SlicesMode;
  readonly maxDocs?: number | null;
}

/** Elasticsearch's ceiling for `slices=auto` (`BulkByScrollParallelizationHelper.AUTO_SLICE_CEILING`). */
export const AUTO_SLICE_CEILING = 20;

/** The slices `slices=auto` uses: one per shard of the source with the fewest shards, at most 20. */
export function autoSlices(indices: readonly SourceIndex[]): number | null {
  const shards = indices.map((index) => index.primaries).filter((value): value is number => value !== null && value > 0);
  return shards.length > 0 ? Math.min(AUTO_SLICE_CEILING, ...shards) : null;
}

/** Sum of known document counts, `null` when none is known. */
export function totalDocs(indices: readonly SourceIndex[]): number | null {
  const known = indices.map((index) => index.docs).filter((docs): docs is number => docs !== null);
  return known.length > 0 ? known.reduce((sum, docs) => sum + docs, 0) : null;
}

/** Live preflight checks of a reindex. */
export function reindexChecks(input: ReindexCheckInput): Check[] {
  const checks: Check[] = [];
  const { sources, dest } = input;
  switch (sources.state) {
    case 'idle':
      checks.push({ id: 'sources', status: 'warn', title: 'Sources', detail: 'Enter the indices to copy from.' });
      break;
    case 'loading':
      checks.push({ id: 'sources', status: 'pending', title: 'Sources', detail: 'Looking up the source indices…' });
      break;
    case 'missing':
      checks.push({ id: 'sources', status: 'fail', title: 'No source index', detail: 'Nothing matches the sources.' });
      break;
    case 'error':
      checks.push({ id: 'sources', status: 'fail', title: 'Sources not found', detail: sources.reason });
      break;
    case 'ready': {
      const skipped = (sources.skipped ?? []).map((index) => index.name);
      if (sources.indices.length === 0) {
        checks.push({
          id: 'sources',
          status: 'fail',
          title: 'No source index',
          detail:
            skipped.length > 0
              ? `The patterns only match closed indices (${skipped.join(', ')}), which a reindex skips.`
              : 'The patterns match no index.',
        });
        break;
      }
      const docs = totalDocs(sources.indices);
      checks.push({
        id: 'sources',
        status: 'pass',
        title: `${pluralize(sources.indices.length, 'source index', 'source indices')}`,
        detail: docs === null ? 'Document counts are not available.' : `${pluralize(docs, 'document')} to copy.`,
      });
      const closed = sources.indices.filter((index) => index.open === false).map((index) => index.name);
      if (closed.length > 0) {
        checks.push({
          id: 'sources-open',
          status: 'fail',
          title: closed.length === 1 ? 'A source is closed' : 'Sources are closed',
          detail: `${closed.join(', ')} ${closed.length === 1 ? 'is' : 'are'} closed and cannot be read.`,
        });
      }
      if (skipped.length > 0) {
        checks.push({
          id: 'sources-skipped',
          status: 'warn',
          title: skipped.length === 1 ? 'A closed index is skipped' : 'Closed indices are skipped',
          detail: `${skipped.join(', ')} ${skipped.length === 1 ? 'matches a pattern but is' : 'match a pattern but are'} closed: the reindex does not copy ${
            skipped.length === 1 ? 'it' : 'them'
          }. Open ${skipped.length === 1 ? 'it' : 'them'} first to include ${skipped.length === 1 ? 'it' : 'them'}.`,
        });
      }
      const slices = input.slicesMode === 'auto' ? autoSlices(sources.indices) : null;
      if (slices !== null && slices > 1 && input.maxDocs !== null && input.maxDocs !== undefined && input.maxDocs < slices) {
        checks.push({
          id: 'max-docs',
          status: 'fail',
          title: 'Maximum documents below the slices',
          detail: `Auto uses ${pluralize(slices, 'slice')} here, and Elasticsearch needs max_docs to be at least the number of slices. Raise the maximum or choose fewer slices.`,
        });
      }
    }
  }

  const name = input.destName.trim();
  switch (dest.state) {
    case 'idle':
      if (name) {
        checks.push({ id: 'dest', status: 'pending', title: 'Destination', detail: 'Looking up the destination…' });
      }
      break;
    case 'loading':
      checks.push({ id: 'dest', status: 'pending', title: 'Destination', detail: 'Looking up the destination…' });
      break;
    case 'missing':
      checks.push({
        id: 'dest',
        status: 'warn',
        title: `${name} does not exist yet`,
        detail:
          'Reindex creates it with dynamic mappings and the default settings, unless an index template matches. Create it first with the settings and mappings it needs.',
        fix: 'create-destination',
      });
      break;
    case 'error':
      checks.push({ id: 'dest', status: 'fail', title: 'Destination could not be checked', detail: dest.reason });
      break;
    case 'ready': {
      const blocked = dest.indices.filter((index) => index.writeBlocked);
      const docs = totalDocs(dest.indices);
      if (input.destIsDataStream) {
        checks.push({
          id: 'dest',
          status: 'pass',
          title: `${name} is a data stream`,
          detail: 'Documents are added with op_type create; the source documents need a @timestamp.',
        });
      } else {
        const holds = docs !== null && docs > 0;
        const kept = input.skipExisting
          ? input.conflicts === 'proceed'
            ? 'documents with an id it already has are skipped and counted as version conflicts.'
            : 'the first document with an id it already has stops the reindex (choose Proceed to skip them).'
          : 'documents with the same id are overwritten.';
        checks.push({
          id: 'dest',
          status: holds && (!input.skipExisting || input.conflicts !== 'proceed') ? 'warn' : 'pass',
          title: `${name} exists`,
          detail: holds ? `It already holds ${pluralize(docs, 'document')}; ${kept}` : 'Its mappings and settings are used.',
        });
      }
      const closedDest = dest.indices.filter((index) => index.open === false).map((index) => index.name);
      if (closedDest.length > 0) {
        checks.push({
          id: 'dest-open',
          status: 'fail',
          title: 'Destination is closed',
          detail: `${closedDest.join(', ')} ${closedDest.length === 1 ? 'is' : 'are'} closed: open ${closedDest.length === 1 ? 'it' : 'them'} first (Index details).`,
        });
      }
      if (blocked.length > 0) {
        checks.push({
          id: 'dest-writable',
          status: 'fail',
          title: 'Destination refuses writes',
          detail: `${blocked.map((index) => `${index.name} (${index.blockSettings.join(', ')})`).join(', ')}.`,
        });
      }
      const sourceNames = sources.state === 'ready' ? new Set(sources.indices.map((index) => index.name)) : new Set<string>();
      const overlap = dest.indices.filter((index) => sourceNames.has(index.name)).map((index) => index.name);
      if (overlap.length > 0) {
        checks.push({
          id: 'dest-overlap',
          status: 'fail',
          title: 'Destination is also a source',
          detail: `${overlap.join(', ')} would be read and written at the same time.`,
        });
      }
    }
  }
  return checks;
}

/* ---- Reindex progress ---------------------------------------------------------------------- */

function statusNumber(status: unknown, key: string): number {
  return isRecord(status) ? (toNumber(status[key]) ?? 0) : 0;
}

const COUNTERS = ['total', 'created', 'updated', 'deleted', 'noops', 'version_conflicts', 'batches', 'throttled_millis'] as const;
type Counter = (typeof COUNTERS)[number];

function addCounters(statuses: readonly unknown[]): Record<Counter, number> {
  const sum = Object.fromEntries(COUNTERS.map((key) => [key, 0])) as Record<Counter, number>;
  for (const status of statuses) {
    for (const key of COUNTERS) {
      sum[key] += statusNumber(status, key);
    }
  }
  return sum;
}

function failureList(value: unknown): ReindexFailure[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(isRecord).map((failure) => ({
    index: typeof failure['index'] === 'string' ? failure['index'] : null,
    id: typeof failure['id'] === 'string' ? failure['id'] : null,
    reason: sentence(elasticsearchReason(failure['cause'] ?? failure['reason'] ?? failure) ?? 'Unknown failure'),
    status: toNumber(failure['status']),
  }));
}

/** "[11]: version conflict, document already exists (current version [1])" without the id and version. */
function failureReasonKey(reason: string, id: string | null): string {
  let text = reason;
  if (id) {
    const prefix = `[${id}]: `;
    if (text.startsWith(prefix)) {
      text = text.slice(prefix.length);
    }
  }
  return sentence(text.replace(/\s*\(current version \[\d+\]\)/, ''));
}

/** Failures grouped by index, status and reason, largest group first. */
export function groupFailures(failures: readonly ReindexFailure[], sampleIds = 5): FailureGroup[] {
  const groups = new Map<string, { index: string | null; status: number | null; reason: string; count: number; ids: string[] }>();
  for (const failure of failures) {
    const reason = failureReasonKey(failure.reason, failure.id);
    const key = JSON.stringify([failure.index, failure.status, reason]);
    const group = groups.get(key) ?? { index: failure.index, status: failure.status, reason, count: 0, ids: [] };
    group.count++;
    if (failure.id !== null && group.ids.length < sampleIds) {
      group.ids.push(failure.id);
    }
    groups.set(key, group);
  }
  return [...groups.values()].sort((left, right) => right.count - left.count);
}

/**
 * Progress of a reindex task from `GET _tasks/{id}`. A sliced reindex only
 * reports finished slices in its own status; the running slices are its
 * sub-tasks (`children`, read with POST tasks `{ parent_task_id }`) and are added to it.
 */
export function reindexProgress(response: TaskGetResponse, children: readonly RawListedTask[] = [], taskId?: string): ReindexProgress {
  const completed = response.completed === true;
  const task = response.task;
  const status = completed && isRecord(response.response) ? response.response : (task?.status ?? {});
  const slicesValue = isRecord(task?.status) ? task.status['slices'] : undefined;
  const sliceStatuses = Array.isArray(slicesValue) ? slicesValue : null;
  const pendingSlices = completed || !sliceStatuses ? 0 : sliceStatuses.filter((slice) => slice === null).length;
  // A slice that finished between the two calls is in the parent's list already: do not count it twice.
  const finishedSlices = new Set(
    (sliceStatuses ?? []).filter(isRecord).map((slice) => toNumber(slice['slice_id'])).filter((id): id is number => id !== null),
  );
  const childStatuses = completed
    ? []
    : children
        .filter((child) => !taskId || child.parent_task_id === taskId)
        .map((child) => child.status ?? {})
        .filter((status) => {
          const sliceId = isRecord(status) ? toNumber(status['slice_id']) : null;
          return sliceId === null || !finishedSlices.has(sliceId);
        });
  const counters = addCounters([status, ...childStatuses]);
  const processed = counters.created + counters.updated + counters.deleted + counters.noops + counters.version_conflicts;
  const totalKnown = counters.total > 0 || (completed && processed === 0);
  const total = totalKnown ? counters.total : null;
  const runningMillis = Math.max(0, (task?.running_time_in_nanos ?? 0) / 1_000_000);
  const rate = runningMillis > 0 && processed > 0 ? processed / (runningMillis / 1000) : null;
  const remaining = total !== null ? Math.max(0, total - processed) : null;
  // A sliced reindex reports the throttle on its running slices (each gets its share).
  const ownRps = isRecord(status) ? toNumber(status['requests_per_second']) : null;
  const sliceRps = childStatuses.map((child) => (isRecord(child) ? toNumber(child['requests_per_second']) : null));
  const rps =
    ownRps !== null && ownRps > 0
      ? ownRps
      : sliceRps.length > 0 && sliceRps.every((value) => value !== null && value > 0)
        ? sliceRps.reduce<number>((sum, value) => sum + (value ?? 0), 0)
        : null;
  const failures = failureList(isRecord(response.response) ? response.response['failures'] : undefined);
  const error = response.error !== undefined && response.error !== null ? sentence(elasticsearchReason(response.error) ?? 'The task failed') : null;
  const cancelValue = isRecord(status) ? (status['canceled'] ?? status['cancelled']) : undefined;
  const cancelReason = typeof cancelValue === 'string' ? cancelValue : null;
  const timedOut = isRecord(response.response) && response.response['timed_out'] === true;
  let outcome: TaskOutcome = 'running';
  if (completed) {
    if (error) {
      outcome = 'failed';
    } else if (cancelReason) {
      outcome = 'cancelled';
    } else if (failures.length > 0 || timedOut) {
      outcome = counters.created + counters.updated + counters.deleted > 0 ? 'partial' : 'failed';
    } else {
      outcome = 'succeeded';
    }
  }
  return {
    outcome,
    completed,
    description: task?.description ?? null,
    total,
    created: counters.created,
    updated: counters.updated,
    deleted: counters.deleted,
    noops: counters.noops,
    versionConflicts: counters.version_conflicts,
    processed,
    percent: total !== null && total > 0 ? Math.min(100, (processed / total) * 100) : completed ? 100 : null,
    batches: counters.batches,
    runningMillis,
    rate,
    // A throttled reindex copies its first batches at full speed: the throttle bounds what is left.
    etaMillis:
      !completed && rate !== null && remaining !== null ? (remaining / (rps !== null && rps > 0 ? Math.min(rate, rps) : rate)) * 1000 : null,
    throttledMillis: counters.throttled_millis,
    requestsPerSecond: rps !== null && rps > 0 ? rps : null,
    slices: sliceStatuses ? sliceStatuses.length : null,
    pendingSlices: Math.max(0, pendingSlices - childStatuses.length),
    failures,
    error,
    cancelReason,
  };
}

/**
 * The progress shown while a task runs never goes backwards: a sliced task is
 * read in two calls, and a slice can finish between them for one poll.
 */
export function steadyProgress(previous: ReindexProgress | null, next: ReindexProgress): ReindexProgress {
  if (!previous || next.completed || previous.processed <= next.processed) {
    return next;
  }
  const created = Math.max(previous.created, next.created);
  const updated = Math.max(previous.updated, next.updated);
  const deleted = Math.max(previous.deleted, next.deleted);
  const noops = Math.max(previous.noops, next.noops);
  const versionConflicts = Math.max(previous.versionConflicts, next.versionConflicts);
  const processed = Math.max(previous.processed, created + updated + deleted + noops + versionConflicts);
  const total = next.total ?? previous.total;
  return {
    ...next,
    created,
    updated,
    deleted,
    noops,
    versionConflicts,
    processed,
    batches: Math.max(previous.batches, next.batches),
    percent: total !== null && total > 0 ? Math.min(100, (processed / total) * 100) : next.percent,
    rate: next.runningMillis > 0 ? processed / (next.runningMillis / 1000) : next.rate,
  };
}

/** The destination named in a reindex task description ("reindex from [a, b] to [c]"). */
export function describedReindex(description: string | null | undefined): { readonly sources: string; readonly dest: string } | null {
  const match = /^reindex from \[(.*)\] to \[([^\]]+)\]/.exec(description ?? '');
  if (!match?.[1] || !match[2]) {
    return null;
  }
  return { sources: match[1].replace(/\s*,\s*/g, ', '), dest: match[2] };
}

/** Whether the running slices must be read (POST tasks `{ parent_task_id }`): some are not finished yet. */
export function needsSliceChildren(response: TaskGetResponse): boolean {
  if (response.completed === true) {
    return false;
  }
  const slices = isRecord(response.task?.status) ? response.task.status['slices'] : undefined;
  return Array.isArray(slices) && slices.some((slice) => slice === null);
}

/* ---- Request text ----------------------------------------------------------------------- */

/** The request in Kibana console form ("POST /logs/_shrink/x" + body). */
export function requestText(preview: RequestPreview): string {
  const line = `${preview.method} ${preview.path}`;
  return preview.body ? `${line}\n${JSON.stringify(preview.body, null, 2)}` : line;
}
