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

/** A finite number from a number or a non-blank numeric string (`_cat` returns strings), else `null`. */
export function toNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** A string as it is; anything else as indented JSON (or `String(value)` when it cannot be serialised). */
export function stringifyForDisplay(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}
