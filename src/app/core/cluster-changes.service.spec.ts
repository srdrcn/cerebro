import { describe, expect, it } from 'vitest';
import {
  ClusterSnapshot,
  detectClusterChanges,
} from './cluster-changes.service';

function snapshot(
  indices: readonly string[],
  nodes: readonly string[],
): ClusterSnapshot {
  return { cluster_name: 'production', indices, nodes };
}

describe('cluster change detection', () => {
  it('reports joined/left nodes and created/deleted indices', () => {
    expect(
      detectClusterChanges(
        snapshot(['logs-old', 'shared'], ['node-a', 'node-b']),
        snapshot(['logs-new', 'shared'], ['node-b', 'node-c']),
      ),
    ).toEqual({
      joinedNodes: ['node-c'],
      leftNodes: ['node-a'],
      createdIndices: ['logs-new'],
      deletedIndices: ['logs-old'],
    });
  });
});
