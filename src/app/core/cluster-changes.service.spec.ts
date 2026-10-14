import { describe, expect, it } from 'vitest';
import {
  ClusterSnapshot,
  ExpectedChangeLedger,
  detectClusterChanges,
  expectedChangesFor,
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

describe('own index changes', () => {
  const changes = (created: string[], deleted: string[]) => ({
    joinedNodes: [],
    leftNodes: [],
    createdIndices: created,
    deletedIndices: deleted,
  });

  it('maps the endpoints that create or delete indices', () => {
    expect(expectedChangesFor('overview/delete_indices', { indices: 'logs-1,logs-2' })).toEqual({
      deleted: ['logs-1', 'logs-2'],
    });
    expect(expectedChangesFor('create_index/create', { index: 'orders', metadata: {} })).toEqual({
      created: ['orders'],
    });
    expect(expectedChangesFor('snapshots/restore', { indices: 'a' })).toEqual({ createdUnknown: true });
    expect(expectedChangesFor('overview/close_indices', { indices: 'logs-1' })).toBeUndefined();
  });

  it('leaves expected changes out once, and reports the rest', () => {
    const ledger = new ExpectedChangeLedger(() => 1_000);
    ledger.expect({ deleted: ['tmp-a'], created: ['tmp-b'] });

    expect(ledger.filter(changes(['tmp-b', 'other-new'], ['tmp-a', 'other-old']))).toEqual(
      changes(['other-new'], ['other-old']),
    );
    // Forgotten after being seen: a later external change is reported.
    expect(ledger.filter(changes(['tmp-b'], ['tmp-a']))).toEqual(changes(['tmp-b'], ['tmp-a']));
  });

  it('waits for slow changes but expires stale expectations', () => {
    let now = 0;
    const ledger = new ExpectedChangeLedger(() => now);
    ledger.expect({ deleted: ['tmp-a'] });

    expect(ledger.filter(changes([], []))).toEqual(changes([], []));
    now = 60_000;
    expect(ledger.filter(changes([], ['tmp-a']))).toEqual(changes([], []));

    ledger.expect({ deleted: ['tmp-c'] });
    now = 300_000;
    expect(ledger.filter(changes([], ['tmp-c']))).toEqual(changes([], ['tmp-c']));
  });

  it('hides creations for a while after a restore started', () => {
    let now = 0;
    const ledger = new ExpectedChangeLedger(() => now);
    ledger.expect({ createdUnknown: true });

    expect(ledger.filter(changes(['restored-logs'], ['gone'])).createdIndices).toEqual([]);
    now = 31_000;
    expect(ledger.filter(changes(['new-later'], [])).createdIndices).toEqual(['new-later']);
  });
});
