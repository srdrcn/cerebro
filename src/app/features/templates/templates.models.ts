export interface LegacyTemplate {
  name: string;
  template: Record<string, unknown>;
}

export const LEGACY_TEMPLATE_BASE = JSON.stringify({
  template: 'template pattern(e.g.: index_name_*)',
  settings: {},
  mappings: {},
  aliases: {},
}, null, 2);

export function templatePattern(template: LegacyTemplate): string {
  const pattern = template.template['template'];
  if (typeof pattern === 'string') return pattern;
  const patterns = template.template['index_patterns'];
  return Array.isArray(patterns) ? patterns.filter((item): item is string => typeof item === 'string').join(', ') : '';
}

export function filterLegacyTemplates(
  templates: readonly LegacyTemplate[],
  nameFilter: string,
  patternFilter: string,
): LegacyTemplate[] {
  return [...templates]
    .filter((item) => item.name.includes(nameFilter) && templatePattern(item).includes(patternFilter))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function parseTemplateBody(source: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(source);
  if (parsed === null || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error('Template body must be a JSON object');
  }
  return parsed as Record<string, unknown>;
}
