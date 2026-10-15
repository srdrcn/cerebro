/** Naming rules Elasticsearch enforces, checked before a request is sent. */

/** Characters no index, template, snapshot or repository name may contain. */
const INVALID_NAME_CHARACTERS: readonly string[] = [
  '\\',
  '/',
  '*',
  '?',
  '"',
  '<',
  '>',
  '|',
  ',',
  '#',
];

/** Index names additionally reject ":" (it separates remote clusters). */
export const INVALID_INDEX_NAME_CHARACTERS: readonly string[] = [...INVALID_NAME_CHARACTERS, ':'];

/** The invalid characters `name` contains, in the order of `characters`. */
export function invalidCharacters(
  name: string,
  characters: readonly string[] = INVALID_NAME_CHARACTERS,
): string[] {
  return characters.filter((character) => name.includes(character));
}

/**
 * The rules shared by template and snapshot names: not empty, no whitespace,
 * lowercase, no leading "_" and none of the invalid characters. Returns an
 * error message ("Template names must be lowercase") or `null`.
 */
export function validateResourceName(name: string, noun: string): string | null {
  const plural = `${noun.charAt(0).toUpperCase()}${noun.slice(1)} names`;
  if (!name) {
    return `Enter a name for the ${noun}`;
  }
  if (/\s/.test(name)) {
    return `${plural} cannot contain spaces`;
  }
  if (name !== name.toLowerCase()) {
    return `${plural} must be lowercase`;
  }
  if (name.startsWith('_')) {
    return `${plural} cannot start with "_"`;
  }
  const invalid = invalidCharacters(name);
  if (invalid.length > 0) {
    return `${plural} cannot contain ${invalid.map((character) => `"${character}"`).join(', ')}`;
  }
  return null;
}

/** Elasticsearch's limit of index name length in bytes. */
const MAX_INDEX_NAME_BYTES = 255;

function utf8Length(value: string): number {
  return new TextEncoder().encode(value).length;
}

/**
 * The format rules Elasticsearch enforces on index names (not whether the
 * name is taken). Returns an error message or `null`.
 */
export function indexNameFormatError(name: string): string | null {
  if (!name) {
    return 'Enter a name for the index';
  }
  if (name !== name.toLowerCase()) {
    return 'Index names must be lowercase';
  }
  if (/\s/.test(name)) {
    return 'Index names cannot contain spaces';
  }
  if (name === '.' || name === '..') {
    return 'Index names cannot be "." or ".."';
  }
  const first = name.charAt(0);
  if (first === '-' || first === '_' || first === '+') {
    return `Index names cannot start with "${first}"`;
  }
  const invalid = invalidCharacters(name, INVALID_INDEX_NAME_CHARACTERS);
  if (invalid.length > 0) {
    return `Index names cannot contain ${invalid.map((character) => `"${character}"`).join(', ')}`;
  }
  const bytes = utf8Length(name);
  return bytes > MAX_INDEX_NAME_BYTES ? `Index names are limited to ${MAX_INDEX_NAME_BYTES} bytes (this one has ${bytes})` : null;
}
