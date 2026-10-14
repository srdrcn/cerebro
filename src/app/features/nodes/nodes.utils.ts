import { textMatcher } from '../../core/format';
import { isInternalAttribute } from '../../core/node-attributes';
import { NodeSortField, NodesFilter, NodesNode } from './nodes.models';

/** Does `node` pass the name filter (regex or substring) and the role filter? */
export function matchesNode(
  node: NodesNode,
  filter: NodesFilter,
  matchesName: (value: string) => boolean = textMatcher(filter.name),
): boolean {
  const matchesRole =
    (node.master && filter.master) ||
    (node.data && filter.data) ||
    (node.ingest && filter.ingest) ||
    (node.coordinating && filter.coordinating);
  return matchesName(node.name) && !!matchesRole;
}

/** The nodes that pass `filter`, compiling the name filter once. */
export function filterNodes(nodes: readonly NodesNode[], filter: NodesFilter): NodesNode[] {
  const matchesName = textMatcher(filter.name);
  return nodes.filter((node) => matchesNode(node, filter, matchesName));
}

function sortValue(node: NodesNode, field: NodeSortField): string | number | null {
  switch (field) {
    case 'name':
      return node.name;
    case 'cpu.load':
      return node.cpu.load;
    case 'cpu.process':
      return node.cpu.process;
    case 'heap.percent':
      return node.heap.percent;
    case 'disk.percent':
      return node.disk?.percent ?? null;
    case 'uptime':
      return node.uptime;
  }
}

/** Stable sort; missing values always go last, ties fall back to the name. */
export function sortNodes(
  nodes: readonly NodesNode[],
  field: NodeSortField,
  reverse: boolean,
): NodesNode[] {
  const direction = reverse ? -1 : 1;
  return [...nodes].sort((left, right) => {
    const leftValue = sortValue(left, field);
    const rightValue = sortValue(right, field);
    if (leftValue === rightValue) {
      return left.name.localeCompare(right.name);
    }
    if (leftValue === null) {
      return 1;
    }
    if (rightValue === null) {
      return -1;
    }
    if (typeof leftValue === 'string' && typeof rightValue === 'string') {
      return direction * leftValue.localeCompare(rightValue);
    }
    return direction * (Number(leftValue) - Number(rightValue));
  });
}

/** Built-in attributes (`ml.*`, `xpack.*`, …) are hidden unless asked for. */
export function attributeEntries(
  attributes: Readonly<Record<string, unknown>>,
  includeInternal = false,
): readonly (readonly [string, string])[] {
  return Object.entries(attributes)
    .filter(([name]) => includeInternal || !isInternalAttribute(name))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => [name, String(value)] as const);
}

export interface NodeRoleBadge {
  readonly key: 'master' | 'data' | 'ingest' | 'coordinating';
  readonly label: string;
  readonly title: string;
}

export function nodeRoles(node: NodesNode): readonly NodeRoleBadge[] {
  const roles: NodeRoleBadge[] = [];
  if (node.master) {
    roles.push({
      key: 'master',
      label: node.current_master ? 'master ★' : 'master',
      title: node.current_master ? 'Elected master' : 'Master-eligible',
    });
  }
  if (node.data) {
    roles.push({ key: 'data', label: 'data', title: 'Data node' });
  }
  if (node.ingest) {
    roles.push({ key: 'ingest', label: 'ingest', title: 'Ingest node' });
  }
  if (node.coordinating) {
    roles.push({ key: 'coordinating', label: 'coordinating', title: 'Coordinating only' });
  }
  return roles;
}

function average(values: readonly number[]): number | null {
  return values.length === 0
    ? null
    : values.reduce((sum, value) => sum + value, 0) / values.length;
}

export interface NodesSummary {
  readonly total: number;
  readonly master?: string;
  readonly versions: readonly string[];
  readonly averageHeap: number | null;
  readonly averageCpu: number | null;
  readonly diskUsed: number;
  readonly diskTotal: number;
}

export function summarizeNodes(nodes: readonly NodesNode[]): NodesSummary {
  const disks = nodes.flatMap((node) => (node.disk ? [node.disk] : []));
  const diskTotal = disks.reduce((sum, disk) => sum + disk.total, 0);
  const diskUsed = disks.reduce((sum, disk) => sum + (disk.total - disk.available), 0);
  const master = nodes.find((node) => node.current_master)?.name;
  return {
    total: nodes.length,
    ...(master ? { master } : {}),
    versions: [...new Set(nodes.map((node) => node.version))].sort(),
    averageHeap: average(nodes.map((node) => node.heap.percent)),
    averageCpu: average(
      nodes.flatMap((node) => (node.cpu.process === null ? [] : [node.cpu.process])),
    ),
    diskUsed,
    diskTotal,
  };
}

/** Elasticsearch byte strings such as "274mb" → "274 MB". */
export function prettyByteString(value: string | null | undefined): string {
  if (!value) {
    return '–';
  }
  const match = /^([\d.]+)\s*([kmgtp]?b)$/i.exec(value.trim());
  if (!match) {
    return value;
  }
  return `${match[1]} ${(match[2] ?? '').toUpperCase()}`;
}
