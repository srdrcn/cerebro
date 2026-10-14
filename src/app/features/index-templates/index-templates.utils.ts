import { pluralize, textMatcher } from '../../core/format';
import { JsonRecord, isRecord, stringList } from '../../core/json';
import { isManagedTemplate } from '../../core/templates';
import {
  AliasEntry,
  BodyCheck,
  BodyProblem,
  ComponentTemplateBody,
  ComponentTemplateEntry,
  IndexTemplateBody,
  IndexTemplateEntry,
  MappingField,
  Origin,
  ResolvedAlias,
  ResolvedField,
  ResolvedSetting,
  ResolvedView,
  SettingEntry,
  SimulateResponse,
  TemplateContent,
  TemplateKind,
  TemplateRow,
} from './index-templates.models';

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/* ------------------------------------------------------------------ */
/* Template facts                                                      */
/* ------------------------------------------------------------------ */

export function indexPatterns(body: IndexTemplateBody | undefined): string[] {
  return stringList(body?.index_patterns);
}

export function composedOf(body: IndexTemplateBody | undefined): string[] {
  return stringList(body?.composed_of);
}

/** Components the template may reference before they exist. */
export function ignoredComponents(body: IndexTemplateBody | undefined): string[] {
  return stringList(body?.ignore_missing_component_templates);
}

export function templatePriority(body: IndexTemplateBody | undefined): number | null {
  return finiteNumber(body?.priority);
}

export function templateVersion(body: IndexTemplateBody | ComponentTemplateBody | undefined): number | null {
  return finiteNumber(body?.version);
}

export function isDataStreamTemplate(body: IndexTemplateBody | undefined): boolean {
  return isRecord(body?.data_stream);
}

export function metaDescription(meta: unknown): string | null {
  if (!isRecord(meta)) {
    return null;
  }
  const description = meta['description'];
  return typeof description === 'string' && description.trim() ? description.trim() : null;
}

/** `_meta` entries other than the description, rendered as small tags. */
export function metaTags(meta: unknown): SettingEntry[] {
  if (!isRecord(meta)) {
    return [];
  }
  return Object.entries(meta)
    .filter(([key]) => key !== 'description')
    .map(([key, value]) => ({ key, value: displayValue(value) }))
    .sort((left, right) => left.key.localeCompare(right.key));
}

/** Index template names that reference each component template. */
export function componentUsage(templates: readonly IndexTemplateEntry[]): Map<string, string[]> {
  const usage = new Map<string, string[]>();
  for (const template of templates) {
    for (const component of composedOf(template.index_template)) {
      const users = usage.get(component) ?? [];
      if (!users.includes(template.name)) {
        users.push(template.name);
      }
      usage.set(component, users);
    }
  }
  for (const users of usage.values()) {
    users.sort((left, right) => left.localeCompare(right));
  }
  return usage;
}

/** "settings · mappings (4 fields) · 1 alias" — what a template block defines. */
export function describeContent(content: TemplateContent | undefined): string {
  if (!isRecord(content)) {
    return 'Empty';
  }
  const parts: string[] = [];
  const settings = flattenSettings(content.settings);
  if (settings.length > 0) {
    parts.push(pluralize(settings.length, 'setting'));
  }
  if (isRecord(content.mappings)) {
    const fields = mappingFields(content.mappings).filter((field) => !field.multi);
    parts.push(fields.length > 0 ? `mappings (${pluralize(fields.length, 'field')})` : 'mappings');
  }
  const aliases = isRecord(content.aliases) ? Object.keys(content.aliases).length : 0;
  if (aliases > 0) {
    parts.push(pluralize(aliases, 'alias', 'aliases'));
  }
  if (isRecord(content.lifecycle)) {
    parts.push('lifecycle');
  }
  return parts.length > 0 ? parts.join(' · ') : 'Empty';
}

export function indexTemplateRow(entry: IndexTemplateEntry): TemplateRow {
  const body = entry.index_template;
  return {
    kind: 'index',
    name: entry.name,
    managed: isManagedTemplate(entry.name, body?._meta),
    patterns: indexPatterns(body),
    priority: templatePriority(body),
    version: templateVersion(body),
    dataStream: isDataStreamTemplate(body),
    composedOf: composedOf(body),
    usedBy: [],
    contents: describeContent(body?.template),
    description: metaDescription(body?._meta),
  };
}

export function componentTemplateRow(
  entry: ComponentTemplateEntry,
  usage: ReadonlyMap<string, readonly string[]>,
): TemplateRow {
  const body = entry.component_template;
  return {
    kind: 'component',
    name: entry.name,
    managed: isManagedTemplate(entry.name, body?._meta),
    patterns: [],
    priority: null,
    version: templateVersion(body),
    dataStream: false,
    composedOf: [],
    usedBy: usage.get(entry.name) ?? [],
    contents: describeContent(body?.template),
    description: metaDescription(body?._meta),
  };
}

/**
 * Search over name, patterns, component names and the description, with the
 * regex-or-substring semantics of the other filters (`textMatcher`). Managed
 * templates are left out unless asked for. Sorted by name with user
 * templates first.
 */
export function filterRows(
  rows: readonly TemplateRow[],
  query: string,
  showManaged: boolean,
): TemplateRow[] {
  const matches = textMatcher(query);
  return rows
    .filter((row) => showManaged || !row.managed)
    .filter(
      (row) =>
        !query.trim() ||
        matches(row.name) ||
        row.patterns.some(matches) ||
        row.composedOf.some(matches) ||
        (row.description !== null && matches(row.description)),
    )
    .sort(
      (left, right) =>
        Number(left.managed) - Number(right.managed) || left.name.localeCompare(right.name),
    );
}

/** Endpoints an Elasticsearch before 7.8 reads as invalid index names. */
export const COMPOSABLE_TEMPLATE_ENDPOINTS = ['_index_template', '_component_template'] as const;

/* ------------------------------------------------------------------ */
/* Editor                                                              */
/* ------------------------------------------------------------------ */

export function templateSource(body: unknown): string {
  return JSON.stringify(body ?? {}, null, 2);
}

const INDEX_TEMPLATE_KEYS = new Set([
  'index_patterns',
  'template',
  'composed_of',
  'priority',
  'version',
  '_meta',
  'data_stream',
  'allow_auto_create',
  'ignore_missing_component_templates',
  'deprecated',
]);

const COMPONENT_TEMPLATE_KEYS = new Set(['template', 'version', '_meta', 'deprecated']);

const CONTENT_KEYS = new Set(['settings', 'mappings', 'aliases', 'lifecycle', 'data_stream_options']);

const MISPLACED_KEYS = ['settings', 'mappings', 'aliases'];

function checkContent(body: JsonRecord, problems: BodyProblem[]): void {
  for (const key of MISPLACED_KEYS) {
    if (key in body) {
      problems.push({ level: 'error', message: `Move "${key}" inside "template": { … }` });
    }
  }
  const content = body['template'];
  if (content === undefined) {
    return;
  }
  if (!isRecord(content)) {
    problems.push({ level: 'error', message: '"template" must be an object with settings, mappings and aliases' });
    return;
  }
  for (const key of ['settings', 'mappings', 'aliases']) {
    if (content[key] !== undefined && !isRecord(content[key])) {
      problems.push({ level: 'error', message: `"template.${key}" must be an object` });
    }
  }
  for (const key of Object.keys(content)) {
    if (!CONTENT_KEYS.has(key)) {
      problems.push({ level: 'warning', message: `Unknown field "template.${key}"; Elasticsearch may reject it` });
    }
  }
}

function checkVersion(body: JsonRecord, problems: BodyProblem[]): void {
  const version = body['version'];
  if (version !== undefined && !(typeof version === 'number' && Number.isInteger(version))) {
    problems.push({ level: 'error', message: '"version" must be a whole number' });
  }
  if (body['_meta'] !== undefined && !isRecord(body['_meta'])) {
    problems.push({ level: 'error', message: '"_meta" must be an object' });
  }
}

function checkUnknownKeys(body: JsonRecord, known: ReadonlySet<string>, problems: BodyProblem[]): void {
  for (const key of Object.keys(body)) {
    if (!known.has(key) && !MISPLACED_KEYS.includes(key)) {
      problems.push({ level: 'warning', message: `Unknown field "${key}"; Elasticsearch may reject it` });
    }
  }
}

function isStringArray(value: unknown): boolean {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/**
 * Problems of an index template body. `components` lists the existing
 * component templates; null (not loaded yet) skips the existence check.
 */
export function checkIndexTemplate(body: JsonRecord, components: readonly string[] | null): BodyProblem[] {
  const problems: BodyProblem[] = [];
  const patterns = body['index_patterns'];
  if (patterns === undefined || (Array.isArray(patterns) && patterns.length === 0) || patterns === '') {
    problems.push({ level: 'error', message: 'Add at least one entry to "index_patterns"' });
  } else if (typeof patterns !== 'string' && !isStringArray(patterns)) {
    problems.push({ level: 'error', message: '"index_patterns" must be a list of index name patterns' });
  }

  const priority = body['priority'];
  if (priority !== undefined && !(typeof priority === 'number' && Number.isInteger(priority) && priority >= 0)) {
    problems.push({ level: 'error', message: '"priority" must be a whole number of 0 or more' });
  }
  checkVersion(body, problems);

  const composed = body['composed_of'];
  if (composed !== undefined && !isStringArray(composed)) {
    problems.push({ level: 'error', message: '"composed_of" must be a list of component template names' });
  } else if (Array.isArray(composed) && components !== null) {
    const ignored = stringList(body['ignore_missing_component_templates']);
    for (const name of composed as string[]) {
      if (!components.includes(name) && !ignored.includes(name)) {
        // Elasticsearch rejects the template unless it is listed in ignore_missing_component_templates.
        problems.push({
          level: 'error',
          message: `Component template "${name}" does not exist; create it first or list it in "ignore_missing_component_templates"`,
        });
      }
    }
  }

  if (body['data_stream'] !== undefined && !isRecord(body['data_stream'])) {
    problems.push({ level: 'error', message: '"data_stream" must be an object, e.g. {}' });
  }
  checkContent(body, problems);
  checkUnknownKeys(body, INDEX_TEMPLATE_KEYS, problems);
  return problems;
}

/** Structural checks of a component template body (errors block saving). */
export function checkComponentTemplate(body: JsonRecord): BodyProblem[] {
  const problems: BodyProblem[] = [];
  if (body['template'] === undefined) {
    problems.push({ level: 'error', message: 'Add a "template" object with settings, mappings or aliases' });
  }
  checkVersion(body, problems);
  checkContent(body, problems);
  checkUnknownKeys(body, COMPONENT_TEMPLATE_KEYS, problems);
  return problems;
}

/** Parses and checks the editor content without throwing. */
export function analyzeBody(source: string, kind: TemplateKind, components: readonly string[] | null = []): BodyCheck {
  if (!source.trim()) {
    return { ok: false, message: 'The template body is required' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch (error: unknown) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
  if (!isRecord(parsed)) {
    return { ok: false, message: 'The template body must be a JSON object' };
  }
  const problems = kind === 'index' ? checkIndexTemplate(parsed, components) : checkComponentTemplate(parsed);
  return { ok: true, value: parsed, problems };
}

/** Replaces (or adds) an entry by name in a loaded list. */
export function upsertByName<T extends { readonly name: string }>(
  list: readonly T[] | undefined,
  entry: T,
): readonly T[] | undefined {
  return list === undefined ? undefined : [...list.filter((item) => item.name !== entry.name), entry];
}

export function removeByName<T extends { readonly name: string }>(
  list: readonly T[] | undefined,
  name: string,
): readonly T[] | undefined {
  return list === undefined ? undefined : list.filter((item) => item.name !== name);
}

/* ------------------------------------------------------------------ */
/* Readable settings, mappings and aliases                              */
/* ------------------------------------------------------------------ */

export function displayValue(value: unknown): string {
  if (value === null || value === undefined) {
    return 'null';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value) && value.every((item) => typeof item !== 'object' || item === null)) {
    return value.map((item) => displayValue(item)).join(', ');
  }
  return JSON.stringify(value);
}

/**
 * Flattens nested settings into sorted dotted keys. Elasticsearch prefixes
 * every index setting with "index.", so `number_of_shards` and
 * `index.number_of_shards` are the same setting.
 */
export function flattenSettings(settings: unknown): SettingEntry[] {
  const entries: SettingEntry[] = [];
  const walk = (value: unknown, prefix: string): void => {
    if (isRecord(value) && Object.keys(value).length > 0) {
      for (const [key, child] of Object.entries(value)) {
        walk(child, prefix ? `${prefix}.${key}` : key);
      }
      return;
    }
    if (prefix) {
      entries.push({ key: normalizeSettingKey(prefix), value: isRecord(value) ? '{}' : displayValue(value) });
    }
  };
  walk(settings, '');
  return entries.sort((left, right) => left.key.localeCompare(right.key));
}

export function normalizeSettingKey(key: string): string {
  return key.startsWith('index.') ? key : `index.${key}`;
}

/** Fields of a mapping in document order, objects before their children. */
export function mappingFields(mappings: unknown): MappingField[] {
  if (!isRecord(mappings)) {
    return [];
  }
  // Mappings of Elasticsearch 6 can still be wrapped in a type name.
  let root = mappings;
  const keys = Object.keys(mappings);
  if (!('properties' in mappings) && keys.length === 1 && isRecord(mappings[keys[0] ?? ''])) {
    const inner = mappings[keys[0] ?? ''] as JsonRecord;
    if ('properties' in inner) {
      root = inner;
    }
  }
  const fields: MappingField[] = [];
  const walk = (properties: unknown, prefix: string, depth: number): void => {
    if (!isRecord(properties)) {
      return;
    }
    for (const [name, definition] of Object.entries(properties)) {
      const path = prefix ? `${prefix}.${name}` : name;
      const field = isRecord(definition) ? definition : {};
      const nested = isRecord(field['properties']);
      const declared = field['type'];
      const type = typeof declared === 'string' ? declared : 'object';
      fields.push({ path, type, multi: false, runtime: false, depth });
      if (nested) {
        walk(field['properties'], path, depth + 1);
      }
      if (isRecord(field['fields'])) {
        for (const [sub, subDefinition] of Object.entries(field['fields'])) {
          const subType = isRecord(subDefinition) && typeof subDefinition['type'] === 'string' ? subDefinition['type'] : 'object';
          fields.push({ path: `${path}.${sub}`, type: subType, multi: true, runtime: false, depth: depth + 1 });
        }
      }
    }
  };
  walk(root['properties'], '', 0);
  if (isRecord(root['runtime'])) {
    for (const [name, definition] of Object.entries(root['runtime'])) {
      const type = isRecord(definition) && typeof definition['type'] === 'string' ? definition['type'] : 'keyword';
      fields.push({ path: name, type, multi: false, runtime: true, depth: 0 });
    }
  }
  return fields;
}

/** Mapping options other than the fields: dynamic, _source, dynamic_templates … */
export function mappingOptions(mappings: unknown): SettingEntry[] {
  if (!isRecord(mappings)) {
    return [];
  }
  return Object.entries(mappings)
    .filter(([key]) => key !== 'properties' && key !== 'runtime')
    .map(([key, value]) => ({
      key,
      value:
        key === 'dynamic_templates' && Array.isArray(value)
          ? pluralize(value.length, 'dynamic template')
          : displayValue(value),
    }))
    .sort((left, right) => left.key.localeCompare(right.key));
}

export function aliasEntries(aliases: unknown): AliasEntry[] {
  if (!isRecord(aliases)) {
    return [];
  }
  return Object.entries(aliases)
    .map(([name, definition]) => {
      const alias = isRecord(definition) ? definition : {};
      const flags: string[] = [];
      if (alias['is_write_index'] === true) flags.push('write index');
      if (alias['filter'] !== undefined) flags.push('filtered');
      if (alias['routing'] !== undefined || alias['index_routing'] !== undefined || alias['search_routing'] !== undefined) {
        flags.push('routing');
      }
      if (alias['is_hidden'] === true) flags.push('hidden');
      return { name, flags };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

/** Name of the ILM policy set by resolved settings, if any. */
export function lifecyclePolicy(settings: readonly SettingEntry[]): string | null {
  return settings.find((entry) => entry.key === 'index.lifecycle.name')?.value ?? null;
}

interface OriginMaps {
  readonly settings: Map<string, Origin>;
  readonly fields: Map<string, Origin>;
  readonly aliases: Map<string, Origin>;
}

/**
 * Which component template (or the index template itself) defines each
 * setting, field and alias. Later sources win, like in Elasticsearch: the
 * components in `composed_of` order, then the template's own block.
 */
export function originMaps(
  template: IndexTemplateBody | undefined,
  components: readonly ComponentTemplateEntry[],
): OriginMaps {
  const maps: OriginMaps = { settings: new Map(), fields: new Map(), aliases: new Map() };
  const apply = (content: TemplateContent | undefined, origin: Origin): void => {
    if (!isRecord(content)) {
      return;
    }
    for (const entry of flattenSettings(content.settings)) maps.settings.set(entry.key, origin);
    for (const field of mappingFields(content.mappings)) maps.fields.set(field.path, origin);
    for (const alias of aliasEntries(content.aliases)) maps.aliases.set(alias.name, origin);
  };
  for (const name of composedOf(template)) {
    const component = components.find((entry) => entry.name === name);
    if (component) {
      apply(component.component_template?.template, { kind: 'component', name });
    }
  }
  apply(template?.template, { kind: 'self' });
  return maps;
}

const DEFAULT_ORIGIN: Origin = { kind: 'default' };

/** Readable view of an `_index_template/_simulate` response. */
export function buildResolvedView(
  response: SimulateResponse | undefined,
  template: IndexTemplateBody | undefined,
  components: readonly ComponentTemplateEntry[],
): ResolvedView {
  const candidate = response?.template;
  const resolved: TemplateContent = isRecord(candidate) ? candidate : {};
  const origins = originMaps(template, components);
  const settings: ResolvedSetting[] = flattenSettings(resolved.settings).map((entry) => ({
    ...entry,
    origin: origins.settings.get(entry.key) ?? DEFAULT_ORIGIN,
  }));
  const fields: ResolvedField[] = mappingFields(resolved.mappings).map((field) => ({
    ...field,
    origin: origins.fields.get(field.path) ?? DEFAULT_ORIGIN,
  }));
  const aliases: ResolvedAlias[] = aliasEntries(resolved.aliases).map((alias) => ({
    ...alias,
    origin: origins.aliases.get(alias.name) ?? DEFAULT_ORIGIN,
  }));
  const overlaps = response?.overlapping;
  const overlapping = (Array.isArray(overlaps) ? overlaps : [])
    .filter((item) => isRecord(item) && typeof item['name'] === 'string')
    .map((item) => ({ name: item.name, patterns: stringList(item.index_patterns).join(', ') }));
  return {
    settings,
    fields,
    mappingOptions: mappingOptions(resolved.mappings),
    aliases,
    overlapping,
    lifecycle: lifecyclePolicy(settings),
  };
}

/* ------------------------------------------------------------------ */
/* URL                                                                 */
/* ------------------------------------------------------------------ */

export function parseKind(value: string | null | undefined): TemplateKind {
  return value === 'components' || value === 'component' ? 'component' : 'index';
}

export function kindParam(kind: TemplateKind): string | null {
  return kind === 'component' ? 'components' : null;
}
