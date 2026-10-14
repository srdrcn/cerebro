import { describe, expect, it } from 'vitest';
import { NodesNode } from './nodes.models';
import {
  attributeEntries,
  matchesNode,
  nodeRoles,
  prettyByteString,
  sortNodes,
  summarizeNodes,
} from './nodes.utils';

function node(
  name: string,
  overrides: Partial<NodesNode> = {},
): NodesNode {
  return {
    id: name,
    name,
    host: null,
    current_master: false,
    master: false,
    data: false,
    ingest: false,
    coordinating: false,
    cpu: { load: 0, process: 0, os: 0 },
    heap: { percent: 0, used: '0b', max: '0b' },
    disk: null,
    uptime: 0,
    jvm: null,
    version: '8.0.0',
    attributes: {},
    ...overrides,
  };
}

describe('node filtering and sorting', () => {
  it('combines a case-insensitive name match with the selected roles', () => {
    const candidate = node('Warm-Node-01', { data: true, ingest: true });

    expect(
      matchesNode(candidate, {
        name: 'warm',
        master: false,
        data: true,
        ingest: false,
        coordinating: false,
      }),
    ).toBe(true);
    expect(
      matchesNode(candidate, {
        name: 'cold',
        master: false,
        data: true,
        ingest: true,
        coordinating: false,
      }),
    ).toBe(false);
  });

  it('sorts nested numeric fields in both directions', () => {
    const nodes = [
      node('node-b', { cpu: { load: 8, process: 3, os: 4 } }),
      node('node-a', { cpu: { load: 2, process: 1, os: 2 } }),
    ];

    expect(sortNodes(nodes, 'cpu.load', false).map((item) => item.name)).toEqual([
      'node-a',
      'node-b',
    ]);
    expect(sortNodes(nodes, 'cpu.load', true).map((item) => item.name)).toEqual([
      'node-b',
      'node-a',
    ]);
  });
});

describe('node presentation helpers', () => {
  it('hides built-in attributes unless requested', () => {
    const attributes = { zone: 'a', 'ml.config_version': '12', rack: 'r1', 'xpack.installed': 'true' };
    expect(attributeEntries(attributes)).toEqual([
      ['rack', 'r1'],
      ['zone', 'a'],
    ]);
    expect(attributeEntries(attributes, true)).toHaveLength(4);
  });

  it('lists roles with the elected master marked', () => {
    expect(
      nodeRoles(node('n', { master: true, current_master: true, data: true })).map((role) => role.label),
    ).toEqual(['master ★', 'data']);
  });

  it('summarizes the cluster', () => {
    const summary = summarizeNodes([
      node('a', {
        current_master: true,
        heap: { percent: 20, used: '1gb', max: '5gb' },
        cpu: { load: 1, process: 10, os: 5 },
        disk: { percent: 50, available: 50, total: 100 },
      }),
      node('b', {
        version: '8.1.0',
        heap: { percent: 40, used: '2gb', max: '5gb' },
        cpu: { load: 1, process: null, os: 5 },
        disk: null,
      }),
    ]);
    expect(summary).toEqual({
      total: 2,
      master: 'a',
      versions: ['8.0.0', '8.1.0'],
      averageHeap: 30,
      averageCpu: 10,
      diskUsed: 50,
      diskTotal: 100,
    });
  });

  it('prettifies Elasticsearch byte strings', () => {
    expect(prettyByteString('274mb')).toBe('274 MB');
    expect(prettyByteString('1.5gb')).toBe('1.5 GB');
    expect(prettyByteString('weird')).toBe('weird');
    expect(prettyByteString(null)).toBe('–');
  });
});
