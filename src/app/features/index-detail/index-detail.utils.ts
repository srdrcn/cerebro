import { formatBytes, formatDuration, formatNumber, humanize, pluralize, textMatcher } from '../../core/format';
import { HealthTone, healthFromShardCopies, healthTone } from '../../core/health';
import { isRecord } from '../../core/json';
import { unassignedReason } from '../../core/shards';
import {
  AliasDetail,
  CatShardRow,
  DETAIL_TABS,
  DetailTab,
  FlatSetting,
  IlmExplainResponse,
  IndexDetail,
  IndexDetailResponse,
  IndexOpenState,
  IndexOperation,
  IndexOperationDefinition,
  IndexResolution,
  IndexSummary,
  JsonObject,
  KeySettings,
  LifecyclePhaseAction,
  LifecycleState,
  LifecycleStepError,
  LifecycleTimes,
  MappingDetail,
  MappingField,
  MappingInfo,
  ShardGroup,
  ShardHealthSummary,
  ShardRow,
  ShardSortField,
  ShardState,
  StatItem,
  StatKind,
  StatSection,
  StepInfoSummary,
} from './index-detail.models';

/* ---- Generic helpers ---------------------------------------------------- */

/** Reads `a.b.c` from nested objects; `undefined` when any step is missing. */
function readPath(source: unknown, path: string): unknown {
  let current: unknown = source;
  for (const part of path.split('.')) {
    if (!isRecord(current)) {
      return undefined;
    }
    current = current[part];
  }
  return current;
}

export function readNumber(source: unknown, path: string): number | null {
  const value = readPath(source, path);
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

function readString(source: unknown, path: string): string | null {
  const value = readPath(source, path);
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return null;
}

/** Scalars as text, arrays as a comma separated list, objects as compact JSON. */
function displayValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (Array.isArray(value)) {
    return value.every((item) => !isRecord(item) && !Array.isArray(item))
      ? value.map((item) => displayValue(item)).join(', ')
      : JSON.stringify(value);
  }
  if (isRecord(value)) {
    return JSON.stringify(value);
  }
  return String(value);
}

/* ---- Tabs ----------------------------------------------------------------- */

export function parseTab(value: string | null | undefined): DetailTab {
  return DETAIL_TABS.find((tab) => tab.key === value)?.key ?? 'overview';
}

/** Arrow / Home / End navigation between tabs (wraps around). */
export function nextTab(current: DetailTab, key: string): DetailTab | null {
  const index = DETAIL_TABS.findIndex((tab) => tab.key === current);
  const last = DETAIL_TABS.length - 1;
  let next: number;
  switch (key) {
    case 'ArrowRight':
      next = index >= last ? 0 : index + 1;
      break;
    case 'ArrowLeft':
      next = index <= 0 ? last : index - 1;
      break;
    case 'Home':
      next = 0;
      break;
    case 'End':
      next = last;
      break;
    default:
      return null;
  }
  return DETAIL_TABS[next]?.key ?? null;
}

/* ---- Response resolution -------------------------------------------------- */

/**
 * Picks the concrete index out of an index_detail response. The name in the
 * URL may be an alias: one target is shown directly, several ask the user to
 * choose.
 */
export function resolveIndexDetail(response: IndexDetailResponse, requested: string): IndexResolution {
  const names = Object.keys(response.settings ?? {}).sort((left, right) => left.localeCompare(right));
  if (names.length === 0) {
    return { kind: 'missing' };
  }
  const name = names.includes(requested) ? requested : names.length === 1 ? names[0] : undefined;
  if (name === undefined) {
    return { kind: 'multiple', indices: names };
  }
  const statsEntry = response.stats?.indices?.[name];
  const shards = response.shards ? response.shards.filter((row) => row.index === name) : null;
  return {
    kind: 'single',
    detail: {
      name,
      settings: response.settings[name]?.settings ?? {},
      mappings: response.mappings?.[name]?.mappings ?? null,
      stats: statsEntry ?? null,
      aliases: response.aliases?.[name]?.aliases ?? null,
      shards,
    },
  };
}

/* ---- Settings --------------------------------------------------------------- */

/** Nested settings → sorted `index.refresh_interval = 1s` rows. */
export function flattenSettings(settings: JsonObject, prefix = ''): FlatSetting[] {
  const rows: FlatSetting[] = [];
  const visit = (value: unknown, path: string): void => {
    if (isRecord(value)) {
      const entries = Object.entries(value);
      if (entries.length === 0 && path) {
        rows.push({ key: path, value: '{}' });
      }
      for (const [key, child] of entries) {
        visit(child, path ? `${path}.${key}` : key);
      }
    } else {
      rows.push({ key: path, value: displayValue(value) });
    }
  };
  visit(settings, prefix);
  return rows.sort((left, right) => left.key.localeCompare(right.key));
}

export function filterSettings(rows: readonly FlatSetting[], query: string): readonly FlatSetting[] {
  if (!query.trim()) {
    return rows;
  }
  const matches = textMatcher(query);
  return rows.filter((row) => matches(row.key) || matches(row.value));
}

function settingMap(settings: JsonObject): ReadonlyMap<string, string> {
  return new Map(flattenSettings(settings).map((row) => [row.key, row.value]));
}

const BLOCKS: readonly (readonly [string, string])[] = [
  ['index.blocks.read_only', 'Read only'],
  ['index.blocks.read_only_allow_delete', 'Read only (allow delete)'],
  ['index.blocks.write', 'Writes blocked'],
  ['index.blocks.read', 'Reads blocked'],
  ['index.blocks.metadata', 'Metadata blocked'],
];

/**
 * Index versions before 8.11 encode the Elasticsearch release
 * (`7170099` → 7.17.0); later ones are opaque index format ids.
 */
export function decodeVersion(raw: string | null): string | null {
  if (!raw || !/^\d+$/.test(raw)) {
    return null;
  }
  const id = Number(raw);
  const major = Math.floor(id / 1_000_000);
  const minor = Math.floor(id / 10_000) % 100;
  const revision = Math.floor(id / 100) % 100;
  if (major < 1 || minor >= 50) {
    return null;
  }
  return `${major}.${minor}.${revision}`;
}

export function keySettings(detail: IndexDetail): KeySettings {
  const map = settingMap(detail.settings);
  const get = (key: string): string | null => map.get(key) ?? null;
  const shards = Number(get('index.number_of_shards'));
  const created = Number(get('index.creation_date'));
  const refresh = get('index.refresh_interval');
  const versionRaw = get('index.version.created');
  return {
    primaries: Number.isFinite(shards) && shards > 0 ? shards : null,
    replicas: get('index.number_of_replicas'),
    autoExpandReplicas: get('index.auto_expand_replicas') === 'false' ? null : get('index.auto_expand_replicas'),
    refreshInterval: refresh ?? '1s',
    refreshIntervalIsDefault: refresh === null,
    createdAt: Number.isFinite(created) && created > 0 ? new Date(created) : null,
    uuid: get('index.uuid'),
    versionCreated: decodeVersion(versionRaw),
    versionCreatedRaw: versionRaw,
    lifecyclePolicy: get('index.lifecycle.name') || null,
    tierPreference: get('index.routing.allocation.include._tier_preference'),
    defaultPipeline: get('index.default_pipeline') && get('index.default_pipeline') !== '_none' ? get('index.default_pipeline') : null,
    hidden: get('index.hidden') === 'true',
    blocks: BLOCKS.filter(([key]) => get(key) === 'true').map(([, label]) => label),
    closed: isClosed(detail),
    openState: indexOpenState(detail),
  };
}

/**
 * Open / closed state. Missing statistics alone do not mean "closed": the
 * stats call also fails for users without the monitor privilege, on timeouts
 * or on server errors, so that case is reported as "unknown".
 */
export function indexOpenState(detail: IndexDetail): IndexOpenState {
  const status = detail.stats?.status;
  if (status === 'close' || status === 'open') {
    return status === 'close' ? 'closed' : 'open';
  }
  if (settingMap(detail.settings).get('index.verified_before_close') === 'true') {
    return 'closed';
  }
  return detail.stats ? 'open' : 'unknown';
}

export function isClosed(detail: IndexDetail): boolean {
  return indexOpenState(detail) === 'closed';
}

/* ---- Health and summary --------------------------------------------------- */

/** The reported health, or one derived from the shard copies ("gray" when unknown). */
export function indexHealth(detail: IndexDetail, shards: readonly ShardRow[]): HealthTone {
  const reported = healthTone(detail.stats?.health);
  return reported !== 'gray' ? reported : healthFromShardCopies(shards);
}

export function indexSummary(detail: IndexDetail, shards: readonly ShardRow[]): IndexSummary {
  const settings = keySettings(detail);
  const replicas = Number(settings.replicas);
  const base = {
    primaries: settings.primaries,
    replicas: settings.replicas !== null && Number.isFinite(replicas) ? replicas : null,
  };
  const primaries = detail.stats?.primaries;
  const total = detail.stats?.total;
  if (primaries || total) {
    return {
      ...base,
      docs: readNumber(primaries, 'docs.count'),
      deletedDocs: readNumber(primaries, 'docs.deleted'),
      primarySize: readNumber(primaries, 'store.size_in_bytes'),
      totalSize: readNumber(total, 'store.size_in_bytes'),
      segments: readNumber(total, 'segments.count'),
      estimated: false,
    };
  }
  const started = shards.filter((row) => row.size !== null);
  const primaryRows = started.filter((row) => row.primary);
  const sum = (rows: readonly ShardRow[], pick: (row: ShardRow) => number | null): number | null =>
    rows.length === 0 ? null : rows.reduce((acc, row) => acc + (pick(row) ?? 0), 0);
  return {
    ...base,
    docs: sum(primaryRows, (row) => row.docs),
    deletedDocs: null,
    primarySize: sum(primaryRows, (row) => row.size),
    totalSize: sum(started, (row) => row.size),
    segments: null,
    estimated: true,
  };
}

/* ---- Mappings ------------------------------------------------------------- */

const OBJECT_TYPES = new Set(['object', 'nested', 'flattened']);
const MAPPING_STRUCTURE_KEYS = new Set(['type', 'properties', 'fields']);

function fieldDetails(definition: JsonObject): MappingDetail[] {
  return Object.entries(definition)
    .filter(([key]) => !MAPPING_STRUCTURE_KEYS.has(key))
    .map(([key, value]) => ({
      key,
      value: key === 'script' && isRecord(value) && typeof value['source'] === 'string' ? value['source'] : displayValue(value),
    }));
}

function walkProperties(properties: JsonObject, prefix: string, depth: number, out: MappingField[]): void {
  for (const [name, raw] of Object.entries(properties)) {
    if (!isRecord(raw)) {
      continue;
    }
    const path = prefix ? `${prefix}.${name}` : name;
    const children = isRecord(raw['properties']) ? raw['properties'] : null;
    const multiFields = isRecord(raw['fields']) ? raw['fields'] : null;
    const type = typeof raw['type'] === 'string' ? raw['type'] : 'object';
    out.push({
      path,
      name,
      depth,
      type,
      multiField: false,
      runtime: false,
      hasChildren: Boolean((children && Object.keys(children).length > 0) || (multiFields && Object.keys(multiFields).length > 0)),
      details: fieldDetails(raw),
    });
    if (multiFields) {
      for (const [subName, subRaw] of Object.entries(multiFields)) {
        if (!isRecord(subRaw)) {
          continue;
        }
        out.push({
          path: `${path}.${subName}`,
          name: subName,
          depth: depth + 1,
          type: typeof subRaw['type'] === 'string' ? subRaw['type'] : 'object',
          multiField: true,
          runtime: false,
          hasChildren: false,
          details: fieldDetails(subRaw),
        });
      }
    }
    if (children) {
      walkProperties(children, path, depth + 1, out);
    }
  }
}

/** Flattens a mapping into a depth-annotated field list (tree order). */
export function mappingInfo(mappings: JsonObject | null): MappingInfo {
  const fields: MappingField[] = [];
  const source = mappings ?? {};
  if (isRecord(source['properties'])) {
    walkProperties(source['properties'], '', 0, fields);
  }
  if (isRecord(source['runtime'])) {
    for (const [name, raw] of Object.entries(source['runtime'])) {
      if (isRecord(raw)) {
        fields.push({
          path: name,
          name,
          depth: 0,
          type: typeof raw['type'] === 'string' ? raw['type'] : 'keyword',
          multiField: false,
          runtime: true,
          hasChildren: false,
          details: fieldDetails(raw),
        });
      }
    }
  }
  const dynamic = source['dynamic'];
  return {
    fields,
    dynamic: dynamic === undefined ? null : String(dynamic),
    sourceEnabled: readPath(source, '_source.enabled') !== false,
    dynamicTemplates: Array.isArray(source['dynamic_templates']) ? source['dynamic_templates'].length : 0,
    dataStreamTimestamp: readPath(source, '_data_stream_timestamp.enabled') === true,
    meta: isRecord(source['_meta']) ? source['_meta'] : null,
    routingRequired: readPath(source, '_routing.required') === true,
  };
}

export function isObjectType(type: string): boolean {
  return OBJECT_TYPES.has(type);
}

/** Number of leaf fields (objects and multi-fields not counted twice). */
export function countLeafFields(fields: readonly MappingField[]): number {
  return fields.filter((field) => !isObjectType(field.type) || !field.hasChildren).length;
}

export function filterMappingFields(fields: readonly MappingField[], query: string): readonly MappingField[] {
  if (!query.trim()) {
    return fields;
  }
  const matches = textMatcher(query);
  return fields.filter(
    (field) => matches(field.path) || matches(field.type) || field.details.some((detail) => matches(detail.value)),
  );
}

/** Badge colour of a field type. */
export function typeTone(type: string): 'blue' | 'green' | 'purple' | 'yellow' | 'accent' | 'outline' {
  if (['text', 'match_only_text', 'search_as_you_type', 'completion', 'annotated_text'].includes(type)) {
    return 'blue';
  }
  if (['keyword', 'constant_keyword', 'wildcard', 'ip', 'version'].includes(type)) {
    return 'green';
  }
  if (
    ['long', 'integer', 'short', 'byte', 'double', 'float', 'half_float', 'scaled_float', 'unsigned_long'].includes(type) ||
    type.endsWith('_range')
  ) {
    return 'purple';
  }
  if (['date', 'date_nanos'].includes(type)) {
    return 'yellow';
  }
  if (OBJECT_TYPES.has(type)) {
    return 'outline';
  }
  return 'accent';
}

/* ---- Stats ----------------------------------------------------------------- */

interface StatSpec {
  readonly label: string;
  readonly path: string;
  readonly kind: StatKind;
  readonly hint?: string;
}

interface SectionSpec {
  readonly key: string;
  readonly title: string;
  readonly icon: string;
  readonly items: readonly StatSpec[];
  readonly ratios?: readonly {
    readonly label: string;
    readonly numerator: string;
    readonly denominator: string | readonly string[];
    readonly kind: 'percent' | 'latency';
    readonly hint?: string;
  }[];
}

const STAT_SECTIONS: readonly SectionSpec[] = [
  {
    key: 'indexing',
    title: 'Indexing',
    icon: 'bi-pencil-square',
    items: [
      { label: 'Index operations', path: 'indexing.index_total', kind: 'count' },
      { label: 'Indexing time', path: 'indexing.index_time_in_millis', kind: 'millis' },
      { label: 'In progress', path: 'indexing.index_current', kind: 'count' },
      { label: 'Failed', path: 'indexing.index_failed', kind: 'count' },
      { label: 'Deletes', path: 'indexing.delete_total', kind: 'count' },
      { label: 'No-op updates', path: 'indexing.noop_update_total', kind: 'count' },
      { label: 'Throttled for', path: 'indexing.throttle_time_in_millis', kind: 'millis' },
    ],
    ratios: [
      {
        label: 'Avg. indexing latency',
        numerator: 'indexing.index_time_in_millis',
        denominator: 'indexing.index_total',
        kind: 'latency',
      },
    ],
  },
  {
    key: 'search',
    title: 'Search',
    icon: 'bi-search',
    items: [
      { label: 'Queries', path: 'search.query_total', kind: 'count' },
      { label: 'Query time', path: 'search.query_time_in_millis', kind: 'millis' },
      { label: 'Fetches', path: 'search.fetch_total', kind: 'count' },
      { label: 'Fetch time', path: 'search.fetch_time_in_millis', kind: 'millis' },
      { label: 'Scrolls', path: 'search.scroll_total', kind: 'count' },
      { label: 'Open contexts', path: 'search.open_contexts', kind: 'count' },
      { label: 'Running queries', path: 'search.query_current', kind: 'count' },
      { label: 'Suggests', path: 'search.suggest_total', kind: 'count' },
    ],
    ratios: [
      {
        label: 'Avg. query latency',
        numerator: 'search.query_time_in_millis',
        denominator: 'search.query_total',
        kind: 'latency',
      },
    ],
  },
  {
    key: 'get',
    title: 'Get',
    icon: 'bi-file-earmark-text',
    items: [
      { label: 'Gets', path: 'get.total', kind: 'count' },
      { label: 'Get time', path: 'get.time_in_millis', kind: 'millis' },
      { label: 'Found', path: 'get.exists_total', kind: 'count' },
      { label: 'Missing', path: 'get.missing_total', kind: 'count' },
      { label: 'In progress', path: 'get.current', kind: 'count' },
    ],
  },
  {
    key: 'merges',
    title: 'Merges',
    icon: 'bi-intersect',
    items: [
      { label: 'Running', path: 'merges.current', kind: 'count' },
      { label: 'Completed', path: 'merges.total', kind: 'count' },
      { label: 'Merge time', path: 'merges.total_time_in_millis', kind: 'millis' },
      { label: 'Merged documents', path: 'merges.total_docs', kind: 'count' },
      { label: 'Merged size', path: 'merges.total_size_in_bytes', kind: 'bytes' },
      { label: 'Throttled for', path: 'merges.total_throttled_time_in_millis', kind: 'millis' },
      {
        label: 'Auto-throttle',
        path: 'merges.total_auto_throttle_in_bytes',
        kind: 'rate',
        hint: 'Current merge I/O rate limit',
      },
    ],
  },
  {
    key: 'refresh',
    title: 'Refresh',
    icon: 'bi-arrow-repeat',
    items: [
      { label: 'Refreshes', path: 'refresh.total', kind: 'count' },
      { label: 'Refresh time', path: 'refresh.total_time_in_millis', kind: 'millis' },
      { label: 'External refreshes', path: 'refresh.external_total', kind: 'count' },
      { label: 'External refresh time', path: 'refresh.external_total_time_in_millis', kind: 'millis' },
      { label: 'Waiting listeners', path: 'refresh.listeners', kind: 'count' },
    ],
  },
  {
    key: 'flush',
    title: 'Flush',
    icon: 'bi-save',
    items: [
      { label: 'Flushes', path: 'flush.total', kind: 'count' },
      { label: 'Periodic flushes', path: 'flush.periodic', kind: 'count' },
      { label: 'Flush time', path: 'flush.total_time_in_millis', kind: 'millis' },
    ],
  },
  {
    key: 'query_cache',
    title: 'Query cache',
    icon: 'bi-lightning-charge',
    items: [
      { label: 'Memory', path: 'query_cache.memory_size_in_bytes', kind: 'bytes' },
      { label: 'Hits', path: 'query_cache.hit_count', kind: 'count' },
      { label: 'Misses', path: 'query_cache.miss_count', kind: 'count' },
      { label: 'Cached queries', path: 'query_cache.cache_count', kind: 'count' },
      { label: 'Evictions', path: 'query_cache.evictions', kind: 'count' },
    ],
    ratios: [
      {
        label: 'Hit ratio',
        numerator: 'query_cache.hit_count',
        denominator: ['query_cache.hit_count', 'query_cache.miss_count'],
        kind: 'percent',
      },
    ],
  },
  {
    key: 'request_cache',
    title: 'Request cache',
    icon: 'bi-box-seam',
    items: [
      { label: 'Memory', path: 'request_cache.memory_size_in_bytes', kind: 'bytes' },
      { label: 'Hits', path: 'request_cache.hit_count', kind: 'count' },
      { label: 'Misses', path: 'request_cache.miss_count', kind: 'count' },
      { label: 'Evictions', path: 'request_cache.evictions', kind: 'count' },
    ],
    ratios: [
      {
        label: 'Hit ratio',
        numerator: 'request_cache.hit_count',
        denominator: ['request_cache.hit_count', 'request_cache.miss_count'],
        kind: 'percent',
      },
    ],
  },
  {
    key: 'fielddata',
    title: 'Fielddata',
    icon: 'bi-memory',
    items: [
      { label: 'Memory', path: 'fielddata.memory_size_in_bytes', kind: 'bytes' },
      { label: 'Evictions', path: 'fielddata.evictions', kind: 'count' },
      { label: 'Global ordinals build time', path: 'fielddata.global_ordinals.build_time_in_millis', kind: 'millis' },
    ],
  },
  {
    key: 'segments',
    title: 'Segments',
    icon: 'bi-layers',
    items: [
      { label: 'Segments', path: 'segments.count', kind: 'count' },
      { label: 'Memory', path: 'segments.memory_in_bytes', kind: 'bytes' },
      { label: 'Index writer memory', path: 'segments.index_writer_memory_in_bytes', kind: 'bytes' },
      { label: 'Version map memory', path: 'segments.version_map_memory_in_bytes', kind: 'bytes' },
      { label: 'Fixed bitset memory', path: 'segments.fixed_bit_set_memory_in_bytes', kind: 'bytes' },
    ],
  },
  {
    key: 'translog',
    title: 'Translog',
    icon: 'bi-journal-text',
    items: [
      { label: 'Operations', path: 'translog.operations', kind: 'count' },
      { label: 'Size', path: 'translog.size_in_bytes', kind: 'bytes' },
      { label: 'Uncommitted operations', path: 'translog.uncommitted_operations', kind: 'count' },
      { label: 'Uncommitted size', path: 'translog.uncommitted_size_in_bytes', kind: 'bytes' },
      {
        label: 'Oldest change',
        path: 'translog.earliest_last_modified_age',
        kind: 'millis',
        hint: 'Age of the oldest operation not yet flushed',
      },
    ],
  },
  {
    key: 'docs',
    title: 'Documents and storage',
    icon: 'bi-hdd',
    items: [
      { label: 'Documents', path: 'docs.count', kind: 'count' },
      { label: 'Deleted documents', path: 'docs.deleted', kind: 'count' },
      { label: 'Store size', path: 'store.size_in_bytes', kind: 'bytes' },
      { label: 'Data set size', path: 'store.total_data_set_size_in_bytes', kind: 'bytes' },
      { label: 'Reserved', path: 'store.reserved_in_bytes', kind: 'bytes' },
      { label: 'Completion', path: 'completion.size_in_bytes', kind: 'bytes' },
    ],
  },
];

export function formatStat(value: number, kind: StatKind): string {
  switch (kind) {
    case 'bytes':
      return formatBytes(value);
    case 'rate':
      return `${formatBytes(value)}/s`;
    case 'millis':
      return value === 0 ? '0s' : formatDuration(value);
    case 'percent':
      return `${value.toLocaleString('en-US', { maximumFractionDigits: 1 })}%`;
    case 'count':
      return formatNumber(value);
    case 'text':
      return String(value);
  }
}

/** Readable, grouped index statistics (primaries or totals). */
export function statSections(group: JsonObject | null | undefined): readonly StatSection[] {
  if (!group) {
    return [];
  }
  return STAT_SECTIONS.flatMap((section) => {
    const items: StatItem[] = [];
    for (const spec of section.items) {
      const value = readNumber(group, spec.path);
      if (value !== null) {
        items.push({ label: spec.label, value: formatStat(value, spec.kind), ...(spec.hint ? { hint: spec.hint } : {}) });
      }
    }
    for (const ratio of section.ratios ?? []) {
      const numerator = readNumber(group, ratio.numerator);
      const denominators = (typeof ratio.denominator === 'string' ? [ratio.denominator] : ratio.denominator).map((path) =>
        readNumber(group, path),
      );
      if (numerator === null || denominators.some((value) => value === null)) {
        continue;
      }
      const denominator = denominators.reduce<number>((sum, value) => sum + (value ?? 0), 0);
      const value =
        denominator === 0
          ? '–'
          : ratio.kind === 'percent'
            ? formatStat((numerator / denominator) * 100, 'percent')
            : `${(numerator / denominator).toLocaleString('en-US', { maximumFractionDigits: 2 })}ms`;
      items.splice(ratio.kind === 'percent' ? 1 : 2, 0, { label: ratio.label, value, ...(ratio.hint ? { hint: ratio.hint } : {}) });
    }
    if (section.key === 'indexing' && readPath(group, 'indexing.is_throttled') === true) {
      items.push({ label: 'Throttled now', value: 'Yes' });
    }
    return items.length > 0 ? [{ key: section.key, title: section.title, icon: section.icon, items }] : [];
  });
}

/* ---- Shards ---------------------------------------------------------------- */

export function unassignedReasonLabel(reason: string | null): string | null {
  if (!reason) {
    return null;
  }
  return unassignedReason(reason).label;
}

function shardState(state: string): ShardState {
  switch (state.toUpperCase()) {
    case 'STARTED':
      return 'started';
    case 'INITIALIZING':
      return 'initializing';
    case 'RELOCATING':
      return 'relocating';
    case 'UNASSIGNED':
      return 'unassigned';
    default:
      return 'unknown';
  }
}

function toNumber(value: string | null): number | null {
  if (value === null || value === '' || !Number.isFinite(Number(value))) {
    return null;
  }
  return Number(value);
}

/** `_cat/shards` rows → typed rows (relocation targets split out). */
export function shardRows(rows: readonly CatShardRow[] | null): ShardRow[] {
  return (rows ?? []).map((row, position) => {
    const state = shardState(row.state);
    let node = row.node;
    let relocatingTo: string | null = null;
    if (node && node.includes('->')) {
      const [source, target] = node.split('->');
      node = source?.trim() || null;
      relocatingTo = target?.trim().split(/\s+/).pop() ?? null;
    }
    const reason = row['unassigned.reason'];
    return {
      key: `${row.shard}-${row.prirep}-${position}`,
      shard: Number(row.shard),
      primary: row.prirep === 'p' || row.prirep === 'primary',
      state,
      stateLabel: humanize(row.state),
      docs: toNumber(row.docs),
      size: toNumber(row.store),
      node,
      ip: row.ip,
      relocatingTo,
      unassignedReason: reason,
      unassignedReasonLabel: unassignedReasonLabel(reason),
      unassignedFor: row['unassigned.for'],
    };
  });
}

const STATE_ORDER: Readonly<Record<ShardState, number>> = {
  unassigned: 0,
  initializing: 1,
  relocating: 2,
  unknown: 3,
  started: 4,
};

function compareDefault(left: ShardRow, right: ShardRow): number {
  return left.shard - right.shard || Number(right.primary) - Number(left.primary) || (left.node ?? '').localeCompare(right.node ?? '');
}

export function sortShards(rows: readonly ShardRow[], field: ShardSortField, reverse: boolean): ShardRow[] {
  const direction = reverse ? -1 : 1;
  return [...rows].sort((left, right) => {
    let result = 0;
    switch (field) {
      case 'shard':
        return direction * (left.shard - right.shard) || compareDefault(left, right);
      case 'state':
        result = STATE_ORDER[left.state] - STATE_ORDER[right.state];
        break;
      case 'node':
        if (!left.node || !right.node) {
          return left.node === right.node ? compareDefault(left, right) : left.node ? -1 : 1;
        }
        result = left.node.localeCompare(right.node);
        break;
      case 'docs':
      case 'size': {
        const leftValue = left[field];
        const rightValue = right[field];
        if (leftValue === null || rightValue === null) {
          return leftValue === rightValue ? compareDefault(left, right) : leftValue === null ? 1 : -1;
        }
        result = leftValue - rightValue;
        break;
      }
    }
    return direction * result || compareDefault(left, right);
  });
}

export function summarizeShards(rows: readonly ShardRow[]): ShardHealthSummary {
  const count = (state: ShardState): number => rows.filter((row) => row.state === state).length;
  const groups = new Map<number, ShardRow[]>();
  const nodes = new Map<string, { primaries: number; replicas: number }>();
  for (const row of [...rows].sort(compareDefault)) {
    groups.set(row.shard, [...(groups.get(row.shard) ?? []), row]);
    if (row.node && row.state !== 'unassigned') {
      const entry = nodes.get(row.node) ?? { primaries: 0, replicas: 0 };
      if (row.primary) {
        entry.primaries++;
      } else {
        entry.replicas++;
      }
      nodes.set(row.node, entry);
    }
  }
  return {
    total: rows.length,
    started: count('started'),
    initializing: count('initializing'),
    relocating: count('relocating'),
    unassigned: count('unassigned'),
    unassignedPrimaries: rows.filter((row) => row.primary && row.state === 'unassigned').length,
    nodes: [...nodes.entries()]
      .map(([name, counts]) => ({ name, ...counts }))
      .sort((left, right) => left.name.localeCompare(right.name)),
    groups: [...groups.entries()]
      .sort(([left], [right]) => left - right)
      .map(([shard, copies]): ShardGroup => ({ shard, copies })),
  };
}

export function shardStateTone(row: ShardRow): 'green' | 'blue' | 'purple' | 'yellow' | 'red' | 'outline' {
  switch (row.state) {
    case 'started':
      return 'green';
    case 'initializing':
      return 'blue';
    case 'relocating':
      return 'purple';
    case 'unassigned':
      return row.primary ? 'red' : 'yellow';
    case 'unknown':
      return 'outline';
  }
}

/** Query parameters of the allocation explain page for one shard copy. */
export function explainQuery(index: string, row: ShardRow): { index: string; shard: number; primary: boolean } {
  return { index, shard: row.shard, primary: row.primary };
}

/* ---- Aliases --------------------------------------------------------------- */

export function aliasDetails(aliases: Readonly<Record<string, JsonObject>> | null): AliasDetail[] {
  return Object.entries(aliases ?? {})
    .map(([name, raw]) => {
      const routing = readString(raw, 'routing');
      const writeIndex = raw['is_write_index'];
      return {
        name,
        filter: isRecord(raw['filter']) ? raw['filter'] : null,
        indexRouting: readString(raw, 'index_routing') ?? routing,
        searchRouting: readString(raw, 'search_routing') ?? routing,
        isWriteIndex: typeof writeIndex === 'boolean' ? writeIndex : null,
        hidden: raw['is_hidden'] === true,
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

/** One-line description of an alias filter (`range on price`). */
export function describeFilter(filter: JsonObject | null): string | null {
  if (!filter) {
    return null;
  }
  const [type, body] = Object.entries(filter)[0] ?? [];
  if (!type) {
    return null;
  }
  const fields = isRecord(body) ? Object.keys(body).filter((key) => !key.startsWith('_') && key !== 'boost') : [];
  if (type === 'bool') {
    const clauses = isRecord(body)
      ? Object.entries(body).reduce((sum, [, value]) => sum + (Array.isArray(value) ? value.length : isRecord(value) ? 1 : 0), 0)
      : 0;
    return `bool query with ${pluralize(clauses, 'clause')}`;
  }
  return fields.length > 0 && type !== 'match_all' ? `${type} on ${fields.join(', ')}` : `${type} query`;
}

/* ---- Lifecycle ------------------------------------------------------------- */

function dateAt(source: JsonObject, key: string): Date | null {
  const value = source[key];
  return typeof value === 'number' && value > 0 ? new Date(value) : null;
}

export function lifecycleState(response: IlmExplainResponse | null, index: string): LifecycleState {
  const explain = response?.indices?.[index];
  if (!explain || explain['managed'] !== true) {
    return { kind: 'unmanaged' };
  }
  const times: LifecycleTimes[] = [];
  const timeEntries: readonly (readonly [string, string])[] = [
    ['index_creation_date_millis', 'Index created'],
    ['lifecycle_date_millis', 'Lifecycle date'],
    ['phase_time_millis', 'Phase entered'],
    ['action_time_millis', 'Action started'],
    ['step_time_millis', 'Step entered'],
  ];
  for (const [key, label] of timeEntries) {
    const at = dateAt(explain, key);
    if (at) {
      times.push({ label, at });
    }
  }
  const stepInfo = isRecord(explain['step_info']) ? explain['step_info'] : null;
  const step = readString(explain, 'step');
  let error: LifecycleStepError | null = null;
  const reason = readString(stepInfo, 'reason') ?? readString(stepInfo, 'caused_by.reason');
  if (step === 'ERROR' || (stepInfo && (stepInfo['type'] !== undefined || reason !== null))) {
    const retries = readNumber(explain, 'failed_step_retry_count');
    const retryable = explain['is_auto_retryable_error'];
    error = {
      failedStep: readString(explain, 'failed_step'),
      type: readString(stepInfo, 'type'),
      reason: reason ?? (stepInfo ? JSON.stringify(stepInfo) : 'The policy stopped on an error.'),
      retries,
      autoRetryable: typeof retryable === 'boolean' ? retryable : null,
    };
  }
  const definition = readPath(explain, 'phase_execution.phase_definition');
  const actions = isRecord(definition) && isRecord(definition['actions']) ? definition['actions'] : {};
  const phaseActions: LifecyclePhaseAction[] = Object.entries(actions).map(([name, params]) => ({
    name,
    params: isRecord(params) ? Object.entries(params).map(([key, value]) => ({ key, value: displayValue(value) })) : [],
  }));
  return {
    kind: 'managed',
    policy: readString(explain, 'policy'),
    phase: readString(explain, 'phase'),
    action: readString(explain, 'action'),
    step,
    age: readString(explain, 'age'),
    times,
    error,
    stepInfo: error ? null : stepInfo,
    phaseActions,
    phaseMinAge: readString(definition, 'min_age'),
    policyVersion: readNumber(explain, 'phase_execution.version'),
    raw: explain,
  };
}

/**
 * `step_info` of a healthy ILM step ("Waiting for all shards to become
 * active", `{ shards_left_to_allocate: 2, all_shards_active: false }`) as a
 * sentence plus readable facts. Nested values are left to the JSON view.
 */
export function stepInfoSummary(info: JsonObject): StepInfoSummary {
  const message = readString(info, 'message') ?? readString(info, 'reason');
  const details: MappingDetail[] = [];
  let hasNested = false;
  for (const [key, value] of Object.entries(info)) {
    if (key === 'message' || (key === 'reason' && message !== null && message === value)) {
      continue;
    }
    if (typeof value === 'boolean') {
      details.push({ key: humanize(key), value: value ? 'yes' : 'no' });
    } else if (typeof value === 'number' || typeof value === 'string') {
      details.push({ key: humanize(key), value: typeof value === 'number' ? formatNumber(value) : value });
    } else if (value !== null && value !== undefined) {
      hasNested = true;
    }
  }
  return { message, details, hasNested };
}

/** Readable ILM step / action / phase names ("check-rollover-ready" → "Check rollover ready"). */
export function lifecycleLabel(value: string | null): string {
  return value ? humanize(value) : '–';
}

/* ---- Operations ------------------------------------------------------------ */

export const INDEX_OPERATIONS: Readonly<Record<IndexOperation, IndexOperationDefinition>> = {
  refresh: {
    path: 'overview/refresh_indices',
    label: 'Refresh',
    verb: 'refresh',
    icon: 'bi-arrow-repeat',
    done: 'refreshed',
    confirm: null,
  },
  flush: {
    path: 'overview/flush_indices',
    label: 'Flush',
    verb: 'flush',
    icon: 'bi-save',
    done: 'flushed',
    confirm: null,
  },
  merge: {
    path: 'overview/force_merge',
    label: 'Force merge',
    verb: 'force merge',
    icon: 'bi-intersect',
    done: 'force merged',
    confirm: {
      title: (index) => `Force merge index ${index}?`,
      message: 'Force merging is I/O intensive and can take a long time on large indices.',
      confirmLabel: 'Force merge index',
      tone: 'warning',
    },
  },
  cache: {
    path: 'overview/clear_indices_cache',
    label: 'Clear cache',
    verb: 'clear the cache of',
    icon: 'bi-eraser',
    done: 'cache cleared',
    confirm: null,
  },
  open: {
    path: 'overview/open_indices',
    label: 'Open',
    verb: 'open',
    icon: 'bi-unlock',
    done: 'opened',
    confirm: {
      title: (index) => `Open index ${index}?`,
      message: 'Reads and writes resume once the shards are allocated again.',
      confirmLabel: 'Open index',
      tone: 'default',
    },
  },
  close: {
    path: 'overview/close_indices',
    label: 'Close',
    verb: 'close',
    icon: 'bi-lock',
    done: 'closed',
    confirm: {
      title: (index) => `Close index ${index}?`,
      message: 'Closing blocks every read and write until the index is opened again.',
      confirmLabel: 'Close index',
      tone: 'danger',
    },
  },
  delete: {
    path: 'overview/delete_indices',
    label: 'Delete',
    verb: 'delete',
    icon: 'bi-trash3',
    done: 'deleted',
    confirm: {
      title: (index) => `Delete index ${index}?`,
      message: 'Every document is removed permanently. This cannot be undone.',
      confirmLabel: 'Delete index',
      tone: 'danger',
    },
  },
};

/** Data stream of a backing index (`.ds-logs-web-2026.10.14-000001` → `logs-web`). */
export function dataStreamOf(index: string): string | null {
  const match = /^\.(?:ds|fs)-(.+)-\d{4}\.\d{2}\.\d{2}-\d{6}$/.exec(index);
  return match?.[1] ?? null;
}

/** Human readable rendering of a few setting values (dates). */
export function settingHint(key: string, value: string): string | null {
  if (/(^|\.)creation_date$/.test(key) && /^\d{10,}$/.test(value)) {
    const date = new Date(Number(value));
    return Number.isNaN(date.getTime()) ? null : date.toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
  }
  return null;
}

