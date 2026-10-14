import { NodeSortField, NodesFilter, NodesNode } from './nodes.models';

export function matchesNode(node: NodesNode, filter: NodesFilter): boolean {
  const matchesName = node.name
    .toLocaleLowerCase()
    .includes(filter.name.toLocaleLowerCase());
  const matchesRole =
    (node.master && filter.master) ||
    (node.data && filter.data) ||
    (node.ingest && filter.ingest) ||
    (node.coordinating && filter.coordinating);
  return matchesName && matchesRole;
}

function sortValue(
  node: NodesNode,
  field: NodeSortField,
): string | number | null {
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

export function formatUptime(milliseconds: number): string {
  const units: readonly (readonly [string, number])[] = [
    ['yr', 31_536_000_000],
    ['mo', 2_678_400_000],
    ['d', 86_400_000],
    ['h', 3_600_000],
    ['min', 60_000],
    ['sec', 1_000],
  ];
  for (const [label, measure] of units) {
    const amount = Math.floor(milliseconds / measure);
    if (amount > 0) {
      return `${amount}${label}`;
    }
  }
  return '0sec';
}

export function formatNodeBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return '0b';
  }
  const units = ['b', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const unit = Math.min(
    Math.floor(Math.log(value) / Math.log(1024)),
    units.length - 1,
  );
  return `${(value / 1024 ** unit).toFixed(2)}${units[unit]}`;
}
