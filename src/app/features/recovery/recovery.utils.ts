import { ClusterApiError } from '../../core/api-envelope';
import { readableReason } from '../../core/errors';
import { formatBytes, formatNumber, humanize, matchesText } from '../../core/format';
import { isRecord } from '../../core/json';
import {
  Progress,
  RawRecoveryRow,
  Recovery,
  RecoveryGroup,
  RecoverySample,
  RecoverySortField,
  RecoverySummary,
} from './recovery.models';

/** `_cat` uses "n/a" (and sometimes "-" or "") for missing values. */
export function catValue(value: string | undefined): string | undefined {
  const text = value?.trim();
  return text && text !== 'n/a' && text !== '-' ? text : undefined;
}

export function catNumber(value: string | undefined): number {
  const parsed = Number(catValue(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

/** "12.5%" → 12.5; anything unparsable → 0; clamped to 0–100. */
export function parsePercent(value: string | undefined): number {
  const parsed = Number.parseFloat((value ?? '').replace('%', ''));
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return Math.max(0, Math.min(100, parsed));
}

function progress(total: string | undefined, recovered: string | undefined, percent: string | undefined): Progress {
  return { total: catNumber(total), recovered: catNumber(recovered), percent: parsePercent(percent) };
}

export function normalizeRecovery(row: RawRecoveryRow): Recovery {
  const index = row.index ?? '';
  const shard = catNumber(row.shard);
  const type = (catValue(row.type) ?? 'unknown').toLocaleLowerCase();
  const stage = (catValue(row.stage) ?? 'unknown').toLocaleLowerCase();
  const sourceNode = catValue(row.source_node);
  const sourceHost = catValue(row.source_host);
  const targetNode = catValue(row.target_node);
  const targetHost = catValue(row.target_host);
  const repository = catValue(row.repository);
  const snapshot = catValue(row.snapshot);
  const translogTotal = Number(catValue(row.translog_ops));
  return {
    key: [index, shard, type, sourceNode ?? '', targetNode ?? ''].join('|'),
    index,
    shard,
    timeMs: catNumber(row.time),
    type,
    stage,
    done: stage === 'done',
    ...(sourceNode ? { sourceNode } : {}),
    ...(sourceHost ? { sourceHost } : {}),
    ...(targetNode ? { targetNode } : {}),
    ...(targetHost ? { targetHost } : {}),
    ...(repository ? { repository } : {}),
    ...(snapshot ? { snapshot } : {}),
    files: progress(row.files, row.files_recovered, row.files_percent),
    filesTotal: catNumber(row.files_total),
    bytes: progress(row.bytes, row.bytes_recovered, row.bytes_percent),
    bytesTotal: catNumber(row.bytes_total),
    // -1 (or a missing value) means the number of operations is not known yet.
    translog:
      Number.isFinite(translogTotal) && translogTotal >= 0
        ? progress(row.translog_ops, row.translog_ops_recovered, row.translog_ops_percent)
        : null,
  };
}

export function parseRecoveries(rows: unknown): Recovery[] {
  if (!Array.isArray(rows)) {
    return [];
  }
  return rows.flatMap((row: unknown) =>
    isRecord(row) && typeof row['index'] === 'string' ? [normalizeRecovery(row as RawRecoveryRow)] : [],
  );
}

/* ------------------------------------------------------------------ */
/* Presentation metadata                                               */
/* ------------------------------------------------------------------ */

export interface TypeMeta {
  readonly label: string;
  readonly icon: string;
  readonly badge: string;
  readonly description: string;
}

const TYPES: Readonly<Record<string, TypeMeta>> = {
  peer: {
    label: 'Peer',
    icon: 'bi-arrow-left-right',
    badge: 'badge-blue',
    description: 'Copied from another node (new replica or relocation)',
  },
  existing_store: {
    label: 'Existing store',
    icon: 'bi-hdd',
    badge: 'badge-green',
    description: 'Recovered from the data already on the node (restart)',
  },
  snapshot: {
    label: 'Snapshot',
    icon: 'bi-camera',
    badge: 'badge-purple',
    description: 'Restored from a snapshot repository',
  },
  empty_store: {
    label: 'Empty store',
    icon: 'bi-plus-square',
    badge: 'badge-outline',
    description: 'New empty primary (index creation)',
  },
  local_shards: {
    label: 'Local shards',
    icon: 'bi-intersect',
    badge: 'badge-yellow',
    description: 'Built from other shards on the node (shrink, split or clone)',
  },
};

export function typeMeta(type: string): TypeMeta {
  return (
    TYPES[type] ?? {
      label: humanize(type) || 'Unknown',
      icon: 'bi-question-circle',
      badge: 'badge-outline',
      description: '',
    }
  );
}

export const RECOVERY_TYPES = Object.keys(TYPES);

/** The ordered stages of a recovery (shown as a stepper). */
export const STAGES = ['init', 'index', 'verify_index', 'translog', 'finalize', 'done'] as const;

const STAGE_LABELS: Readonly<Record<string, string>> = {
  init: 'Starting',
  index: 'Copying files',
  verify_index: 'Verifying',
  translog: 'Replaying translog',
  finalize: 'Finalizing',
  done: 'Done',
};

export function stageLabel(stage: string): string {
  return STAGE_LABELS[stage] ?? (humanize(stage) || 'Unknown');
}

/** 0-based position in STAGES; unknown stages count as the first. */
export function stageIndex(stage: string): number {
  const position = (STAGES as readonly string[]).indexOf(stage);
  return position < 0 ? 0 : position;
}

/** Overall progress of one recovery, for the headline meter. */
export function recoveryPercent(recovery: Recovery): number {
  if (recovery.done) {
    return 100;
  }
  const stage = stageIndex(recovery.stage);
  if (recovery.bytes.total > 0 && stage <= stageIndex('index')) {
    return recovery.bytes.percent;
  }
  if (stage >= stageIndex('translog') && recovery.translog && recovery.translog.total > 0) {
    return recovery.translog.percent;
  }
  if (recovery.bytes.total > 0) {
    return recovery.bytes.percent;
  }
  return stage >= stageIndex('verify_index') ? 99 : 0;
}

export function bytesRemaining(recovery: Recovery): number {
  return recovery.done ? 0 : Math.max(0, recovery.bytes.total - recovery.bytes.recovered);
}

export function filesRemaining(recovery: Recovery): number {
  return recovery.done ? 0 : Math.max(0, recovery.files.total - recovery.files.recovered);
}

export function translogRemaining(recovery: Recovery): number {
  if (recovery.done || !recovery.translog) {
    return 0;
  }
  return Math.max(0, recovery.translog.total - recovery.translog.recovered);
}

export interface MetricView {
  /** Meter value, 0–100. */
  readonly value: number;
  /** Headline next to the label: "42%" or "–". */
  readonly label: string;
  readonly detail: string;
}

/**
 * Display values of the bytes, files and translog columns. Elasticsearch
 * reports 0 of 0 as 0% (files, bytes) or 100% (translog) whatever the stage,
 * so empty amounts are told apart from real progress here.
 */
export function metricView(recovery: Recovery, kind: 'bytes' | 'files' | 'translog'): MetricView {
  const stage = stageIndex(recovery.stage);
  if (kind === 'translog') {
    const translog = recovery.translog;
    if (!translog) {
      return { value: 0, label: '–', detail: 'Not known yet' };
    }
    if (translog.total === 0) {
      return recovery.done || stage >= stageIndex('translog')
        ? { value: 100, label: '–', detail: 'No operations' }
        : { value: 0, label: '–', detail: 'Starts after files' };
    }
    const percent = recovery.done ? 100 : translog.percent;
    return {
      value: percent,
      label: `${percent}%`,
      detail: `${formatNumber(translog.recovered)} / ${formatNumber(translog.total)} ops`,
    };
  }
  const amount = kind === 'bytes' ? recovery.bytes : recovery.files;
  if (amount.total === 0) {
    const finished = recovery.done || stage > stageIndex('index');
    return {
      value: finished ? 100 : 0,
      label: '–',
      detail: kind === 'bytes' ? 'Nothing to copy' : 'No files to copy',
    };
  }
  const percent = recovery.done ? 100 : amount.percent;
  const format = kind === 'bytes' ? (value: number) => formatBytes(value) : formatNumber;
  return {
    value: percent,
    label: `${percent}%`,
    detail: `${format(amount.recovered)} / ${format(amount.total)}`,
  };
}

/* ------------------------------------------------------------------ */
/* Filtering, grouping, sorting, summary                               */
/* ------------------------------------------------------------------ */

export interface RecoveryFilter {
  readonly text: string;
  /** Types to hide; empty means every type is shown. */
  readonly hiddenTypes: ReadonlySet<string>;
}

export function filterRecoveries(recoveries: readonly Recovery[], filter: RecoveryFilter): Recovery[] {
  return recoveries.filter(
    (recovery) => !filter.hiddenTypes.has(recovery.type) && matchesText(recovery.index, filter.text),
  );
}

function compareRecoveries(left: Recovery, right: Recovery): number {
  if (left.done !== right.done) {
    return left.done ? 1 : -1;
  }
  return left.shard - right.shard || left.type.localeCompare(right.type) || left.key.localeCompare(right.key);
}

export function groupRecoveries(recoveries: readonly Recovery[]): RecoveryGroup[] {
  const groups = new Map<string, Recovery[]>();
  for (const recovery of recoveries) {
    const list = groups.get(recovery.index) ?? [];
    list.push(recovery);
    groups.set(recovery.index, list);
  }
  return [...groups.entries()].map(([index, list]) => {
    const sorted = [...list].sort(compareRecoveries);
    const active = sorted.filter((recovery) => !recovery.done);
    const measured = active.length > 0 ? active : sorted;
    const bytesTotal = measured.reduce((sum, recovery) => sum + recovery.bytes.total, 0);
    const bytesRecovered = measured.reduce(
      (sum, recovery) => sum + (recovery.done ? recovery.bytes.total : Math.min(recovery.bytes.recovered, recovery.bytes.total)),
      0,
    );
    const percent =
      active.length === 0
        ? 100
        : bytesTotal > 0
          ? (bytesRecovered / bytesTotal) * 100
          : active.reduce((sum, recovery) => sum + recoveryPercent(recovery), 0) / active.length;
    return {
      index,
      recoveries: sorted,
      active: active.length,
      bytesTotal,
      bytesRecovered,
      bytesRemaining: active.reduce((sum, recovery) => sum + bytesRemaining(recovery), 0),
      percent: Math.round(percent * 10) / 10,
      longestMs: sorted.reduce((max, recovery) => Math.max(max, recovery.done ? 0 : recovery.timeMs), 0),
    };
  });
}

/** Active groups always come first; then the chosen order; ties by name. */
export function sortGroups(
  groups: readonly RecoveryGroup[],
  field: RecoverySortField,
): RecoveryGroup[] {
  return [...groups].sort((left, right) => {
    const leftActive = left.active > 0;
    const rightActive = right.active > 0;
    if (leftActive !== rightActive) {
      return leftActive ? -1 : 1;
    }
    let order = 0;
    if (field === 'remaining') {
      order = right.bytesRemaining - left.bytesRemaining || right.bytesTotal - left.bytesTotal;
    } else if (field === 'time') {
      const leftTime = Math.max(left.longestMs, ...left.recoveries.map((recovery) => recovery.timeMs));
      const rightTime = Math.max(right.longestMs, ...right.recoveries.map((recovery) => recovery.timeMs));
      order = rightTime - leftTime;
    }
    if (order !== 0) {
      return order;
    }
    // Hidden indices (data stream backing indices, system indices) go last.
    const leftHidden = left.index.startsWith('.');
    const rightHidden = right.index.startsWith('.');
    if (leftHidden !== rightHidden) {
      return leftHidden ? 1 : -1;
    }
    return left.index.localeCompare(right.index);
  });
}

export function summarizeRecoveries(recoveries: readonly Recovery[]): RecoverySummary {
  const active = recoveries.filter((recovery) => !recovery.done);
  const byType = new Map<string, number>();
  for (const recovery of active.length > 0 ? active : recoveries) {
    byType.set(recovery.type, (byType.get(recovery.type) ?? 0) + 1);
  }
  const bytesToRecover = active.reduce((sum, recovery) => sum + recovery.bytes.total, 0);
  const bytesLeft = active.reduce((sum, recovery) => sum + bytesRemaining(recovery), 0);
  let percent: number | null = null;
  if (active.length > 0) {
    percent =
      bytesToRecover > 0
        ? ((bytesToRecover - bytesLeft) / bytesToRecover) * 100
        : active.reduce((sum, recovery) => sum + recoveryPercent(recovery), 0) / active.length;
    percent = Math.round(percent * 10) / 10;
  }
  return {
    total: recoveries.length,
    active: active.length,
    // Indices that are recovering right now (done rows of "All" mode do not count).
    indices: new Set(active.map((recovery) => recovery.index)).size,
    bytesToRecover,
    bytesRemaining: bytesLeft,
    filesRemaining: active.reduce((sum, recovery) => sum + filesRemaining(recovery), 0),
    translogRemaining: active.reduce((sum, recovery) => sum + translogRemaining(recovery), 0),
    percent,
    byType: [...byType.entries()]
      .map(([type, count]) => ({ type, count }))
      .sort((left, right) => right.count - left.count || left.type.localeCompare(right.type)),
  };
}

/**
 * Byte numbers of a group header. Active groups show the copy progress; for
 * finished ones the copied amount is often 0 (existing store, sequence-based
 * peer recovery), so the shard size and what was reused are shown instead.
 */
export function groupBytesLabel(group: RecoveryGroup): string {
  if (group.active > 0) {
    return `${formatBytes(group.bytesRecovered)} of ${formatBytes(group.bytesTotal)}`;
  }
  const size = group.recoveries.reduce((sum, recovery) => sum + Math.max(recovery.bytesTotal, recovery.bytes.total), 0);
  const copied = group.bytesTotal;
  if (copied <= 0) {
    return size > 0 ? `${formatBytes(size)}, reused from disk` : 'No data to copy';
  }
  if (copied < size) {
    return `${formatBytes(copied)} copied, ${formatBytes(size - copied)} reused`;
  }
  return `${formatBytes(copied)} copied`;
}

export function typeCounts(recoveries: readonly Recovery[]): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const recovery of recoveries) {
    counts.set(recovery.type, (counts.get(recovery.type) ?? 0) + 1);
  }
  return counts;
}

/* ------------------------------------------------------------------ */
/* Throughput                                                          */
/* ------------------------------------------------------------------ */

export function takeSample(recoveries: readonly Recovery[], at: number): RecoverySample {
  return {
    at,
    recovered: new Map(
      recoveries.filter((recovery) => !recovery.done).map((recovery) => [recovery.key, recovery.bytes.recovered]),
    ),
  };
}

/**
 * Bytes per second of each active recovery between two polls. Recoveries
 * that were not active in the previous sample have no rate yet.
 */
export function recoveryRates(
  previous: RecoverySample | null,
  current: RecoverySample,
): ReadonlyMap<string, number> {
  const rates = new Map<string, number>();
  if (!previous) {
    return rates;
  }
  const seconds = (current.at - previous.at) / 1_000;
  if (seconds <= 0) {
    return rates;
  }
  for (const [key, recovered] of current.recovered) {
    const before = previous.recovered.get(key);
    if (before !== undefined && recovered >= before) {
      rates.set(key, (recovered - before) / seconds);
    }
  }
  return rates;
}

/** Remaining time in ms at the given rate, or `null` when it cannot be estimated. */
export function estimateRemaining(remaining: number, bytesPerSecond: number | undefined): number | null {
  if (bytesPerSecond === undefined || bytesPerSecond <= 0 || remaining <= 0) {
    return null;
  }
  return (remaining / bytesPerSecond) * 1_000;
}

/**
 * A failed request in plain words: Elasticsearch's own reason when it sent
 * one, a privilege hint for 401/403 without a reason, a generic sentence
 * otherwise.
 */
export function describeLoadError(error: unknown): string {
  const reason = readableReason(error);
  if (reason) {
    return reason;
  }
  const status =
    error instanceof ClusterApiError
      ? error.status
      : isRecord(error) && typeof error['status'] === 'number'
        ? error['status']
        : undefined;
  if (status === 401 || status === 403) {
    return 'The connected user may not read recoveries. It needs the "monitor" cluster privilege.';
  }
  return 'The cluster did not answer the recovery request. Check that it is reachable and try again.';
}
