import { describe, expect, it } from 'vitest';
import { ClusterApiError } from '../../core/api-envelope';
import {
  CUSTOM_GROUP_KEY,
  PendingChange,
  SettingRow,
  buildFlatSettingsPayload,
  customSettingRows,
  defaultScope,
  errorReason,
  filterSettingRows,
  friendlyReason,
  groupEditorRows,
  groupSettingRows,
  humanizeSettingKey,
  isNoopDraft,
  matchesSettingQuery,
  movesToPersistent,
  normalizeSettingName,
  pendingChanges,
  pruneDrafts,
  settingErrorsFor,
  settingNameError,
  settingNamedInError,
  settingValueToString,
  withoutSavedDrafts,
} from './settings-editor.models';

function row(name: string, overrides: Partial<SettingRow> = {}): SettingRow {
  return { name, value: 'v', origin: 'default', editable: true, ...overrides };
}

describe('settingValueToString', () => {
  it('flattens scalars, lists and empty values', () => {
    expect(settingValueToString('1s')).toBe('1s');
    expect(settingValueToString(3)).toBe('3');
    expect(settingValueToString(true)).toBe('true');
    expect(settingValueToString(['zone', 'rack'])).toBe('zone,rack');
    expect(settingValueToString([])).toBe('');
    expect(settingValueToString(null)).toBe('');
    expect(settingValueToString(undefined)).toBe('');
    expect(settingValueToString({ a: 1 })).toBe('{"a":1}');
  });
});

describe('humanizeSettingKey', () => {
  it('uses sentence case and keeps well known acronyms', () => {
    expect(humanizeSettingKey('thread_pool')).toBe('Thread pool');
    expect(humanizeSettingKey('xpack.security')).toBe('X-Pack security');
    expect(humanizeSettingKey('http')).toBe('HTTP');
    expect(humanizeSettingKey('cluster.routing')).toBe('Cluster routing');
  });
});

describe('groupSettingRows', () => {
  it('folds tiny families into the general group and sorts groups and rows', () => {
    const groups = groupSettingRows(
      [
        row('index.refresh_interval'),
        row('index.number_of_replicas'),
        row('index.merge.policy.floor_segment'),
        row('index.merge.scheduler.max_thread_count'),
        row('index.merge.policy.segments_per_tier'),
        row('index.blocks.read_only'),
      ],
      { stripPrefix: 'index.', generalTitle: 'General' },
    );
    expect(groups.map((group) => [group.key, group.title, group.prefix])).toEqual([
      ['', 'General', 'index.'],
      ['merge', 'Merge', 'index.merge.'],
    ]);
    expect(groups[0]?.rows.map((setting) => setting.name)).toEqual([
      'index.blocks.read_only',
      'index.number_of_replicas',
      'index.refresh_interval',
    ]);
  });

  it('splits large families into sub groups nested under their parent', () => {
    const rows = [
      ...Array.from({ length: 6 }, (_, i) => row(`cluster.routing.setting_${i}`)),
      ...Array.from({ length: 3 }, (_, i) => row(`cluster.election.setting_${i}`)),
      row('cluster.name'),
    ];
    const groups = groupSettingRows(rows, { splitAbove: 8, minSubgroupSize: 5 });
    expect(groups.map((group) => [group.key, group.depth, group.shortTitle, group.rows.length])).toEqual([
      ['cluster', 0, 'Cluster', 4],
      ['cluster.routing', 1, 'Routing', 6],
    ]);
    expect(groups[1]?.title).toBe('Cluster routing');
  });

  it('can put the general group last', () => {
    const groups = groupSettingRows(
      [row('a.one'), row('a.two'), row('a.three'), row('lonely.setting')],
      { generalTitle: 'Other settings', generalFirst: false },
    );
    expect(groups.map((group) => group.title)).toEqual(['A', 'Other settings']);
  });
});

describe('filterSettingRows', () => {
  const rows = [
    row('cluster.routing.allocation.enable'),
    row('cluster.name', { editable: false }),
    row('cluster.routing.allocation.disk.watermark.low', { origin: 'persistent' }),
  ];

  it('matches every search term against the name', () => {
    expect(matchesSettingQuery('cluster.routing.allocation.disk.watermark.low', 'watermark low')).toBe(true);
    expect(matchesSettingQuery('cluster.routing.allocation.enable', 'watermark low')).toBe(false);
    expect(matchesSettingQuery('anything', '   ')).toBe(true);
  });

  it('hides static settings and defaults according to the toggles', () => {
    const names = (filter: Parameters<typeof filterSettingRows>[1]) =>
      filterSettingRows(rows, filter).map((setting) => setting.name);
    expect(names({ query: '', showStatic: false, onlyOverridden: false })).toEqual([
      'cluster.routing.allocation.enable',
      'cluster.routing.allocation.disk.watermark.low',
    ]);
    expect(names({ query: 'name', showStatic: true, onlyOverridden: false })).toEqual(['cluster.name']);
    expect(names({ query: '', showStatic: true, onlyOverridden: true })).toEqual([
      'cluster.routing.allocation.disk.watermark.low',
    ]);
  });

  it('keeps settings with pending changes visible whatever the toggles', () => {
    const visible = filterSettingRows(
      rows,
      { query: '', showStatic: false, onlyOverridden: true },
      new Set(['cluster.routing.allocation.enable']),
    );
    expect(visible.map((setting) => setting.name)).toEqual([
      'cluster.routing.allocation.enable',
      'cluster.routing.allocation.disk.watermark.low',
    ]);
  });
});

describe('pending changes', () => {
  const rows = [
    row('a', { value: '1s' }),
    row('b', { value: 'x', origin: 'persistent', persistent: 'x' }),
    row('c', { value: 'locked', editable: false }),
    row('d', { value: 'all', origin: 'transient', transient: 'all' }),
  ];

  it('starts transient settings as transient and everything else as persistent', () => {
    expect(defaultScope(rows[0]!)).toBe('persistent');
    expect(defaultScope(rows[3]!)).toBe('transient');
  });

  it('ignores unchanged drafts, locked settings and clearing a default', () => {
    expect(isNoopDraft(rows[0]!, { value: '1s', scope: 'persistent' })).toBe(true);
    expect(isNoopDraft(rows[0]!, { value: ' ', scope: 'persistent' })).toBe(true);
    expect(isNoopDraft(rows[1]!, { value: '', scope: 'persistent' })).toBe(false);
    expect(
      pendingChanges(rows, {
        a: { value: '1s', scope: 'persistent' },
        b: { value: '', scope: 'persistent' },
        c: { value: 'changed', scope: 'persistent' },
        d: { value: 'none', scope: 'transient' },
      }),
    ).toEqual<PendingChange[]>([
      { name: 'b', from: 'x', to: null, scope: 'persistent' },
      { name: 'd', from: 'all', to: 'none', scope: 'transient' },
    ]);
  });

  it('prunes drafts that match reloaded values and keeps the object when nothing changed', () => {
    const drafts = { a: { value: '2s', scope: 'persistent' as const } };
    expect(pruneDrafts(rows, drafts)).toBe(drafts);
    expect(pruneDrafts([row('a', { value: '2s' })], drafts)).toEqual({});
    expect(pruneDrafts([row('a', { value: '1s', editable: false })], drafts)).toEqual({});
  });

  it('keeps drafts of settings added by name, even empty ones, until they are removed', () => {
    const drafts = {
      'logger.org.elasticsearch.transport': { value: 'debug', scope: 'persistent' as const },
      'cluster.routing.allocation.exclude._ip': { value: '', scope: 'persistent' as const },
    };
    expect(pruneDrafts(rows, drafts)).toBe(drafts);
  });

  it('moves a transient setting to persistent without changing its value', () => {
    const transient = rows[3]!;
    expect(movesToPersistent(transient, { value: 'all', scope: 'persistent' })).toBe(true);
    expect(movesToPersistent(transient, { value: '', scope: 'persistent' })).toBe(false);
    expect(movesToPersistent(transient, { value: 'all', scope: 'transient' })).toBe(false);
    expect(movesToPersistent(rows[1]!, { value: 'x', scope: 'persistent' })).toBe(false);
    expect(isNoopDraft(transient, { value: 'all', scope: 'transient' })).toBe(true);
    expect(isNoopDraft(transient, { value: 'all', scope: 'persistent' })).toBe(false);
    // Moving a persistent setting to the transient layer is not worth a change.
    expect(isNoopDraft(rows[1]!, { value: 'x', scope: 'transient' })).toBe(true);
  });

  it('removes saved drafts but keeps the ones edited again meanwhile', () => {
    const saved: PendingChange[] = [
      { name: 'a', from: '1s', to: '2s', scope: 'persistent' },
      { name: 'b', from: 'x', to: null, scope: 'persistent' },
    ];
    expect(
      withoutSavedDrafts(
        {
          a: { value: '3s', scope: 'persistent' },
          b: { value: '', scope: 'persistent' },
          e: { value: 'other', scope: 'persistent' },
        },
        saved,
      ),
    ).toEqual({ a: { value: '3s', scope: 'persistent' }, e: { value: 'other', scope: 'persistent' } });
  });

  it('builds the flat index settings payload with null resets', () => {
    expect(
      buildFlatSettingsPayload([
        { name: 'index.refresh_interval', from: '1s', to: '30s', scope: 'persistent' },
        { name: 'index.number_of_replicas', from: '2', to: null, scope: 'persistent' },
      ]),
    ).toEqual({ 'index.refresh_interval': '30s', 'index.number_of_replicas': null });
  });
});

describe('save errors', () => {
  const enableError = new ClusterApiError(400, {
    error: {
      root_cause: [{ reason: 'ignored root cause' }],
      reason: "illegal value can't update [cluster.routing.allocation.enable] from [all] to [x]",
      caused_by: { reason: 'For input string: "x"' },
    },
  });

  it('prefers the top level reason of an Elasticsearch error', () => {
    expect(errorReason(enableError)).toBe(
      "illegal value can't update [cluster.routing.allocation.enable] from [all] to [x]",
    );
    expect(errorReason(new ClusterApiError(500, 'Gateway timeout'))).toBe('Gateway timeout');
    expect(errorReason(new Error('boom'))).toBeUndefined();
    expect(errorReason(undefined)).toBeUndefined();
  });

  it('rewrites Java enum errors', () => {
    expect(
      friendlyReason('No enum constant org.elasticsearch.cluster.routing.allocation.decider.Allocation.SOMETIMES'),
    ).toBe('[sometimes] is not one of the accepted values.');
    expect(friendlyReason('anything else')).toBe('anything else');
  });

  it('finds the setting an error is about, preferring the longest bracketed name', () => {
    const names = ['cluster.routing.allocation.enable', 'cluster.routing.allocation.enable.extra'];
    expect(settingNamedInError('bad value for [cluster.routing.allocation.enable]', names)).toBe(
      'cluster.routing.allocation.enable',
    );
    expect(settingNamedInError('setting cluster.routing.allocation.enable.extra is bad', names)).toBe(
      'cluster.routing.allocation.enable.extra',
    );
    expect(settingNamedInError('unrelated', names)).toBeUndefined();
  });

  it('attaches the error to the rejected value', () => {
    const changes: PendingChange[] = [
      { name: 'cluster.routing.allocation.enable', from: 'all', to: 'x', scope: 'persistent' },
      { name: 'other', from: '1', to: '2', scope: 'persistent' },
    ];
    expect(settingErrorsFor(enableError, changes)).toEqual({
      'cluster.routing.allocation.enable': {
        message: "illegal value can't update [cluster.routing.allocation.enable] from [all] to [x]",
        value: 'x',
      },
    });
    const anonymous = new ClusterApiError(400, { error: { reason: 'Failed to parse value [maybe]' } });
    expect(settingErrorsFor(anonymous, changes)).toEqual({});
    expect(settingErrorsFor(anonymous, changes.slice(1))).toEqual({
      other: { message: 'Failed to parse value [maybe]', value: '2' },
    });
  });
});

describe('featured settings', () => {
  it('collects featured settings first, in the given order, and removes them from their family', () => {
    const groups = groupSettingRows(
      [
        row('index.refresh_interval'),
        row('index.number_of_replicas'),
        row('index.merge.a'),
        row('index.merge.b'),
        row('index.merge.c'),
      ],
      { stripPrefix: 'index.', featured: ['index.number_of_replicas', 'index.missing', 'index.refresh_interval'] },
    );
    expect(groups.map((group) => [group.title, group.rows.map((setting) => setting.name)])).toEqual([
      ['Common settings', ['index.number_of_replicas', 'index.refresh_interval']],
      ['Merge', ['index.merge.a', 'index.merge.b', 'index.merge.c']],
    ]);
    expect(groups[0]?.description).toBe('Frequently changed settings');
  });
});

describe('settings added by name', () => {
  const rows = [row('cluster.routing.allocation.enable', { value: 'all' })];
  const drafts = {
    'logger.org.elasticsearch.transport': { value: 'debug', scope: 'persistent' as const },
    'cluster.routing.allocation.exclude._name': { value: '', scope: 'persistent' as const },
    'cluster.routing.allocation.enable': { value: 'none', scope: 'persistent' as const },
  };

  it('creates editable rows for drafts Elasticsearch does not list', () => {
    expect(customSettingRows(rows, drafts)).toEqual([
      { name: 'cluster.routing.allocation.exclude._name', value: '', origin: 'default', editable: true, custom: true },
      { name: 'logger.org.elasticsearch.transport', value: '', origin: 'default', editable: true, custom: true },
    ]);
  });

  it('lists them as pending once they have a value', () => {
    expect(pendingChanges(rows, drafts)).toEqual<PendingChange[]>([
      { name: 'cluster.routing.allocation.enable', from: 'all', to: 'none', scope: 'persistent' },
      { name: 'logger.org.elasticsearch.transport', from: '', to: 'debug', scope: 'persistent' },
    ]);
  });

  it('always shows them, whatever the search and toggles', () => {
    const custom = customSettingRows(rows, drafts);
    const visible = filterSettingRows([...rows, ...custom], { query: 'enable', showStatic: false, onlyOverridden: true });
    expect(visible.map((setting) => setting.name)).toEqual([
      'cluster.routing.allocation.exclude._name',
      'logger.org.elasticsearch.transport',
    ]);
  });

  it('normalizes and validates typed names', () => {
    expect(normalizeSettingName('  routing.allocation.require._name ', 'index.')).toBe(
      'index.routing.allocation.require._name',
    );
    expect(normalizeSettingName('index.blocks.write', 'index.')).toBe('index.blocks.write');
    expect(normalizeSettingName('   ', 'index.')).toBe('');
    expect(normalizeSettingName('logger._root')).toBe('logger._root');
    expect(settingNameError('')).toContain('Enter');
    expect(settingNameError('cluster routing')).toContain('spaces');
    expect(settingNameError('nodots')).toContain('dotted');
    expect(settingNameError('cluster..name')).toContain('dotted');
    expect(settingNameError('cluster.routing.allocation.exclude._name')).toBeUndefined();
    expect(settingNameError('logger.org.elasticsearch.transport')).toBeUndefined();
  });
});

describe('groupEditorRows', () => {
  const rows = [
    row('gateway.expected_data_nodes', { editable: false }),
    row('gateway.recover_after_time', { editable: false }),
    row('gateway.slow_write_logging_threshold'),
    row('search.default_search_timeout'),
    row('search.max_buckets'),
    row('search.allow_expensive_queries'),
  ];

  it('does not let hidden static settings keep a tiny family in its own card', () => {
    const hidden = groupEditorRows(rows, false, { generalTitle: 'Other settings', generalFirst: false });
    expect(hidden.map((group) => [group.title, group.rows.map((setting) => setting.name)])).toEqual([
      ['Search', ['search.allow_expensive_queries', 'search.default_search_timeout', 'search.max_buckets']],
      ['Other settings', ['gateway.slow_write_logging_threshold']],
    ]);
    const shown = groupEditorRows(rows, true, { generalTitle: 'Other settings', generalFirst: false });
    expect(shown.map((group) => [group.title, group.rows.length])).toEqual([
      ['Gateway', 3],
      ['Search', 3],
    ]);
  });

  it('puts settings added by name first, in a group of their own', () => {
    const custom = row('logger.org.elasticsearch.transport', { value: '', custom: true });
    const groups = groupEditorRows([...rows, custom], false);
    expect(groups[0]).toMatchObject({ key: CUSTOM_GROUP_KEY, title: 'Added settings', rows: [custom] });
    expect(groups.slice(1).flatMap((group) => group.rows)).not.toContain(custom);
  });
});
