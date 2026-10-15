import { elasticsearchReason } from '../../core/errors';
import { formatBytes, humanize, sentence } from '../../core/format';
import { healthLabel, healthTone } from '../../core/health';
import { JsonRecord, isRecord, stringList, toNumber } from '../../core/json';
import {
  CATEGORIES,
  ClusterHealthInfo,
  ClusterSettingsLayers,
  DoctorCategory,
  DoctorFinding,
  DoctorInput,
  DoctorSeverity,
  DoctorSource,
  EsVersion,
  HealthDiagnosisView,
  HealthIndicatorView,
  HealthReportView,
  IlmErrorRow,
  IndexRow,
  NodeBreaker,
  NodeDisk,
  NodeInfo,
  RawDoctorReport,
  SEVERITIES,
  ShardRow,
  UnavailableSource,
} from './doctor.models';

/* ------------------------------------------------------------------ */
/* Primitive parsing                                                   */
/* ------------------------------------------------------------------ */

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

/** `true` / `"true"` (settings come back as strings with `flat_settings`). */
export function isTrue(value: unknown): boolean {
  return value === true || (typeof value === 'string' && value.trim().toLowerCase() === 'true');
}

const BYTE_FACTORS: Readonly<Record<string, number>> = {
  b: 1,
  k: 1024,
  kb: 1024,
  m: 1024 ** 2,
  mb: 1024 ** 2,
  g: 1024 ** 3,
  gb: 1024 ** 3,
  t: 1024 ** 4,
  tb: 1024 ** 4,
  p: 1024 ** 5,
  pb: 1024 ** 5,
};

/**
 * An Elasticsearch byte size ("500mb", "1.5gb", "150GB") in bytes. Units are
 * binary (1kb = 1024 bytes) as in `ByteSizeValue`; `-1` (disabled) and values
 * without a unit other than `0` are `null`.
 */
export function parseByteSize(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0 ? value : null;
  }
  if (typeof value !== 'string') {
    return null;
  }
  const match = /^\s*(\d+(?:\.\d+)?)\s*([a-z]*)\s*$/i.exec(value);
  if (!match) {
    return null;
  }
  const amount = Number(match[1]);
  const unit = (match[2] ?? '').toLowerCase();
  if (!unit) {
    return amount === 0 ? 0 : null;
  }
  const factor = BYTE_FACTORS[unit];
  return factor === undefined ? null : Math.round(amount * factor);
}

/** "8.15.3" → { major: 8, minor: 15 }. */
export function parseVersion(value: unknown): EsVersion | null {
  const raw = text(value);
  const match = raw ? /^(\d+)\.(\d+)/.exec(raw) : null;
  if (!raw || !match) {
    return null;
  }
  return { text: raw, major: Number(match[1]), minor: Number(match[2]) };
}

export function versionAtLeast(version: EsVersion | null, major: number, minor: number): boolean {
  if (!version) {
    return false;
  }
  return version.major > major || (version.major === major && version.minor >= minor);
}

/* ------------------------------------------------------------------ */
/* Sources                                                             */
/* ------------------------------------------------------------------ */

function parseHealth(value: unknown): ClusterHealthInfo {
  const health = isRecord(value) ? value : {};
  const count = (key: string) => toNumber(health[key]) ?? 0;
  return {
    clusterName: text(health['cluster_name']),
    status: text(health['status'])?.toLowerCase() ?? 'unknown',
    nodes: count('number_of_nodes'),
    dataNodes: count('number_of_data_nodes'),
    activePrimaries: count('active_primary_shards'),
    activeShards: count('active_shards'),
    unassigned: count('unassigned_shards'),
    initializing: count('initializing_shards'),
    relocating: count('relocating_shards'),
    delayedUnassigned: count('delayed_unassigned_shards'),
  };
}

/** Least available data path, as the disk threshold monitor sees it. */
function parseDisk(fs: unknown): NodeDisk | null {
  if (!isRecord(fs)) {
    return null;
  }
  const paths = Array.isArray(fs['data']) ? fs['data'].filter(isRecord) : [];
  const usable = paths.filter(
    (path) => toNumber(path['total_in_bytes']) !== null && toNumber(path['available_in_bytes']) !== null,
  );
  const least = usable.reduce<JsonRecord | null>(
    (best, path) =>
      best === null || (toNumber(path['available_in_bytes']) ?? 0) < (toNumber(best['available_in_bytes']) ?? 0)
        ? path
        : best,
    null,
  );
  const source = least ?? (isRecord(fs['total']) ? fs['total'] : null);
  const total = source ? toNumber(source['total_in_bytes']) : null;
  const available = source ? toNumber(source['available_in_bytes']) : null;
  if (!source || total === null || available === null || total <= 0) {
    return null;
  }
  return {
    path: text(source['path']),
    total,
    available,
    reported: {
      low: toNumber(source['low_watermark_free_space_in_bytes']),
      high: toNumber(source['high_watermark_free_space_in_bytes']),
      flood: toNumber(source['flood_stage_free_space_in_bytes']),
    },
  };
}

function parseBreakers(value: unknown): NodeBreaker[] {
  if (!isRecord(value)) {
    return [];
  }
  return Object.entries(value)
    .filter((entry): entry is [string, JsonRecord] => isRecord(entry[1]))
    .map(([name, breaker]) => ({
      name,
      tripped: toNumber(breaker['tripped']) ?? 0,
      limit: toNumber(breaker['limit_size_in_bytes']),
      estimated: toNumber(breaker['estimated_size_in_bytes']),
    }));
}

function parseNodes(value: unknown): NodeInfo[] | null {
  if (!isRecord(value) || !isRecord(value['nodes'])) {
    return null;
  }
  return Object.entries(value['nodes'])
    .filter((entry): entry is [string, JsonRecord] => isRecord(entry[1]))
    .map(([id, node]) => {
      const jvm = isRecord(node['jvm']) ? node['jvm'] : {};
      const mem = isRecord(jvm['mem']) ? jvm['mem'] : {};
      const gc = isRecord(jvm['gc']) && isRecord(jvm['gc']['collectors']) ? jvm['gc']['collectors'] : {};
      const old = isRecord(gc['old']) ? gc['old'] : {};
      const pools = isRecord(mem['pools']) ? mem['pools'] : {};
      const oldPool = isRecord(pools['old']) ? pools['old'] : {};
      return {
        id,
        name: text(node['name']) ?? id,
        roles: Array.isArray(node['roles']) ? stringList(node['roles']) : null,
        disk: parseDisk(node['fs']),
        heapPercent: toNumber(mem['heap_used_percent']),
        heapUsed: toNumber(mem['heap_used_in_bytes']),
        heapMax: toNumber(mem['heap_max_in_bytes']),
        oldGenUsed: toNumber(oldPool['used_in_bytes']),
        oldGenMax: toNumber(oldPool['max_in_bytes']),
        uptime: toNumber(jvm['uptime_in_millis']),
        oldGcCount: toNumber(old['collection_count']),
        oldGcTime: toNumber(old['collection_time_in_millis']),
        breakers: parseBreakers(node['breakers']),
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

function flatLayer(value: unknown): Record<string, string> {
  const layer: Record<string, string> = {};
  if (!isRecord(value)) {
    return layer;
  }
  for (const [key, setting] of Object.entries(value)) {
    if (typeof setting === 'string' || typeof setting === 'number' || typeof setting === 'boolean') {
      layer[key] = String(setting);
    } else if (Array.isArray(setting)) {
      layer[key] = stringList(setting).join(',');
    }
  }
  return layer;
}

function parseSettings(value: unknown): ClusterSettingsLayers | null {
  if (!isRecord(value)) {
    return null;
  }
  return {
    persistent: flatLayer(value['persistent']),
    transient: flatLayer(value['transient']),
    defaults: flatLayer(value['defaults']),
  };
}

function parseIndices(value: unknown): IndexRow[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  return value
    .filter(isRecord)
    .map((row) => ({
      name: text(row['index']) ?? '',
      health: text(row['health'])?.toLowerCase() ?? 'unknown',
      status: text(row['status'])?.toLowerCase() ?? 'open',
      primaries: toNumber(row['pri']) ?? 0,
      replicas: toNumber(row['rep']) ?? 0,
      docs: toNumber(row['docs.count']),
      size: toNumber(row['store.size']),
      primarySize: toNumber(row['pri.store.size']),
    }))
    .filter((row) => row.name !== '');
}

function parseShards(value: unknown): ShardRow[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  return value
    .filter(isRecord)
    .map((row) => ({
      index: text(row['index']) ?? '',
      shard: toNumber(row['shard']) ?? 0,
      primary: row['prirep'] === 'p' || row['prirep'] === 'primary',
      state: text(row['state'])?.toUpperCase() ?? 'UNKNOWN',
      store: toNumber(row['store']),
      node: text(row['node']),
      reason: text(row['unassigned.reason']),
    }))
    .filter((row) => row.index !== '');
}

/** Searchable snapshot markers, kept when the backend asks for them. */
const STORE_KEYS = new Set(['index.store.type', 'index.store.snapshot.partial']);

function parseBlocks(value: unknown): Map<string, Readonly<Record<string, unknown>>> | null {
  if (!isRecord(value)) {
    return null;
  }
  const blocks = new Map<string, Readonly<Record<string, unknown>>>();
  for (const [index, entry] of Object.entries(value)) {
    const settings = isRecord(entry) && isRecord(entry['settings']) ? entry['settings'] : null;
    if (!settings) {
      continue;
    }
    // Flat keys ("index.blocks.write") or, defensively, the nested form.
    const nested = isRecord(settings['index']) && isRecord(settings['index']['blocks']) ? settings['index']['blocks'] : null;
    const flat: Record<string, unknown> = {};
    for (const [key, setting] of Object.entries(settings)) {
      if (key.startsWith('index.blocks.') || STORE_KEYS.has(key)) {
        flat[key] = setting;
      }
    }
    for (const [key, setting] of Object.entries(nested ?? {})) {
      flat[`index.blocks.${key}`] = setting;
    }
    blocks.set(index, flat);
  }
  return blocks;
}

const MISSING_POLICY = /^policy \[.*\] does not exist$/;

function parseIlm(value: unknown): IlmErrorRow[] | null {
  if (!isRecord(value) || !isRecord(value['indices'])) {
    return null;
  }
  return Object.entries(value['indices'])
    .filter((entry): entry is [string, JsonRecord] => isRecord(entry[1]))
    .filter(([, entry]) => text(entry['step'])?.toUpperCase() === 'ERROR')
    .map(([index, entry]) => {
      const info = isRecord(entry['step_info']) ? entry['step_info'] : {};
      const reason = text(info['reason']) ?? elasticsearchReason(info);
      const failedStep = text(entry['failed_step']);
      return {
        index: text(entry['index']) ?? index,
        policy: text(entry['policy']),
        phase: text(entry['phase']),
        action: text(entry['action']),
        failedStep,
        errorType: text(info['type']),
        reason,
        retryCount: toNumber(entry['failed_step_retry_count']),
        autoRetry: entry['is_auto_retryable_error'] === true,
        // IndexLifecycleService reports "policy [x] does not exist" as an ERROR
        // step without a failed step; `_ilm/retry` rejects such an index.
        missingPolicy: failedStep === null || MISSING_POLICY.test(reason ?? ''),
      };
    })
    .sort((left, right) => left.index.localeCompare(right.index));
}

function parseUnavailable(value: unknown): Map<string, UnavailableSource> {
  const unavailable = new Map<string, UnavailableSource>();
  if (!isRecord(value)) {
    return unavailable;
  }
  for (const [source, entry] of Object.entries(value)) {
    const record = isRecord(entry) ? entry : {};
    unavailable.set(source, { status: toNumber(record['status']), error: record['error'] ?? entry });
  }
  return unavailable;
}

/** Normalizes the backend report; anything malformed becomes `null` (not checked). */
export function parseDoctorInput(raw: unknown): DoctorInput {
  const report: RawDoctorReport = isRecord(raw) ? raw : {};
  const info = isRecord(report.info) ? report.info : null;
  return {
    health: parseHealth(report.health),
    version: parseVersion(info && isRecord(info['version']) ? info['version']['number'] : null),
    nodes: parseNodes(report.nodes),
    settings: parseSettings(report.settings),
    indices: parseIndices(report.indices),
    shards: parseShards(report.shards),
    blocks: parseBlocks(report.blocks),
    ilm: parseIlm(report.ilm),
    deprecations: isRecord(report.deprecations) ? report.deprecations : null,
    healthReport: isRecord(report.health_report) ? report.health_report : null,
    unavailable: parseUnavailable(report.unavailable),
  };
}

/** Whether a source answered (and parsed). */
export function hasSource(input: DoctorInput, source: DoctorSource): boolean {
  switch (source) {
    case 'health':
      return true;
    case 'info':
      return input.version !== null;
    case 'nodes':
      return input.nodes !== null;
    case 'settings':
      return input.settings !== null;
    case 'indices':
      return input.indices !== null;
    case 'shards':
      return input.shards !== null;
    case 'blocks':
      return input.blocks !== null;
    case 'ilm':
      return input.ilm !== null;
    case 'deprecations':
      return input.deprecations !== null;
    case 'health_report':
      return input.healthReport !== null;
  }
}

/**
 * Privileges each source needs when Elasticsearch security is on (from the
 * "Prerequisites" of each API's reference page).
 */
const PRIVILEGES: Readonly<Record<DoctorSource, string>> = {
  health: 'monitor',
  info: 'monitor',
  nodes: 'monitor',
  settings: 'monitor',
  indices: 'monitor',
  shards: 'monitor',
  blocks: 'view_index_metadata',
  ilm: 'view_index_metadata',
  deprecations: 'manage',
  health_report: 'monitor',
};

const SOURCE_LABELS: Readonly<Record<DoctorSource, string>> = {
  health: 'cluster health',
  info: 'cluster version',
  nodes: 'node statistics',
  settings: 'cluster settings',
  indices: 'index list',
  shards: 'shard list',
  blocks: 'index blocks',
  ilm: 'lifecycle status',
  deprecations: 'deprecation info',
  health_report: 'health report',
};

/** "Needs the monitor privilege (403)", "Available from Elasticsearch 8.7", … */
export function unavailableReason(input: DoctorInput, source: DoctorSource): string {
  const entry = input.unavailable.get(source);
  const status = entry?.status ?? null;
  if (status === 401 || status === 403) {
    return `Needs the ${PRIVILEGES[source]} privilege (${status})`;
  }
  if (source === 'health_report' && input.version && !versionAtLeast(input.version, 8, 7)) {
    return 'Available from Elasticsearch 8.7';
  }
  if (source === 'deprecations' && input.version && input.version.major < 7) {
    return 'Available from Elasticsearch 7.0';
  }
  if (!entry) {
    return `Elasticsearch did not return the ${SOURCE_LABELS[source]}`;
  }
  const reason = elasticsearchReason(entry.error);
  if ((status === 400 || status === 404 || status === 405) && (source === 'ilm' || source === 'deprecations')) {
    const feature = source === 'ilm' ? 'Index lifecycle management' : 'The deprecation info API';
    return `${feature} is not available on this cluster${status ? ` (${status})` : ''}`;
  }
  const suffix = status ? ` (${status})` : '';
  return reason ? `${sentence(reason)}${suffix}` : `Could not read the ${SOURCE_LABELS[source]}${suffix}`;
}

/**
 * Whether a source is missing because the feature does not exist on this
 * cluster (rather than because of privileges or an error): the health report
 * before 8.7, the deprecation API before 7.0, ILM and deprecations without
 * X-Pack (the endpoint is unknown: 400/404/405).
 */
export function isUnsupportedSource(input: DoctorInput, source: DoctorSource): boolean {
  const status = input.unavailable.get(source)?.status ?? null;
  if (source === 'health_report') {
    return input.version ? !versionAtLeast(input.version, 8, 7) : status === 400 || status === 404;
  }
  if (source === 'deprecations' && input.version && input.version.major < 7) {
    return true;
  }
  return (source === 'ilm' || source === 'deprecations') && (status === 400 || status === 404 || status === 405);
}

/* ------------------------------------------------------------------ */
/* Cluster settings                                                    */
/* ------------------------------------------------------------------ */

/** The effective value: transient, then persistent, then the default. */
export function settingValue(settings: ClusterSettingsLayers | null, key: string): string | undefined {
  if (!settings) {
    return undefined;
  }
  return settings.transient[key] ?? settings.persistent[key] ?? settings.defaults[key];
}

/** Whether the setting was set through the cluster settings API. */
export function isExplicit(settings: ClusterSettingsLayers | null, key: string): boolean {
  return !!settings && (key in settings.transient || key in settings.persistent);
}

/* ------------------------------------------------------------------ */
/* Disk watermarks                                                     */
/* ------------------------------------------------------------------ */

export type Watermark =
  | { readonly kind: 'ratio'; readonly ratio: number }
  | { readonly kind: 'bytes'; readonly bytes: number };

/**
 * A disk watermark: a percentage of used space ("85%"), a ratio ("0.85") or
 * an absolute amount of free space ("500mb"), as `RelativeByteSizeValue`
 * accepts them.
 */
export function parseWatermark(value: unknown): Watermark | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  const percent = /^(\d+(?:\.\d+)?)\s*%$/.exec(trimmed);
  if (percent) {
    const ratio = Number(percent[1]) / 100;
    return ratio >= 0 && ratio <= 1 ? { kind: 'ratio', ratio } : null;
  }
  if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
    const ratio = Number(trimmed);
    return ratio >= 0 && ratio <= 1 ? { kind: 'ratio', ratio } : null;
  }
  const bytes = parseByteSize(trimmed);
  return bytes === null ? null : { kind: 'bytes', bytes };
}

export type WatermarkKey = 'low' | 'high' | 'flood';

export interface WatermarkLevel {
  readonly key: WatermarkKey;
  readonly label: string;
  /** The value as configured ("90%", "500mb"). */
  readonly setting: string;
  readonly watermark: Watermark;
  /** Cap on the free space a percentage asks for (8.5+), `null` without one. */
  readonly headroom: number | null;
}

export interface DiskThresholds {
  /** `cluster.routing.allocation.disk.threshold_enabled`. */
  readonly enabled: boolean;
  readonly low: WatermarkLevel | null;
  readonly high: WatermarkLevel | null;
  readonly flood: WatermarkLevel | null;
  /** Flood stage of dedicated frozen nodes (7.11+). */
  readonly frozenFlood: WatermarkLevel | null;
  /** Where the values came from. */
  readonly source: 'settings' | 'defaults';
}

const DISK_PREFIX = 'cluster.routing.allocation.disk.watermark';

const LEVEL_SETTINGS: Readonly<Record<WatermarkKey | 'frozen', { key: WatermarkKey; setting: string; label: string; fallback: string; headroom: string }>> = {
  low: { key: 'low', setting: `${DISK_PREFIX}.low`, label: 'low watermark', fallback: '85%', headroom: '200GB' },
  high: { key: 'high', setting: `${DISK_PREFIX}.high`, label: 'high watermark', fallback: '90%', headroom: '150GB' },
  flood: { key: 'flood', setting: `${DISK_PREFIX}.flood_stage`, label: 'flood stage watermark', fallback: '95%', headroom: '100GB' },
  frozen: { key: 'flood', setting: `${DISK_PREFIX}.flood_stage.frozen`, label: 'frozen flood stage watermark', fallback: '95%', headroom: '20GB' },
};

/**
 * Resolves the watermarks the disk threshold decider applies.
 *
 * Since 8.5 each percentage/ratio watermark has a `max_headroom` that caps the
 * free space it requires (200GB / 150GB / 100GB / 20GB for frozen). Per the
 * reference, the headroom defaults to those values only while the watermark
 * itself is not explicitly set; once a watermark is set and its headroom is
 * not, no headroom applies. Absolute (byte) watermarks never have one. Without
 * the settings (no `monitor` privilege) the documented defaults are assumed.
 */
export function diskThresholds(settings: ClusterSettingsLayers | null, version: EsVersion | null): DiskThresholds {
  const headroomSupported = settings !== null || versionAtLeast(version, 8, 5);
  const level = (name: WatermarkKey | 'frozen'): WatermarkLevel | null => {
    const meta = LEVEL_SETTINGS[name];
    const setting = settings ? settingValue(settings, meta.setting) : meta.fallback;
    const watermark = parseWatermark(setting ?? meta.fallback);
    if (!watermark) {
      return null;
    }
    let headroom: number | null = null;
    if (watermark.kind === 'ratio' && headroomSupported) {
      const headroomKey = `${meta.setting}.max_headroom`;
      if (!settings) {
        headroom = parseByteSize(meta.headroom);
      } else if (isExplicit(settings, headroomKey) || !isExplicit(settings, meta.setting)) {
        headroom = parseByteSize(settingValue(settings, headroomKey));
      }
    }
    return { key: meta.key, label: meta.label, setting: setting ?? meta.fallback, watermark, headroom };
  };
  const enabledSetting = settingValue(settings, 'cluster.routing.allocation.disk.threshold_enabled');
  return {
    enabled: enabledSetting === undefined || isTrue(enabledSetting),
    low: level('low'),
    high: level('high'),
    flood: level('flood'),
    frozenFlood: settings && settingValue(settings, LEVEL_SETTINGS.frozen.setting) === undefined ? null : level('frozen'),
    source: settings ? 'settings' : 'defaults',
  };
}

/** Free space a watermark requires on a disk of `total` bytes. */
export function requiredFreeBytes(level: WatermarkLevel, total: number): number {
  if (level.watermark.kind === 'bytes') {
    return level.watermark.bytes;
  }
  const free = Math.round(total * (1 - level.watermark.ratio));
  return level.headroom === null ? free : Math.min(free, level.headroom);
}

/** "90%", "90% (max headroom 150 GB)", "500 MB free". */
export function describeWatermark(level: WatermarkLevel): string {
  if (level.watermark.kind === 'bytes') {
    return `${formatBytes(level.watermark.bytes)} free`;
  }
  const percent = `${roundPercent(level.watermark.ratio * 100)}%`;
  return level.headroom === null ? percent : `${percent} (max headroom ${formatBytes(level.headroom)})`;
}

/** 90.6 → "90.6", 90 → "90". */
export function roundPercent(value: number): string {
  return (Math.round(value * 10) / 10).toLocaleString('en-US');
}

/** Whether the node holds data (dedicated master, ingest or coordinating nodes do not). */
export function isDataNode(node: NodeInfo): boolean {
  return node.roles === null || node.roles.some((role) => role === 'data' || role.startsWith('data_'));
}

/** Dedicated frozen nodes only apply the frozen flood stage watermark. */
export function isFrozenOnly(node: NodeInfo): boolean {
  const roles = node.roles ?? [];
  return (
    roles.includes('data_frozen') &&
    !roles.some((role) => role !== 'data_frozen' && (role === 'data' || role.startsWith('data_')))
  );
}

/* ------------------------------------------------------------------ */
/* Health report                                                       */
/* ------------------------------------------------------------------ */

const INDICATOR_LABELS: Readonly<Record<string, string>> = {
  master_is_stable: 'Master stability',
  shards_availability: 'Shard availability',
  shards_capacity: 'Shard capacity',
  disk: 'Disk',
  ilm: 'Index lifecycle (ILM)',
  slm: 'Snapshot lifecycle (SLM)',
  repository_integrity: 'Snapshot repositories',
  data_stream_lifecycle: 'Data stream lifecycle',
  file_settings: 'File-based settings',
};

export function indicatorLabel(name: string): string {
  return INDICATOR_LABELS[name] ?? humanize(name);
}

const STATUS_RANK: Readonly<Record<string, number>> = { red: 0, yellow: 1, unknown: 2, unavailable: 2, green: 3 };

function statusRank(status: string): number {
  return STATUS_RANK[status] ?? 2;
}

const RESOURCE_GROUP_LABELS: Readonly<Record<string, string>> = {
  indices: 'Indices',
  nodes: 'Nodes',
  slm_policies: 'Snapshot policies',
  ilm_policies: 'Lifecycle policies',
  feature_states: 'Feature states',
  snapshot_repositories: 'Repositories',
};

function resourceNames(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => {
      if (typeof item === 'string') {
        return item;
      }
      if (isRecord(item)) {
        return text(item['name']) ?? text(item['id']);
      }
      return null;
    })
    .filter((item): item is string => item !== null);
}

function diagnosisView(value: unknown): HealthDiagnosisView | null {
  if (!isRecord(value)) {
    return null;
  }
  const affected = isRecord(value['affected_resources']) ? value['affected_resources'] : {};
  const resources = Object.entries(affected)
    .map(([key, names]) => ({ label: RESOURCE_GROUP_LABELS[key] ?? humanize(key), names: resourceNames(names) }))
    .filter((group) => group.names.length > 0);
  const helpUrl = text(value['help_url']);
  return {
    cause: text(value['cause']) ?? '',
    action: text(value['action']) ?? '',
    helpUrl: helpUrl && /^https?:\/\//i.test(helpUrl) ? helpUrl : null,
    resources,
  };
}

export function indicatorViews(report: Readonly<Record<string, unknown>>): HealthIndicatorView[] {
  const indicators = isRecord(report['indicators']) ? report['indicators'] : {};
  return Object.entries(indicators)
    .filter((entry): entry is [string, JsonRecord] => isRecord(entry[1]))
    .map(([name, indicator]) => {
      const status = text(indicator['status'])?.toLowerCase() ?? 'unknown';
      const impacts = Array.isArray(indicator['impacts']) ? indicator['impacts'].filter(isRecord) : [];
      const diagnoses = Array.isArray(indicator['diagnosis']) ? indicator['diagnosis'] : [];
      return {
        name,
        label: indicatorLabel(name),
        status,
        tone: healthTone(status),
        statusLabel: healthLabel(status),
        symptom: text(indicator['symptom']) ?? '',
        impacts: impacts
          .map((impact) => ({
            severity: toNumber(impact['severity']),
            description: text(impact['description']) ?? '',
            areas: stringList(impact['impact_areas']).map(humanize),
          }))
          .filter((impact) => impact.description !== '')
          // Severity 1 is the most severe.
          .sort((left, right) => (left.severity ?? 9) - (right.severity ?? 9)),
        diagnoses: diagnoses.map(diagnosisView).filter((item): item is HealthDiagnosisView => item !== null),
      };
    })
    .sort((left, right) => statusRank(left.status) - statusRank(right.status) || left.label.localeCompare(right.label));
}

export function healthReportView(input: DoctorInput): HealthReportView {
  const report = input.healthReport;
  if (report) {
    const status = text(report['status'])?.toLowerCase() ?? 'unknown';
    return { kind: 'report', status, tone: healthTone(status), indicators: indicatorViews(report) };
  }
  // Older versions answer 400/404 ("no handler found"); 8.7 introduced the API.
  if (isUnsupportedSource(input, 'health_report')) {
    return { kind: 'unsupported', version: input.version?.text ?? null };
  }
  return { kind: 'unavailable', reason: unavailableReason(input, 'health_report') };
}

/* ------------------------------------------------------------------ */
/* Findings list                                                       */
/* ------------------------------------------------------------------ */

const SEVERITY_ORDER: Readonly<Record<DoctorSeverity, number>> = { critical: 0, warning: 1, info: 2 };

const CATEGORY_ORDER: Readonly<Record<DoctorCategory, number>> = Object.fromEntries(
  CATEGORIES.map((category, index) => [category.key, index]),
) as Record<DoctorCategory, number>;

/** Severity first, then category, then title. */
export function sortFindings(findings: readonly DoctorFinding[]): DoctorFinding[] {
  return [...findings].sort(
    (left, right) =>
      SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity] ||
      CATEGORY_ORDER[left.category] - CATEGORY_ORDER[right.category] ||
      left.title.localeCompare(right.title),
  );
}

export function countBySeverity(findings: readonly DoctorFinding[]): Record<DoctorSeverity, number> {
  const counts: Record<DoctorSeverity, number> = { critical: 0, warning: 0, info: 0 };
  for (const finding of findings) {
    counts[finding.severity] += 1;
  }
  return counts;
}

export function countByCategory(findings: readonly DoctorFinding[]): Record<DoctorCategory, number> {
  const counts = Object.fromEntries(CATEGORIES.map((category) => [category.key, 0])) as Record<DoctorCategory, number>;
  for (const finding of findings) {
    counts[finding.category] += 1;
  }
  return counts;
}

export interface FindingFilter {
  /** Empty = every severity. */
  readonly severities: ReadonlySet<DoctorSeverity>;
  /** `null` = every category. */
  readonly category: DoctorCategory | null;
}

export function filterFindings(findings: readonly DoctorFinding[], filter: FindingFilter): DoctorFinding[] {
  return findings.filter(
    (finding) =>
      (filter.severities.size === 0 || filter.severities.has(finding.severity)) &&
      (filter.category === null || finding.category === filter.category),
  );
}

const SEVERITY_KEYS = new Set<string>(SEVERITIES.map((severity) => severity.key));
const CATEGORY_KEYS = new Set<string>(CATEGORIES.map((category) => category.key));

/** `?severity=critical,warning` → the set (unknown values are ignored). */
export function parseSeverityParam(value: string | null): Set<DoctorSeverity> {
  return new Set(
    (value ?? '')
      .split(',')
      .map((item) => item.trim().toLowerCase())
      .filter((item): item is DoctorSeverity => SEVERITY_KEYS.has(item)),
  );
}

export function severityParam(severities: ReadonlySet<DoctorSeverity>): string | null {
  const ordered = SEVERITIES.map((severity) => severity.key).filter((key) => severities.has(key));
  return ordered.length > 0 ? ordered.join(',') : null;
}

export function parseCategoryParam(value: string | null): DoctorCategory | null {
  const key = (value ?? '').trim().toLowerCase();
  return CATEGORY_KEYS.has(key) ? (key as DoctorCategory) : null;
}
