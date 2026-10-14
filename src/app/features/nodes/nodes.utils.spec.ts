import { describe, expect, it } from 'vitest';
import { NodesNode } from './nodes.models';
import { matchesNode, sortNodes } from './nodes.utils';

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
