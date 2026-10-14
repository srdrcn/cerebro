import { describe, expect, it } from 'vitest';
import {
  buildClusterSavePayload,
  buildClusterSettingRows,
  isDynamicClusterSetting,
  summarizeOverrides,
} from './cluster-settings.models';
import { pendingChanges } from './settings-editor.models';

describe('cluster settings models', () => {
  it('uses transient values over persistent ones over defaults', () => {
    const rows = buildClusterSettingRows({
      defaults: { 'a.x': 'default', 'b.x': 'default', 'c.x': 'default' },
      persistent: { 'b.x': 'persistent', 'c.x': 'persistent' },
      transient: { 'c.x': 'transient' },
    });
    expect(rows.map((row) => [row.name, row.value, row.origin])).toEqual([
      ['a.x', 'default', 'default'],
      ['b.x', 'persistent', 'persistent'],
      ['c.x', 'transient', 'transient'],
    ]);
  });

  it('stages persistence separately and serializes an empty value as null deletion', () => {
    const rows = buildClusterSettingRows({
      defaults: { 'cluster.routing.allocation.enable': 'all' },
      persistent: { 'cluster.blocks.read_only': 'true' },
    });
    const changes = pendingChanges(rows, {
      'cluster.routing.allocation.enable': { value: 'primaries', scope: 'transient' },
      'cluster.blocks.read_only': { value: '', scope: 'persistent' },
    });
    expect(buildClusterSavePayload(changes, rows)).toEqual({
      transient: { 'cluster.routing.allocation.enable': 'primaries' },
      persistent: { 'cluster.blocks.read_only': null },
    });
  });

  it('knows dynamic settings of old and recent Elasticsearch versions', () => {
    expect(isDynamicClusterSetting('cluster.routing.allocation.enable')).toBe(true);
    expect(isDynamicClusterSetting('cluster.max_shards_per_node')).toBe(true);
    expect(isDynamicClusterSetting('discovery.zen.minimum_master_nodes')).toBe(true);
    expect(isDynamicClusterSetting('logger.org.elasticsearch.transport')).toBe(true);
    expect(isDynamicClusterSetting('cluster.routing.allocation.exclude._name')).toBe(true);
    expect(isDynamicClusterSetting('node.name')).toBe(false);
    expect(isDynamicClusterSetting('path.data')).toBe(false);
  });
});

describe('cluster setting rows', () => {
  const rows = buildClusterSettingRows({
    defaults: {
      'cluster.routing.allocation.enable': 'all',
      'cluster.routing.allocation.awareness.attributes': [],
      'node.name': 'es-node-1',
    },
    persistent: { 'cluster.routing.allocation.enable': 'primaries', 'custom.plugin.setting': 'on' },
    transient: { 'cluster.routing.allocation.enable': 'none' },
  });

  it('exposes the effective value, its origin and every explicit layer', () => {
    expect(rows).toEqual([
      { name: 'cluster.routing.allocation.awareness.attributes', value: '', origin: 'default', editable: true },
      {
        name: 'cluster.routing.allocation.enable',
        value: 'none',
        origin: 'transient',
        editable: true,
        persistent: 'primaries',
        transient: 'none',
      },
      { name: 'custom.plugin.setting', value: 'on', origin: 'persistent', editable: true, persistent: 'on' },
      {
        name: 'node.name',
        value: 'es-node-1',
        origin: 'default',
        editable: false,
        lockLabel: 'Static',
        lockReason: expect.stringContaining('elasticsearch.yml'),
      },
    ]);
  });

  it('counts persistent and transient overrides', () => {
    expect(summarizeOverrides(rows)).toEqual({ persistent: 2, transient: 1 });
  });

  it('writes values to the chosen layer and clears every explicit layer on reset', () => {
    expect(
      buildClusterSavePayload(
        [
          { name: 'cluster.routing.allocation.enable', from: 'none', to: null, scope: 'transient' },
          { name: 'custom.plugin.setting', from: 'on', to: 'off', scope: 'transient' },
          { name: 'cluster.routing.allocation.awareness.attributes', from: '', to: 'zone,rack', scope: 'persistent' },
        ],
        rows,
      ),
    ).toEqual({
      persistent: {
        'cluster.routing.allocation.enable': null,
        'cluster.routing.allocation.awareness.attributes': 'zone,rack',
      },
      transient: { 'cluster.routing.allocation.enable': null, 'custom.plugin.setting': 'off' },
    });
  });
});

describe('moving transient settings to persistent', () => {
  const rows = buildClusterSettingRows({
    defaults: { 'cluster.routing.allocation.enable': 'all', 'indices.recovery.max_bytes_per_sec': '40mb' },
    persistent: { 'cluster.routing.allocation.enable': 'primaries' },
    transient: { 'cluster.routing.allocation.enable': 'none', 'indices.recovery.max_bytes_per_sec': '80mb' },
  });

  it('treats a persistent draft of a transient setting as a change even with the same value', () => {
    const changes = pendingChanges(rows, {
      'cluster.routing.allocation.enable': { value: 'none', scope: 'persistent' },
      'indices.recovery.max_bytes_per_sec': { value: '80mb', scope: 'transient' },
    });
    expect(changes).toEqual([
      { name: 'cluster.routing.allocation.enable', from: 'none', to: 'none', scope: 'persistent' },
    ]);
  });

  it('clears the transient value so the persistent one applies', () => {
    expect(
      buildClusterSavePayload(
        [
          { name: 'cluster.routing.allocation.enable', from: 'none', to: 'none', scope: 'persistent' },
          { name: 'indices.recovery.max_bytes_per_sec', from: '80mb', to: '100mb', scope: 'persistent' },
        ],
        rows,
      ),
    ).toEqual({
      persistent: { 'cluster.routing.allocation.enable': 'none', 'indices.recovery.max_bytes_per_sec': '100mb' },
      transient: { 'cluster.routing.allocation.enable': null, 'indices.recovery.max_bytes_per_sec': null },
    });
  });

  it('keeps the transient layer when the change stays transient', () => {
    expect(
      buildClusterSavePayload(
        [{ name: 'indices.recovery.max_bytes_per_sec', from: '80mb', to: '100mb', scope: 'transient' }],
        rows,
      ),
    ).toEqual({ persistent: {}, transient: { 'indices.recovery.max_bytes_per_sec': '100mb' } });
  });

  it('writes settings added by name to the chosen layer', () => {
    const changes = pendingChanges(rows, {
      'cluster.routing.allocation.exclude._name': { value: 'es-node-3', scope: 'persistent' },
    });
    expect(buildClusterSavePayload(changes, rows)).toEqual({
      persistent: { 'cluster.routing.allocation.exclude._name': 'es-node-3' },
      transient: {},
    });
  });
});
