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
  'thread pool',
  'shards',
  'segments',
] as const;

export type CatApi = (typeof CAT_APIS)[number];
export type SortDirection = 'asc' | 'desc';
export type CatRow = Readonly<Record<string, unknown>>;

export function catApiValue(api: CatApi): string {
  return api.replaceAll(' ', '_');
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

function isEmpty(value: unknown): value is null | undefined {
  return value === null || value === undefined;
}

function numericValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (
    typeof value === 'string' &&
    /^-?(?:\d+\.?\d*|\.\d+)$/.test(value.trim())
  ) {
    return Number(value);
  }
  return null;
}

const collator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base',
});

function compareValues(left: unknown, right: unknown): number {
  if (Object.is(left, right)) {
    return 0;
  }
  if (isEmpty(left)) {
    return 1;
  }
  if (isEmpty(right)) {
    return -1;
  }

  const leftNumber = numericValue(left);
  const rightNumber = numericValue(right);
  if (leftNumber !== null && rightNumber !== null) {
    return leftNumber - rightNumber;
  }
  return collator.compare(String(left), String(right));
}

/** Immutable and stable table sorting; missing values remain at the end. */
export function sortCatRows(
  rows: readonly CatRow[],
  column: string | null,
  direction: SortDirection,
): readonly CatRow[] {
  if (!column) {
    return [...rows];
  }

  return rows
    .map((row, index) => ({ row, index }))
    .sort((left, right) => {
      const leftValue = left.row[column];
      const rightValue = right.row[column];
      const missingComparison = isEmpty(leftValue)
        ? isEmpty(rightValue) ? 0 : 1
        : isEmpty(rightValue) ? -1 : 0;
      if (missingComparison !== 0) {
        return missingComparison;
      }

      const comparison = compareValues(leftValue, rightValue);
      const directed = direction === 'asc' ? comparison : -comparison;
      return directed || left.index - right.index;
    })
    .map(({ row }) => row);
}

export function asCatRows(value: unknown): readonly CatRow[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(
    (row): row is CatRow =>
      typeof row === 'object' && row !== null && !Array.isArray(row),
  );
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
