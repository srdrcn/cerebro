/** Helpers for the untyped JSON Elasticsearch returns. */

export type JsonRecord = Record<string, unknown>;

/** A plain JSON object (not `null`, not an array). */
export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The string items of a list. Elasticsearch accepts a single string wherever
 * it accepts a list (`index_patterns`, `aliases`), so a non-empty string
 * becomes a one-item list.
 */
export function stringList(value: unknown): string[] {
  if (typeof value === 'string') {
    return value ? [value] : [];
  }
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}
