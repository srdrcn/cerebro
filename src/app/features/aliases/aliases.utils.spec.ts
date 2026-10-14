import { describe, expect, it } from 'vitest';
import { AliasChange, AliasRecord } from './aliases.models';
import {
  aliasNames,
  applyChangesLocally,
  assignmentKey,
  buildAliasRows,
  changeFor,
  countByKind,
  describePendingChanges,
  draftStatusFor,
  filterAliasRows,
  filterLabel,
  otherWriteIndices,
  pluralize,
  prettyJson,
  revertChange,
  routingTags,
  sameSettings,
  sortAliasRows,
  sortIndexOptions,
  stageAddition,
  stageRemoval,
  summarizePendingItem,
} from './aliases.utils';

const logs12: AliasRecord = { alias: 'logs', index: 'logs-2026.10.12' };
const logs13: AliasRecord = { alias: 'logs', index: 'logs-2026.10.13' };
const catalog: AliasRecord = {
  alias: 'catalog',
  index: 'products',
  filter: { range: { price: { gte: 10 } } },
};
const orders: AliasRecord = {
  alias: 'orders',
  index: 'orders-v2',
  index_routing: '1',
  search_routing: '1,2',
};
const current: AliasRecord[] = [logs12, logs13, catalog, orders];

describe('staging alias changes', () => {
  it('keeps at most one change per assignment', () => {
    const added = stageAddition([], { alias: 'recent', index: 'logs-2026.10.14' });
    const replaced = stageAddition(added, {
      alias: 'recent',
      index: 'logs-2026.10.14',
      search_routing: '3',
    });
    expect(replaced).toEqual([
      { kind: 'add', alias: { alias: 'recent', index: 'logs-2026.10.14', search_routing: '3' } },
    ]);
  });

  it('turns a staged removal into an update when the assignment is re-added', () => {
    const removed = stageRemoval([], catalog, current);
    const readded = stageAddition(removed, { alias: 'catalog', index: 'products' });
    expect(readded).toEqual([{ kind: 'add', alias: { alias: 'catalog', index: 'products' } }]);
  });

  it('drops a staged addition instead of removing an assignment that does not exist yet', () => {
    const fresh: AliasRecord = { alias: 'recent', index: 'logs-2026.10.14' };
    const staged = stageAddition([], fresh);
    expect(stageRemoval(staged, fresh, current)).toEqual([]);
  });

  it('replaces a staged update with a removal of the existing assignment', () => {
    const staged = stageAddition([], { ...orders, search_routing: '9' });
    expect(stageRemoval(staged, orders, current)).toEqual([{ kind: 'remove', alias: orders }]);
  });

  it('reverts by assignment key', () => {
    const changes: AliasChange[] = [
      { kind: 'remove', alias: logs12 },
      { kind: 'add', alias: { alias: 'x', index: 'products' } },
    ];
    expect(revertChange(changes, assignmentKey(logs12))).toEqual([changes[1]]);
  });

  it('finds the change staged for an assignment', () => {
    const changes: AliasChange[] = [
      { kind: 'remove', alias: logs12 },
      { kind: 'add', alias: { alias: 'x', index: 'products' } },
    ];
    expect(changeFor(changes, assignmentKey({ alias: 'x', index: 'products' }))).toBe(changes[1]);
    expect(changeFor(changes, assignmentKey(logs13))).toBeUndefined();
  });
});

describe('alias table rows', () => {
  const changes: AliasChange[] = [
    { kind: 'remove', alias: logs12 },
    { kind: 'add', alias: { ...orders, search_routing: '1' } },
    { kind: 'add', alias: { alias: 'recent', index: 'logs-2026.10.14' } },
  ];

  it('previews the result of the staged changes', () => {
    const rows = buildAliasRows(current, changes);
    expect(rows.map((row) => [row.record.alias, row.record.index, row.state])).toEqual([
      ['logs', 'logs-2026.10.12', 'removed'],
      ['logs', 'logs-2026.10.13', 'current'],
      ['catalog', 'products', 'current'],
      ['orders', 'orders-v2', 'updated'],
      ['recent', 'logs-2026.10.14', 'added'],
    ]);
    expect(rows[3]?.record.search_routing).toBe('1');
  });

  it('filters by alias and index (substring or regular expression)', () => {
    const rows = buildAliasRows(current, []);
    expect(filterAliasRows(rows, 'LOGS', '').map((row) => row.record.index)).toEqual([
      'logs-2026.10.12',
      'logs-2026.10.13',
    ]);
    expect(filterAliasRows(rows, '', '^orders').map((row) => row.record.alias)).toEqual(['orders']);
    expect(filterAliasRows(rows, '[', '')).toEqual([]);
  });

  it('sorts by alias or index with the other column as tie breaker', () => {
    const rows = buildAliasRows(current, []);
    expect(sortAliasRows(rows, 'alias', false).map((row) => row.key)).toEqual([
      assignmentKey(catalog),
      assignmentKey(logs12),
      assignmentKey(logs13),
      assignmentKey(orders),
    ]);
    expect(sortAliasRows(rows, 'index', true).map((row) => row.record.index)).toEqual([
      'products',
      'orders-v2',
      'logs-2026.10.13',
      'logs-2026.10.12',
    ]);
  });
});

describe('pending change summary', () => {
  it('classifies changes and flags the ones that can no longer apply', () => {
    const changes: AliasChange[] = [
      { kind: 'add', alias: { alias: 'recent', index: 'logs-2026.10.14' } },
      { kind: 'add', alias: { ...catalog, filter: undefined } },
      { kind: 'remove', alias: logs13 },
      { kind: 'remove', alias: { alias: 'gone', index: 'products' } },
      { kind: 'add', alias: { alias: 'old', index: 'deleted-index' } },
    ];
    const items = describePendingChanges(changes, current, [
      'logs-2026.10.12',
      'logs-2026.10.13',
      'logs-2026.10.14',
      'products',
      'orders-v2',
    ]);
    expect(items.map((item) => [item.kind, item.problem])).toEqual([
      ['add', undefined],
      ['update', undefined],
      ['remove', undefined],
      ['remove', 'This assignment no longer exists.'],
      ['add', 'The index no longer exists.'],
    ]);
    expect(countByKind(items)).toEqual({ add: 2, update: 1, remove: 2 });
    expect(summarizePendingItem(items[0]!)).toBe('Add recent to logs-2026.10.14');
    expect(summarizePendingItem(items[1]!)).toBe('Update catalog on products');
    expect(summarizePendingItem(items[2]!)).toBe('Remove logs from logs-2026.10.13');
  });

  it('does not flag additions while the index list is unknown', () => {
    const items = describePendingChanges(
      [{ kind: 'add', alias: { alias: 'a', index: 'whatever' } }],
      [],
      undefined,
    );
    expect(items[0]?.problem).toBeUndefined();
  });

  it('pluralizes counts', () => {
    expect(pluralize(1, 'change')).toBe('1 change');
    expect(pluralize(3, 'change')).toBe('3 changes');
    expect(pluralize(2, 'index', 'indices')).toBe('2 indices');
  });
});

describe('write index', () => {
  const writer: AliasRecord = { alias: 'w', index: 'a', is_write_index: true };
  const reader: AliasRecord = { alias: 'w', index: 'b', is_write_index: false };

  it('lists the other write indices of an alias once the staged changes apply', () => {
    expect(otherWriteIndices([writer, reader], [], 'w', 'b')).toEqual([writer]);
    expect(otherWriteIndices([writer, reader], [], 'w', 'a')).toEqual([]);
    const cleared = stageAddition([], { ...writer, is_write_index: false });
    expect(otherWriteIndices([writer, reader], cleared, 'w', 'b')).toEqual([]);
  });

  it('flags a staged change that would leave the alias with two write indices', () => {
    const promoted = stageAddition([], { ...reader, is_write_index: true });
    const items = describePendingChanges(promoted, [writer, reader], ['a', 'b']);
    expect(items[0]?.problem).toBe('a is also a write index of this alias.');

    const moved = stageAddition(promoted, { ...writer, is_write_index: false });
    const movedItems = describePendingChanges(moved, [writer, reader], ['a', 'b']);
    expect(movedItems.map((item) => item.problem)).toEqual([undefined, undefined]);
    expect(movedItems.map(summarizePendingItem)).toEqual([
      'Update w on b (write index)',
      'Update w on a (no longer the write index)',
    ]);

    const removed = stageRemoval(promoted, writer, [writer, reader]);
    expect(describePendingChanges(removed, [writer, reader], ['a', 'b']).map((item) => item.problem))
      .toEqual([undefined, undefined]);
  });

  it('mentions the write index in the confirmation summary', () => {
    const items = describePendingChanges(
      [{ kind: 'add', alias: { alias: 'w', index: 'c', is_write_index: true } }],
      [],
      undefined,
    );
    expect(summarizePendingItem(items[0]!)).toBe('Add w to c (write index)');
  });
});

describe('draft status', () => {
  const existing: AliasRecord[] = [
    { alias: 'Logs-UP', index: 'logs-2026.10.12', search_routing: '1' },
    orders,
  ];

  it('is new without a name and index, or for an assignment that does not exist', () => {
    expect(draftStatusFor('', 'orders-v2', undefined, existing, [])).toBe('new');
    expect(draftStatusFor('orders', '', undefined, existing, [])).toBe('new');
    expect(draftStatusFor('fresh', 'orders-v2', { alias: 'fresh', index: 'orders-v2' }, existing, [])).toBe('new');
  });

  it('compares names case sensitively', () => {
    const record: AliasRecord = { alias: 'Logs-UP', index: 'logs-2026.10.12', search_routing: '9' };
    expect(draftStatusFor('Logs-UP', 'logs-2026.10.12', record, existing, [])).toBe('update');
    expect(draftStatusFor('logs-up', 'logs-2026.10.12', { ...record, alias: 'logs-up' }, existing, []))
      .toBe('new');
  });

  it('is same when nothing would change, update otherwise', () => {
    expect(draftStatusFor('orders', 'orders-v2', { ...orders }, existing, [])).toBe('same');
    expect(draftStatusFor('orders', 'orders-v2', { ...orders, is_write_index: true }, existing, []))
      .toBe('update');
    expect(draftStatusFor('orders', 'orders-v2', undefined, existing, [])).toBe('update');
  });

  it('is restage when a change is already staged for the assignment', () => {
    const changes = stageRemoval([], orders, existing);
    expect(draftStatusFor('orders', 'orders-v2', { ...orders }, existing, changes)).toBe('restage');
  });
});

describe('applying changes locally', () => {
  it('produces the alias list Elasticsearch will report after the update', () => {
    const changes: AliasChange[] = [
      { kind: 'remove', alias: logs12 },
      { kind: 'add', alias: { ...orders, search_routing: '1' } },
      { kind: 'add', alias: { alias: 'recent', index: 'logs-2026.10.14' } },
    ];
    expect(applyChangesLocally(current, changes)).toEqual([
      logs13,
      catalog,
      { ...orders, search_routing: '1' },
      { alias: 'recent', index: 'logs-2026.10.14' },
    ]);
  });
});

describe('display helpers', () => {
  it('collapses identical routing values into one tag', () => {
    expect(routingTags({ alias: 'a', index: 'b', index_routing: '1', search_routing: '1' })).toEqual([
      { label: 'routing', value: '1', title: 'Index and search routing: 1' },
    ]);
    expect(routingTags(orders).map((tag) => `${tag.label}=${tag.value}`)).toEqual([
      'index=1',
      'search=1,2',
    ]);
    expect(routingTags(logs12)).toEqual([]);
  });

  it('labels filters by their top level query', () => {
    expect(filterLabel(catalog.filter)).toBe('range');
    expect(filterLabel({ term: {}, range: {} })).toBe('2 clauses');
    expect(filterLabel({})).toBe('empty');
    expect(filterLabel('raw')).toBe('filter');
  });

  it('lists regular indices before dot-prefixed ones, without duplicates', () => {
    expect(sortIndexOptions(['products', '.kibana', 'audit', 'products'])).toEqual([
      'audit',
      'products',
      '.kibana',
    ]);
  });

  it('lists distinct alias names', () => {
    expect(aliasNames(current)).toEqual(['catalog', 'logs', 'orders']);
  });

  it('pretty prints JSON and tolerates undefined', () => {
    expect(prettyJson({ a: [1] })).toBe('{\n  "a": [\n    1\n  ]\n}');
    expect(prettyJson(undefined)).toBe('');
  });

  it('compares flags, treating an unset hidden flag as false', () => {
    expect(sameSettings({ ...logs12, is_hidden: true }, logs12)).toBe(false);
    expect(sameSettings({ ...logs12, is_write_index: false }, logs12)).toBe(false);
    expect(sameSettings({ ...logs12, is_write_index: true }, { ...logs12, is_write_index: true })).toBe(true);
  });

  it('compares routing and filters regardless of key order', () => {
    const left: AliasRecord = { alias: 'a', index: 'b', filter: { bool: { must: [], filter: [] } } };
    const right: AliasRecord = { alias: 'a', index: 'b', filter: { bool: { filter: [], must: [] } } };
    expect(sameSettings(left, right)).toBe(true);
    expect(sameSettings(left, { ...right, index_routing: '1' })).toBe(false);
    expect(sameSettings(logs12, { alias: 'logs', index: 'logs-2026.10.12' })).toBe(true);
  });
});
