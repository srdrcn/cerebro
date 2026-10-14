import { describe, expect, it } from 'vitest';
import { CHECKS, runChecks, verdictFor } from './doctor.checks';
import { DEPRECATIONS, liveReport } from './doctor.fixtures';
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
    expect(ids(report)).toEqual([
      'index-blocks:read-only-allow-delete',
      'cluster-status:yellow',
      'disk-watermarks:high',
      'impossible-replicas',
      'unassigned-shards:replica',
      'missing-replicas',
      'ilm-errors',
      'disk-threshold-enabled',
      'over-sharded',
      'index-blocks:manual',
    ]);
    const severities = report.findings.map((item) => item.severity);
    expect(severities).toEqual([...severities].sort((left, right) => ['critical', 'warning', 'info'].indexOf(left) - ['critical', 'warning', 'info'].indexOf(right)));
    expect(report.findings[0]?.id).toBe('index-blocks:read-only-allow-delete');
    expect(report.counts).toEqual({ critical: 1, warning: 7, info: 2 });
    expect(report.passed).toBe(CHECKS.length - 9);
  });

  it('sums up the verdict in one sentence', () => {
    expect(report.verdict).toEqual({
      tone: 'red',
      icon: 'bi-x-octagon-fill',
      title: 'Critical problems found',
      text: '1 critical problem and 7 warnings need attention, plus 2 suggestions.',
    });
  });

  it('reports the yellow cluster with its shard counts', () => {
    const status = finding(report, 'cluster-status:yellow');
    expect(status.severity).toBe('warning');
    expect(status.summary).toBe('Every primary shard is allocated, but 4 replica shards are not.');
    expect(status.facts).toContainEqual({ label: 'Unassigned', value: '4' });
    expect(status.links[0]?.route).toBe('/allocation');
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
      path: 'doctor/index_settings',
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
      { label: 'Low watermark', value: '85%, at most 200 GB free' },
      { label: 'High watermark', value: '90%, at most 150 GB free' },
      { label: 'Flood stage', value: '95%, at most 100 GB free' },
    ]);
    expect(disk.links).toEqual([{ label: 'Open nodes', icon: 'bi-hdd-stack', route: '/nodes' }]);
  });

  it('warns that disk-based allocation is disabled in the node configuration', () => {
    const threshold = finding(report, 'disk-threshold-enabled');
    expect(threshold.severity).toBe('warning');
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
      path: 'doctor/index_settings',
      payload: { indices: ['tmp-doctor-ro'], settings: { 'index.blocks.read_only_allow_delete': null } },
      tone: 'default',
    });
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
    expect(ilm.links[0]).toMatchObject({ route: '/ilm', params: { tab: 'status' } });
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
    expect(finding(runChecks(raw), 'cluster-status:yellow').summary).toContain('1 of them is delayed on purpose');
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

  it('grades heap usage', () => {
    const raw = healthyReport();
    nodes(raw)[0].jvm.mem.heap_used_percent = 86;
    nodes(raw)[1].jvm.mem.heap_used_percent = 97;
    const report = runChecks(raw);
    expect(finding(report, 'jvm-heap:critical')).toMatchObject({ title: 'Heap usage is critical on 1 node' });
    expect(finding(report, 'jvm-heap:critical').resources[0]?.detail).toBe('97% of 400 MB');
    expect(finding(report, 'jvm-heap:warning').resources.map((item) => item.name)).toEqual(['es-node-1']);
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
    expect(runChecks(null).verdict.tone).toBe('green');
  });
});

describe('verdictFor', () => {
  it('words every combination', () => {
    expect(verdictFor({ critical: 1, warning: 0, info: 0 }).text).toBe('1 critical problem needs attention.');
    expect(verdictFor({ critical: 2, warning: 3, info: 0 }).text).toBe('2 critical problems and 3 warnings need attention.');
    expect(verdictFor({ critical: 0, warning: 1, info: 1 })).toMatchObject({
      tone: 'yellow',
      title: 'Needs attention',
      text: '1 warning needs attention, plus 1 suggestion.',
    });
    expect(verdictFor({ critical: 0, warning: 0, info: 2 })).toMatchObject({
      tone: 'green',
      text: 'No problems found, only 2 suggestions to consider.',
    });
  });
});
