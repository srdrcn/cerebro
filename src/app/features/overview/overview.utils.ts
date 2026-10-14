import { formatBytes, formatCompact, formatNumber, matchesText, pluralize, sentence } from '../../core/format';
import { isInternalAttribute } from '../../core/node-attributes';
import {
  IndexOperation,
  IndexOperationPath,
  OverviewData,
  OverviewIndex,
  OverviewIndexFilter,
  OverviewNode,
  OverviewShard,
  RawOverviewData,
  RawOverviewIndex,
  ShardMapLayout,
  ShardState,
} from './overview.models';

export const UNASSIGNED = 'unassigned';

/** Fills the fields the backend omits for legacy closed indices. */
function normalizeIndex(index: RawOverviewIndex): OverviewIndex {
  return {
    ...index,
    unhealthy: index.unhealthy ?? false,
    doc_count: index.doc_count ?? 0,
    size_in_bytes: index.size_in_bytes ?? 0,
    aliases: index.aliases ?? [],
    num_shards: index.num_shards ?? 0,
    num_replicas: index.num_replicas ?? 0,
    shards: index.shards ?? {},
  };
}

export function normalizeOverview(data: RawOverviewData): OverviewData {
  return {
    ...data,
    indices: (data.indices ?? []).map(normalizeIndex),
    nodes: data.nodes ?? [],
  };
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
  if (!filter.name.trim()) {
    return true;
  }
  return (
    matchesText(index.name, filter.name) ||
    index.aliases.some((alias) => matchesText(alias, filter.name))
  );
}

export function filterOverviewIndices(
  indices: readonly OverviewIndex[],
  filter: OverviewIndexFilter,
): OverviewIndex[] {
  const direction = filter.ascending ? 1 : -1;
  return indices
    .filter((index) => matchesOverviewIndex(index, filter))
    .sort((left, right) => direction * left.name.localeCompare(right.name));
}

/** Builds the legacy comma-separated `{ indices: "a,b,c" }` payload. */
export function indicesPayload(names: readonly string[]): { indices: string } {
  return { indices: names.join(',') };
}

/** Escapes `value` so that it matches literally inside a regular expression. */
export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The smallest change to `filter` that makes the index `name` visible: first
 * the Affected-only / Closed / Special switches are relaxed (keeping the
 * user's text filter), and only if the text filter still hides it is the name
 * filter replaced by an anchored expression. Returns `filter` itself when the
 * index already matches or does not exist.
 */
export function revealIndexFilter(
  indices: readonly OverviewIndex[],
  filter: OverviewIndexFilter,
  name: string,
): OverviewIndexFilter {
  const index = indices.find((candidate) => candidate.name === name);
  if (!index || matchesOverviewIndex(index, filter)) {
    return filter;
  }
  const relaxed: OverviewIndexFilter = {
    ...filter,
    healthy: true,
    closed: filter.closed || index.closed,
    special: filter.special || index.special,
  };
  if (matchesOverviewIndex(index, relaxed)) {
    return relaxed;
  }
  return { ...relaxed, name: `^${escapeRegExp(name)}$` };
}

/** Data nodes matching the name filter (regex or substring), sorted by name. */
export function visibleDataNodes(
  nodes: readonly OverviewNode[],
  name: string,
): OverviewNode[] {
  return nodes
    .filter((node) => node.data && matchesText(node.name, name))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function isSameShard(
  left: OverviewShard | undefined,
  right: OverviewShard,
): boolean {
  return Boolean(
    left &&
      left.index === right.index &&
      left.node === right.node &&
      left.shard === right.shard &&
      left.primary === right.primary,
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

/**
 * Returns the selected shard when it is still started on the same node in
 * the given data (so it can still be relocated), `undefined` otherwise.
 */
export function stillRelocatable(
  data: OverviewData,
  selected: OverviewShard | undefined,
): OverviewShard | undefined {
  if (!selected?.node) {
    return undefined;
  }
  const index = data.indices.find((candidate) => candidate.name === selected.index);
  const match = index?.shards[selected.node]?.find((shard) => isSameShard(selected, shard));
  return match && shardState(match) === 'started' && !index?.closed ? match : undefined;
}

/** Shards of an index on one node (or `unassigned`), primaries first per number. */
export function shardsOn(index: OverviewIndex, nodeId: string): OverviewShard[] {
  return [...(index.shards[nodeId] ?? [])].sort(
    (left, right) =>
      left.shard - right.shard || Number(right.primary) - Number(left.primary),
  );
}

export function shardState(shard: OverviewShard): ShardState {
  switch (shard.state.toUpperCase()) {
    case 'STARTED':
      return 'started';
    case 'INITIALIZING':
      return 'initializing';
    case 'RELOCATING':
      return 'relocating';
    case 'UNASSIGNED':
      return 'unassigned';
    default:
      return 'unknown';
  }
}

/** CSS classes of a shard chip: state, role and selection. */
export function shardChipClass(
  shard: OverviewShard,
  closed: boolean,
  selected = false,
): string {
  const state = closed ? 'closed' : shardState(shard);
  return [
    'shard-chip',
    `is-${state}`,
    shard.primary ? 'is-primary' : 'is-replica',
    selected ? 'is-selected' : '',
  ]
    .filter(Boolean)
    .join(' ');
}

/** Accessible description of a shard: "Shard 1 of logs · primary · relocating to node-3". */
export function describeShard(
  shard: OverviewShard,
  nodeNames: ReadonlyMap<string, string>,
  closed = false,
): string {
  const role = shard.primary ? 'primary' : 'replica';
  const state = closed ? 'closed' : shardState(shard);
  const target =
    state === 'relocating' && shard.relocating_node
      ? ` to ${nodeNames.get(shard.relocating_node) ?? shard.relocating_node}`
      : '';
  return `Shard ${shard.shard} of ${shard.index} · ${role} · ${state}${target}`;
}

/** Heading of a shard menu: "Shard 0 · replica", plus the state unless started. */
export function shardHeading(shard: OverviewShard, closed = false): string {
  const role = shard.primary ? 'primary' : 'replica';
  const actual = shardState(shard);
  // An unassigned copy of a closed index is still unassigned: say so, and
  // mention the closed index rather than hiding the allocation state.
  if (closed && actual === 'unassigned') {
    return `Shard ${shard.shard} · ${role} · unassigned (closed index)`;
  }
  const state = closed ? 'closed' : actual;
  return state === 'started' ? `Shard ${shard.shard} · ${role}` : `Shard ${shard.shard} · ${role} · ${state}`;
}

/**
 * Query parameters of `/allocation` explaining one shard copy. A primary is
 * unique, so it needs no node; an assigned replica names its node so the
 * explanation is about that copy; an unassigned copy leaves the node out so
 * Elasticsearch explains (one of) the unassigned copies of the shard.
 */
export function allocationExplainParams(shard: OverviewShard): Record<string, string> {
  const params: Record<string, string> = {
    index: shard.index,
    shard: String(shard.shard),
    primary: String(shard.primary),
  };
  if (!shard.primary && shard.node && shardState(shard) !== 'unassigned') {
    params['node'] = shard.node;
  }
  return params;
}

export interface ShardCounts {
  readonly unassigned: number;
  readonly relocating: number;
  readonly initializing: number;
}

export function hasShardActivity(counts: ShardCounts): boolean {
  return counts.unassigned > 0 || counts.relocating > 0 || counts.initializing > 0;
}

/** "3 unassigned · 1 relocating shards": the non-zero counts, one shared noun. */
export function shardActivityLabel(counts: ShardCounts): string {
  const parts: [number, string][] = [
    [counts.unassigned, 'unassigned'],
    [counts.relocating, 'relocating'],
    [counts.initializing, 'initializing'],
  ];
  const total = counts.unassigned + counts.relocating + counts.initializing;
  const label = parts
    .filter(([count]) => count > 0)
    .map(([count, state]) => `${formatNumber(count)} ${state}`)
    .join(' · ');
  return `${label} ${total === 1 ? 'shard' : 'shards'}`;
}

/** Below this width the grid switches to its compact phone geometry. */
const NARROW_WIDTH = 600;

/**
 * Splits the grid width into a node column and as many index columns of at
 * least the minimum width as fit. When not even one column fits the map
 * scrolls horizontally.
 */
export function shardMapLayout(width: number): ShardMapLayout {
  const usable = Math.max(0, Math.floor(width));
  const narrow = usable < NARROW_WIDTH;
  const nodeColumn = narrow ? 136 : usable < 960 ? 220 : 248;
  const minColumn = narrow ? 156 : 210;
  const available = usable - nodeColumn;
  if (available < minColumn) {
    return { nodeColumn, columns: 1, columnWidth: minColumn, scroll: true };
  }
  const columns = Math.max(1, Math.floor(available / minColumn));
  return {
    nodeColumn,
    columns,
    columnWidth: Math.floor(available / columns),
    scroll: false,
  };
}

/** 1-based page that contains `name`, or `undefined` when it is filtered out. */
export function pageOfIndex(
  indices: readonly OverviewIndex[],
  name: string,
  pageSize: number,
): number | undefined {
  const position = indices.findIndex((index) => index.name === name);
  return position < 0 ? undefined : Math.floor(position / Math.max(1, pageSize)) + 1;
}

/** "3 × 2 shards · 8.5k docs · 1.3 MB" (closed: "3 × 2 shards"). */
export function indexSummary(index: OverviewIndex): string {
  const layout = `${index.num_shards} × ${index.num_replicas + 1} shards`;
  if (index.closed) {
    return layout;
  }
  return `${layout} · ${formatCompact(index.doc_count)} docs · ${formatBytes(index.size_in_bytes)}`;
}

/** Index stat meta: a short breakdown for the tile and the full one for its title. */
export function indexBreakdown(
  total: number,
  closed: number,
  special: number,
): { short: string; full: string } {
  const parts = [closed > 0 ? `${closed} closed` : '', special > 0 ? `${special} special` : ''].filter(Boolean);
  return {
    short: parts.length > 0 ? parts.join(' · ') : 'all open',
    full: `${total - closed} open · ${closed} closed · ${special} special`,
  };
}

/** Load average relative to the number of processors, as a percentage. */
export function loadPercent(node: OverviewNode): number {
  return node.available_processors > 0
    ? Math.round((node.load_average / node.available_processors) * 100)
    : 0;
}

/** Non built-in node attributes (ml.*, xpack.*, transform.* are hidden). */
export function nodeAttributes(
  attributes: Readonly<Record<string, unknown>>,
): readonly (readonly [string, string])[] {
  return Object.entries(attributes)
    .filter(([name]) => !isInternalAttribute(name))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => [name, String(value)] as const);
}

export interface NodeRole {
  readonly key: 'master' | 'data' | 'ingest' | 'coordinating';
  readonly icon: string;
  readonly title: string;
}

/** Role icons of a node row, elected master first. */
export function nodeRoleIcons(node: OverviewNode): NodeRole[] {
  const roles: NodeRole[] = [];
  if (node.master) {
    roles.push({
      key: 'master',
      icon: node.current_master ? 'bi-star-fill' : 'bi-star',
      title: node.current_master ? 'Elected master' : 'Master eligible',
    });
  }
  if (node.data) {
    roles.push({ key: 'data', icon: 'bi-hdd', title: 'Data node' });
  }
  if (node.ingest) {
    roles.push({ key: 'ingest', icon: 'bi-funnel', title: 'Ingest node' });
  }
  if (node.coordinating) {
    roles.push({ key: 'coordinating', icon: 'bi-signpost-split', title: 'Coordinating only' });
  }
  return roles;
}

export type HealthTone = 'green' | 'yellow' | 'red' | 'gray';

/** Cluster health in sentence case ("Yellow"), like every other displayed value. */
export function healthLabel(status: string | null | undefined): string {
  return sentence((status ?? '').toLowerCase()) || 'Unknown';
}

export function healthTone(status: string | null | undefined): HealthTone {
  switch ((status ?? '').toLowerCase()) {
    case 'green':
      return 'green';
    case 'yellow':
      return 'yellow';
    case 'red':
      return 'red';
    default:
      return 'gray';
  }
}

/** Percentage of all shard copies that are active (started or relocating). */
export function activeShardPercent(data: OverviewData): number {
  const total =
    data.active_shards + data.initializing_shards + data.unassigned_shards;
  return total === 0 ? 100 : Math.floor((data.active_shards / total) * 1000) / 10;
}

/** Sum of primary store sizes of the open indices. */
export function primaryStoreSize(indices: readonly OverviewIndex[]): number {
  return indices.reduce((sum, index) => sum + (index.closed ? 0 : index.size_in_bytes), 0);
}

/**
 * Which index chips must be switched on so that `name` (for example from the
 * `?filter=` link of the command palette) is visible.
 */
export function revealFlags(
  indices: readonly OverviewIndex[],
  name: string,
): { closed: boolean; special: boolean } {
  const index = indices.find((candidate) => candidate.name === name.trim());
  return { closed: Boolean(index?.closed), special: Boolean(index?.special) };
}

export interface OperationConfirmation {
  readonly title: string;
  readonly message?: string;
  readonly items?: readonly string[];
  readonly confirmLabel: string;
  readonly tone: 'default' | 'warning' | 'danger';
}

export interface OperationDefinition {
  readonly path: IndexOperationPath;
  /** Verb used in menus and toasts ("Force merge"). */
  readonly label: string;
  readonly icon: string;
  /** Past participle for success messages ("force merged"). */
  readonly done: string;
  readonly tone: 'default' | 'warning' | 'danger';
  readonly message: string;
  /** Single index operations that are cheap and safe run without asking. */
  readonly confirmSingle: boolean;
}

export const OPERATIONS: Readonly<Record<IndexOperation, OperationDefinition>> = {
  open: {
    path: 'overview/open_indices',
    label: 'Open',
    icon: 'bi-unlock',
    done: 'opened',
    tone: 'default',
    message: 'Reads and writes resume once the shards are allocated again.',
    confirmSingle: true,
  },
  close: {
    path: 'overview/close_indices',
    label: 'Close',
    icon: 'bi-lock',
    done: 'closed',
    tone: 'danger',
    message: 'Closing blocks every read and write until it is opened again.',
    confirmSingle: true,
  },
  merge: {
    path: 'overview/force_merge',
    label: 'Force merge',
    icon: 'bi-intersect',
    done: 'force merged',
    tone: 'warning',
    message: 'Force merging is I/O intensive and can take a long time on large indices.',
    confirmSingle: true,
  },
  refresh: {
    path: 'overview/refresh_indices',
    label: 'Refresh',
    icon: 'bi-arrow-repeat',
    done: 'refreshed',
    tone: 'default',
    message: 'Makes every recent write visible to search.',
    confirmSingle: false,
  },
  flush: {
    path: 'overview/flush_indices',
    label: 'Flush',
    icon: 'bi-save',
    done: 'flushed',
    tone: 'default',
    message: 'Commits the transaction log to the Lucene index on disk.',
    confirmSingle: false,
  },
  cache: {
    path: 'overview/clear_indices_cache',
    label: 'Clear cache',
    icon: 'bi-eraser',
    done: 'cache cleared',
    tone: 'default',
    message: 'Clears the query, request and field data caches.',
    confirmSingle: false,
  },
  delete: {
    path: 'overview/delete_indices',
    label: 'Delete',
    icon: 'bi-trash3',
    done: 'deleted',
    tone: 'danger',
    message: 'Every document is removed permanently. This cannot be undone.',
    confirmSingle: true,
  },
};

/** "1 index", "3 indices", or with an adjective: "2 closed indices". */
function indexCount(count: number, adjective = ''): string {
  const prefix = adjective ? `${adjective} ` : '';
  return pluralize(count, `${prefix}index`, `${prefix}indices`);
}

/** Operations Elasticsearch rejects on closed indices (`index_closed_exception`). */
const OPEN_INDEX_OPERATIONS: ReadonlySet<IndexOperation> = new Set<IndexOperation>([
  'merge',
  'refresh',
  'flush',
  'cache',
]);

export function requiresOpenIndex(operation: IndexOperation): boolean {
  return OPEN_INDEX_OPERATIONS.has(operation);
}

export interface OperationTargets {
  /** Indices the operation is sent to. */
  readonly names: string[];
  /** Closed indices left out because the operation would fail on them. */
  readonly skipped: number;
}

/**
 * Indices `operation` can act on. A single closed index makes a whole merge,
 * refresh, flush or cache request fail, so closed indices are left out of
 * those; open, close and delete keep every index.
 */
export function operationTargets(
  operation: IndexOperation,
  indices: readonly OverviewIndex[],
): OperationTargets {
  const openOnly = requiresOpenIndex(operation);
  const names = indices.filter((index) => !(openOnly && index.closed)).map((index) => index.name);
  return { names, skipped: indices.length - names.length };
}

/** Confirmation dialog for running `operation` on `names` (`skipped` closed indices left out). */
export function operationConfirmation(
  operation: IndexOperation,
  names: readonly string[],
  skipped = 0,
): OperationConfirmation {
  const definition = OPERATIONS[operation];
  const count = names.length;
  const single = count === 1;
  const target = single ? `index ${names[0]}` : indexCount(count);
  const verb = operation === 'cache' ? 'Clear the cache of' : definition.label;
  const confirmLabel =
    operation === 'cache'
      ? single
        ? 'Clear cache'
        : `Clear ${count} caches`
      : single
        ? `${definition.label} index`
        : `${definition.label} ${indexCount(count)}`;
  const skippedNote =
    skipped > 0 ? ` ${indexCount(skipped, 'closed')} ${skipped === 1 ? 'is' : 'are'} skipped.` : '';
  return {
    title: `${verb} ${target}?`,
    message: definition.message + skippedNote,
    ...(single ? {} : { items: names }),
    confirmLabel,
    tone: definition.tone,
  };
}

/** "Index products closed" / "3 indices refreshed, 1 closed index skipped". */
export function operationSuccess(
  operation: IndexOperation,
  names: readonly string[],
  skipped = 0,
): string {
  const definition = OPERATIONS[operation];
  const subject = names.length === 1 ? `Index ${names[0]}` : indexCount(names.length);
  const skippedNote = skipped > 0 ? `, ${indexCount(skipped, 'closed')} skipped` : '';
  return `${subject} ${definition.done}${skippedNote}`;
}

/** "Could not close index products" / "Could not clear the cache of 3 indices". */
export function operationFailure(operation: IndexOperation, names: readonly string[]): string {
  const verb = operation === 'cache' ? 'clear the cache of' : OPERATIONS[operation].label.toLowerCase();
  const target = names.length === 1 ? `index ${names[0]}` : indexCount(names.length);
  return `Could not ${verb} ${target}`;
}
