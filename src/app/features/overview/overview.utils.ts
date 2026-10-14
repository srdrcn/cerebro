import {
  OverviewIndex,
  OverviewIndexFilter,
  OverviewNode,
  OverviewNodeFilter,
  OverviewShard,
} from './overview.models';

function textMatches(value: string, expression: string): boolean {
  try {
    return new RegExp(expression.trim(), 'i').test(value);
  } catch {
    return value.toLocaleLowerCase().includes(expression.toLocaleLowerCase());
  }
}

export function matchesOverviewIndex(
  index: OverviewIndex,
  filter: OverviewIndexFilter,
): boolean {
  if ((!filter.special && index.special) || (!filter.closed && index.closed)) {
    return false;
  }
  // The legacy `healthy` flag means "include healthy", rather than
  // "match healthy". Turning it off intentionally shows affected indices only.
  if (!filter.healthy && !index.unhealthy) {
    return false;
  }
  if (!filter.name) {
    return true;
  }
  return (
    textMatches(index.name, filter.name) ||
    index.aliases.some((alias) => textMatches(alias, filter.name))
  );
}

export function filterOverviewIndices(
  indices: readonly OverviewIndex[],
  filter: OverviewIndexFilter,
): OverviewIndex[] {
  const direction = filter.ascending ? 1 : -1;
  return indices
    .filter((index) => matchesOverviewIndex(index, filter))
    .sort((left, right) =>
      direction * left.name.localeCompare(right.name),
    );
}

/** Builds the legacy comma-separated payload from the entire filtered result. */
export function buildBulkIndicesPayload(
  indices: readonly OverviewIndex[],
  filter: OverviewIndexFilter,
): { indices: string } {
  return {
    indices: filterOverviewIndices(indices, filter)
      .map((index) => index.name)
      .join(','),
  };
}

export function matchesOverviewNode(
  node: OverviewNode,
  filter: OverviewNodeFilter,
): boolean {
  const matchesName = node.name
    .toLocaleLowerCase()
    .includes(filter.name.toLocaleLowerCase());
  const matchesRole =
    (node.data && filter.data) ||
    (node.master && filter.master) ||
    (node.ingest && filter.ingest) ||
    (node.coordinating && filter.coordinating);
  return matchesName && matchesRole;
}

export function isSameShard(
  left: OverviewShard | undefined,
  right: OverviewShard,
): boolean {
  return Boolean(
    left &&
      left.index === right.index &&
      left.node === right.node &&
      left.shard === right.shard,
  );
}

export function canReceiveShard(
  selected: OverviewShard | undefined,
  index: OverviewIndex,
  targetNodeId: string,
): boolean {
  if (
    !selected ||
    selected.index !== index.name ||
    selected.node === targetNodeId
  ) {
    return false;
  }
  return !(index.shards[targetNodeId] ?? []).some(
    (shard) => shard.shard === selected.shard,
  );
}

export function formatBytes(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '-';
  }
  if (value === 0) {
    return '0 B';
  }
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const unit = Math.min(
    Math.floor(Math.log(Math.abs(value)) / Math.log(1024)),
    units.length - 1,
  );
  const amount = value / 1024 ** unit;
  return `${amount.toLocaleString(undefined, {
    maximumFractionDigits: unit === 0 ? 0 : 1,
  })} ${units[unit]}`;
}
