/** Formatting helpers shared by every view. */

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'] as const;

export function formatBytes(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '–';
  }
  if (value === 0) {
    return '0 B';
  }
  const unit = Math.max(
    0,
    Math.min(
      Math.floor(Math.log(Math.abs(value)) / Math.log(1024)),
      BYTE_UNITS.length - 1,
    ),
  );
  const amount = value / 1024 ** unit;
  return `${amount.toLocaleString('en-US', {
    maximumFractionDigits: unit === 0 ? 0 : digits,
  })} ${BYTE_UNITS[unit]}`;
}

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '–';
  }
  return value.toLocaleString('en-US');
}

/** 1234 → "1.2k", 3_400_000 → "3.4M". */
export function formatCompact(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '–';
  }
  return new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
}

const DURATION_UNITS: readonly (readonly [string, number])[] = [
  ['y', 31_536_000_000],
  ['mo', 2_592_000_000],
  ['d', 86_400_000],
  ['h', 3_600_000],
  ['m', 60_000],
  ['s', 1_000],
];

/** Two most significant units, e.g. "3d 4h" or "12m 5s". */
export function formatDuration(milliseconds: number | null | undefined): string {
  if (
    milliseconds === null ||
    milliseconds === undefined ||
    !Number.isFinite(milliseconds) ||
    milliseconds < 0
  ) {
    return '–';
  }
  if (milliseconds < 1_000) {
    return `${Math.round(milliseconds)}ms`;
  }
  // The largest non-zero unit plus the next smaller one ("3d 4h", "1d").
  const first = DURATION_UNITS.findIndex(([, size]) => milliseconds >= size);
  const [label, size] = DURATION_UNITS[first] ?? ['s', 1_000];
  const amount = Math.floor(milliseconds / size);
  const next = DURATION_UNITS[first + 1];
  if (!next) {
    return `${amount}${label}`;
  }
  const rest = Math.floor((milliseconds - amount * size) / next[1]);
  return rest > 0 ? `${amount}${label} ${rest}${next[0]}` : `${amount}${label}`;
}

/** The noun alone: "node" for 1, "nodes" otherwise (for labels that style the number). */
export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return count === 1 ? singular : pluralForm;
}

/** "1 node", "3 nodes", "1,204 shards". */
export function pluralize(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${formatNumber(count)} ${plural(count, singular, pluralForm)}`;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** Local date "2026-10-14". */
export function formatDate(milliseconds: number | null | undefined): string {
  if (milliseconds === null || milliseconds === undefined || !Number.isFinite(milliseconds)) {
    return '–';
  }
  const date = new Date(milliseconds);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Local "2026-10-14 15:54", or "2026-10-14 15:54:10" with `seconds`. */
export function formatTimestamp(
  milliseconds: number | null | undefined,
  options: { readonly seconds?: boolean } = {},
): string {
  if (milliseconds === null || milliseconds === undefined || !Number.isFinite(milliseconds)) {
    return '–';
  }
  const date = new Date(milliseconds);
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  return `${formatDate(milliseconds)} ${options.seconds ? `${time}:${pad(date.getSeconds())}` : time}`;
}

const RELATIVE_UNITS: readonly (readonly [string, number])[] = DURATION_UNITS.slice(0, -1);

/** "just now", "5m ago", "3h ago", "2d ago" (or "in 5m" for clock skew). */
export function formatRelative(milliseconds: number | null | undefined, now: number): string {
  if (milliseconds === null || milliseconds === undefined || !Number.isFinite(milliseconds)) {
    return '–';
  }
  const delta = now - milliseconds;
  const distance = Math.abs(delta);
  const unit = RELATIVE_UNITS.find(([, size]) => distance >= size);
  if (!unit) {
    return 'just now';
  }
  const amount = `${Math.floor(distance / unit[1])}${unit[0]}`;
  return delta >= 0 ? `${amount} ago` : `in ${amount}`;
}

/** Upper-cases the first letter of a sentence Elasticsearch wrote in lower case. */
export function sentence(value: string): string {
  const text = value.trim();
  return text ? text.charAt(0).toLocaleUpperCase() + text.slice(1) : '';
}

/** "number_of_replicas" → "Number of replicas", "cluster.routing" → "Cluster routing". */
export function humanize(value: string): string {
  return sentence(value.replace(/[_.-]+/g, ' ').replace(/\s+/g, ' ').toLocaleLowerCase());
}

export function clampPercent(value: number | null | undefined): number {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(100, value));
}

export type Severity = 'ok' | 'warn' | 'danger';

export function severity(value: number | null | undefined, warn = 75, danger = 90): Severity {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return 'ok';
  }
  if (value >= danger) {
    return 'danger';
  }
  return value >= warn ? 'warn' : 'ok';
}

/** Case-insensitive match that accepts a regular expression when valid. */
export function matchesText(value: string, expression: string): boolean {
  const query = expression.trim();
  if (!query) {
    return true;
  }
  try {
    return new RegExp(query, 'i').test(value);
  } catch {
    return value.toLocaleLowerCase().includes(query.toLocaleLowerCase());
  }
}

export function sortByName<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}
