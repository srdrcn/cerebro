export interface IndexMetadata {
  settings?: unknown;
  mappings?: unknown;
}

function asObject(value: unknown): Record<string, unknown> {
  if (value === null || Array.isArray(value) || typeof value !== 'object') {
    throw new Error('Index settings must be a JSON object');
  }
  return value as Record<string, unknown>;
}

export function buildIndexMetadata(
  source: string,
  shards: string,
  replicas: string,
): Record<string, unknown> {
  const parsed = source.trim() ? asObject(JSON.parse(source)) : {};
  if (Object.keys(parsed).length > 0) {
    return parsed;
  }

  const indexSettings: Record<string, unknown> = {};
  if (shards.trim()) indexSettings['number_of_shards'] = shards.trim();
  if (replicas.trim()) indexSettings['number_of_replicas'] = replicas.trim();
  return { settings: { index: indexSettings } };
}

export function cloneableMetadata(metadata: IndexMetadata): Record<string, unknown> {
  return {
    settings: metadata.settings ?? {},
    mappings: metadata.mappings ?? {},
  };
}
