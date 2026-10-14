import { describe, expect, it } from 'vitest';
import { buildIndexMetadata, cloneableMetadata } from './create-index.models';

describe('create index payload', () => {
  it('uses simple shard and replica inputs when custom JSON is blank', () => {
    expect(buildIndexMetadata('', ' 5 ', '1')).toEqual({
      settings: { index: { number_of_shards: '5', number_of_replicas: '1' } },
    });
  });

  it('keeps custom JSON authoritative', () => {
    expect(buildIndexMetadata('{"settings":{"refresh_interval":"30s"}}', '5', '1')).toEqual({
      settings: { refresh_interval: '30s' },
    });
  });

  it('clones only settings and mappings from index metadata', () => {
    expect(cloneableMetadata({ settings: { a: 1 }, mappings: { properties: {} } })).toEqual({
      settings: { a: 1 }, mappings: { properties: {} },
    });
  });
});
