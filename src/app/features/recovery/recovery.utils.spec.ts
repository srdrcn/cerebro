import { describe, expect, it } from 'vitest';
import { RawRecoveryRow, Recovery } from './recovery.models';
import {
  bytesRemaining,
  catNumber,
  catValue,
  describeLoadError,
  estimateRemaining,
  filesRemaining,
  filterRecoveries,
  groupBytesLabel,
  groupRecoveries,
  metricView,
  normalizeRecovery,
  parsePercent,
  parseRecoveries,
  recoveryPercent,
  recoveryRates,
  sortGroups,
  stageIndex,
  stageLabel,
  summarizeRecoveries,
  takeSample,
  translogRemaining,
  typeCounts,
  typeMeta,
} from './recovery.utils';

function row(overrides: Partial<RawRecoveryRow> = {}): RawRecoveryRow {
  return {
    index: 'logs',
    shard: '0',
    time: '4210',
    type: 'peer',
    stage: 'index',
    source_host: '127.0.0.1',
    source_node: 'es-node-1',
    target_host: '127.0.0.1',
    target_node: 'es-node-2',
    repository: 'n/a',
    snapshot: 'n/a',
    files: '4',
    files_recovered: '1',
    files_percent: '25.0%',
    files_total: '6',
    bytes: '1000',
    bytes_recovered: '250',
    bytes_percent: '25.0%',
    bytes_total: '1500',
    translog_ops: '0',
    translog_ops_recovered: '0',
    translog_ops_percent: '100.0%',
    ...overrides,
  };
}

function recovery(overrides: Partial<RawRecoveryRow> = {}): Recovery {
  return normalizeRecovery(row(overrides));
}

describe('parsing _cat/recovery rows', () => {
  it('reads cat values, numbers and percentages', () => {
    expect(catValue('n/a')).toBeUndefined();
    expect(catValue(' - ')).toBeUndefined();
    expect(catValue(' x ')).toBe('x');
    expect(catNumber('12')).toBe(12);
    expect(catNumber('n/a')).toBe(0);
    expect(catNumber(undefined)).toBe(0);
    expect(parsePercent('12.5%')).toBe(12.5);
    expect(parsePercent('120%')).toBe(100);
    expect(parsePercent('-1')).toBe(0);
    expect(parsePercent('garbage')).toBe(0);
  });

  it('normalizes a peer recovery', () => {
    const value = recovery();
    expect(value).toMatchObject({
      key: 'logs|0|peer|es-node-1|es-node-2',
      index: 'logs',
      shard: 0,
      timeMs: 4210,
      type: 'peer',
      stage: 'index',
      done: false,
      sourceNode: 'es-node-1',
      targetNode: 'es-node-2',
      files: { total: 4, recovered: 1, percent: 25 },
      filesTotal: 6,
      bytes: { total: 1000, recovered: 250, percent: 25 },
      bytesTotal: 1500,
      translog: { total: 0, recovered: 0, percent: 100 },
    });
    expect(value.repository).toBeUndefined();
    expect(value.snapshot).toBeUndefined();
  });

  it('keeps snapshot details and unknown translog counts', () => {
    const value = recovery({ type: 'SNAPSHOT', repository: 'backups', snapshot: 'nightly', source_node: 'n/a', translog_ops: '-1' });
    expect(value.type).toBe('snapshot');
    expect(value.repository).toBe('backups');
    expect(value.snapshot).toBe('nightly');
    expect(value.sourceNode).toBeUndefined();
    expect(value.translog).toBeNull();
  });

  it('ignores malformed rows', () => {
    expect(parseRecoveries([row(), { shard: '1' }, 'nope', null])).toHaveLength(1);
    expect(parseRecoveries({ error: 'x' })).toEqual([]);
  });
});

describe('presentation helpers', () => {
  it('describes types and stages', () => {
    expect(typeMeta('peer').label).toBe('Peer');
    expect(typeMeta('existing_store').label).toBe('Existing store');
    expect(typeMeta('future_type')).toMatchObject({ label: 'Future type', badge: 'badge-outline' });
    expect(stageLabel('translog')).toBe('Replaying translog');
    expect(stageLabel('new_stage')).toBe('New stage');
    expect(stageIndex('init')).toBe(0);
    expect(stageIndex('done')).toBe(5);
    expect(stageIndex('weird')).toBe(0);
  });

  it('computes the headline progress per stage', () => {
    expect(recoveryPercent(recovery({ stage: 'done' }))).toBe(100);
    expect(recoveryPercent(recovery())).toBe(25);
    expect(
      recoveryPercent(recovery({ stage: 'translog', translog_ops: '200', translog_ops_recovered: '50', translog_ops_percent: '25%' })),
    ).toBe(25);
    expect(recoveryPercent(recovery({ stage: 'translog', bytes_percent: '100%' }))).toBe(100);
    expect(recoveryPercent(recovery({ stage: 'finalize', bytes: '0', bytes_percent: '0%' }))).toBe(99);
    expect(recoveryPercent(recovery({ stage: 'init', bytes: '0', bytes_percent: '0%' }))).toBe(0);
  });

  it('computes remaining amounts', () => {
    expect(bytesRemaining(recovery())).toBe(750);
    expect(bytesRemaining(recovery({ stage: 'done' }))).toBe(0);
    expect(filesRemaining(recovery())).toBe(3);
    expect(translogRemaining(recovery({ translog_ops: '10', translog_ops_recovered: '4' }))).toBe(6);
    expect(translogRemaining(recovery({ translog_ops: '-1' }))).toBe(0);
  });

  it('builds metric views that tell empty amounts from progress', () => {
    expect(metricView(recovery(), 'bytes')).toEqual({ value: 25, label: '25%', detail: '250 B / 1,000 B' });
    expect(metricView(recovery(), 'files')).toEqual({ value: 25, label: '25%', detail: '1 / 4' });
    expect(metricView(recovery(), 'translog')).toEqual({ value: 0, label: '–', detail: 'Starts after files' });
    expect(metricView(recovery({ stage: 'finalize' }), 'translog')).toEqual({ value: 100, label: '–', detail: 'No operations' });
    expect(metricView(recovery({ translog_ops: '-1' }), 'translog').detail).toBe('Not known yet');
    expect(
      metricView(recovery({ stage: 'translog', translog_ops: '2000', translog_ops_recovered: '500', translog_ops_percent: '25%' }), 'translog'),
    ).toEqual({ value: 25, label: '25%', detail: '500 / 2,000 ops' });
    expect(metricView(recovery({ stage: 'done', bytes: '0', bytes_percent: '0.0%' }), 'bytes')).toEqual({
      value: 100,
      label: '–',
      detail: 'Nothing to copy',
    });
    expect(metricView(recovery({ stage: 'done', files: '0', files_percent: '0.0%' }), 'files').detail).toBe('No files to copy');
    expect(metricView(recovery({ stage: 'done', bytes_percent: '99%' }), 'bytes').value).toBe(100);
  });
});

describe('filtering, grouping and sorting', () => {
  const list = [
    recovery({ index: 'logs', shard: '1' }),
    recovery({ index: 'logs', shard: '0', stage: 'done', type: 'existing_store', source_node: 'n/a' }),
    recovery({ index: 'logs', shard: '0' }),
    recovery({ index: 'metrics', shard: '0', bytes: '4000', bytes_recovered: '1000' }),
    recovery({ index: 'archive', shard: '0', stage: 'done', type: 'snapshot' }),
  ];

  it('filters by index text (regex or substring) and type', () => {
    expect(filterRecoveries(list, { text: 'met', hiddenTypes: new Set() }).map((item) => item.index)).toEqual(['metrics']);
    expect(filterRecoveries(list, { text: '^(logs|archive)$', hiddenTypes: new Set(['peer']) }).map((item) => item.type)).toEqual([
      'existing_store',
      'snapshot',
    ]);
    expect(filterRecoveries(list, { text: '[', hiddenTypes: new Set() })).toEqual([]);
  });

  it('groups by index with active recoveries first and byte-weighted progress', () => {
    const groups = groupRecoveries(list);
    const logs = groups.find((group) => group.index === 'logs');
    expect(logs?.recoveries.map((item) => [item.shard, item.done])).toEqual([
      [0, false],
      [1, false],
      [0, true],
    ]);
    expect(logs).toMatchObject({ active: 2, bytesTotal: 2000, bytesRecovered: 500, bytesRemaining: 1500, percent: 25 });
    const archive = groups.find((group) => group.index === 'archive');
    expect(archive).toMatchObject({ active: 0, percent: 100, bytesRemaining: 0, longestMs: 0 });
  });

  it('sorts groups: active first, then by the chosen field', () => {
    const groups = groupRecoveries(list);
    expect(sortGroups(groups, 'index').map((group) => group.index)).toEqual(['logs', 'metrics', 'archive']);
    expect(sortGroups(groups, 'remaining').map((group) => group.index)).toEqual(['metrics', 'logs', 'archive']);
    const timed = groupRecoveries([recovery({ index: 'a', time: '10' }), recovery({ index: 'b', time: '5000' })]);
    expect(sortGroups(timed, 'time').map((group) => group.index)).toEqual(['b', 'a']);
    const hidden = groupRecoveries([recovery({ index: '.ds-x', stage: 'done' }), recovery({ index: 'z', stage: 'done' })]);
    expect(sortGroups(hidden, 'index').map((group) => group.index)).toEqual(['z', '.ds-x']);
  });

  it('summarizes active recoveries', () => {
    const summary = summarizeRecoveries(list);
    expect(summary).toMatchObject({
      total: 5,
      active: 3,
      // archive only has a done recovery.
      indices: 2,
      bytesToRecover: 6000,
      bytesRemaining: 4500,
      filesRemaining: 9,
      translogRemaining: 0,
      percent: 25,
    });
    expect(summary.byType).toEqual([{ type: 'peer', count: 3 }]);
  });

  it('summarizes completed recoveries by type when nothing is active', () => {
    const done = list.filter((item) => item.done);
    const summary = summarizeRecoveries(done);
    expect(summary.active).toBe(0);
    expect(summary.percent).toBeNull();
    expect(summary.byType.map((entry) => entry.type)).toEqual(['existing_store', 'snapshot']);
    expect(summarizeRecoveries([]).byType).toEqual([]);
  });

  it('counts only the indices with active recoveries (All mode mixes in done rows)', () => {
    const mixed = [
      recovery({ index: 'busy', shard: '0' }),
      recovery({ index: 'busy', shard: '1' }),
      ...['a', 'b', 'c', 'd'].map((index) => recovery({ index, stage: 'done', type: 'existing_store' })),
    ];
    expect(summarizeRecoveries(mixed)).toMatchObject({ total: 6, active: 2, indices: 1 });
    expect(summarizeRecoveries(mixed.slice(2))).toMatchObject({ active: 0, indices: 0 });
  });

  it('labels group bytes: progress while active, size and reuse once done', () => {
    const [active] = groupRecoveries([recovery({ index: 'busy' })]);
    expect(active && groupBytesLabel(active)).toBe('250 B of 1,000 B');
    const [reused] = groupRecoveries([
      recovery({ index: 'audit', stage: 'done', type: 'existing_store', bytes: '0', bytes_recovered: '0', bytes_total: '27238' }),
    ]);
    expect(reused && groupBytesLabel(reused)).toBe('26.6 KB, reused from disk');
    const [partly] = groupRecoveries([recovery({ index: 'p', stage: 'done', bytes: '1000', bytes_recovered: '1000', bytes_total: '3048' })]);
    expect(partly && groupBytesLabel(partly)).toBe('1,000 B copied, 2 KB reused');
    const [full] = groupRecoveries([recovery({ index: 'f', stage: 'done', bytes: '2048', bytes_recovered: '2048', bytes_total: '2048' })]);
    expect(full && groupBytesLabel(full)).toBe('2 KB copied');
    const [empty] = groupRecoveries([recovery({ index: 'e', stage: 'done', bytes: '0', bytes_total: '0' })]);
    expect(empty && groupBytesLabel(empty)).toBe('No data to copy');
  });

  it('counts types', () => {
    expect([...typeCounts(list).entries()]).toEqual([
      ['peer', 3],
      ['existing_store', 1],
      ['snapshot', 1],
    ]);
  });
});

describe('throughput', () => {
  it('computes per-recovery rates between two samples', () => {
    const first = takeSample([recovery({ bytes_recovered: '100' }), recovery({ index: 'gone' })], 1_000);
    const second = takeSample(
      [recovery({ bytes_recovered: '1100' }), recovery({ index: 'new' }), recovery({ index: 'gone', stage: 'done' })],
      3_000,
    );
    const rates = recoveryRates(first, second);
    expect(rates.get('logs|0|peer|es-node-1|es-node-2')).toBe(500);
    expect(rates.has('new|0|peer|es-node-1|es-node-2')).toBe(false);
    expect(rates.size).toBe(1);
    expect(recoveryRates(null, second).size).toBe(0);
    expect(recoveryRates(second, second).size).toBe(0);
  });

  it('ignores counters that went backwards (restarted recoveries)', () => {
    const first = takeSample([recovery({ bytes_recovered: '900' })], 0);
    const second = takeSample([recovery({ bytes_recovered: '100' })], 1_000);
    expect(recoveryRates(first, second).size).toBe(0);
  });

  it('estimates the remaining time', () => {
    expect(estimateRemaining(1000, 500)).toBe(2000);
    expect(estimateRemaining(1000, 0)).toBeNull();
    expect(estimateRemaining(1000, undefined)).toBeNull();
    expect(estimateRemaining(0, 100)).toBeNull();
  });
});

describe('describeLoadError', () => {
  it('prefers the Elasticsearch reason', () => {
    expect(
      describeLoadError({ status: 500, body: { error: { root_cause: [{ reason: 'root' }], type: 't', reason: 'search phase failed' } } }),
    ).toBe('Root');
    expect(describeLoadError({ status: 500, body: { error: { root_cause: [{ reason: 'only root' }] } } })).toBe('Only root');
    expect(describeLoadError({ status: 502, body: { error: 'Bad gateway' } })).toBe('Bad gateway');
    expect(describeLoadError({ status: 502, body: 'upstream down' })).toBe('Upstream down');
  });

  it('falls back to the status, permissions or a connection hint', () => {
    expect(describeLoadError({ status: 403, body: {} })).toMatch(/monitor/);
    expect(describeLoadError({ status: 500, body: {} })).toBe('The request failed with status 500.');
    expect(describeLoadError(new Error('network'))).toBe('The cluster did not answer. Check the connection and try again.');
    expect(describeLoadError('timeout')).toBe('Timeout');
    expect(describeLoadError(undefined)).toBe('The request failed.');
  });
});
