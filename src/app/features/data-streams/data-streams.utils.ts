import { isUnknownEndpoint, readableReason } from '../../core/errors';
import { textMatcher } from '../../core/format';
import { HealthTone, healthLabel, healthTone } from '../../core/health';
import {
  BackingIndexRow,
  DataStream,
  DataStreamStats,
  DataStreamStatsEntry,
  LifecycleInfo,
  StreamRow,
  StreamSortField,
  StreamSummary,
} from './data-streams.models';

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

const HEALTH_DESCRIPTIONS: Readonly<Record<HealthTone, string>> = {
  green: 'Green: all primary and replica shards of the backing indices are assigned',
  yellow: 'Yellow: some replica shards of the backing indices are unassigned',
  red: 'Red: at least one primary shard of a backing index is unassigned; part of the data cannot be searched or written',
  gray: 'Health unknown: Elasticsearch did not report a status',
};

/** Explanation shown as the badge tooltip. */
export function healthDescription(tone: HealthTone): string {
  return HEALTH_DESCRIPTIONS[tone];
}

/** Severity used to sort by health: red first when descending. */
const HEALTH_RANK: Readonly<Record<HealthTone, number>> = { green: 0, gray: 1, yellow: 2, red: 3 };

/**
 * Who manages the stream's next generation: an ILM policy, the built-in data
 * stream lifecycle (with its retention) or nothing.
 */
export function lifecycleOf(stream: DataStream): LifecycleInfo {
  const managedBy = typeof stream.next_generation_managed_by === 'string' ? stream.next_generation_managed_by : '';
  const policy = typeof stream.ilm_policy === 'string' && stream.ilm_policy ? stream.ilm_policy : null;
  const lifecycle = stream.lifecycle;
  const dslEnabled = typeof lifecycle === 'object' && lifecycle !== null && lifecycle.enabled !== false;
  const retention = dslEnabled
    ? (typeof lifecycle.data_retention === 'string' ? lifecycle.data_retention : null) ??
      (typeof lifecycle.effective_retention === 'string' ? lifecycle.effective_retention : null)
    : null;

  if (/lifecycle management/i.test(managedBy) && policy) {
    return { kind: 'ilm', policy };
  }
  if (/data stream lifecycle/i.test(managedBy) && dslEnabled) {
    return { kind: 'dsl', retention };
  }
  if (policy) {
    return { kind: 'ilm', policy };
  }
  if (dslEnabled) {
    return { kind: 'dsl', retention };
  }
  return { kind: 'none' };
}

export function backingIndexRows(stream: DataStream): BackingIndexRow[] {
  const indices = Array.isArray(stream.indices) ? stream.indices : [];
  return indices
    .filter((index) => typeof index?.index_name === 'string')
    .map((index, position, all) => ({
      name: index.index_name,
      position: position + 1,
      // The last backing index is the write index.
      write: position === all.length - 1,
      managedBy: typeof index.managed_by === 'string' && index.managed_by ? index.managed_by : null,
      policy: typeof index.ilm_policy === 'string' && index.ilm_policy ? index.ilm_policy : null,
    }));
}

export function statsByStream(stats: DataStreamStats | null | undefined): Map<string, DataStreamStatsEntry> {
  const map = new Map<string, DataStreamStatsEntry>();
  for (const entry of Array.isArray(stats?.data_streams) ? stats.data_streams : []) {
    if (typeof entry?.data_stream === 'string') {
      map.set(entry.data_stream, entry);
    }
  }
  return map;
}

export function buildRows(
  streams: readonly DataStream[] | undefined,
  stats: DataStreamStats | null | undefined,
): StreamRow[] {
  const byName = statsByStream(stats);
  return (streams ?? [])
    .filter((stream) => typeof stream?.name === 'string')
    .map((stream) => {
      const entry = byName.get(stream.name);
      const backing = backingIndexRows(stream);
      const health = healthTone(stream.status);
      const lastEvent = finite(entry?.maximum_timestamp);
      return {
        stream,
        name: stream.name,
        health,
        healthLabel: healthLabel(health),
        indexCount: backing.length,
        generation: finite(stream.generation) ?? backing.length,
        template: typeof stream.template === 'string' && stream.template ? stream.template : null,
        lifecycle: lifecycleOf(stream),
        sizeBytes: finite(entry?.store_size_bytes),
        // 0 means "no documents yet" in the stats API.
        lastEvent: lastEvent !== null && lastEvent > 0 ? lastEvent : null,
        writeIndex: backing[backing.length - 1]?.name ?? null,
        hidden: stream.hidden === true,
        system: stream.system === true,
        replicated: stream.replicated === true,
        timestampField: stream.timestamp_field?.name ?? '@timestamp',
        backingIndices: backing,
      };
    });
}

/** Hidden or system streams (".logs-…", ".fleet-…") are shown on request only. */
export function isInternal(row: StreamRow): boolean {
  return row.hidden || row.system || row.name.startsWith('.');
}

/**
 * Streams whose name, index template or ILM policy matches `query` (regex or
 * substring, like every filter of the app). A literal substring always
 * matches, so a `?name=` link to a name with regex characters still finds it.
 */
export function filterRows(rows: readonly StreamRow[], query: string, showInternal: boolean): StreamRow[] {
  const raw = query.trim();
  const needle = raw.toLocaleLowerCase();
  const pattern = textMatcher(raw);
  const matches = (value: string | null): boolean =>
    value !== null && (value.toLocaleLowerCase().includes(needle) || pattern(value));
  return rows.filter(
    (row) =>
      (showInternal || !isInternal(row)) &&
      (!raw ||
        matches(row.name) ||
        matches(row.template) ||
        (row.lifecycle.kind === 'ilm' && matches(row.lifecycle.policy))),
  );
}

/** Missing sizes and times (`null`) always go last, in both directions. */
function nullRank(left: number | null, right: number | null): number {
  return Number(left === null) - Number(right === null);
}

/** Stable sort; missing values always go last, ties fall back to the name. */
export function sortRows(rows: readonly StreamRow[], field: StreamSortField, reverse: boolean): StreamRow[] {
  const direction = reverse ? -1 : 1;
  return [...rows].sort((left, right) => {
    let result: number;
    switch (field) {
      case 'health':
        result = (HEALTH_RANK[left.health] - HEALTH_RANK[right.health]) * direction;
        break;
      case 'indices':
        result = (left.indexCount - right.indexCount) * direction;
        break;
      case 'size':
        result =
          nullRank(left.sizeBytes, right.sizeBytes) || ((left.sizeBytes ?? 0) - (right.sizeBytes ?? 0)) * direction;
        break;
      case 'lastEvent':
        result =
          nullRank(left.lastEvent, right.lastEvent) || ((left.lastEvent ?? 0) - (right.lastEvent ?? 0)) * direction;
        break;
      default:
        result = 0;
    }
    return result || left.name.localeCompare(right.name) * (field === 'name' ? direction : 1);
  });
}

export function summarize(rows: readonly StreamRow[]): StreamSummary {
  const sizes = rows.map((row) => row.sizeBytes).filter((size): size is number => size !== null);
  const events = rows.map((row) => row.lastEvent).filter((time): time is number => time !== null);
  return {
    streams: rows.length,
    backingIndices: rows.reduce((total, row) => total + row.indexCount, 0),
    sizeBytes: sizes.length > 0 ? sizes.reduce((total, size) => total + size, 0) : null,
    unhealthy: rows.filter((row) => row.health === 'yellow' || row.health === 'red').length,
    lastEvent: events.length > 0 ? Math.max(...events) : null,
  };
}

/** ".ds-logs-app-2026.10.14-000002" of stream "logs-app" → "2026.10.14-000002". */
export function shortIndexName(index: string, stream: string): string {
  const prefix = `.ds-${stream}-`;
  return index.startsWith(prefix) && index.length > prefix.length ? index.slice(prefix.length) : index;
}

/**
 * Backing index name Elasticsearch will most likely create on the next
 * rollover: `.ds-<stream>-<yyyy.MM.dd>-<generation + 1, 6 digits>`.
 */
export function nextBackingIndex(name: string, generation: number, now: number): string {
  const date = new Date(now);
  const pad = (value: number): string => String(value).padStart(2, '0');
  const day = `${date.getUTCFullYear()}.${pad(date.getUTCMonth() + 1)}.${pad(date.getUTCDate())}`;
  return `.ds-${name}-${day}-${String(generation + 1).padStart(6, '0')}`;
}

/* ------------------------------------------------------------------ */
/* Deep links (?name=)                                                 */
/* ------------------------------------------------------------------ */

/** Reads the `?name=` deep link (from /index_detail and /ilm); blank means none. */
export function streamNameParam(value: string | null | undefined): string | null {
  const name = value?.trim() ?? '';
  return name === '' ? null : name;
}

/** The linked stream exists but is hidden or system: the toggle must be on to see it. */
export function revealsInternal(rows: readonly StreamRow[], name: string): boolean {
  const row = rows.find((candidate) => candidate.name === name);
  return row !== undefined && isInternal(row);
}

/** The URL keeps `?name=` while the search box still holds exactly the linked name. */
export function keepsStreamLink(query: string, linked: string | null): boolean {
  return linked !== null && query.trim() === linked;
}

/** `true` once loaded streams do not contain the linked one (deleted or mistyped). */
export function linkedStreamMissing(
  rows: readonly StreamRow[],
  linked: string | null,
  loaded: boolean,
): boolean {
  return loaded && linked !== null && !rows.some((row) => row.name === linked);
}

/**
 * Copy for a `?name=` link to a stream Elasticsearch did not list. The list
 * includes hidden and system streams, so the stream is gone or the link was
 * made for another cluster.
 */
export function missingStreamMessage(name: string): { readonly heading: string; readonly text: string } {
  return {
    heading: `Data stream “${name}” not found`,
    text: 'This cluster has no data stream with this name. It may have been deleted, or the link points to another cluster.',
  };
}

/**
 * Expanded rows after a `?name=` link changes from `previous` to `next`: the
 * row opened by the previous link collapses and the new linked row opens.
 * Rows the user expanded by hand stay open (the component passes `null` as
 * `previous` once the user toggled the linked row).
 */
export function relinkExpanded(
  current: ReadonlySet<string>,
  previous: string | null,
  next: string | null,
): Set<string> {
  const expanded = new Set(current);
  if (previous !== null && previous !== next) {
    expanded.delete(previous);
  }
  if (next !== null) {
    expanded.add(next);
  }
  return expanded;
}

/**
 * The reason shown in the error state, or `undefined` when the page should
 * fall back to its own sentence with the "needs Elasticsearch 7.9" hint (no
 * reason, or an Elasticsearch that does not know the endpoint).
 */
export function loadErrorReason(error: unknown): string | undefined {
  return isUnknownEndpoint(error, ['_data_stream']) ? undefined : readableReason(error);
}
