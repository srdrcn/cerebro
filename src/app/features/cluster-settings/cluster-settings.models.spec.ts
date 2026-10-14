import { describe, expect, it } from 'vitest';
import { buildClusterSettingsPayload, mergeClusterSettings } from './cluster-settings.models';

describe('cluster settings models', () => {
  it('merges settings with transient taking precedence over persistent and defaults', () => {
    expect(mergeClusterSettings({
      defaults: { a: 'default', b: 'default', c: 'default' },
      persistent: { b: 'persistent', c: 'persistent' },
      transient: { c: 'transient' },
    })).toEqual({ a: 'default', b: 'persistent', c: 'transient' });
  });

  it('stages persistence separately and serializes an empty value as null deletion', () => {
    expect(buildClusterSettingsPayload({
      'cluster.routing.allocation.enable': { value: 'primaries', transient: true },
      'cluster.blocks.read_only': { value: '', transient: false },
    })).toEqual({
      transient: { 'cluster.routing.allocation.enable': 'primaries' },
      persistent: { 'cluster.blocks.read_only': null },
    });
  });
});
