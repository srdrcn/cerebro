import { describe, expect, it } from 'vitest';
import { DataStream, DataStreamStats } from './data-streams.models';
import {
  backingIndexRows,
  buildRows,
  filterRows,
  formatRelative,
  formatTimestamp,
  healthDescription,
  healthLabel,
  healthTone,
  isInternal,
  keepsStreamLink,
  lifecycleOf,
  linkedStreamMissing,
  missingStreamMessage,
  nextBackingIndex,
  relinkExpanded,
  revealsInternal,
  shortIndexName,
  sortRows,
  statsByStream,
  streamNameParam,
  summarize,
} from './data-streams.utils';

const web: DataStream = {
  name: 'app-events-web',
  timestamp_field: { name: '@timestamp' },
  indices: [
    { index_name: '.ds-app-events-web-2026.10.14-000001', ilm_policy: 'app-events-policy', managed_by: 'Index Lifecycle Management' },
    { index_name: '.ds-app-events-web-2026.10.14-000002', ilm_policy: 'app-events-policy', managed_by: 'Index Lifecycle Management' },
  ],
  generation: 2,
  status: 'GREEN',
  template: 'app-events',
  ilm_policy: 'app-events-policy',
  next_generation_managed_by: 'Index Lifecycle Management',
  hidden: false,
  system: false,
};

const worker: DataStream = {
  name: 'app-events-worker',
  indices: [{ index_name: '.ds-app-events-worker-2026.10.14-000001' }],
  generation: 1,
  status: 'YELLOW',
  template: 'app-events',
};

const deprecation: DataStream = {
  name: '.logs-deprecation.elasticsearch-default',
  indices: [{ index_name: '.ds-.logs-deprecation-000001', managed_by: 'Data stream lifecycle' }],
  generation: 1,
  status: 'RED',
  template: '.deprecation-indexing-template',
  lifecycle: { enabled: true, data_retention: '30d' },
  next_generation_managed_by: 'Data stream lifecycle',
  hidden: true,
};

const stats: DataStreamStats = {
  data_stream_count: 2,
  backing_indices: 3,
  total_store_size_bytes: 31_842,
  data_streams: [
    { data_stream: 'app-events-web', backing_indices: 2, store_size_bytes: 20_792, maximum_timestamp: 2_000 },
    { data_stream: 'app-events-worker', backing_indices: 1, store_size_bytes: 11_050, maximum_timestamp: 0 },
  ],
};

describe('health', () => {
  it('maps statuses to tones and labels', () => {
    expect(healthTone('GREEN')).toBe('green');
    expect(healthTone('yellow')).toBe('yellow');
    expect(healthTone('RED')).toBe('red');
    expect(healthTone(undefined)).toBe('gray');
    expect(healthTone(3)).toBe('gray');
    expect(healthLabel('green')).toBe('Green');
    expect(healthLabel('yellow')).toBe('Yellow');
    expect(healthLabel('red')).toBe('Red');
    expect(healthLabel('gray')).toBe('Unknown');
    expect(healthDescription('yellow')).toMatch(/^Yellow: some replica shards/);
    expect(healthDescription('red')).toMatch(/primary shard/);
  });
});

describe('lifecycleOf', () => {
  it('prefers what manages the next generation', () => {
    expect(lifecycleOf(web)).toEqual({ kind: 'ilm', policy: 'app-events-policy' });
    expect(lifecycleOf(deprecation)).toEqual({ kind: 'dsl', retention: '30d' });
    expect(
      lifecycleOf({ ...deprecation, ilm_policy: 'old', next_generation_managed_by: 'Data stream lifecycle' }),
    ).toEqual({ kind: 'dsl', retention: '30d' });
  });

  it('falls back to whatever is configured', () => {
    expect(lifecycleOf({ name: 'a', ilm_policy: 'p' })).toEqual({ kind: 'ilm', policy: 'p' });
    expect(lifecycleOf({ name: 'a', lifecycle: {} })).toEqual({ kind: 'dsl', retention: null });
    expect(lifecycleOf({ name: 'a', lifecycle: { effective_retention: '7d' } })).toEqual({ kind: 'dsl', retention: '7d' });
    expect(lifecycleOf({ name: 'a', lifecycle: { enabled: false } })).toEqual({ kind: 'none' });
    expect(lifecycleOf({ name: 'a' })).toEqual({ kind: 'none' });
  });
});

describe('rows', () => {
  it('lists backing indices oldest first with the last one as write index', () => {
    expect(backingIndexRows(web)).toEqual([
      { name: '.ds-app-events-web-2026.10.14-000001', position: 1, write: false, managedBy: 'Index Lifecycle Management', policy: 'app-events-policy' },
      { name: '.ds-app-events-web-2026.10.14-000002', position: 2, write: true, managedBy: 'Index Lifecycle Management', policy: 'app-events-policy' },
    ]);
    expect(backingIndexRows({ name: 'x' })).toEqual([]);
  });

  it('indexes stats by stream name', () => {
    expect(statsByStream(stats).get('app-events-worker')?.store_size_bytes).toBe(11_050);
    expect(statsByStream(null).size).toBe(0);
  });

  it('joins streams with their stats', () => {
    const [webRow, workerRow, deprecationRow] = buildRows([web, worker, deprecation], stats);
    expect(webRow).toMatchObject({
      name: 'app-events-web',
      health: 'green',
      indexCount: 2,
      generation: 2,
      template: 'app-events',
      sizeBytes: 20_792,
      lastEvent: 2_000,
      writeIndex: '.ds-app-events-web-2026.10.14-000002',
      timestampField: '@timestamp',
      hidden: false,
    });
    // A maximum_timestamp of 0 means the stream has no documents yet.
    expect(workerRow).toMatchObject({ health: 'yellow', lastEvent: null, timestampField: '@timestamp' });
    expect(deprecationRow).toMatchObject({ health: 'red', sizeBytes: null, hidden: true });
  });

  it('copes with missing data', () => {
    expect(buildRows(undefined, undefined)).toEqual([]);
    const [row] = buildRows([{ name: 'bare' }], null);
    expect(row).toMatchObject({ generation: 0, indexCount: 0, writeIndex: null, template: null, health: 'gray' });
  });
});

describe('filter, sort and summary', () => {
  const rows = buildRows([web, worker, deprecation], stats);

  it('treats hidden, system and dot streams as internal', () => {
    expect(rows.map((row) => isInternal(row))).toEqual([false, false, true]);
    const [row] = buildRows([{ name: '.fleet', hidden: false }], null);
    expect(isInternal(row!)).toBe(true);
  });

  it('filters by name, template and policy', () => {
    expect(filterRows(rows, '', false).map((row) => row.name)).toEqual(['app-events-web', 'app-events-worker']);
    expect(filterRows(rows, '', true)).toHaveLength(3);
    expect(filterRows(rows, 'WORKER', false).map((row) => row.name)).toEqual(['app-events-worker']);
    expect(filterRows(rows, 'deprecation-indexing', true)).toHaveLength(1);
    expect(filterRows(rows, 'events-policy', false).map((row) => row.name)).toEqual(['app-events-web']);
  });

  it('sorts by every column with the name as tie breaker', () => {
    expect(sortRows(rows, 'name', false).map((row) => row.name)).toEqual([
      '.logs-deprecation.elasticsearch-default',
      'app-events-web',
      'app-events-worker',
    ]);
    expect(sortRows(rows, 'health', true).map((row) => row.health)).toEqual(['red', 'yellow', 'green']);
    expect(sortRows(rows, 'indices', true)[0]?.name).toBe('app-events-web');
    expect(sortRows(rows, 'size', true).map((row) => row.sizeBytes)).toEqual([20_792, 11_050, null]);
    expect(sortRows(rows, 'lastEvent', false).map((row) => row.lastEvent)).toEqual([null, null, 2_000]);
  });

  it('summarizes the visible streams', () => {
    expect(summarize(rows)).toEqual({ streams: 3, backingIndices: 4, sizeBytes: 31_842, unhealthy: 2, lastEvent: 2_000 });
    expect(summarize([])).toEqual({ streams: 0, backingIndices: 0, sizeBytes: null, unhealthy: 0, lastEvent: null });
  });
});

describe('formatting', () => {
  it('predicts the next backing index name', () => {
    expect(nextBackingIndex('app-events-web', 2, Date.UTC(2026, 9, 4, 23, 0))).toBe('.ds-app-events-web-2026.10.04-000003');
  });

  it('shortens backing index names', () => {
    expect(shortIndexName('.ds-app-events-web-2026.10.14-000002', 'app-events-web')).toBe('2026.10.14-000002');
    expect(shortIndexName('restored-index', 'app-events-web')).toBe('restored-index');
  });

  it('formats relative times', () => {
    const now = 10 * 86_400_000;
    expect(formatRelative(now - 10_000, now)).toBe('just now');
    expect(formatRelative(now - 5 * 60_000, now)).toBe('5m ago');
    expect(formatRelative(now - 3 * 3_600_000, now)).toBe('3h ago');
    expect(formatRelative(now - 2 * 86_400_000, now)).toBe('2d ago');
    expect(formatRelative(now + 5 * 60_000, now)).toBe('in 5m');
    expect(formatRelative(null, now)).toBe('–');
  });

  it('formats absolute times in local time', () => {
    expect(formatTimestamp(new Date(2026, 9, 14, 9, 5, 7).getTime())).toBe('2026-10-14 09:05:07');
    expect(formatTimestamp(null)).toBe('');
  });
});

describe('deep links', () => {
  const rows = buildRows([web, worker, deprecation], stats);

  it('reads the ?name= parameter', () => {
    expect(streamNameParam('app-events-web')).toBe('app-events-web');
    expect(streamNameParam('  app-events-web ')).toBe('app-events-web');
    expect(streamNameParam('')).toBeNull();
    expect(streamNameParam('   ')).toBeNull();
    expect(streamNameParam(null)).toBeNull();
    expect(streamNameParam(undefined)).toBeNull();
  });

  it('reveals hidden and system streams only when the link names one', () => {
    expect(revealsInternal(rows, '.logs-deprecation.elasticsearch-default')).toBe(true);
    expect(revealsInternal(rows, 'app-events-web')).toBe(false);
    expect(revealsInternal(rows, 'missing')).toBe(false);
    // Partial names never count: the link names a stream exactly.
    expect(revealsInternal(rows, '.logs-deprecation')).toBe(false);
  });

  it('keeps the link while the search box holds exactly the linked name', () => {
    expect(keepsStreamLink('app-events-web', 'app-events-web')).toBe(true);
    expect(keepsStreamLink(' app-events-web ', 'app-events-web')).toBe(true);
    expect(keepsStreamLink('', 'app-events-web')).toBe(false);
    expect(keepsStreamLink('app-events', 'app-events-web')).toBe(false);
    expect(keepsStreamLink('app-events-web', null)).toBe(false);
  });

  it('reports a linked stream that does not exist once loaded', () => {
    expect(linkedStreamMissing(rows, 'gone', true)).toBe(true);
    expect(linkedStreamMissing(rows, 'gone', false)).toBe(false);
    expect(linkedStreamMissing(rows, 'app-events-web', true)).toBe(false);
    expect(linkedStreamMissing(rows, 'app-events', true)).toBe(true);
    expect(linkedStreamMissing(rows, null, true)).toBe(false);
    expect(linkedStreamMissing([], 'app-events-web', true)).toBe(true);
  });

  it('does not claim an unlisted linked stream was deleted', () => {
    const plain = missingStreamMessage('ilm-history-7');
    expect(plain.heading).toBe('Data stream “ilm-history-7” is not listed');
    expect(plain.text).toContain('hidden or system stream');
    expect(plain.text).toContain('may have been deleted');
    const dotted = missingStreamMessage('.logs-deprecation.elasticsearch-default');
    expect(dotted.heading).toContain('.logs-deprecation.elasticsearch-default');
    expect(dotted.text).toMatch(/^Elasticsearch did not list it\. Names starting with a dot/);
  });

  it('collapses the row opened by the previous link when a new link arrives', () => {
    const userOpened = new Set(['metrics']);
    const first = relinkExpanded(userOpened, null, 'app-events-web');
    expect([...first].sort()).toEqual(['app-events-web', 'metrics']);
    // The input set is not mutated.
    expect([...userOpened]).toEqual(['metrics']);
    const second = relinkExpanded(first, 'app-events-web', 'app-events-worker');
    expect([...second].sort()).toEqual(['app-events-worker', 'metrics']);
    // A plain link without ?name= collapses the linked row too.
    expect([...relinkExpanded(second, 'app-events-worker', null)]).toEqual(['metrics']);
    // Rows the user toggled themselves stay open.
    expect([...relinkExpanded(second, 'app-events-worker', null, true)].sort()).toEqual(['app-events-worker', 'metrics']);
    // Re-linking the same stream keeps it open.
    expect([...relinkExpanded(second, 'app-events-worker', 'app-events-worker')].sort()).toEqual([
      'app-events-worker',
      'metrics',
    ]);
  });

  it('filters a linked name to the stream itself', () => {
    expect(filterRows(rows, 'app-events-web', false).map((row) => row.name)).toEqual(['app-events-web']);
  });
});
