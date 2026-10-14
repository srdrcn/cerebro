/** Naming rules Elasticsearch enforces, checked before a request is sent. */

/** Characters no index, template, snapshot or repository name may contain. */
export const INVALID_NAME_CHARACTERS: readonly string[] = [
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
