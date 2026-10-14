import { JsonRecord, isRecord, stringList } from '../../core/json';

export interface LegacyTemplate {
  name: string;
  template: Record<string, unknown>;
}

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
  return typeof legacy === 'string' ? [legacy] : stringList(template.template['index_patterns']);
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

export function parseTemplateBody(source: string): JsonRecord {
  const parsed: unknown = JSON.parse(source);
  if (!isRecord(parsed)) {
    throw new Error('Template body must be a JSON object');
  }
  return parsed;
}

export type TemplateBodyState =
  | { readonly ok: true; readonly value: JsonRecord }
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
export function templateBodyWarning(body: JsonRecord): string | null {
  const patterns = body['index_patterns'] ?? body['template'];
  const empty =
    patterns === undefined ||
    (typeof patterns === 'string' && !patterns.trim()) ||
    (Array.isArray(patterns) && patterns.length === 0);
  return empty ? 'Add "index_patterns" so the template matches new indices' : null;
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
