import { describe, expect, it } from 'vitest';
import {
  buildIndexSettingRows,
  groupIndexOptions,
  indexMetadata,
  indexSettingKind,
  isClosedIndex,
  resolveIndexSettings,
} from './index-settings.models';

describe('index settings merge', () => {
  it('lets explicit index settings override defaults and hides metadata fields', () => {
    const rows = buildIndexSettingRows({
      defaults: {
        'index.number_of_replicas': '1',
        'index.refresh_interval': '1s',
        'index.creation_date': '1720000000000',
        'index.version.created': '9000000',
      },
      settings: {
        'index.refresh_interval': '30s',
        'index.uuid': 'secret-internal-id',
      },
    });
    expect(rows.map((row) => [row.name, row.value, row.origin])).toEqual([
      ['index.number_of_replicas', '1', 'default'],
      ['index.refresh_interval', '30s', 'index'],
    ]);
  });
});

describe('index setting kinds', () => {
  it('distinguishes dynamic, static, final and internal settings', () => {
    expect(indexSettingKind('index.number_of_replicas')).toBe('dynamic');
    expect(indexSettingKind('index.routing.allocation.require._name')).toBe('dynamic');
    expect(indexSettingKind('index.blocks.write')).toBe('dynamic');
    expect(indexSettingKind('index.codec')).toBe('static');
    expect(indexSettingKind('index.analysis.analyzer.custom.type')).toBe('static');
    expect(indexSettingKind('index.number_of_shards')).toBe('final');
    expect(indexSettingKind('index.sort.field')).toBe('final');
    expect(indexSettingKind('index.version.compatibility')).toBe('internal');
    expect(indexSettingKind('index.store.snapshot.repository_name')).toBe('internal');
  });
});

describe('index setting rows', () => {
  const group = {
    defaults: { 'index.refresh_interval': '1s', 'index.codec': 'default', 'index.max_result_window': 10000 },
    settings: {
      'index.number_of_shards': '1',
      'index.refresh_interval': '30s',
      'index.uuid': 'abc',
      'index.creation_date': '1791983838153',
    },
  };

  it('marks explicit values as overridden and locks what cannot change on an open index', () => {
    expect(buildIndexSettingRows(group)).toEqual([
      {
        name: 'index.codec',
        value: 'default',
        origin: 'default',
        editable: false,
        lockLabel: 'Static',
        lockReason: expect.stringContaining('closed'),
      },
      { name: 'index.max_result_window', value: '10000', origin: 'default', editable: true },
      {
        name: 'index.number_of_shards',
        value: '1',
        origin: 'index',
        editable: false,
        lockLabel: 'Fixed',
        lockReason: expect.stringContaining('created'),
      },
      { name: 'index.refresh_interval', value: '30s', origin: 'index', editable: true },
    ]);
  });

  it('unlocks static settings of closed indices but never final ones', () => {
    const closed = { ...group, settings: { ...group.settings, 'index.verified_before_close': 'true' } };
    expect(isClosedIndex(closed)).toBe(true);
    expect(isClosedIndex(group)).toBe(false);
    const rows = buildIndexSettingRows(closed);
    expect(rows.map((row) => [row.name, row.editable])).toEqual([
      ['index.codec', true],
      ['index.max_result_window', true],
      ['index.number_of_shards', false],
      ['index.refresh_interval', true],
    ]);
  });

  it('extracts the index metadata hidden from the form', () => {
    expect(indexMetadata(group)).toEqual({
      uuid: 'abc',
      createdAt: new Date(1791983838153),
      closed: false,
    });
    expect(indexMetadata({})).toEqual({ closed: false });
  });
});

describe('resolveIndexSettings', () => {
  it('handles exact names, aliases to one index and aliases to several', () => {
    expect(resolveIndexSettings({ logs: {} }, 'logs')).toEqual({ kind: 'single', index: 'logs', group: {} });
    expect(resolveIndexSettings({ 'logs-2': { settings: {} } }, 'logs-current')).toEqual({
      kind: 'single',
      index: 'logs-2',
      group: { settings: {} },
    });
    expect(resolveIndexSettings({ b: {}, a: {} }, 'logs')).toEqual({ kind: 'multiple', indices: ['a', 'b'] });
    expect(resolveIndexSettings({}, 'logs')).toEqual({ kind: 'missing' });
  });
});

describe('groupIndexOptions', () => {
  it('sorts indices and lists dot-prefixed ones separately', () => {
    expect(groupIndexOptions(['orders', '.kibana', 'customers', 'orders'])).toEqual({
      regular: ['customers', 'orders'],
      system: ['.kibana'],
    });
  });
});
