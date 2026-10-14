import { describe, expect, it } from 'vitest';
import { CHECKS, runChecks, verdictFor } from './doctor.checks';
import { DEPRECATIONS, ILM_MISSING_POLICY, liveReport } from './doctor.fixtures';
import { DoctorFinding, DoctorReport } from './doctor.models';

const GB = 1024 ** 3;
const TB = 1024 ** 4;

function finding(report: DoctorReport, id: string): DoctorFinding {
  const match = report.findings.find((item) => item.id === id);
  if (!match) {
    throw new Error(`No finding ${id} in ${report.findings.map((item) => item.id).join(', ')}`);
  }
  return match;
}

function ids(report: DoctorReport): string[] {
  return report.findings.map((item) => item.id);
}

function outcome(report: DoctorReport, id: string) {
  return report.outcomes.find((item) => item.id === id);
}

/** Every node of the fixture with the same disk usage. */
function setDisks(raw: Record<string, any>, total: number, available: number): void {
  for (const node of Object.values<any>(raw['nodes'].nodes)) {
    node.fs = { total: { total_in_bytes: total, available_in_bytes: available }, data: [{ path: '/data', total_in_bytes: total, available_in_bytes: available }] };
  }
}

function enableDiskThreshold(raw: Record<string, any>): void {
  raw['settings'].defaults['cluster.routing.allocation.disk.threshold_enabled'] = 'true';
}

/** A healthy cluster: green, no tmp-doctor conditions, plenty of disk. */
function healthyReport(): Record<string, any> {
  const raw = liveReport();
  raw['health'].status = 'green';
  raw['health'].unassigned_shards = 0;
  raw['indices'] = raw['indices']
    .filter((row: any) => !row.index.startsWith('tmp-doctor') && row.index !== 'overflow-test' && row.index !== 'metrics-app')
    .map((row: any) => ({ ...row, pri: '1' }));
  raw['shards'] = raw['shards'].filter((row: any) => row.state === 'STARTED' && !row.index.startsWith('tmp-doctor'));
  raw['blocks'] = {};
  raw['ilm'] = { indices: {} };
  raw['health_report'].status = 'green';
  for (const indicator of Object.values<any>(raw['health_report'].indicators)) {
    indicator.status = 'green';
  }
  enableDiskThreshold(raw);
  setDisks(raw, 100 * GB, 60 * GB);
  return raw;
}

describe('runChecks on the live 8.15 report', () => {
  const report = runChecks(liveReport());

  it('runs every check and orders findings by severity, then category', () => {
    expect(report.ran).toBe(CHECKS.length);
    expect(report.skipped).toBe(0);
    expect(report.version).toBe('8.15.3');
    expect(report.clusterName).toBe('cerebro-demo');
    // The yellow status is reported by the unassigned replicas finding.
    expect(ids(report)).toEqual([
      'index-blocks:read-only-allow-delete',
      'disk-watermarks:high',
      'impossible-replicas',
      'unassigned-shards:replica',
      'missing-replicas',
      'ilm-errors',
      'over-sharded',
      'index-blocks:manual',
      'disk-threshold-enabled',
    ]);
    const severities = report.findings.map((item) => item.severity);
    expect(severities).toEqual([...severities].sort((left, right) => ['critical', 'warning', 'info'].indexOf(left) - ['critical', 'warning', 'info'].indexOf(right)));
    expect(report.findings[0]?.id).toBe('index-blocks:read-only-allow-delete');
    expect(report.counts).toEqual({ critical: 1, warning: 5, info: 3 });
    // cluster-status found the yellow health, so it did not pass either.
    expect(report.passed).toBe(CHECKS.length - 9);
    expect(outcome(report, 'cluster-status')).toMatchObject({ status: 'failed', findings: [] });
    expect(report.gaps).toBe(0);
  });

  it('sums up the verdict in one sentence', () => {
    expect(report.verdict).toEqual({
      tone: 'red',
      icon: 'bi-x-octagon-fill',
      title: 'Critical problems found',
      text: '1 critical problem and 5 warnings need attention, plus 3 info findings.',
    });
  });

  it('reports the yellow cluster through its unassigned replicas, with the shard counts', () => {
    const unassigned = finding(report, 'unassigned-shards:replica');
    expect(unassigned.summary).toBe('Cluster health is yellow: 2 indices are missing replica copies.');
    expect(unassigned.facts).toEqual([
      { label: 'Cluster health', value: 'Yellow' },
      { label: 'Unassigned', value: '4' },
      { label: 'Initializing', value: '0' },
      { label: 'Relocating', value: '0' },
    ]);
    expect(unassigned.impact).toContain('if a node holding the last active copy of a shard fails, the cluster turns red');
  });

  it('groups unassigned replicas by index with their reason and an explain link', () => {
    const unassigned = finding(report, 'unassigned-shards:replica');
    expect(unassigned.title).toBe('4 replica shards are unassigned');
    expect(unassigned.resources).toEqual([
      {
        kind: 'index',
        name: 'overflow-test',
        detail: 'Shards 0, 1 · Cluster recovered · more replicas than nodes',
        link: { label: 'Explain', icon: 'bi-signpost-split', route: '/allocation', params: { index: 'overflow-test', shard: '0', primary: 'false' } },
      },
      {
        kind: 'index',
        name: 'tmp-doctor-overflow',
        detail: 'Shard 0 · Index created · more replicas than nodes',
        link: { label: 'Explain', icon: 'bi-signpost-split', route: '/allocation', params: { index: 'tmp-doctor-overflow', shard: '0', primary: 'false' } },
      },
    ]);
    // Nothing failed to allocate, so there is nothing to retry.
    expect(unassigned.fixes).toEqual([]);
  });

  it('offers to reduce replicas that can never be allocated to data nodes - 1', () => {
    const replicas = finding(report, 'impossible-replicas');
    expect(replicas.title).toBe('2 indices have more replicas than the cluster can hold');
    expect(replicas.summary).toContain('with 3 data nodes an index can have at most 2 replicas');
    expect(replicas.resources.map((item) => [item.name, item.detail])).toEqual([
      ['overflow-test', '3 replicas · 2 shard copies can never be allocated'],
      ['tmp-doctor-overflow', '4 replicas · 2 shard copies can never be allocated'],
    ]);
    expect(replicas.resources[0]?.fix?.label).toBe('Reduce replicas to 2');
    expect(replicas.fixes[0]).toMatchObject({
      label: 'Reduce all to 2 replicas',
      confirmLabel: 'Reduce all to 2 replicas',
      path: 'index_settings/bulk_update',
      payload: { indices: ['overflow-test', 'tmp-doctor-overflow'], settings: { 'index.number_of_replicas': 2 } },
      confirmItems: ['overflow-test', 'tmp-doctor-overflow'],
    });
    expect(replicas.resources[1]?.fix?.payload).toEqual({
      indices: ['tmp-doctor-overflow'],
      settings: { 'index.number_of_replicas': 2 },
    });
    expect(replicas.resources[1]?.fix?.confirmTitle).toBe('Reduce the replicas of tmp-doctor-overflow to 2?');
  });

  it('lists indices without replicas, ignoring system and hidden ones', () => {
    const missing = finding(report, 'missing-replicas');
    expect(missing.severity).toBe('warning');
    expect(missing.resources.map((item) => [item.name, item.detail])).toEqual([
      ['metrics-app', '1 primary shard · 194.3 KB'],
      ['tmp-doctor-norep', '1 primary shard · 227 B'],
    ]);
    const fix = missing.fixes[0]!;
    expect(fix.label).toBe('Add a replica to all');
    expect(missing.resources[0]?.fix?.label).toBe('Add a replica');
    expect(fix.payload).toEqual({ indices: ['metrics-app', 'tmp-doctor-norep'], settings: { 'index.number_of_replicas': 1 } });
    // Disk watermarks are disabled on the demo cluster, so the replicas can still be placed.
    expect(fix.confirmMessage).toBe(
      'Sets index.number_of_replicas to 1. Elasticsearch copies every shard to another node, which needs about 194.5 KB of extra disk.',
    );
    expect(missing.resources[1]?.fix?.payload).toEqual({ indices: ['tmp-doctor-norep'], settings: { 'index.number_of_replicas': 1 } });
  });

  it('measures disks against the resolved watermarks, even when Elasticsearch does not enforce them', () => {
    const disk = finding(report, 'disk-watermarks:high');
    expect(disk.title).toBe('3 nodes are above the high watermark');
    expect(disk.summary).toContain('threshold_enabled: false');
    // 270,553,174,016 B total, 25,314,484,224 B available: 10% of the disk is
    // 27,055,317,401 B (what Elasticsearch itself reports as the high
    // watermark free space), below the 150 GB headroom.
    expect(disk.resources[0]).toEqual({
      kind: 'node',
      name: 'es-node-1',
      detail: '90.6% used · 23.6 GB free of 252 GB · the high watermark needs 25.2 GB free',
    });
    expect(disk.facts).toEqual([
      { label: 'Low watermark', value: '85% (max headroom 200 GB)' },
      { label: 'High watermark', value: '90% (max headroom 150 GB)' },
      { label: 'Flood stage', value: '95% (max headroom 100 GB)' },
    ]);
    expect(disk.links).toEqual([{ label: 'Open nodes', icon: 'bi-hdd-stack', route: '/nodes' }]);
  });

  it('notes that disk-based allocation is disabled in the node configuration (the disk finding carries the warning)', () => {
    const threshold = finding(report, 'disk-threshold-enabled');
    expect(threshold.severity).toBe('info');
    expect(threshold.impact).toContain('see the disk finding');
    expect(threshold.facts).toEqual([{ label: 'Set in', value: 'node configuration (elasticsearch.yml) or default' }]);
    // elasticsearch.yml cannot be changed through the API.
    expect(threshold.fixes).toEqual([]);
  });

  it('offers to remove the flood stage block and reports manual blocks as info', () => {
    const blocked = finding(report, 'index-blocks:read-only-allow-delete');
    expect(blocked.severity).toBe('critical');
    expect(blocked.resources.map((item) => item.name)).toEqual(['tmp-doctor-ro']);
    expect(blocked.resources[0]?.link).toEqual({ label: 'Index settings', icon: 'bi-gear', route: '/index_settings', params: { index: 'tmp-doctor-ro' } });
    expect(blocked.fixes[0]).toMatchObject({
      label: 'Remove read-only block',
      path: 'index_settings/bulk_update',
      payload: { indices: ['tmp-doctor-ro'], settings: { 'index.blocks.read_only_allow_delete': null } },
      tone: 'default',
    });
    // threshold_enabled is false on the demo cluster: nothing adds or removes the block.
    expect(blocked.advice).toBe('Make sure the disks have room, then remove the block.');
    expect(blocked.note).toContain('neither re-applies nor removes this block on its own');
    expect(blocked.fixes[0]?.confirmMessage).toContain('will neither add it again nor remove it on its own');
    const manual = finding(report, 'index-blocks:manual');
    expect(manual.severity).toBe('info');
    expect(manual.resources).toEqual([
      {
        kind: 'index',
        name: 'tmp-doctor-write',
        detail: 'write block',
        link: { label: 'Index settings', icon: 'bi-gear', route: '/index_settings', params: { index: 'tmp-doctor-write' } },
      },
    ]);
  });

  it('reports the ILM error with its failed step, reason and a retry', () => {
    const ilm = finding(report, 'ilm-errors');
    expect(ilm.title).toBe('Lifecycle management failed for 1 index');
    expect(ilm.resources[0]?.detail).toMatch(
      /^attempt-rollover failed: setting \[index\.lifecycle\.rollover_alias\] for index \[tmp-doctor-ilm-1\] is empty or not defined.* · policy tmp-doctor-policy/,
    );
    expect(ilm.resources[0]?.link).toEqual({ label: 'Index details', icon: 'bi-box', route: '/index_detail', params: { index: 'tmp-doctor-ilm-1', tab: 'lifecycle' } });
    expect(ilm.fixes[0]).toMatchObject({ label: 'Retry step', path: 'ilm/retry', payload: { indices: ['tmp-doctor-ilm-1'] } });
    expect(ilm.links[0]).toMatchObject({ route: '/ilm', params: { tab: 'status', index: 'tmp-doctor-ilm-1' } });
    expect(ilm.note).toContain('retries some of these steps on its own');
  });

  it('suggests fewer shards for small multi-shard indices', () => {
    const small = finding(report, 'over-sharded');
    expect(small.severity).toBe('info');
    expect(small.resources[0]).toMatchObject({ name: 'search-sessions', detail: '5 primary shards · 1.2 KB in total' });
    expect(small.resources.map((item) => item.name)).toContain('tmp-doctor-shards');
    expect(small.resources.some((item) => item.name.startsWith('.'))).toBe(false);
  });

  it('keeps disk and shard indicators of the health report out of the findings (checks cover them)', () => {
    expect(ids(report).some((id) => id.startsWith('health-indicators'))).toBe(false);
    expect(report.healthReport.kind).toBe('report');
    if (report.healthReport.kind === 'report') {
      expect(report.healthReport.indicators.map((item) => item.name).slice(0, 2)).toEqual(['disk', 'shards_availability']);
      expect(report.healthReport.indicators[0]?.diagnoses[0]?.helpUrl).toMatch(/^https:\/\//);
    }
  });
});

describe('cluster status', () => {
  it('is critical when red', () => {
    const raw = healthyReport();
    raw['health'].status = 'red';
    raw['health'].unassigned_shards = 3;
    const status = finding(runChecks(raw), 'cluster-status:red');
    expect(status.severity).toBe('critical');
    expect(status.summary).toBe('At least one primary shard is not allocated (3 unassigned shards in total).');
  });

  it('is info while shards only initialize', () => {
    const raw = healthyReport();
    raw['health'].status = 'yellow';
    raw['health'].initializing_shards = 2;
    const status = finding(runChecks(raw), 'cluster-status:recovering');
    expect(status.severity).toBe('info');
    expect(status.links[0]?.route).toBe('/recovery');
  });

  it('mentions delayed allocation', () => {
    const raw = liveReport();
    raw['health'].delayed_unassigned_shards = 1;
    expect(finding(runChecks(raw), 'unassigned-shards:replica').summary).toContain('1 of them is delayed on purpose');
  });

  it('reports yellow on its own when the shard list could not be read', () => {
    const raw = liveReport();
    raw['shards'] = null;
    raw['unavailable'] = { shards: { status: 403, error: {} } };
    const status = finding(runChecks(raw), 'cluster-status:yellow');
    expect(status.summary).toBe('Every primary shard is allocated, but 4 replica shards are not.');
    expect(status.facts).toContainEqual({ label: 'Unassigned', value: '4' });
    // There is no unassigned shards finding to point to.
    expect(status.advice).not.toContain('finding');
    expect(status.links[0]?.route).toBe('/allocation');
  });

  it('explains red health caused by primaries that are still initializing', () => {
    const raw = healthyReport();
    raw['health'].status = 'red';
    raw['health'].initializing_shards = 2;
    const status = finding(runChecks(raw), 'cluster-status:red');
    expect(status).toMatchObject({
      severity: 'critical',
      title: 'Cluster health is red while primaries recover',
      summary: 'Some primary shards are still initializing (recovering); 2 shards are initializing in total.',
    });
    expect(status.links.map((link) => link.route)).toEqual(['/recovery', '/allocation']);
  });
});

describe('a healthy cluster', () => {
  it('passes every check', () => {
    const report = runChecks(healthyReport());
    expect(report.findings).toEqual([]);
    expect(report.passed).toBe(CHECKS.length);
    expect(report.verdict).toMatchObject({ tone: 'green', title: 'Healthy', text: 'No problems found.' });
  });
});

describe('unassigned shards', () => {
  it('makes unassigned primaries critical and offers to retry failed allocations', () => {
    const raw = healthyReport();
    raw['shards'].push(
      { index: 'orders', shard: '1', prirep: 'p', state: 'UNASSIGNED', store: null, node: null, 'unassigned.reason': 'ALLOCATION_FAILED' },
      { index: 'orders', shard: '0', prirep: 'p', state: 'UNASSIGNED', store: null, node: null, 'unassigned.reason': 'NODE_LEFT' },
    );
    const primaries = finding(runChecks(raw), 'unassigned-shards:primary');
    expect(primaries.severity).toBe('critical');
    expect(primaries.title).toBe('2 primary shards are unassigned');
    expect(primaries.resources[0]).toMatchObject({
      name: 'orders',
      detail: 'Shards 0, 1 · Allocation failed · Node left',
      link: { params: { index: 'orders', shard: '0', primary: 'true' } },
    });
    expect(primaries.fixes[0]).toMatchObject({
      label: 'Retry failed allocations',
      path: 'doctor/retry_allocation',
      confirmItems: ['orders'],
    });
  });
});

describe('replicas', () => {
  it('explains that a single data node cannot hold replicas', () => {
    const raw = healthyReport();
    raw['health'].number_of_data_nodes = 1;
    const id = Object.keys(raw['nodes'].nodes)[0]!;
    raw['nodes'].nodes = { [id]: raw['nodes'].nodes[id] };
    raw['indices'].push({ index: 'solo', health: 'green', status: 'open', pri: '1', rep: '0', 'pri.store.size': '100' });
    const report = runChecks(raw);
    const missing = finding(report, 'missing-replicas:single-node');
    expect(missing.severity).toBe('info');
    expect(missing.fixes).toEqual([]);
    // With one node, the 1-replica indices of the fixture can never be placed.
    expect(finding(report, 'impossible-replicas').fixes[0]?.label).toBe('Reduce all to 0 replicas');
  });

  it('warns that new replicas may not fit when nodes are above the high watermark', () => {
    const raw = liveReport();
    enableDiskThreshold(raw);
    const fix = finding(runChecks(raw), 'missing-replicas').fixes[0]!;
    expect(fix.confirmMessage).toContain('es-node-1, es-node-2 and es-node-3 are above the high watermark, so the new replicas may stay unassigned.');
  });
});

describe('disk watermarks', () => {
  it('is critical above the flood stage when enforced', () => {
    const raw = healthyReport();
    setDisks(raw, 100 * GB, 4 * GB);
    const report = runChecks(raw);
    const disk = finding(report, 'disk-watermarks:flood');
    expect(disk.severity).toBe('critical');
    expect(disk.title).toBe('3 nodes are above the flood stage watermark');
    expect(disk.summary).toContain('index.blocks.read_only_allow_delete');
    expect(disk.resources[0]?.detail).toBe('96% used · 4 GB free of 100 GB · the flood stage watermark needs 5 GB free');
    expect(outcome(report, 'disk-threshold-enabled')?.status).toBe('passed');
  });

  it('is info above the low watermark', () => {
    const raw = healthyReport();
    setDisks(raw, 100 * GB, 12 * GB);
    expect(finding(runChecks(raw), 'disk-watermarks:low').severity).toBe('info');
  });

  it('caps percentages with max_headroom on large disks (8.5+)', () => {
    const raw = healthyReport();
    // 95% used of 10 TB leaves 512 GB: more than the 200 GB the low watermark asks for.
    setDisks(raw, 10 * TB, 512 * GB);
    expect(ids(runChecks(raw))).toEqual([]);
    // 99% used leaves ~102 GB: below the 150 GB high watermark headroom, above the 100 GB flood stage one.
    setDisks(raw, 10 * TB, Math.round(10 * TB * 0.01));
    expect(ids(runChecks(raw))).toEqual(['disk-watermarks:high']);
  });

  it('ignores the default headroom once a watermark is set explicitly', () => {
    const raw = healthyReport();
    raw['settings'].persistent['cluster.routing.allocation.disk.watermark.low'] = '85%';
    setDisks(raw, 10 * TB, 512 * GB);
    const disk = finding(runChecks(raw), 'disk-watermarks:low');
    expect(disk.resources[0]?.detail).toBe('95% used · 512 GB free of 10 TB · the low watermark needs 1.5 TB free');
    expect(disk.facts?.[0]).toEqual({ label: 'Low watermark', value: '85%' });
  });

  it('reads absolute watermarks as free space, with transient over persistent', () => {
    const raw = healthyReport();
    raw['settings'].persistent['cluster.routing.allocation.disk.watermark.low'] = '30gb';
    raw['settings'].persistent['cluster.routing.allocation.disk.watermark.high'] = '20gb';
    raw['settings'].transient['cluster.routing.allocation.disk.watermark.high'] = '50gb';
    raw['settings'].persistent['cluster.routing.allocation.disk.watermark.flood_stage'] = '10gb';
    setDisks(raw, 100 * GB, 45 * GB);
    const disk = finding(runChecks(raw), 'disk-watermarks:high');
    expect(disk.resources[0]?.detail).toBe('55% used · 45 GB free of 100 GB · the high watermark needs 50 GB free');
    expect(disk.facts).toContainEqual({ label: 'High watermark', value: '50 GB free' });
  });

  it('skips nodes that hold no data and applies only the frozen flood stage to frozen nodes', () => {
    const raw = healthyReport();
    const [first, second] = Object.values<any>(raw['nodes'].nodes);
    first.roles = ['master'];
    first.fs.data[0].available_in_bytes = 1 * GB;
    second.roles = ['data_frozen'];
    // 88% used: past low and high, but frozen nodes only have a flood stage (95%, 20 GB headroom).
    second.fs.data[0].available_in_bytes = 12 * GB;
    expect(ids(runChecks(raw)).filter((id) => id.startsWith('disk'))).toEqual([]);
    second.fs.data[0].available_in_bytes = 4 * GB;
    expect(finding(runChecks(raw), 'disk-watermarks:flood').resources.map((item) => item.name)).toEqual(['es-node-3']);
  });

  it('assumes the defaults (or the node figures) without the cluster settings', () => {
    const raw = liveReport();
    raw['settings'] = null;
    raw['unavailable'] = { settings: { status: 403, error: { error: { reason: 'action [cluster:monitor/settings] is unauthorized' } } } };
    const report = runChecks(raw);
    const disk = finding(report, 'disk-watermarks:high');
    expect(disk.note).toBe('The cluster settings could not be read, so the default watermarks were assumed.');
    expect(disk.resources[0]?.detail).toContain('the high watermark needs 25.2 GB free');
    // Without the settings the watermarks count as enforced.
    expect(disk.summary).toBe('Elasticsearch moves shards away from these nodes and does not allocate any new shard to them.');
    expect(outcome(report, 'allocation-enabled')).toMatchObject({ status: 'skipped', reason: 'Needs the monitor privilege (403)' });
  });

  it('offers to reset a disabled threshold set through the API', () => {
    const raw = healthyReport();
    raw['settings'].persistent['cluster.routing.allocation.disk.threshold_enabled'] = 'false';
    const threshold = finding(runChecks(raw), 'disk-threshold-enabled');
    expect(threshold.severity).toBe('info');
    expect(threshold.fixes[0]?.payload).toEqual({
      settings: {
        persistent: { 'cluster.routing.allocation.disk.threshold_enabled': null },
        transient: { 'cluster.routing.allocation.disk.threshold_enabled': null },
      },
    });
  });
});

describe('read-only blocks', () => {
  it('warns that the block comes back while a node is above the flood stage', () => {
    const raw = liveReport();
    enableDiskThreshold(raw);
    setDisks(raw, 100 * GB, 3 * GB);
    const blocked = finding(runChecks(raw), 'index-blocks:read-only-allow-delete');
    expect(blocked.note).toBe(
      'es-node-1, es-node-2 and es-node-3 are still above the flood stage watermark: Elasticsearch re-applies the block until disk space is freed.',
    );
    expect(blocked.fixes[0]?.tone).toBe('warning');
  });

  it('accepts boolean values and lists every block of an index', () => {
    const raw = healthyReport();
    raw['blocks'] = { a: { settings: { 'index.blocks.read_only': true, 'index.blocks.metadata': 'true' } }, b: { settings: { 'index.blocks.write': 'false' } } };
    expect(finding(runChecks(raw), 'index-blocks:manual').resources).toEqual([
      expect.objectContaining({ name: 'a', detail: 'read-only, metadata block' }),
    ]);
  });
});

describe('shard sizes and counts', () => {
  it('flags shards above 50 GB', () => {
    const raw = healthyReport();
    raw['shards'].push(
      { index: 'big', shard: '0', prirep: 'p', state: 'STARTED', store: String(60 * GB), node: 'es-node-1' },
      { index: 'big', shard: '0', prirep: 'r', state: 'STARTED', store: String(61 * GB), node: 'es-node-2' },
      { index: 'big', shard: '1', prirep: 'p', state: 'STARTED', store: String(50 * GB), node: 'es-node-2' },
    );
    const big = finding(runChecks(raw), 'oversized-shards');
    expect(big.severity).toBe('warning');
    expect(big.resources).toEqual([
      {
        kind: 'index',
        name: 'big',
        detail: '1 shard over 50 GB · largest 61 GB',
        link: { label: 'Index details', icon: 'bi-box', route: '/index_detail', params: { index: 'big', tab: 'shards' } },
      },
    ]);
  });

  it('warns at 80% of the shard limit and is critical at 95%, counting open indices only', () => {
    const raw = healthyReport();
    raw['settings'].persistent['cluster.max_shards_per_node'] = '10';
    raw['indices'] = [
      { index: 'a', status: 'open', pri: '6', rep: '1' },
      { index: 'b', status: 'open', pri: '6', rep: '1' },
      { index: 'closed', status: 'close', pri: '50', rep: '1' },
    ];
    raw['shards'] = [];
    const warning = finding(runChecks(raw), 'shard-capacity');
    expect(warning.severity).toBe('warning');
    expect(warning.title).toBe('The cluster uses 80% of its shard limit');
    expect(warning.summary).toBe('Open indices hold 24 shards; the limit is 30 (10 per data node × 3 data nodes).');
    raw['indices'][1].pri = '8';
    expect(finding(runChecks(raw), 'shard-capacity')).toMatchObject({ severity: 'warning', title: 'The cluster uses 93.3% of its shard limit' });
    raw['indices'][1].pri = '9';
    expect(finding(runChecks(raw), 'shard-capacity')).toMatchObject({ severity: 'critical', title: 'The cluster uses 100% of its shard limit' });
  });

  it('does not suggest fewer shards when a primary is 1 GB or more', () => {
    const raw = healthyReport();
    raw['indices'].push({ index: 'two', status: 'open', pri: '2', rep: '0', 'pri.store.size': String(2 * GB) });
    raw['indices'].push({ index: '.ds-logs-1', status: 'open', pri: '2', rep: '1', 'pri.store.size': '10' });
    raw['shards'].push(
      { index: 'two', shard: '0', prirep: 'p', state: 'STARTED', store: String(GB), node: 'n' },
      { index: 'two', shard: '1', prirep: 'p', state: 'STARTED', store: String(GB - 1), node: 'n' },
      { index: '.ds-logs-1', shard: '0', prirep: 'p', state: 'STARTED', store: '5', node: 'n' },
      { index: '.ds-logs-1', shard: '1', prirep: 'p', state: 'STARTED', store: '5', node: 'n' },
    );
    const report = runChecks(raw);
    expect(ids(report)).not.toContain('over-sharded');
    // "two" has no replicas though.
    expect(finding(report, 'missing-replicas').resources.map((item) => item.name)).toEqual(['two']);
  });
});

describe('JVM', () => {
  function nodes(raw: Record<string, any>): any[] {
    return Object.values<any>(raw['nodes'].nodes);
  }

  it('grades old-generation memory pressure, not the noisy total heap', () => {
    const raw = healthyReport();
    // A full young generation right before a G1 collection: not a problem.
    nodes(raw)[2].jvm.mem.heap_used_percent = 97;
    expect(ids(runChecks(raw))).toEqual([]);
    nodes(raw)[0].jvm.mem.pools.old.used_in_bytes = Math.round(419430400 * 0.86);
    nodes(raw)[1].jvm.mem.pools.old.used_in_bytes = Math.round(419430400 * 0.97);
    const report = runChecks(raw);
    expect(finding(report, 'jvm-heap:critical')).toMatchObject({ title: 'JVM memory pressure is critical on 1 node' });
    expect(finding(report, 'jvm-heap:critical').resources[0]?.detail).toBe('old gen 97% · heap 71% of 400 MB');
    expect(finding(report, 'jvm-heap:warning').resources.map((item) => item.name)).toEqual(['es-node-1']);
    expect(finding(report, 'jvm-heap:warning').note).toContain('single sample');
  });

  it('falls back to the heap percentage without the old-generation pool', () => {
    const raw = healthyReport();
    delete nodes(raw)[0].jvm.mem.pools;
    nodes(raw)[0].jvm.mem.heap_used_percent = 88;
    const heap = finding(runChecks(raw), 'jvm-heap:warning');
    expect(heap.summary).toBe('85% or more of the JVM heap is in use.');
    expect(heap.resources[0]?.detail).toBe('heap 88% of 400 MB');
  });

  it('flags long or frequent old-generation collections', () => {
    const raw = healthyReport();
    const [first, second, third] = nodes(raw);
    first.jvm.gc.collectors.old = { collection_count: 4, collection_time_in_millis: 6_000 };
    first.jvm.uptime_in_millis = 3_600_000;
    second.jvm.gc.collectors.old = { collection_count: 100, collection_time_in_millis: 20_000 };
    second.jvm.uptime_in_millis = 200_000;
    third.jvm.gc.collectors.old = { collection_count: 10, collection_time_in_millis: 2_000 };
    third.jvm.uptime_in_millis = 3_600_000;
    const gc = finding(runChecks(raw), 'jvm-gc');
    expect(gc.resources.map((item) => item.detail)).toEqual([
      '4 collections · 1s on average · 0.2% of uptime',
      '100 collections · 200ms on average · 10% of uptime',
    ]);
  });

  it('reports tripped breakers, as a warning when the parent breaker tripped', () => {
    const raw = healthyReport();
    nodes(raw)[0].breakers.fielddata.tripped = 2;
    expect(finding(runChecks(raw), 'circuit-breakers')).toMatchObject({ severity: 'info' });
    nodes(raw)[1].breakers.parent.tripped = 5;
    const breakers = finding(runChecks(raw), 'circuit-breakers');
    expect(breakers.severity).toBe('warning');
    expect(breakers.resources.map((item) => item.detail)).toEqual(['fielddata 2 times', 'parent 5 times']);
  });
});

describe('cluster settings', () => {
  it('offers to enable restricted allocation without leaving a transient setting', () => {
    const raw = healthyReport();
    raw['settings'].transient['cluster.routing.allocation.enable'] = 'primaries';
    const report = runChecks(raw);
    const allocation = finding(report, 'allocation-enabled');
    expect(allocation.severity).toBe('warning');
    expect(allocation.summary).toBe('Only primary shards are allocated; replicas stay unassigned.');
    expect(allocation.facts).toContainEqual({ label: 'Set in', value: 'transient cluster setting' });
    expect(allocation.fixes[0]?.payload).toEqual({
      settings: {
        persistent: { 'cluster.routing.allocation.enable': null },
        transient: { 'cluster.routing.allocation.enable': null },
      },
    });
    expect(finding(report, 'transient-settings').resources).toEqual([
      { kind: 'setting', name: 'cluster.routing.allocation.enable', detail: 'primaries' },
    ]);
  });

  it('overrides a node-level "none" with a persistent "all"', () => {
    const raw = healthyReport();
    raw['settings'].defaults['cluster.routing.allocation.enable'] = 'none';
    const allocation = finding(runChecks(raw), 'allocation-enabled');
    expect(allocation.fixes[0]?.payload).toEqual({
      settings: { persistent: { 'cluster.routing.allocation.enable': 'all' }, transient: { 'cluster.routing.allocation.enable': null } },
    });
  });
});

describe('upgrade readiness', () => {
  const raw = healthyReport();
  raw['deprecations'] = DEPRECATIONS;
  const report = runChecks(raw);
  const upgrade = report.findings.filter((item) => item.category === 'upgrade');

  it('groups items by message: critical must be fixed (warning), warning can wait (info)', () => {
    expect(upgrade.map((item) => [item.severity, item.title])).toEqual([
      ['warning', "Cluster name cannot contain ':'"],
      ['warning', 'Old index with a compatibility version < 7.0'],
      ['info', "ILM policy [logs-policy] contains the action 'freeze' that is deprecated"],
      ['info', "Index name cannot contain ':'"],
      ['info', 'Legacy index templates are deprecated'],
      ['info', 'Setting [xpack.monitoring.collection.enabled] is deprecated'],
    ]);
    const cluster = upgrade[0]!;
    expect(cluster.impact).toBe('Must be fixed before upgrading to Elasticsearch 9.');
    expect(cluster.summary).toBe("This cluster is named [mycompany:logging], which contains the illegal character ':'.");
    expect(cluster.external?.[0]?.url).toMatch(/^https:\/\/www\.elastic\.co\//);
  });

  it('lists the affected resources with links and per-item details', () => {
    const old = upgrade[1]!;
    expect(old.summary).toBe('Elasticsearch reports this for 2 items.');
    expect(old.resources).toEqual([
      expect.objectContaining({ kind: 'index', name: 'old-index', detail: 'This index has version: 6.8.0', link: expect.objectContaining({ route: '/index_settings' }) }),
      expect.objectContaining({ kind: 'index', name: 'older-index', detail: 'This index has version: 6.5.0' }),
    ]);
    const policy = upgrade[2]!;
    expect(policy.resources[0]).toMatchObject({ kind: 'policy', name: 'logs-policy', link: { route: '/ilm', params: { policy: 'logs-policy' } } });
  });

  it('reads the impacted nodes of node settings', () => {
    const nodes = upgrade[5]!;
    expect(nodes.summary).toBe('Remove the [xpack.monitoring.collection.enabled] setting.');
    expect(nodes.resources.map((item) => [item.kind, item.name])).toEqual([
      ['node', 'es-node-1'],
      ['node', 'es-node-2'],
    ]);
    expect(nodes.advice).toBe('Can be resolved during a rolling upgrade.');
  });
});

describe('health report indicators', () => {
  it('turns indicators the checks do not cover into findings', () => {
    const raw = healthyReport();
    raw['health_report'].indicators.slm = {
      status: 'yellow',
      symptom: 'Encountered [1] unhealthy snapshot lifecycle management policies.',
      impacts: [{ severity: 2, description: 'Some automated snapshots have not had a successful execution recently.', impact_areas: ['backup'] }],
      diagnosis: [
        {
          cause: 'Several automated snapshot attempts have failed.',
          action: 'Check the snapshot lifecycle policy for detailed failure info.',
          help_url: 'https://ela.st/fix-recent-snapshot-failures',
          affected_resources: { slm_policies: ['nightly'] },
        },
      ],
    };
    raw['health_report'].indicators.disk.status = 'red';
    const indicator = finding(runChecks(raw), 'health-indicators:slm');
    expect(indicator).toMatchObject({
      severity: 'warning',
      category: 'health',
      title: 'Snapshot lifecycle (SLM) is yellow in the health report',
      summary: 'Encountered [1] unhealthy snapshot lifecycle management policies.',
      advice: 'Check the snapshot lifecycle policy for detailed failure info.',
      note: 'Several automated snapshot attempts have failed.',
      external: [{ label: 'Troubleshooting guide', url: 'https://ela.st/fix-recent-snapshot-failures' }],
    });
    expect(indicator.resources).toEqual([{ kind: 'other', name: 'nightly', detail: 'Snapshot policies' }]);
    // The disk check covers the disk indicator.
    expect(ids(runChecks(raw))).not.toContain('health-indicators:disk');
  });

  it('reports covered indicators when the matching check could not run', () => {
    const raw = liveReport();
    raw['nodes'] = null;
    raw['unavailable'] = { nodes: { status: 403, error: {} } };
    const report = runChecks(raw);
    expect(finding(report, 'health-indicators:disk').severity).toBe('critical');
    expect(outcome(report, 'disk-watermarks')).toMatchObject({ status: 'skipped', reason: 'Needs the monitor privilege (403)' });
    expect(outcome(report, 'jvm-heap')?.status).toBe('skipped');
  });
});

describe('older and restricted clusters', () => {
  it('skips what a 7.17 cluster cannot answer and keeps the rest', () => {
    const raw = healthyReport();
    raw['info'].version.number = '7.17.24';
    raw['health_report'] = null;
    raw['deprecations'] = null;
    raw['unavailable'] = {
      health_report: { status: 400, error: { error: 'no handler found for uri [/_health_report?verbose=true] and method [GET]' } },
      deprecations: { status: 403, error: { error: { type: 'security_exception', reason: 'action [cluster:admin/xpack/deprecations/info] is unauthorized' } } },
    };
    // 7.x has no max_headroom settings.
    for (const key of Object.keys(raw['settings'].defaults)) {
      if (key.endsWith('max_headroom')) {
        delete raw['settings'].defaults[key];
      }
    }
    setDisks(raw, 10 * TB, 600 * GB);
    const report = runChecks(raw);
    expect(outcome(report, 'health-indicators')).toMatchObject({ status: 'skipped', reason: 'Available from Elasticsearch 8.7' });
    expect(outcome(report, 'deprecations')).toMatchObject({ status: 'skipped', reason: 'Needs the manage privilege (403)' });
    expect(report.healthReport).toEqual({ kind: 'unsupported', version: '7.17.24' });
    // Without headroom 95% used is past the high watermark.
    expect(finding(report, 'disk-watermarks:high').resources[0]?.detail).toBe('94.1% used · 600 GB free of 10 TB · the high watermark needs 1 TB free');
    expect(report.skipped).toBe(2);
    expect(report.ran).toBe(CHECKS.length - 2);
  });

  it('copes with a report that only has cluster health', () => {
    const report = runChecks({ health: { status: 'green', number_of_data_nodes: 1 } });
    expect(report.findings).toEqual([]);
    expect(report.passed).toBe(1);
    expect(report.skipped).toBe(CHECKS.length - 1);
    expect(outcome(report, 'unassigned-shards')?.reason).toBe('Elasticsearch did not return the shard list');
    expect(report.healthReport).toEqual({ kind: 'unavailable', reason: 'Elasticsearch did not return the health report' });
    expect(report.version).toBeNull();
  });

  it('survives malformed sources', () => {
    const report = runChecks({ health: 'nope', nodes: [], indices: {}, shards: 'x', blocks: [], ilm: { indices: [] }, unavailable: null });
    expect(report.findings).toEqual([]);
    // Almost nothing could be read: not a healthy verdict.
    expect(runChecks(null).verdict).toMatchObject({ tone: 'blue', title: 'Partly checked' });
  });

  it('does not call a mostly unchecked cluster healthy', () => {
    const report = runChecks({
      health: { status: 'green', number_of_data_nodes: 3 },
      info: { version: { number: '7.17.24' } },
      unavailable: Object.fromEntries(
        ['nodes', 'settings', 'indices', 'shards', 'blocks', 'ilm', 'deprecations'].map((source) => [source, { status: 403, error: {} }]),
      ),
    });
    expect(report.ran).toBe(1);
    // The health report does not exist on 7.17: not a gap.
    expect(report.gaps).toBe(CHECKS.length - 2);
    expect(outcome(report, 'health-indicators')).toMatchObject({ status: 'skipped', unsupported: true });
    expect(report.verdict).toEqual({
      tone: 'blue',
      icon: 'bi-question-circle-fill',
      title: 'Partly checked',
      text: `No problems in the only check that could run, but ${CHECKS.length - 2} checks could not run.`,
    });
  });
});

describe('verdictFor', () => {
  it('words every combination', () => {
    expect(verdictFor({ critical: 1, warning: 0, info: 0 }).text).toBe('1 critical problem needs attention.');
    expect(verdictFor({ critical: 2, warning: 3, info: 0 }).text).toBe('2 critical problems and 3 warnings need attention.');
    expect(verdictFor({ critical: 0, warning: 1, info: 1 })).toMatchObject({
      tone: 'yellow',
      title: 'Needs attention',
      text: '1 warning needs attention, plus 1 info finding.',
    });
    expect(verdictFor({ critical: 0, warning: 0, info: 2 })).toMatchObject({
      tone: 'green',
      text: 'No problems found, only 2 info findings to consider.',
    });
    expect(verdictFor({ critical: 0, warning: 1, info: 0 }, { ran: 4, gaps: 2 }).text).toBe('1 warning needs attention. 2 checks could not run.');
    expect(verdictFor({ critical: 0, warning: 0, info: 1 }, { ran: 4, gaps: 1 })).toMatchObject({
      tone: 'blue',
      text: 'No problems in the 4 checks that could run (only 1 info finding), but 1 check could not run.',
    });
    expect(verdictFor({ critical: 0, warning: 0, info: 0 }, { ran: 18, gaps: 0 }).title).toBe('Healthy');
  });
});

describe('lifecycle errors', () => {
  it('does not offer a retry for indices whose policy does not exist', () => {
    const raw = liveReport();
    Object.assign(raw['ilm'].indices, structuredClone(ILM_MISSING_POLICY));
    const report = runChecks(raw);
    const failed = finding(report, 'ilm-errors');
    // Only the genuinely failed step is retried: one bad index makes Elasticsearch reject the whole request.
    expect(failed.resources.map((item) => item.name)).toEqual(['tmp-doctor-ilm-1']);
    expect(failed.fixes[0]?.payload).toEqual({ indices: ['tmp-doctor-ilm-1'] });
    const missing = finding(report, 'ilm-errors:missing-policy');
    expect(missing).toMatchObject({
      severity: 'warning',
      title: '1 index uses a lifecycle policy that does not exist',
      summary: 'index.lifecycle.name points to tmp-doctor-missing, which does not exist, so ILM cannot manage this index.',
      fixes: [],
      links: [{ label: 'Lifecycle policies', icon: 'bi-hourglass-split', route: '/ilm' }],
    });
    expect(missing.resources).toEqual([
      {
        kind: 'index',
        name: 'tmp-doctor-nopolicy',
        detail: 'Policy tmp-doctor-missing does not exist',
        link: { label: 'Index settings', icon: 'bi-gear', route: '/index_settings', params: { index: 'tmp-doctor-nopolicy' } },
      },
    ]);
  });

  it('reports only the missing policy when nothing can be retried', () => {
    const raw = liveReport();
    raw['ilm'].indices = structuredClone(ILM_MISSING_POLICY);
    const report = runChecks(raw);
    expect(ids(report)).not.toContain('ilm-errors');
    expect(ids(report)).toContain('ilm-errors:missing-policy');
  });

  it('passes several indices to the status page', () => {
    const raw = healthyReport();
    raw['ilm'].indices = {
      a: { index: 'a', managed: true, policy: 'p', step: 'ERROR', failed_step: 'check-rollover-ready', step_info: { reason: 'x' } },
      b: { index: 'b', managed: true, policy: 'p', step: 'ERROR', failed_step: 'check-rollover-ready', step_info: { reason: 'y' } },
    };
    const ilm = finding(runChecks(raw), 'ilm-errors');
    expect(ilm.links[0]?.params).toEqual({ tab: 'status', index: 'a,b' });
    expect(ilm.fixes[0]?.label).toBe('Retry 2 steps');
  });
});

describe('replicas of data streams and searchable snapshots', () => {
  it('skips mounted searchable snapshot indices', () => {
    const raw = healthyReport();
    raw['indices'].push(
      { index: 'restored-logs-1', status: 'open', pri: '1', rep: '0', 'pri.store.size': '100' },
      { index: 'partial-logs-0', status: 'open', pri: '1', rep: '0', 'pri.store.size': '100' },
    );
    raw['blocks'] = {
      'restored-logs-1': { settings: { 'index.store.type': 'snapshot' } },
      'partial-logs-0': { settings: { 'index.store.type': 'snapshot', 'index.store.snapshot.partial': 'true' } },
    };
    const report = runChecks(raw);
    expect(ids(report)).not.toContain('missing-replicas');
    expect(outcome(report, 'missing-replicas')?.description).toContain('searchable snapshots');
  });

  it('reports a regular index whose name only looks like a mounted snapshot', () => {
    const raw = healthyReport();
    raw['indices'].push({ index: 'restored-orders', status: 'open', pri: '1', rep: '0', 'pri.store.size': '100' });
    expect(finding(runChecks(raw), 'missing-replicas').resources.map((resource) => resource.name)).toEqual(['restored-orders']);
  });

  it('groups backing indices of user data streams and ignores system ones', () => {
    const raw = healthyReport();
    raw['indices'].push(
      { index: '.ds-app-events-web-2026.10.14-000001', status: 'open', pri: '1', rep: '0', 'pri.store.size': '1000' },
      { index: '.ds-app-events-web-2026.10.14-000002', status: 'open', pri: '1', rep: '0', 'pri.store.size': '24' },
      { index: '.ds-.logs-deprecation.elasticsearch-default-2026.10.14-000001', status: 'open', pri: '1', rep: '0' },
      { index: '.ds-ilm-history-7-2026.10.14-000001', status: 'open', pri: '1', rep: '0' },
      { index: '.internal', status: 'open', pri: '1', rep: '0' },
    );
    const missing = finding(runChecks(raw), 'missing-replicas');
    expect(missing.title).toBe('1 data stream has no replicas');
    expect(missing.resources).toEqual([
      {
        kind: 'data-stream',
        name: 'app-events-web',
        detail: '2 backing indices · 2 primary shards · 1 KB',
        link: { label: 'Open data stream', icon: 'bi-water', route: '/data_streams', params: { name: 'app-events-web' } },
      },
    ]);
    expect(missing.advice).toContain('set number_of_replicas in their index template');
    expect(missing.fixes[0]).toMatchObject({
      confirmTitle: 'Add a replica to the 2 backing indices of app-events-web?',
      payload: {
        indices: ['.ds-app-events-web-2026.10.14-000001', '.ds-app-events-web-2026.10.14-000002'],
        settings: { 'index.number_of_replicas': 1 },
      },
    });
    expect(missing.links).toEqual([{ label: 'Data streams', icon: 'bi-water', route: '/data_streams' }]);
  });

  it('lists indices and data streams together, each with its own fix', () => {
    const raw = healthyReport();
    raw['indices'].push(
      { index: 'solo', status: 'open', pri: '1', rep: '0', 'pri.store.size': '10' },
      { index: '.ds-logs-app-default-2026.10.14-000001', status: 'open', pri: '1', rep: '0', 'pri.store.size': '10' },
    );
    const missing = finding(runChecks(raw), 'missing-replicas');
    expect(missing.title).toBe('1 index and 1 data stream have no replicas');
    expect(missing.resourceLabel).toBe('Affected indices and data streams');
    expect(missing.resources.map((item) => [item.kind, item.name, item.fix?.payload])).toEqual([
      ['index', 'solo', { indices: ['solo'], settings: { 'index.number_of_replicas': 1 } }],
      ['data-stream', 'logs-app-default', { indices: ['.ds-logs-app-default-2026.10.14-000001'], settings: { 'index.number_of_replicas': 1 } }],
    ]);
    expect(missing.fixes[0]?.payload).toEqual({
      indices: ['.ds-logs-app-default-2026.10.14-000001', 'solo'],
      settings: { 'index.number_of_replicas': 1 },
    });
  });
});

describe('read-only block texts', () => {
  it('says the block can go now when no node is at the flood stage', () => {
    const raw = liveReport();
    enableDiskThreshold(raw);
    setDisks(raw, 100 * GB, 50 * GB);
    const blocked = finding(runChecks(raw), 'index-blocks:read-only-allow-delete');
    expect(blocked.advice).toBe('No node is above the flood stage any more, so the block can be removed now.');
    expect(blocked.note).toBe('Every node is below the high watermark, so Elasticsearch normally releases the block on its own within a minute.');
    expect(blocked.fixes[0]?.confirmMessage).toContain('if a node holding its shards passes the flood stage watermark');
  });

  it('names the nodes that must drop below the high watermark first', () => {
    const raw = liveReport();
    enableDiskThreshold(raw);
    setDisks(raw, 100 * GB, 8 * GB);
    const blocked = finding(runChecks(raw), 'index-blocks:read-only-allow-delete');
    expect(blocked.note).toBe('Elasticsearch also removes it on its own once es-node-1, es-node-2 and es-node-3 drop below the high watermark.');
  });
});

describe('node-reported watermarks', () => {
  it('prefers the free space each node reports (it knows about elasticsearch.yml)', () => {
    const raw = healthyReport();
    // elasticsearch.yml sets the low watermark to 80%: the node requires 20% of
    // 2 TB (no headroom), although include_defaults still shows 200GB.
    for (const node of Object.values<any>(raw['nodes'].nodes)) {
      node.fs.data[0] = { path: '/data', total_in_bytes: 2 * TB, available_in_bytes: 300 * GB, low_watermark_free_space_in_bytes: Math.round(2 * TB * 0.2), high_watermark_free_space_in_bytes: 150 * GB, flood_stage_free_space_in_bytes: 100 * GB };
    }
    const disk = finding(runChecks(raw), 'disk-watermarks:low');
    expect(disk.resources[0]?.detail).toBe('85.4% used · 300 GB free of 2 TB · the low watermark needs 409.6 GB free');
  });
});

describe('cluster-wide blocks', () => {
  it('is critical and clears both layers', () => {
    const raw = healthyReport();
    raw['settings'].transient['cluster.blocks.read_only_allow_delete'] = 'true';
    const blocks = finding(runChecks(raw), 'cluster-blocks');
    expect(blocks).toMatchObject({
      severity: 'critical',
      category: 'settings',
      title: 'Writes to every index are rejected',
      facts: [{ label: 'Read-only (allow delete)', value: 'transient cluster setting' }],
    });
    expect(blocks.fixes[0]).toMatchObject({
      path: 'cluster_settings/save',
      payload: {
        settings: {
          persistent: { 'cluster.blocks.read_only': null, 'cluster.blocks.read_only_allow_delete': null },
          transient: { 'cluster.blocks.read_only': null, 'cluster.blocks.read_only_allow_delete': null },
        },
      },
    });
  });

  it('overrides a block set in elasticsearch.yml', () => {
    const raw = healthyReport();
    raw['settings'].defaults['cluster.blocks.read_only'] = 'true';
    const blocks = finding(runChecks(raw), 'cluster-blocks');
    expect((blocks.fixes[0]?.payload['settings'] as any).persistent['cluster.blocks.read_only']).toBe('false');
  });
});

describe('allocation modes', () => {
  it('words the impact of each mode', () => {
    const impact = (mode: string) => {
      const raw = healthyReport();
      raw['settings'].persistent['cluster.routing.allocation.enable'] = mode;
      return finding(runChecks(raw), 'allocation-enabled').impact;
    };
    expect(impact('primaries')).toBe('Replicas stay unassigned, so the cluster stays yellow and has less redundancy.');
    expect(impact('none')).toContain('a restarted node gets none of its shards back');
    expect(impact('new_primaries')).toContain('only new indices get primaries');
  });
});
