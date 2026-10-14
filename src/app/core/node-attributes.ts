/** Node attributes Elasticsearch sets on its own (`ml.*`, `xpack.*`, …). */
export const INTERNAL_ATTRIBUTE_PREFIXES: readonly string[] = ['ml.', 'xpack.', 'transform.'];

/** Built-in attributes rarely explain anything; views hide them by default. */
export function isInternalAttribute(name: string): boolean {
  return INTERNAL_ATTRIBUTE_PREFIXES.some((prefix) => name.startsWith(prefix));
}
