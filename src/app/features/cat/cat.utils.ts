import { HealthTone, healthTone } from '../../core/health';
import { isRecord } from '../../core/json';

export const CAT_APIS = [
  'aliases',
  'allocation',
  'count',
  'fielddata',
  'health',
  'indices',
  'master',
  'nodeattrs',
  'nodes',
  'pending tasks',
  'plugins',
  'recovery',
  'repositories',
  'segments',
  'shards',
  'thread pool',
] as const;

export type CatApi = (typeof CAT_APIS)[number];
export type CatRow = Readonly<Record<string, unknown>>;

export interface CatApiInfo {
  /** Sentence case display name. */
  readonly label: string;
  readonly icon: string;
  readonly description: string;
  /** Text of the empty state when the API returns no rows. */
  readonly emptyText: string;
  /**
   * Always answers with exactly one row (cluster health, document count,
   * elected master); shown as label/value pairs instead of a table.
   */
  readonly singleRow?: true;
}

/** Icon, one-line description and empty-state copy of every CAT API. */
export const CAT_API_INFO: Readonly<Record<CatApi, CatApiInfo>> = {
  aliases: {
    label: 'Aliases',
    icon: 'bi-tags',
    description: 'Aliases and the indices they point to',
    emptyText: 'No aliases are defined in this cluster.',
  },
  allocation: {
    label: 'Allocation',
    icon: 'bi-pie-chart',
    description: 'Shard count and disk usage per node',
    emptyText: 'No data nodes reported shard allocation.',
  },
  count: {
    label: 'Count',
    icon: 'bi-123',
    description: 'Document count of the whole cluster',
    emptyText: 'The cluster did not report a document count.',
    singleRow: true,
  },
  fielddata: {
    label: 'Fielddata',
    icon: 'bi-memory',
    description: 'Heap used by fielddata per node and field',
    emptyText: 'No fielddata is currently loaded in memory.',
  },
  health: {
    label: 'Health',
    icon: 'bi-heart-pulse',
    description: 'Cluster health in a single row',
    emptyText: 'The cluster did not report its health.',
    singleRow: true,
  },
  indices: {
    label: 'Indices',
    icon: 'bi-collection',
    description: 'Health, documents and size of every index',
    emptyText: 'This cluster has no indices yet.',
  },
  master: {
    label: 'Master',
    icon: 'bi-star',
    description: 'The currently elected master node',
    emptyText: 'No master node is currently elected.',
    singleRow: true,
  },
  nodeattrs: {
    label: 'Node attributes',
    icon: 'bi-tag',
    description: 'Custom attributes of every node',
    emptyText: 'No node attributes are defined.',
  },
  nodes: {
    label: 'Nodes',
    icon: 'bi-hdd-stack',
    description: 'Roles and resource usage per node',
    emptyText: 'No nodes reported their statistics.',
  },
  'pending tasks': {
    label: 'Pending tasks',
    icon: 'bi-hourglass-split',
    description: 'Cluster state updates waiting to run',
    emptyText: 'No cluster-level changes are waiting to run.',
  },
  plugins: {
    label: 'Plugins',
    icon: 'bi-plug',
    description: 'Plugins installed on each node',
    emptyText: 'No plugins are installed on any node.',
  },
  recovery: {
    label: 'Recovery',
    icon: 'bi-arrow-repeat',
    description: 'Ongoing and completed shard recoveries',
    emptyText: 'No shard recoveries have been recorded.',
  },
  repositories: {
    label: 'Repositories',
    icon: 'bi-database',
    description: 'Registered snapshot repositories',
    emptyText: 'No snapshot repositories are registered.',
  },
  segments: {
    label: 'Segments',
    icon: 'bi-layers',
    description: 'Lucene segments of every shard',
    emptyText: 'No Lucene segments were reported.',
  },
  shards: {
    label: 'Shards',
    icon: 'bi-grid-3x3-gap',
    description: 'Where every shard lives and its state',
    emptyText: 'This cluster has no shards yet.',
  },
  'thread pool': {
    label: 'Thread pool',
    icon: 'bi-cpu',
    description: 'Active, queued and rejected tasks per pool',
    emptyText: 'No thread pool statistics were reported.',
  },
};

export function catApiValue(api: CatApi): string {
  return api.replaceAll(' ', '_');
}

/** Resolves a deep-link value ("thread_pool", "Thread pool") to a CAT API. */
export function catApiFromParam(value: string | null | undefined): CatApi | null {
  if (!value) {
    return null;
  }
  const normalized = value.trim().toLowerCase().replaceAll('_', ' ');
  return CAT_APIS.find((api) => api === normalized) ?? null;
}

/**
 * Whether a response is shown as label/value pairs: only for the APIs that
 * are single-row by nature, so other APIs never flip between a record and a
 * table as their row count changes on refresh.
 */
export function isCatRecord(api: CatApi, rows: readonly CatRow[]): boolean {
  return CAT_API_INFO[api].singleRow === true && rows.length === 1;
}

/**
 * Splits a column name after each `_`, `.` and `-` so long names
 * ("active_shards_percent") wrap between words, never inside one.
 */
export function catKeyParts(column: string): readonly string[] {
  return column.match(/[^_.-]+[_.-]*|[_.-]+/g) ?? [column];
}

export function catColumns(rows: readonly CatRow[]): readonly string[] {
  const columns = new Set<string>();
  for (const row of rows) {
    for (const column of Object.keys(row)) {
      if (column) {
        columns.add(column);
      }
    }
  }
  return [...columns];
}

/** `null`, `undefined` and the placeholders CAT uses for "no value". */
function isMissing(value: unknown): boolean {
  if (value === null || value === undefined) {
    return true;
  }
  if (typeof value === 'string') {
    const text = value.trim();
    return text === '' || text === '-' || text.toLowerCase() === 'n/a';
  }
  return false;
}

const UNIT_FACTORS: Readonly<Record<string, number>> = {
  b: 1,
  kb: 1024,
  mb: 1024 ** 2,
  gb: 1024 ** 3,
  tb: 1024 ** 4,
  pb: 1024 ** 5,
  nanos: 1e-6,
  micros: 1e-3,
  ms: 1,
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  '%': 1,
};

const QUANTITY_PATTERN =
  /^(-?(?:\d+\.?\d*|\.\d+))(b|kb|mb|gb|tb|pb|nanos|micros|ms|s|m|h|d|%)?$/i;

/**
 * Numeric value of a CAT cell: plain numbers plus the human readable sizes
 * ("45.1kb"), durations ("28ms", "1.2m") and percentages ("97.1%") CAT
 * returns, so those columns sort by magnitude instead of alphabetically.
 */
export function quantityValue(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== 'string') {
    return null;
  }
  const match = QUANTITY_PATTERN.exec(value.trim());
  if (!match) {
    return null;
  }
  const amount = Number(match[1]);
  const unit = match[2]?.toLowerCase();
  return unit ? amount * (UNIT_FACTORS[unit] ?? 1) : amount;
}

const collator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base',
});

function compareValues(left: unknown, right: unknown): number {
  if (Object.is(left, right)) {
    return 0;
  }
  const leftNumber = quantityValue(left);
  const rightNumber = quantityValue(right);
  if (leftNumber !== null && rightNumber !== null) {
    return leftNumber - rightNumber;
  }
  return collator.compare(catCellText(left), catCellText(right));
}

/** Immutable and stable table sorting; missing values remain at the end. */
export function sortCatRows(
  rows: readonly CatRow[],
  column: string | null,
  reverse: boolean,
): readonly CatRow[] {
  if (!column) {
    return [...rows];
  }

  return rows
    .map((row, index) => ({ row, index }))
    .sort((left, right) => {
      const leftValue = left.row[column];
      const rightValue = right.row[column];
      const leftMissing = isMissing(leftValue);
      const rightMissing = isMissing(rightValue);
      if (leftMissing || rightMissing) {
        return leftMissing === rightMissing
          ? left.index - right.index
          : leftMissing
            ? 1
            : -1;
      }

      const comparison = compareValues(leftValue, rightValue);
      const directed = reverse ? -comparison : comparison;
      return directed || left.index - right.index;
    })
    .map(({ row }) => row);
}

/**
 * Columns whose values are all numbers or quantities (ignoring missing
 * values); they are right aligned and sort descending first.
 */
export function numericColumns(
  rows: readonly CatRow[],
  columns: readonly string[],
): ReadonlySet<string> {
  const numeric = new Set<string>();
  for (const column of columns) {
    let seen = false;
    let allNumeric = true;
    for (const row of rows) {
      const value = row[column];
      if (isMissing(value)) {
        continue;
      }
      seen = true;
      if (quantityValue(value) === null) {
        allNumeric = false;
        break;
      }
    }
    if (seen && allNumeric) {
      numeric.add(column);
    }
  }
  return numeric;
}

/** Same semantics as the other filters: a regular expression or plain text. */
export function textMatcher(query: string): (value: string) => boolean {
  const expression = query.trim();
  if (!expression) {
    return () => true;
  }
  try {
    const pattern = new RegExp(expression, 'i');
    return (value) => pattern.test(value);
  } catch {
    const needle = expression.toLocaleLowerCase();
    return (value) => value.toLocaleLowerCase().includes(needle);
  }
}

/** Keeps the rows where any column matches the query. */
export function filterCatRows(
  rows: readonly CatRow[],
  columns: readonly string[],
  query: string,
): readonly CatRow[] {
  if (!query.trim()) {
    return rows;
  }
  const matches = textMatcher(query);
  return rows.filter((row) => columns.some((column) => matches(catCellText(row[column]))));
}

export function asCatRows(value: unknown): readonly CatRow[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((row): row is CatRow => isRecord(row));
}

export function catCellText(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

/** Tab separated values (header row first), ready to paste in a spreadsheet. */
export function catRowsToTsv(columns: readonly string[], rows: readonly CatRow[]): string {
  const clean = (text: string) => text.replace(/[\t\r\n]+/g, ' ');
  const lines = [columns.map(clean).join('\t')];
  for (const row of rows) {
    lines.push(columns.map((column) => clean(catCellText(row[column]))).join('\t'));
  }
  return lines.join('\n');
}

const SHARD_STATE_TONES: Readonly<Record<string, HealthTone>> = {
  STARTED: 'green',
  INITIALIZING: 'yellow',
  RELOCATING: 'yellow',
  UNASSIGNED: 'red',
};

/**
 * Status colour of health and shard-state cells (a closed index is gray),
 * `null` for other cells and values.
 */
export function catCellTone(column: string, value: unknown): HealthTone | null {
  if (typeof value !== 'string') {
    return null;
  }
  const name = column.toLowerCase();
  if (name === 'health' || name === 'status') {
    const tone = healthTone(value);
    return tone !== 'gray' ? tone : value.toLowerCase() === 'close' ? 'gray' : null;
  }
  if (name === 'state') {
    return SHARD_STATE_TONES[value.toUpperCase()] ?? null;
  }
  return null;
}
