export interface LegacyTemplate {
  name: string;
  template: Record<string, unknown>;
}

/**
 * Original Cerebro starting point (Elasticsearch 5 `template` key).
 * Not used by the page any more (see NEW_TEMPLATE_BODY); kept for compatibility.
 */
export const LEGACY_TEMPLATE_BASE = JSON.stringify({
  template: 'template pattern(e.g.: index_name_*)',
  settings: {},
  mappings: {},
  aliases: {},
}, null, 2);

/** Starting point for a new template on Elasticsearch 6 and later. */
export const NEW_TEMPLATE_BODY = JSON.stringify(
  {
    index_patterns: ['my-index-*'],
    order: 0,
    settings: {
      number_of_shards: 1,
    },
    mappings: {
      properties: {},
    },
    aliases: {},
  },
  null,
  2,
);

/** Index patterns of a template (`index_patterns` or the legacy `template` key). */
export function templatePatterns(template: LegacyTemplate): string[] {
  const legacy = template.template['template'];
  if (typeof legacy === 'string') return [legacy];
  const patterns = template.template['index_patterns'];
  if (typeof patterns === 'string') return [patterns];
  return Array.isArray(patterns) ? patterns.filter((item): item is string => typeof item === 'string') : [];
}

export function templatePattern(template: LegacyTemplate): string {
  return templatePatterns(template).join(', ');
}

export function templateOrder(template: LegacyTemplate): number | null {
  const order = template.template['order'];
  return typeof order === 'number' && Number.isFinite(order) ? order : null;
}

export function templateVersion(template: LegacyTemplate): number | null {
  const version = template.template['version'];
  return typeof version === 'number' && Number.isFinite(version) ? version : null;
}

/**
 * Separate name and pattern filters of the original page. The page now uses
 * searchLegacyTemplates; kept for compatibility.
 */
export function filterLegacyTemplates(
  templates: readonly LegacyTemplate[],
  nameFilter: string,
  patternFilter: string,
): LegacyTemplate[] {
  return [...templates]
    .filter((item) => item.name.includes(nameFilter) && templatePattern(item).includes(patternFilter))
    .sort((left, right) => left.name.localeCompare(right.name));
}

/** Case-insensitive search over the name and the index patterns, sorted by name. */
export function searchLegacyTemplates(
  templates: readonly LegacyTemplate[],
  query: string,
): LegacyTemplate[] {
  const needle = query.trim().toLocaleLowerCase();
  return [...templates]
    .filter(
      (item) =>
        !needle ||
        item.name.toLocaleLowerCase().includes(needle) ||
        templatePatterns(item).some((pattern) => pattern.toLocaleLowerCase().includes(needle)),
    )
    .sort((left, right) => left.name.localeCompare(right.name));
}

/**
 * Adds a template to a loaded list, replacing any template with the same
 * name. An unloaded list (undefined) stays unloaded.
 */
export function upsertTemplate(
  templates: readonly LegacyTemplate[] | undefined,
  template: LegacyTemplate,
): readonly LegacyTemplate[] | undefined {
  if (templates === undefined) {
    return undefined;
  }
  return [...templates.filter((item) => item.name !== template.name), template];
}

export function parseTemplateBody(source: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(source);
  if (parsed === null || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error('Template body must be a JSON object');
  }
  return parsed as Record<string, unknown>;
}

export type TemplateBodyState =
  | { readonly ok: true; readonly value: Record<string, unknown> }
  | { readonly ok: false; readonly message: string };

/** Parses the editor content without throwing. */
export function analyzeTemplateBody(source: string): TemplateBodyState {
  if (!source.trim()) {
    return { ok: false, message: 'Template body is required' };
  }
  try {
    return { ok: true, value: parseTemplateBody(source) };
  } catch (error: unknown) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

/** Non-blocking advice about a parsed template body. */
export function templateBodyWarning(body: Record<string, unknown>): string | null {
  const patterns = body['index_patterns'] ?? body['template'];
  const empty =
    patterns === undefined ||
    (typeof patterns === 'string' && !patterns.trim()) ||
    (Array.isArray(patterns) && patterns.length === 0);
  return empty ? 'Add "index_patterns" so the template matches new indices' : null;
}

const INVALID_TEMPLATE_NAME_CHARACTERS = ['\\', '/', '*', '?', '"', '<', '>', '|', ',', '#'];

/** Mirrors the legacy template name rules enforced by Elasticsearch. */
export function validateTemplateName(name: string): string | null {
  if (!name) {
    return 'Enter a name for the template';
  }
  if (/\s/.test(name)) {
    return 'Template names cannot contain spaces';
  }
  if (name !== name.toLowerCase()) {
    return 'Template names must be lowercase';
  }
  if (name.startsWith('_')) {
    return 'Template names cannot start with "_"';
  }
  const invalid = INVALID_TEMPLATE_NAME_CHARACTERS.filter((character) => name.includes(character));
  if (invalid.length > 0) {
    return `Template names cannot contain ${invalid.map((character) => `"${character}"`).join(', ')}`;
  }
  return null;
}

/** Pretty JSON used as the editor content of a stored template. */
export function templateSource(template: LegacyTemplate): string {
  return JSON.stringify(template.template, null, 2);
}

export type SaveMode = 'create' | 'update' | 'overwrite' | 'copy';

/**
 * What saving does: create a new template, update the one being edited,
 * overwrite another existing template with the typed name, or create a copy
 * of the edited template under a new name.
 */
export function saveMode(
  name: string,
  selected: string | null,
  existing: readonly string[],
): SaveMode {
  if (selected !== null && name === selected) {
    return 'update';
  }
  if (existing.includes(name)) {
    return 'overwrite';
  }
  return selected === null ? 'create' : 'copy';
}
