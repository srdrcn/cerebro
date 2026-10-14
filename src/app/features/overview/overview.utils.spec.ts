import { describe, expect, it } from 'vitest';
import {
  OverviewIndex,
  OverviewIndexFilter,
  OverviewShard,
} from './overview.models';
import {
  buildBulkIndicesPayload,
  canReceiveShard,
  filterOverviewIndices,
  matchesOverviewIndex,
} from './overview.utils';

const defaultFilter: OverviewIndexFilter = {
  name: '',
  closed: false,
  special: false,
  healthy: true,
  ascending: true,
};

function index(
  name: string,
  overrides: Partial<OverviewIndex> = {},
): OverviewIndex {
  return {
    name,
    aliases: [],
    closed: false,
    special: false,
    unhealthy: false,
    doc_count: 0,
    size_in_bytes: 0,
    num_shards: 1,
    num_replicas: 0,
    shards: {},
    ...overrides,
  };
}

describe('overview index filtering and bulk payloads', () => {
  it('matches aliases and preserves the legacy closed/special/health switches', () => {
    const indices = [
      index('logs-current', { aliases: ['production'] }),
      index('logs-closed', { closed: true, aliases: ['production'] }),
      index('.logs-internal', { special: true, aliases: ['production'] }),
      index('logs-healthy'),
      index('logs-affected', { unhealthy: true }),
    ];

    expect(
      filterOverviewIndices(indices, {
        ...defaultFilter,
        name: 'production',
      }).map((item) => item.name),
    ).toEqual(['logs-current']);
    expect(
      filterOverviewIndices(indices, {
        ...defaultFilter,
        name: 'logs',
        healthy: false,
      }).map((item) => item.name),
    ).toEqual(['logs-affected']);
  });

  it('builds one comma-separated payload from the full filtered result, not a page', () => {
    const indices = [
      index('logs-03'),
      index('metrics-01'),
      index('logs-01'),
      index('logs-02'),
    ];

    const payload = buildBulkIndicesPayload(indices, {
      ...defaultFilter,
      name: '^logs-',
    });

    expect(payload).toEqual({ indices: 'logs-01,logs-02,logs-03' });
  });

  it('falls back to literal case-insensitive matching for an invalid regexp', () => {
    expect(
      matchesOverviewIndex(index('Prefix[Logs-Suffix'), {
        ...defaultFilter,
        name: '[logs-',
      }),
    ).toBe(true);
  });
});

describe('shard relocation eligibility', () => {
  const selected: OverviewShard = {
    shard: 1,
    index: 'logs',
    node: 'node-a',
    state: 'STARTED',
    primary: true,
  };

  it('allows a different node without another copy of the selected shard', () => {
    const targetIndex = index('logs', {
      shards: {
        'node-a': [selected],
        'node-b': [{ ...selected, shard: 2, node: 'node-b' }],
      },
    });

    expect(canReceiveShard(selected, targetIndex, 'node-b')).toBe(true);
    expect(canReceiveShard(selected, targetIndex, 'node-c')).toBe(true);
  });

  it('rejects the source node, another index, and a node with the same shard copy', () => {
    const targetIndex = index('logs', {
      shards: {
        'node-b': [{ ...selected, node: 'node-b', primary: false }],
      },
    });

    expect(canReceiveShard(selected, targetIndex, 'node-a')).toBe(false);
    expect(canReceiveShard(selected, index('metrics'), 'node-b')).toBe(false);
    expect(canReceiveShard(selected, targetIndex, 'node-b')).toBe(false);
    expect(canReceiveShard(undefined, targetIndex, 'node-c')).toBe(false);
  });
});
