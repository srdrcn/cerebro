import { describe, expect, it } from 'vitest';
import { liveReport } from './doctor.fixtures';
import { DoctorFinding } from './doctor.models';
import {
  describeWatermark,
  diskThresholds,
  filterFindings,
  healthReportView,
  indicatorLabel,
  isDataNode,
  isFrozenOnly,
  parseByteSize,
  parseCategoryParam,
  parseDoctorInput,
  parseSeverityParam,
  parseVersion,
  parseWatermark,
  requiredFreeBytes,
  roundPercent,
  settingValue,
  severityParam,
  sortFindings,
  toNumber,
  unavailableReason,
  versionAtLeast,
} from './doctor.utils';

const GB = 1024 ** 3;

describe('primitive parsing', () => {
  it('reads numbers from _cat strings', () => {
    expect(toNumber('42')).toBe(42);
    expect(toNumber(7)).toBe(7);
    expect(toNumber('')).toBeNull();
    expect(toNumber(null)).toBeNull();
    expect(toNumber('12kb')).toBeNull();
  });

  it('parses Elasticsearch byte sizes with binary units', () => {
    expect(parseByteSize('500mb')).toBe(500 * 1024 ** 2);
    expect(parseByteSize('150GB')).toBe(150 * GB);
    expect(parseByteSize('1.5gb')).toBe(1.5 * GB);
    expect(parseByteSize('20 g')).toBe(20 * GB);
    expect(parseByteSize('0')).toBe(0);
    expect(parseByteSize('-1')).toBeNull();
    expect(parseByteSize('12')).toBeNull();
    expect(parseByteSize('12xb')).toBeNull();
  });

  it('parses versions', () => {
    expect(parseVersion('8.15.3')).toEqual({ text: '8.15.3', major: 8, minor: 15 });
    expect(parseVersion('7.17.0-SNAPSHOT')).toMatchObject({ major: 7, minor: 17 });
    expect(parseVersion(undefined)).toBeNull();
    expect(versionAtLeast(parseVersion('8.7.0'), 8, 7)).toBe(true);
    expect(versionAtLeast(parseVersion('8.6.2'), 8, 7)).toBe(false);
    expect(versionAtLeast(parseVersion('9.0.0'), 8, 7)).toBe(true);
    expect(versionAtLeast(null, 8, 7)).toBe(false);
  });

  it('rounds percentages to one decimal', () => {
    expect(roundPercent(90.6435)).toBe('90.6');
    expect(roundPercent(90)).toBe('90');
  });
});

describe('parseDoctorInput', () => {
  const input = parseDoctorInput(liveReport());

  it('normalizes every source of the live report', () => {
    expect(input.health).toMatchObject({ clusterName: 'cerebro-demo', status: 'yellow', dataNodes: 3, unassigned: 4 });
    expect(input.version?.text).toBe('8.15.3');
    expect(input.nodes?.map((node) => node.name)).toEqual(['es-node-1', 'es-node-2', 'es-node-3']);
    expect(input.nodes?.[0]).toMatchObject({
      heapPercent: 41,
      heapMax: 419430400,
      oldGcCount: 0,
      disk: { path: '/usr/share/elasticsearch/data', total: 270553174016, available: 25314484224 },
    });
    expect(input.indices?.find((row) => row.name === 'overflow-test')).toMatchObject({ primaries: 2, replicas: 3, status: 'open' });
    expect(input.shards?.find((row) => row.state === 'UNASSIGNED')).toMatchObject({ primary: false, node: null, store: null });
    expect(input.blocks?.get('tmp-doctor-ro')).toEqual({ 'index.blocks.read_only_allow_delete': 'true' });
    expect(input.ilm?.[0]).toMatchObject({ index: 'tmp-doctor-ilm-1', failedStep: 'attempt-rollover', errorType: 'illegal_argument_exception', autoRetry: true });
    expect(input.unavailable.size).toBe(0);
  });

  it('picks the data path with the least available space', () => {
    const raw = liveReport();
    const node = Object.values<any>(raw['nodes'].nodes)[0];
    node.fs.data = [
      { path: '/a', total_in_bytes: 100, available_in_bytes: 50 },
      { path: '/b', total_in_bytes: 200, available_in_bytes: 20 },
    ];
    expect(parseDoctorInput(raw).nodes?.[0]?.disk).toMatchObject({ path: '/b', total: 200, available: 20 });
  });

  it('reads nested block settings too', () => {
    const raw = liveReport();
    raw['blocks'] = { a: { settings: { index: { blocks: { write: 'true' } } } } };
    expect(parseDoctorInput(raw).blocks?.get('a')).toEqual({ 'index.blocks.write': 'true' });
  });

  it('turns missing sources into null', () => {
    const empty = parseDoctorInput({ health: {} });
    expect(empty.nodes).toBeNull();
    expect(empty.settings).toBeNull();
    expect(empty.healthReport).toBeNull();
    expect(empty.health.status).toBe('unknown');
  });
});

describe('cluster settings', () => {
  it('prefers transient over persistent over defaults', () => {
    const settings = { transient: { a: 't' }, persistent: { a: 'p', b: 'p' }, defaults: { a: 'd', b: 'd', c: 'd' } };
    expect(settingValue(settings, 'a')).toBe('t');
    expect(settingValue(settings, 'b')).toBe('p');
    expect(settingValue(settings, 'c')).toBe('d');
    expect(settingValue(settings, 'x')).toBeUndefined();
    expect(settingValue(null, 'a')).toBeUndefined();
  });
});

describe('disk watermarks', () => {
  const layers = (persistent: Record<string, string> = {}, defaults: Record<string, string> = {}) => ({
    persistent,
    transient: {},
    defaults: {
      'cluster.routing.allocation.disk.watermark.low': '85%',
      'cluster.routing.allocation.disk.watermark.high': '90%',
      'cluster.routing.allocation.disk.watermark.flood_stage': '95%',
      'cluster.routing.allocation.disk.watermark.low.max_headroom': '200GB',
      'cluster.routing.allocation.disk.watermark.high.max_headroom': '150GB',
      'cluster.routing.allocation.disk.watermark.flood_stage.max_headroom': '100GB',
      ...defaults,
    },
  });

  it('reads percentages, ratios and absolute values', () => {
    expect(parseWatermark('85%')).toEqual({ kind: 'ratio', ratio: 0.85 });
    expect(parseWatermark('0.9')).toEqual({ kind: 'ratio', ratio: 0.9 });
    expect(parseWatermark('500mb')).toEqual({ kind: 'bytes', bytes: 500 * 1024 ** 2 });
    expect(parseWatermark('120%')).toBeNull();
    expect(parseWatermark('85')).toBeNull();
    expect(parseWatermark(undefined)).toBeNull();
  });

  it('applies the default headroom while the watermark is not set explicitly', () => {
    const thresholds = diskThresholds(layers(), parseVersion('8.15.3'));
    expect(thresholds.enabled).toBe(true);
    expect(thresholds.high).toMatchObject({ setting: '90%', headroom: 150 * GB });
    // 10% of 10 TB is 1 TB, capped at 150 GB.
    expect(requiredFreeBytes(thresholds.high!, 10 * 1024 * GB)).toBe(150 * GB);
    // 10% of 100 GB stays below the cap.
    expect(requiredFreeBytes(thresholds.high!, 100 * GB)).toBe(10 * GB);
    expect(describeWatermark(thresholds.high!)).toBe('90%, at most 150 GB free');
  });

  it('drops the headroom of an explicit watermark unless the headroom is explicit too', () => {
    const explicit = diskThresholds(layers({ 'cluster.routing.allocation.disk.watermark.high': '92%' }), null);
    expect(explicit.high).toMatchObject({ setting: '92%', headroom: null });
    const both = diskThresholds(
      layers({
        'cluster.routing.allocation.disk.watermark.high': '92%',
        'cluster.routing.allocation.disk.watermark.high.max_headroom': '50gb',
      }),
      null,
    );
    expect(both.high?.headroom).toBe(50 * GB);
    const disabled = diskThresholds(layers({ 'cluster.routing.allocation.disk.watermark.low.max_headroom': '-1' }), null);
    expect(disabled.low?.headroom).toBeNull();
  });

  it('never caps absolute watermarks', () => {
    const thresholds = diskThresholds(layers({ 'cluster.routing.allocation.disk.watermark.flood_stage': '1gb' }), null);
    expect(thresholds.flood).toMatchObject({ watermark: { kind: 'bytes', bytes: GB }, headroom: null });
    expect(requiredFreeBytes(thresholds.flood!, 10 * 1024 * GB)).toBe(GB);
    expect(describeWatermark(thresholds.flood!)).toBe('1 GB free');
  });

  it('honours threshold_enabled', () => {
    expect(diskThresholds(layers({ 'cluster.routing.allocation.disk.threshold_enabled': 'false' }), null).enabled).toBe(false);
  });

  it('falls back to the documented defaults without settings', () => {
    const modern = diskThresholds(null, parseVersion('8.15.0'));
    expect(modern.source).toBe('defaults');
    expect(modern.low).toMatchObject({ setting: '85%', headroom: 200 * GB });
    expect(modern.frozenFlood).toMatchObject({ setting: '95%', headroom: 20 * GB });
    const older = diskThresholds(null, parseVersion('7.17.0'));
    expect(older.high).toMatchObject({ setting: '90%', headroom: null });
  });

  it('knows data and frozen-only nodes', () => {
    const node = (roles: string[] | null) => ({ roles }) as Parameters<typeof isDataNode>[0];
    expect(isDataNode(node(['master', 'data_hot']))).toBe(true);
    expect(isDataNode(node(['master', 'ingest']))).toBe(false);
    expect(isDataNode(node(null))).toBe(true);
    expect(isFrozenOnly(node(['data_frozen']))).toBe(true);
    expect(isFrozenOnly(node(['data_frozen', 'data_hot']))).toBe(false);
    expect(isFrozenOnly(node(['master']))).toBe(false);
  });
});

describe('unavailableReason', () => {
  const input = (unavailable: Record<string, unknown>, version = '8.15.3') =>
    parseDoctorInput({ health: {}, info: { version: { number: version } }, unavailable });

  it('names the missing privilege', () => {
    expect(unavailableReason(input({ nodes: { status: 403, error: {} } }), 'nodes')).toBe('Needs the monitor privilege (403)');
    expect(unavailableReason(input({ ilm: { status: 403, error: {} } }), 'ilm')).toBe('Needs the view_index_metadata privilege (403)');
  });

  it('explains version and feature gaps', () => {
    expect(unavailableReason(input({ health_report: { status: 400, error: {} } }, '8.6.0'), 'health_report')).toBe('Available from Elasticsearch 8.7');
    expect(unavailableReason(input({ ilm: { status: 400, error: { error: 'no handler found' } } }), 'ilm')).toBe(
      'Index lifecycle management is not available on this cluster (400)',
    );
  });

  it('falls back to the Elasticsearch reason', () => {
    const reason = unavailableReason(
      input({ shards: { status: 500, error: { error: { root_cause: [{ reason: 'node disconnected' }] } } } }),
      'shards',
    );
    expect(reason).toBe('Node disconnected (500)');
    expect(unavailableReason(input({}), 'blocks')).toBe('Elasticsearch did not return the index blocks');
  });
});

describe('healthReportView', () => {
  it('sorts indicators red first and keeps impacts and diagnoses', () => {
    const view = healthReportView(parseDoctorInput(liveReport()));
    expect(view.kind).toBe('report');
    if (view.kind !== 'report') {
      return;
    }
    expect(view.tone).toBe('red');
    expect(view.indicators.map((indicator) => indicator.status)).toEqual([
      'red',
      'yellow',
      'green',
      'green',
      'green',
      'green',
      'green',
      'green',
    ]);
    const disk = view.indicators[0]!;
    expect(disk.label).toBe('Disk');
    expect(disk.impacts[0]?.severity).toBe(1);
    expect(disk.diagnoses[0]?.resources.map((group) => group.label)).toContain('Nodes');
    expect(disk.diagnoses[0]?.resources.find((group) => group.label === 'Nodes')?.names).toEqual(['es-node-1', 'es-node-2', 'es-node-3']);
  });

  it('says when the cluster is too old or the report was refused', () => {
    expect(healthReportView(parseDoctorInput({ health: {}, info: { version: { number: '8.4.0' } } }))).toEqual({ kind: 'unsupported', version: '8.4.0' });
    expect(
      healthReportView(parseDoctorInput({ health: {}, unavailable: { health_report: { status: 404, error: {} } } })),
    ).toEqual({ kind: 'unsupported', version: null });
    expect(
      healthReportView(
        parseDoctorInput({ health: {}, info: { version: { number: '8.15.0' } }, unavailable: { health_report: { status: 403, error: {} } } }),
      ),
    ).toEqual({ kind: 'unavailable', reason: 'Needs the monitor privilege (403)' });
  });

  it('ignores help links that are not http(s)', () => {
    const raw = liveReport();
    raw['health_report'].indicators.disk.diagnosis[0].help_url = 'javascript:alert(1)';
    const view = healthReportView(parseDoctorInput(raw));
    expect(view.kind === 'report' && view.indicators[0]?.diagnoses[0]?.helpUrl).toBeNull();
  });

  it('labels indicators', () => {
    expect(indicatorLabel('shards_availability')).toBe('Shard availability');
    expect(indicatorLabel('some_new_indicator')).toBe('Some new indicator');
  });
});

describe('finding list helpers', () => {
  const make = (id: string, severity: DoctorFinding['severity'], category: DoctorFinding['category'], title = id): DoctorFinding => ({
    id,
    checkId: id,
    severity,
    category,
    title,
    summary: '',
    impact: '',
    resources: [],
    fixes: [],
    links: [],
  });

  it('sorts by severity, then category, then title', () => {
    const sorted = sortFindings([
      make('a', 'info', 'health'),
      make('b', 'warning', 'upgrade'),
      make('c', 'warning', 'disk', 'Z'),
      make('d', 'critical', 'settings'),
      make('e', 'warning', 'disk', 'A'),
    ]);
    expect(sorted.map((item) => item.id)).toEqual(['d', 'e', 'c', 'b', 'a']);
  });

  it('filters by severities and category', () => {
    const findings = [make('a', 'info', 'health'), make('b', 'warning', 'disk'), make('c', 'critical', 'disk')];
    expect(filterFindings(findings, { severities: new Set(), category: null }).length).toBe(3);
    expect(filterFindings(findings, { severities: new Set(['warning', 'critical']), category: null }).map((item) => item.id)).toEqual(['b', 'c']);
    expect(filterFindings(findings, { severities: new Set(['critical']), category: 'disk' }).map((item) => item.id)).toEqual(['c']);
    expect(filterFindings(findings, { severities: new Set(), category: 'health' }).map((item) => item.id)).toEqual(['a']);
  });

  it('round-trips the URL filters', () => {
    expect([...parseSeverityParam('warning,critical,bogus')]).toEqual(['warning', 'critical']);
    expect(severityParam(new Set(['info', 'critical']))).toBe('critical,info');
    expect(severityParam(new Set())).toBeNull();
    expect(parseCategoryParam('Disk')).toBe('disk');
    expect(parseCategoryParam('nope')).toBeNull();
    expect(parseCategoryParam(null)).toBeNull();
  });
});
