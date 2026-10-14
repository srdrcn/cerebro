import { describe, expect, it } from 'vitest';
import { CatShardRow, IndexDetail, IndexDetailResponse } from './index-detail.models';
import {
  INDEX_OPERATIONS,
  aliasDetails,
  countLeafFields,
  dataStreamOf,
  decodeVersion,
  describeFilter,
  filterMappingFields,
  filterSettings,
  flattenSettings,
  formatStat,
  indexHealth,
  indexOpenState,
  indexSummary,
  isClosed,
  keySettings,
  lifecycleState,
  mappingInfo,
  nextTab,
  parseTab,
  readNumber,
  resolveIndexDetail,
  settingHint,
  shardRows,
  shardStateTone,
  sortShards,
  statSections,
  stepInfoSummary,
  summarizeShards,
  typeTone,
  unassignedReasonLabel,
} from './index-detail.utils';

function catRow(overrides: Partial<CatShardRow> = {}): CatShardRow {
  return {
    index: 'products',
    shard: '0',
    prirep: 'p',
    state: 'STARTED',
    docs: '100',
    store: '2048',
    ip: '127.0.0.1',
    node: 'es-node-1',
    'unassigned.reason': null,
    'unassigned.for': null,
    ...overrides,
  };
}

function detail(overrides: Partial<IndexDetail> = {}): IndexDetail {
  return {
    name: 'products',
    settings: {
      index: {
        number_of_shards: '2',
        number_of_replicas: '1',
        creation_date: '1791983837916',
        uuid: 'abc',
        version: { created: '8512000' },
        provided_name: 'products',
      },
    },
    mappings: null,
    stats: {
      health: 'green',
      status: 'open',
      primaries: {
        docs: { count: 4200, deleted: 12 },
        store: { size_in_bytes: 1000 },
        segments: { count: 3 },
      },
      total: {
        docs: { count: 8400, deleted: 24 },
        store: { size_in_bytes: 2000 },
        segments: { count: 6 },
      },
    },
    aliases: {},
    shards: [],
    ...overrides,
  };
}

function response(overrides: Partial<IndexDetailResponse> = {}): IndexDetailResponse {
  return {
    settings: { products: { settings: { index: { number_of_shards: '1' } } } },
    mappings: { products: { mappings: { properties: {} } } },
    stats: { indices: { products: { health: 'green', status: 'open' } } },
    aliases: { products: { aliases: { catalog: {} } } },
    shards: [catRow(), catRow({ index: 'other' })],
    ...overrides,
  };
}

describe('generic helpers', () => {
  it('reads nested numbers and numeric strings', () => {
    expect(readNumber({ a: { b: 3 } }, 'a.b')).toBe(3);
    expect(readNumber({ a: { b: '42' } }, 'a.b')).toBe(42);
    expect(readNumber({ a: { b: 'x' } }, 'a.b')).toBeNull();
    expect(readNumber({ a: 1 }, 'a.b')).toBeNull();
  });
});

describe('tabs', () => {
  it('parses the tab query parameter with a safe default', () => {
    expect(parseTab('shards')).toBe('shards');
    expect(parseTab('nope')).toBe('overview');
    expect(parseTab(null)).toBe('overview');
  });

  it('moves between tabs with the keyboard and wraps around', () => {
    expect(nextTab('overview', 'ArrowRight')).toBe('mappings');
    expect(nextTab('overview', 'ArrowLeft')).toBe('lifecycle');
    expect(nextTab('lifecycle', 'ArrowRight')).toBe('overview');
    expect(nextTab('stats', 'Home')).toBe('overview');
    expect(nextTab('stats', 'End')).toBe('lifecycle');
    expect(nextTab('stats', 'Enter')).toBeNull();
  });
});

describe('resolveIndexDetail', () => {
  it('returns the requested index and keeps only its shards', () => {
    const resolved = resolveIndexDetail(response(), 'products');
    expect(resolved.kind).toBe('single');
    if (resolved.kind === 'single') {
      expect(resolved.detail.name).toBe('products');
      expect(resolved.detail.shards).toHaveLength(1);
      expect(resolved.detail.aliases).toEqual({ catalog: {} });
      expect(resolved.detail.stats?.status).toBe('open');
    }
  });

  it('follows an alias that points to a single index', () => {
    const resolved = resolveIndexDetail(response(), 'catalog');
    expect(resolved.kind === 'single' && resolved.detail.name).toBe('products');
  });

  it('asks to choose when an alias points to several indices', () => {
    const resolved = resolveIndexDetail(
      response({ settings: { 'logs-2': { settings: {} }, 'logs-1': { settings: {} } } }),
      'logs',
    );
    expect(resolved).toEqual({ kind: 'multiple', indices: ['logs-1', 'logs-2'] });
  });

  it('reports a missing index and tolerates null sections', () => {
    expect(resolveIndexDetail(response({ settings: {} }), 'x')).toEqual({ kind: 'missing' });
    const resolved = resolveIndexDetail(response({ mappings: null, stats: null, aliases: null, shards: null }), 'products');
    expect(resolved.kind === 'single' && resolved.detail).toMatchObject({
      mappings: null,
      stats: null,
      aliases: null,
      shards: null,
    });
  });
});

describe('settings', () => {
  it('flattens nested settings into sorted rows', () => {
    expect(
      flattenSettings({ index: { b: '1', a: { c: ['x', 'y'], d: {} } } }),
    ).toEqual([
      { key: 'index.a.c', value: 'x, y' },
      { key: 'index.a.d', value: '{}' },
      { key: 'index.b', value: '1' },
    ]);
  });

  it('filters settings by key or value', () => {
    const rows = flattenSettings({ index: { refresh_interval: '30s', number_of_shards: '3' } });
    expect(filterSettings(rows, 'refresh').map((row) => row.key)).toEqual(['index.refresh_interval']);
    expect(filterSettings(rows, '30s')).toHaveLength(1);
    expect(filterSettings(rows, ' ')).toHaveLength(2);
  });

  it('extracts the key settings with defaults', () => {
    const settings = keySettings(
      detail({
        settings: {
          index: {
            number_of_shards: '3',
            number_of_replicas: '2',
            auto_expand_replicas: '0-1',
            creation_date: '1700000000000',
            uuid: 'u',
            version: { created: '7170099' },
            lifecycle: { name: 'hot-warm' },
            default_pipeline: 'enrich',
            hidden: 'true',
            blocks: { write: 'true', read: 'false' },
            routing: { allocation: { include: { _tier_preference: 'data_hot' } } },
          },
        },
      }),
    );
    expect(settings).toMatchObject({
      primaries: 3,
      replicas: '2',
      autoExpandReplicas: '0-1',
      refreshInterval: '1s',
      refreshIntervalIsDefault: true,
      uuid: 'u',
      versionCreated: '7.17.0',
      lifecyclePolicy: 'hot-warm',
      defaultPipeline: 'enrich',
      tierPreference: 'data_hot',
      hidden: true,
      blocks: ['Writes blocked'],
      closed: false,
    });
    expect(settings.createdAt?.getTime()).toBe(1_700_000_000_000);
  });

  it('ignores the _none default pipeline and disabled auto expansion', () => {
    const settings = keySettings(
      detail({ settings: { index: { default_pipeline: '_none', auto_expand_replicas: 'false', refresh_interval: '-1' } } }),
    );
    expect(settings.defaultPipeline).toBeNull();
    expect(settings.autoExpandReplicas).toBeNull();
    expect(settings.refreshInterval).toBe('-1');
    expect(settings.refreshIntervalIsDefault).toBe(false);
    expect(settings.primaries).toBeNull();
  });

  it('decodes legacy version ids only', () => {
    expect(decodeVersion('7170099')).toBe('7.17.0');
    expect(decodeVersion('8100299')).toBe('8.10.2');
    expect(decodeVersion('8512000')).toBeNull();
    expect(decodeVersion('abc')).toBeNull();
    expect(decodeVersion(null)).toBeNull();
  });

  it('renders creation dates next to the raw value', () => {
    expect(settingHint('index.creation_date', '1700000000000')).toBe('2023-11-14 22:13:20 UTC');
    expect(settingHint('index.uuid', '1700000000000')).toBeNull();
    expect(settingHint('index.creation_date', 'soon')).toBeNull();
  });
});

describe('closed indices and summary', () => {
  it('detects closed indices from the stats status or the close verification flag', () => {
    expect(isClosed(detail())).toBe(false);
    expect(isClosed(detail({ stats: { status: 'close' } }))).toBe(true);
    expect(isClosed(detail({ stats: null, settings: { index: { verified_before_close: 'true' } } }))).toBe(true);
  });

  it('does not call an index closed only because its statistics are missing', () => {
    // A 403 / timeout / 5xx on _stats also leaves stats null.
    expect(isClosed(detail({ stats: null }))).toBe(false);
    expect(indexOpenState(detail({ stats: null }))).toBe('unknown');
    expect(indexOpenState(detail())).toBe('open');
    expect(indexOpenState(detail({ stats: { status: 'open' } }))).toBe('open');
    expect(indexOpenState(detail({ stats: { status: 'close' } }))).toBe('closed');
    expect(indexOpenState(detail({ stats: null, settings: { index: { verified_before_close: 'true' } } }))).toBe('closed');
    expect(keySettings(detail({ stats: null }))).toMatchObject({ closed: false, openState: 'unknown' });
  });

  it('summarises documents, sizes and segments from index stats', () => {
    expect(indexSummary(detail(), [])).toEqual({
      primaries: 2,
      replicas: 1,
      docs: 4200,
      deletedDocs: 12,
      primarySize: 1000,
      totalSize: 2000,
      segments: 6,
      estimated: false,
    });
  });

  it('falls back to the shard listing when stats are unavailable', () => {
    const rows = shardRows([
      catRow({ docs: '700', store: '100' }),
      catRow({ prirep: 'r', docs: '700', store: '120' }),
      catRow({ shard: '1', docs: '5', store: '10' }),
      catRow({ shard: '1', prirep: 'r', state: 'UNASSIGNED', docs: null, store: null, node: null }),
    ]);
    expect(indexSummary(detail({ stats: null }), rows)).toMatchObject({
      docs: 705,
      primarySize: 110,
      totalSize: 230,
      deletedDocs: null,
      segments: null,
      estimated: true,
    });
    expect(indexSummary(detail({ stats: null }), []).docs).toBeNull();
  });

  it('derives the health from stats, then from shards', () => {
    expect(indexHealth(detail(), [])).toBe('green');
    const noStats = detail({ stats: null });
    expect(indexHealth(noStats, [])).toBe('gray');
    expect(indexHealth(noStats, shardRows([catRow()]))).toBe('green');
    expect(indexHealth(noStats, shardRows([catRow(), catRow({ prirep: 'r', state: 'UNASSIGNED' })]))).toBe('yellow');
    expect(indexHealth(noStats, shardRows([catRow({ state: 'UNASSIGNED' })]))).toBe('red');
  });
});

describe('mappings', () => {
  const mappings = {
    dynamic: 'strict',
    _source: { enabled: false },
    _data_stream_timestamp: { enabled: true },
    _routing: { required: true },
    dynamic_templates: [{ strings: {} }],
    _meta: { owner: 'team' },
    properties: {
      title: { type: 'text', analyzer: 'english', fields: { raw: { type: 'keyword', ignore_above: 256 } } },
      user: {
        properties: {
          name: { type: 'keyword' },
          address: { type: 'nested', properties: { city: { type: 'keyword', doc_values: false } } },
        },
      },
      created: { type: 'date', format: 'strict_date_optional_time||epoch_millis' },
      empty: { type: 'object' },
    },
    runtime: { day: { type: 'keyword', script: { source: "emit('x')" } } },
  };

  it('walks properties, multi-fields and runtime fields in tree order', () => {
    const info = mappingInfo(mappings);
    expect(info.fields.map((field) => [field.path, field.depth, field.type])).toEqual([
      ['title', 0, 'text'],
      ['title.raw', 1, 'keyword'],
      ['user', 0, 'object'],
      ['user.name', 1, 'keyword'],
      ['user.address', 1, 'nested'],
      ['user.address.city', 2, 'keyword'],
      ['created', 0, 'date'],
      ['empty', 0, 'object'],
      ['day', 0, 'keyword'],
    ]);
    const title = info.fields[0];
    expect(title?.details).toEqual([{ key: 'analyzer', value: 'english' }]);
    expect(title?.hasChildren).toBe(true);
    expect(info.fields[1]?.multiField).toBe(true);
    expect(info.fields[1]?.details).toEqual([{ key: 'ignore_above', value: '256' }]);
    expect(info.fields[5]?.details).toEqual([{ key: 'doc_values', value: 'false' }]);
    expect(info.fields[8]).toMatchObject({ runtime: true, details: [{ key: 'script', value: "emit('x')" }] });
  });

  it('reports mapping level options', () => {
    expect(mappingInfo(mappings)).toMatchObject({
      dynamic: 'strict',
      sourceEnabled: false,
      dataStreamTimestamp: true,
      routingRequired: true,
      dynamicTemplates: 1,
      meta: { owner: 'team' },
    });
    expect(mappingInfo(null)).toMatchObject({
      fields: [],
      dynamic: null,
      sourceEnabled: true,
      dataStreamTimestamp: false,
      dynamicTemplates: 0,
    });
  });

  it('counts leaf fields only', () => {
    // title, title.raw, user.name, user.address.city, created, empty (no children), day
    expect(countLeafFields(mappingInfo(mappings).fields)).toBe(7);
  });

  it('filters by path, type or option value', () => {
    const fields = mappingInfo(mappings).fields;
    expect(filterMappingFields(fields, 'city').map((field) => field.path)).toEqual(['user.address.city']);
    expect(filterMappingFields(fields, 'nested').map((field) => field.path)).toEqual(['user.address']);
    expect(filterMappingFields(fields, 'english').map((field) => field.path)).toEqual(['title']);
    expect(filterMappingFields(fields, '')).toBe(fields);
  });

  it('colours field types by family', () => {
    expect(typeTone('text')).toBe('blue');
    expect(typeTone('keyword')).toBe('green');
    expect(typeTone('long')).toBe('purple');
    expect(typeTone('integer_range')).toBe('purple');
    expect(typeTone('date')).toBe('yellow');
    expect(typeTone('nested')).toBe('outline');
    expect(typeTone('geo_point')).toBe('accent');
  });
});

describe('stats', () => {
  const group = {
    indexing: { index_total: 4, index_time_in_millis: 10, index_current: 0, is_throttled: true },
    search: { query_total: 0, query_time_in_millis: 0 },
    query_cache: { hit_count: 3, miss_count: 1, memory_size_in_bytes: 2048 },
    merges: { total_auto_throttle_in_bytes: 62_914_560 },
  };

  it('builds readable sections and skips missing ones', () => {
    const sections = statSections(group);
    expect(sections.map((section) => section.key)).toEqual(['indexing', 'search', 'merges', 'query_cache']);
    const indexing = sections[0]?.items ?? [];
    expect(indexing.map((item) => [item.label, item.value])).toEqual([
      ['Index operations', '4'],
      ['Indexing time', '10ms'],
      ['Avg. indexing latency', '2.5ms'],
      ['In progress', '0'],
      ['Throttled now', 'Yes'],
    ]);
    expect(sections[1]?.items.find((item) => item.label === 'Avg. query latency')?.value).toBe('–');
    expect(sections[2]?.items[0]?.value).toBe('60 MB/s');
    const cache = sections[3]?.items ?? [];
    expect(cache[0]).toEqual({ label: 'Memory', value: '2 KB' });
    expect(cache[1]).toEqual({ label: 'Hit ratio', value: '75%' });
    expect(statSections(null)).toEqual([]);
  });

  it('formats statistic kinds', () => {
    expect(formatStat(0, 'millis')).toBe('0s');
    expect(formatStat(65_000, 'millis')).toBe('1m 5s');
    expect(formatStat(1536, 'bytes')).toBe('1.5 KB');
    expect(formatStat(12345, 'count')).toBe('12,345');
    expect(formatStat(33.333, 'percent')).toBe('33.3%');
    expect(formatStat(7, 'text')).toBe('7');
  });
});

describe('shards', () => {
  it('parses rows, relocation targets and unassigned reasons', () => {
    const rows = shardRows([
      catRow({ state: 'RELOCATING', node: 'es-node-1 -> 127.0.0.1 abcd es-node-2' }),
      catRow({ prirep: 'r', state: 'UNASSIGNED', docs: null, store: null, node: null, 'unassigned.reason': 'NODE_LEFT', 'unassigned.for': '5m' }),
    ]);
    expect(rows[0]).toMatchObject({ state: 'relocating', node: 'es-node-1', relocatingTo: 'es-node-2', primary: true, docs: 100, size: 2048 });
    expect(rows[1]).toMatchObject({
      state: 'unassigned',
      primary: false,
      docs: null,
      size: null,
      unassignedReason: 'NODE_LEFT',
      unassignedReasonLabel: 'Node left',
      unassignedFor: '5m',
      stateLabel: 'Unassigned',
    });
    expect(shardRows(null)).toEqual([]);
  });

  it('labels unknown unassigned reasons readably', () => {
    expect(unassignedReasonLabel('SOMETHING_NEW')).toBe('Something new');
    expect(unassignedReasonLabel(null)).toBeNull();
  });

  it('sorts by shard number with primaries first, and by other columns', () => {
    const rows = shardRows([
      catRow({ shard: '1', prirep: 'r', node: 'b', docs: '5' }),
      catRow({ shard: '0', prirep: 'r', node: 'c', docs: '9' }),
      catRow({ shard: '1', prirep: 'p', node: 'a', docs: '5' }),
      catRow({ shard: '0', prirep: 'p', state: 'UNASSIGNED', node: null, docs: null }),
    ]);
    const label = (list: readonly { shard: number; primary: boolean }[]) => list.map((row) => `${row.shard}${row.primary ? 'p' : 'r'}`);
    expect(label(sortShards(rows, 'shard', false))).toEqual(['0p', '0r', '1p', '1r']);
    expect(label(sortShards(rows, 'shard', true))).toEqual(['1p', '1r', '0p', '0r']);
    expect(label(sortShards(rows, 'state', false))[0]).toBe('0p');
    expect(label(sortShards(rows, 'docs', true))).toEqual(['0r', '1p', '1r', '0p']);
    expect(label(sortShards(rows, 'node', false))).toEqual(['1p', '1r', '0r', '0p']);
  });

  it('summarises shard states, copies and node spread', () => {
    const summary = summarizeShards(
      shardRows([
        catRow({ node: 'a' }),
        catRow({ prirep: 'r', node: 'b' }),
        catRow({ shard: '1', node: 'b' }),
        catRow({ shard: '1', prirep: 'r', state: 'UNASSIGNED', node: null }),
        catRow({ shard: '1', prirep: 'r', state: 'INITIALIZING', node: 'a' }),
      ]),
    );
    expect(summary).toMatchObject({ total: 5, started: 3, initializing: 1, unassigned: 1, unassignedPrimaries: 0, relocating: 0 });
    expect(summary.nodes).toEqual([
      { name: 'a', primaries: 1, replicas: 1 },
      { name: 'b', primaries: 1, replicas: 1 },
    ]);
    expect(summary.groups.map((group) => [group.shard, group.copies.length, group.copies[0]?.primary])).toEqual([
      [0, 2, true],
      [1, 3, true],
    ]);
  });

  it('picks a badge tone per state', () => {
    const [started, unassignedPrimary, unassignedReplica] = shardRows([
      catRow(),
      catRow({ state: 'UNASSIGNED' }),
      catRow({ prirep: 'r', state: 'UNASSIGNED' }),
    ]);
    expect(started && shardStateTone(started)).toBe('green');
    expect(unassignedPrimary && shardStateTone(unassignedPrimary)).toBe('red');
    expect(unassignedReplica && shardStateTone(unassignedReplica)).toBe('yellow');
  });
});

describe('aliases', () => {
  it('normalises routing, write index and filters', () => {
    expect(
      aliasDetails({
        b: { routing: '1' },
        a: { filter: { term: { user: 'kim' } }, is_write_index: true, is_hidden: true, search_routing: '2,3' },
      }),
    ).toEqual([
      { name: 'a', filter: { term: { user: 'kim' } }, indexRouting: null, searchRouting: '2,3', isWriteIndex: true, hidden: true },
      { name: 'b', filter: null, indexRouting: '1', searchRouting: '1', isWriteIndex: null, hidden: false },
    ]);
    expect(aliasDetails(null)).toEqual([]);
  });

  it('describes filters in one line', () => {
    expect(describeFilter({ range: { price: { gte: 10 } } })).toBe('range on price');
    expect(describeFilter({ bool: { must: [{}, {}], filter: {} } })).toBe('bool query with 3 clauses');
    expect(describeFilter({ match_all: {} })).toBe('match_all query');
    expect(describeFilter(null)).toBeNull();
  });
});

describe('lifecycle', () => {
  it('treats absent or unmanaged explain entries as unmanaged', () => {
    expect(lifecycleState(null, 'x')).toEqual({ kind: 'unmanaged' });
    expect(lifecycleState({ indices: { x: { managed: false } } }, 'x')).toEqual({ kind: 'unmanaged' });
  });

  it('parses the current position, timeline and phase definition', () => {
    const state = lifecycleState(
      {
        indices: {
          x: {
            managed: true,
            policy: 'p',
            phase: 'hot',
            action: 'rollover',
            step: 'check-rollover-ready',
            age: '4m',
            index_creation_date_millis: 1000,
            phase_time_millis: 2000,
            step_info: { message: 'Waiting for docs' },
            phase_execution: {
              version: 3,
              phase_definition: { min_age: '0ms', actions: { rollover: { max_age: '1d', max_size: ['a', 'b'] }, set_priority: { priority: 100 } } },
            },
          },
        },
      },
      'x',
    );
    expect(state.kind).toBe('managed');
    if (state.kind === 'managed') {
      expect(state).toMatchObject({ policy: 'p', phase: 'hot', action: 'rollover', step: 'check-rollover-ready', age: '4m', error: null });
      expect(state.stepInfo).toEqual({ message: 'Waiting for docs' });
      expect(state.times.map((time) => time.label)).toEqual(['Index created', 'Phase entered']);
      expect(state.phaseActions).toEqual([
        { name: 'rollover', params: [{ key: 'max_age', value: '1d' }, { key: 'max_size', value: 'a, b' }] },
        { name: 'set_priority', params: [{ key: 'priority', value: '100' }] },
      ]);
      expect(state.phaseMinAge).toBe('0ms');
      expect(state.policyVersion).toBe(3);
    }
  });

  it('highlights step errors', () => {
    const state = lifecycleState(
      {
        indices: {
          x: {
            managed: true,
            step: 'ERROR',
            failed_step: 'check-rollover-ready',
            failed_step_retry_count: 3,
            is_auto_retryable_error: true,
            step_info: { type: 'illegal_argument_exception', reason: 'rollover alias is empty' },
          },
        },
      },
      'x',
    );
    expect(state.kind === 'managed' && state.error).toEqual({
      failedStep: 'check-rollover-ready',
      type: 'illegal_argument_exception',
      reason: 'rollover alias is empty',
      retries: 3,
      autoRetryable: true,
    });
    expect(state.kind === 'managed' && state.stepInfo).toBeNull();
  });
});

describe('operations and misc', () => {
  it('asks before destructive or expensive operations only', () => {
    expect(INDEX_OPERATIONS.refresh.confirm).toBeNull();
    expect(INDEX_OPERATIONS.delete.confirm?.tone).toBe('danger');
    expect(INDEX_OPERATIONS.delete.confirm?.confirmLabel).toBe('Delete index');
    expect(INDEX_OPERATIONS.delete.confirm?.title('products')).toBe('Delete index products?');
    expect(INDEX_OPERATIONS.close.confirm?.tone).toBe('danger');
    expect(INDEX_OPERATIONS.merge.confirm?.tone).toBe('warning');
  });

  it('finds the data stream of a backing index', () => {
    expect(dataStreamOf('.ds-app-events-web-2026.10.14-000001')).toBe('app-events-web');
    expect(dataStreamOf('products')).toBeNull();
  });
});

describe('lifecycle step info', () => {
  it('turns step_info into a sentence and readable facts', () => {
    expect(stepInfoSummary({ message: 'Waiting for all shards to become active', shards_left_to_allocate: 1200, all_shards_active: false })).toEqual({
      message: 'Waiting for all shards to become active',
      details: [
        { key: 'Shards left to allocate', value: '1,200' },
        { key: 'All shards active', value: 'no' },
      ],
      hasNested: false,
    });
  });

  it('uses the reason when there is no message and flags nested values', () => {
    expect(stepInfoSummary({ reason: 'index is not green', details: { a: 1 }, actions: ['x'] })).toEqual({
      message: 'index is not green',
      details: [],
      hasNested: true,
    });
    expect(stepInfoSummary({ checked: true, stage: 'copy' })).toEqual({
      message: null,
      details: [
        { key: 'Checked', value: 'yes' },
        { key: 'Stage', value: 'copy' },
      ],
      hasNested: false,
    });
  });
});
