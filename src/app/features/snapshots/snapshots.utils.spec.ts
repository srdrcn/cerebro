import { describe, expect, it } from 'vitest';
import { SnapshotRecord } from './snapshots.models';
import {
  aliasesByIndex,
  aliasesOf,
  badgeClass,
  failedShards,
  filterSnapshots,
  indexStatuses,
  isRenaming,
  isRestorable,
  renameIndex,
  restoreTargetState,
  snapshotDuration,
  snapshotMatcher,
  snapshotStart,
  snapshotSystemIndices,
  sortSnapshots,
  stateMeta,
  suggestSnapshotName,
  summarizeSnapshots,
  uniqueName,
  validateRename,
  validateRenamePattern,
  validateSnapshotName,
} from './snapshots.utils';

function snapshot(name: string, extra: Partial<SnapshotRecord> = {}): SnapshotRecord {
  return { snapshot: name, ...extra };
}

const nightly13 = snapshot('nightly-2026.10.13', {
  state: 'SUCCESS',
  start_time_in_millis: 1_000,
  duration_in_millis: 200,
  indices: ['customers', 'products'],
  shards: { total: 3, failed: 0, successful: 3 },
});
const nightly14 = snapshot('nightly-2026.10.14', {
  state: 'PARTIAL',
  start_time: '1970-01-01T00:00:05.000Z',
  indices: ['logs-a', 'logs-b', 'products'],
  shards: { total: 5, failed: 1, successful: 4 },
});
const running = snapshot('manual', {
  state: 'IN_PROGRESS',
  start_time_in_millis: 9_000,
  indices: ['orders'],
});

describe('snapshot state helpers', () => {
  it('maps states to labels and tones', () => {
    expect(stateMeta('SUCCESS')).toMatchObject({ label: 'Success', tone: 'green' });
    expect(stateMeta('PARTIAL')).toMatchObject({ label: 'Partial', tone: 'yellow' });
    expect(stateMeta('FAILED')).toMatchObject({ label: 'Failed', tone: 'red' });
    expect(stateMeta('IN_PROGRESS')).toMatchObject({ label: 'In progress', tone: 'blue' });
    expect(stateMeta('INCOMPATIBLE')).toMatchObject({ label: 'Incompatible', tone: 'neutral' });
    expect(stateMeta(undefined)).toMatchObject({ label: 'Unknown', tone: 'neutral' });
    expect(stateMeta('toString')).toMatchObject({ label: 'Unknown' });
  });

  it('only emits badge classes that exist in the design system', () => {
    expect(badgeClass('green')).toBe('badge badge-green');
    expect(badgeClass('blue')).toBe('badge badge-blue');
    expect(badgeClass('neutral')).toBe('badge');
  });

  it('only restores snapshots that hold data', () => {
    expect(isRestorable(nightly13)).toBe(true);
    expect(isRestorable(nightly14)).toBe(true);
    expect(isRestorable(running)).toBe(false);
    expect(isRestorable(snapshot('broken', { state: 'FAILED' }))).toBe(false);
  });

  it('counts failed shards from stats or the failure list', () => {
    expect(failedShards(nightly14)).toBe(1);
    expect(failedShards(snapshot('x', { failures: [{ index: 'a' }, { index: 'b' }] }))).toBe(2);
    expect(failedShards(snapshot('y'))).toBe(0);
  });
});

describe('snapshot timing', () => {
  it('reads the start from millis or the ISO timestamp', () => {
    expect(snapshotStart(nightly13)).toBe(1_000);
    expect(snapshotStart(nightly14)).toBe(5_000);
    expect(snapshotStart(snapshot('none'))).toBeNull();
  });

  it('measures running snapshots against now and finished ones from the report', () => {
    expect(snapshotDuration(nightly13, 50_000)).toBe(200);
    expect(snapshotDuration(running, 12_500)).toBe(3_500);
    expect(
      snapshotDuration(snapshot('x', { start_time_in_millis: 1_000, end_time_in_millis: 4_000 }), 0),
    ).toBe(3_000);
    expect(snapshotDuration(snapshot('y'), 0)).toBeNull();
  });
});

describe('snapshot filtering and sorting', () => {
  it('matches snapshot names and contained indices', () => {
    expect(snapshotMatcher('')(nightly13)).toBe(true);
    expect(snapshotMatcher('10.13')(nightly13)).toBe(true);
    expect(snapshotMatcher('customers')(nightly13)).toBe(true);
    expect(snapshotMatcher('^logs')(nightly13)).toBe(false);
    expect(snapshotMatcher('^logs')(nightly14)).toBe(true);
  });

  it('lists the system indices of the feature states', () => {
    expect(snapshotSystemIndices(nightly13)).toEqual([]);
    expect(
      snapshotSystemIndices(
        snapshot('full', {
          indices: ['.tasks', 'orders', '.security-7'],
          feature_states: [
            { feature_name: 'tasks', indices: ['.tasks'] },
            { feature_name: 'security', indices: ['.security-7', '.tasks'] },
            { feature_name: 'empty' },
          ],
        }),
      ),
    ).toEqual(['.security-7', '.tasks']);
  });

  it('hides filtered states', () => {
    const all = [nightly13, nightly14, running];
    expect(filterSnapshots(all, '', new Set(['PARTIAL'])).map((s) => s.snapshot)).toEqual([
      'nightly-2026.10.13',
      'manual',
    ]);
    expect(filterSnapshots(all, 'products', new Set()).length).toBe(2);
  });

  it('sorts newest first by default and by name or index count', () => {
    const all = [nightly14, running, nightly13];
    expect(sortSnapshots(all, 'start', true).map((s) => s.snapshot)).toEqual([
      'manual',
      'nightly-2026.10.14',
      'nightly-2026.10.13',
    ]);
    expect(sortSnapshots(all, 'name', false).map((s) => s.snapshot)).toEqual([
      'manual',
      'nightly-2026.10.13',
      'nightly-2026.10.14',
    ]);
    expect(sortSnapshots(all, 'indices', true).map((s) => s.snapshot)).toEqual([
      'nightly-2026.10.14',
      'nightly-2026.10.13',
      'manual',
    ]);
    expect(all[0]).toBe(nightly14);
  });

  it('keeps snapshots without a start time last when sorting newest first', () => {
    const undated = snapshot('undated');
    expect(sortSnapshots([undated, nightly13], 'start', true).map((s) => s.snapshot)).toEqual([
      'nightly-2026.10.13',
      'undated',
    ]);
  });
});

describe('summarizeSnapshots', () => {
  it('counts states, indices and the latest snapshots', () => {
    const summary = summarizeSnapshots([nightly13, nightly14, running]);
    expect(summary.total).toBe(3);
    expect(summary.states).toEqual({ SUCCESS: 1, PARTIAL: 1, IN_PROGRESS: 1 });
    expect(summary.problems).toBe(1);
    expect(summary.running).toBe(1);
    expect(summary.latest?.snapshot).toBe('manual');
    expect(summary.lastSuccess?.snapshot).toBe('nightly-2026.10.13');
    expect(summary.indices).toBe(5);
    expect(summary.shards).toBe(8);
  });

  it('handles an empty repository', () => {
    const summary = summarizeSnapshots([]);
    expect(summary.total).toBe(0);
    expect(summary.latest).toBeUndefined();
    expect(summary.lastSuccess).toBeUndefined();
  });
});

describe('snapshot names', () => {
  it('suggests a lowercase, timestamped name', () => {
    expect(suggestSnapshotName(new Date(2026, 9, 14, 15, 30))).toBe('snapshot-2026.10.14-1530');
    expect(suggestSnapshotName(new Date(2026, 0, 2, 3, 4), 'Nightly')).toBe('nightly-2026.01.02-0304');
  });

  it('makes names unique', () => {
    expect(uniqueName('a', new Set())).toBe('a');
    expect(uniqueName('a', new Set(['a', 'a-2']))).toBe('a-3');
  });

  it('validates names like Elasticsearch does', () => {
    expect(validateSnapshotName('nightly-1')).toBeNull();
    expect(validateSnapshotName('  ')).toMatch(/Enter/);
    expect(validateSnapshotName('Nightly')).toMatch(/lowercase/);
    expect(validateSnapshotName('my snapshot')).toMatch(/spaces/);
    expect(validateSnapshotName('_hidden')).toMatch(/start with "_"/);
    expect(validateSnapshotName('a/b')).toMatch(/"\/"/);
    expect(validateSnapshotName('a,b')).toMatch(/","/);
    expect(validateSnapshotName('taken', new Set(['taken']))).toMatch(/already exists/);
    expect(validateSnapshotName('<nightly-{now/d}>')).toBeNull();
  });
});

describe('restore rename preview', () => {
  it('applies the pattern to every match', () => {
    expect(renameIndex('logs-1', '(.+)', 'restored-$1')).toBe('restored-logs-1');
    expect(renameIndex('logs-1', 'logs', 'old')).toBe('old-1');
    expect(renameIndex('logs-1', '', 'ignored')).toBe('logs-1');
    expect(renameIndex('logs-1', '([', 'x')).toBe('logs-1');
  });

  it('keeps the name when the replacement is missing, like Elasticsearch', () => {
    expect(renameIndex('tmp-logs', 'tmp-', '')).toBe('tmp-logs');
    expect(renameIndex('tmp-logs', 'tmp-', '   ')).toBe('tmp-logs');
    // Stripping a prefix needs a capture group instead of an empty replacement.
    expect(renameIndex('tmp-logs', 'tmp-(.+)', '$1')).toBe('logs');
  });

  it('requires both a pattern and a replacement', () => {
    expect(validateRename('', '')).toEqual({ pattern: null, replacement: null });
    expect(validateRename('(.+)', 'restored-$1')).toEqual({ pattern: null, replacement: null });
    expect(validateRename('tmp-', '').replacement).toMatch(/ignores a pattern without one/);
    expect(validateRename('', 'copy-$1').replacement).toMatch(/Set a rename pattern/);
    expect(validateRename('([', 'x').pattern).toMatch(/not a valid/);

    expect(isRenaming('(.+)', 'restored-$1')).toBe(true);
    expect(isRenaming('tmp-', '')).toBe(false);
    expect(isRenaming('', 'x')).toBe(false);
    expect(isRenaming('([', 'x')).toBe(false);
  });

  it('reports invalid patterns', () => {
    expect(validateRenamePattern('')).toBeNull();
    expect(validateRenamePattern('index_(.+)')).toBeNull();
    expect(validateRenamePattern('([')).toMatch(/not a valid/);
  });
});

describe('restore targets', () => {
  const statuses = indexStatuses([
    { index: 'logs', status: 'open', health: 'green' },
    { index: 'archive', status: 'close' },
    { index: 'legacy' },
    { status: 'open' },
    null,
  ]);

  it('reads index statuses from a _cat/indices response', () => {
    expect([...statuses]).toEqual([
      ['logs', 'open'],
      ['archive', 'close'],
      ['legacy', 'open'],
    ]);
    expect(indexStatuses({ error: 'nope' }).size).toBe(0);
  });

  it('tells open conflicts from closed indices that get replaced', () => {
    const known = new Set(['logs', 'archive']);
    expect(restoreTargetState('logs', statuses, known)).toBe('open');
    expect(restoreTargetState('archive', statuses, known)).toBe('closed');
    expect(restoreTargetState('restored-logs', statuses, known)).toBe('free');
    // Without statuses every known index counts as open.
    expect(restoreTargetState('archive', null, known)).toBe('open');
    expect(restoreTargetState('other', null, known)).toBe('free');
  });

  it('reads aliases from a _cat/aliases response', () => {
    const aliases = aliasesByIndex([
      { alias: 'logs', index: 'logs-1', is_write_index: '-' },
      { alias: 'logs', index: 'logs-2', is_write_index: 'true' },
      { alias: 'current', index: 'logs-2', is_write_index: 'false' },
      { alias: 'orphan' },
      null,
    ]);
    expect([...aliases]).toEqual([
      ['logs-1', [{ alias: 'logs', write: false }]],
      [
        'logs-2',
        [
          { alias: 'logs', write: true },
          { alias: 'current', write: false },
        ],
      ],
    ]);
    expect(aliasesByIndex({ error: 'nope' }).size).toBe(0);
  });

  it('lists the aliases of a set of indices once and flags write aliases', () => {
    const aliases = aliasesByIndex([
      { alias: 'logs', index: 'logs-1', is_write_index: '-' },
      { alias: 'logs', index: 'logs-2', is_write_index: 'true' },
      { alias: 'current', index: 'logs-2', is_write_index: '-' },
      { alias: 'catalog', index: 'products', is_write_index: '-' },
    ]);
    expect(aliasesOf(['logs-1', 'logs-2', 'missing'], aliases)).toEqual([
      { alias: 'current', write: false },
      { alias: 'logs', write: true },
    ]);
    expect(aliasesOf(['logs-1'], aliases)).toEqual([{ alias: 'logs', write: false }]);
    expect(aliasesOf([], aliases)).toEqual([]);
  });
});
