export interface AliasRecord {
  alias: string;
  index: string;
  filter?: unknown;
  index_routing?: string;
  search_routing?: string;
}

export interface AliasDraft {
  alias: string;
  index: string;
  filterText: string;
  indexRouting: string;
  searchRouting: string;
}

export type AliasChange =
  | { kind: 'add'; alias: AliasRecord }
  | { kind: 'remove'; alias: AliasRecord };

export type AliasAction =
  | { add: AliasRecord }
  | { remove: { alias: string; index: string } };

export function parseAliasFilter(source: string): Record<string, unknown> | undefined {
  if (!source.trim()) {
    return undefined;
  }

  const parsed: unknown = JSON.parse(source);
  if (parsed === null || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error('Alias filter must be a JSON object');
  }
  return parsed as Record<string, unknown>;
}

function cleanOptional(value: string): string | undefined {
  const cleaned = value.trim();
  return cleaned || undefined;
}

export function buildAliasAdd(draft: AliasDraft): { add: AliasRecord } {
  const alias = draft.alias.trim().toLowerCase();
  const index = draft.index.trim().toLowerCase();
  if (!alias) {
    throw new Error('Alias must have a non empty name');
  }
  if (!index) {
    throw new Error('Alias must have a valid index name');
  }

  return {
    add: {
      alias,
      index,
      filter: parseAliasFilter(draft.filterText),
      index_routing: cleanOptional(draft.indexRouting),
      search_routing: cleanOptional(draft.searchRouting),
    },
  };
}

export function buildAliasActions(changes: readonly AliasChange[]): AliasAction[] {
  return changes.map((change) =>
    change.kind === 'add'
      ? { add: change.alias }
      : { remove: { index: change.alias.index, alias: change.alias.alias } },
  );
}
