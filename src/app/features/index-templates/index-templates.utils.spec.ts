import { describe, expect, it } from 'vitest';
import {
  ComponentTemplateEntry,
  IndexTemplateEntry,
  NEW_COMPONENT_TEMPLATE_BODY,
  Origin,
  NEW_INDEX_TEMPLATE_BODY,
} from './index-templates.models';
import {
  aliasEntries,
  analyzeBody,
  buildResolvedView,
  componentTemplateRow,
  componentUsage,
  describeContent,
  displayValue,
  filterRows,
  flattenSettings,
  ignoredComponents,
  indexPatterns,
  indexTemplateRow,
  kindParam,
  mappingFields,
  mappingOptions,
  metaTags,
  parseKind,
  removeByName,
  templateSource,
  upsertByName,
} from './index-templates.utils';

/** Short name of an origin, as rendered in the "Defined by" column. */
function originLabel(origin: Origin): string {
  return origin.kind === 'component' ? origin.name : origin.kind === 'self' ? 'this template' : 'Elasticsearch';
}

const appEvents: IndexTemplateEntry = {
  name: 'app-events',
  index_template: {
    index_patterns: ['app-events-*'],
    composed_of: ['app-settings', 'app-mappings'],
    priority: 200,
    _meta: { owner: 'platform-team' },
    data_stream: { hidden: false },
    template: { settings: { index: { refresh_interval: '5s' } } },
  },
};

const appArchive: IndexTemplateEntry = {
  name: 'app-archive',
  index_template: {
    index_patterns: ['app-archive-*'],
    template: { settings: { index: { number_of_shards: '1' } }, aliases: { 'app-archive': {} } },
    composed_of: [],
    priority: 100,
  },
};

const managedLogs: IndexTemplateEntry = {
  name: 'logs',
  index_template: {
    index_patterns: ['logs-*-*'],
    composed_of: ['logs@mappings', 'app-settings'],
    priority: 100,
    _meta: { managed: true, description: 'default logs template' },
    data_stream: {},
  },
};

const systemTemplate: IndexTemplateEntry = {
  name: '.kibana-reporting',
  index_template: { index_patterns: ['.kibana-reporting*'] },
};

const appSettings: ComponentTemplateEntry = {
  name: 'app-settings',
  component_template: {
    template: {
      settings: { index: { lifecycle: { name: 'app-events-policy' }, number_of_shards: '1', number_of_replicas: '1' } },
    },
    _meta: { description: 'Shared settings for app indices' },
  },
};

const appMappings: ComponentTemplateEntry = {
  name: 'app-mappings',
  component_template: {
    template: {
      mappings: {
        properties: {
          '@timestamp': { type: 'date' },
          level: { type: 'keyword' },
          message: { type: 'text', fields: { raw: { type: 'keyword' } } },
        },
      },
    },
    version: 2,
  },
};

describe('template facts', () => {
  it('reads index patterns as a list', () => {
    expect(indexPatterns(appEvents.index_template)).toEqual(['app-events-*']);
    expect(indexPatterns({ index_patterns: 'one-*' })).toEqual(['one-*']);
    expect(indexPatterns({})).toEqual([]);
    expect(indexPatterns(undefined)).toEqual([]);
  });

  it('maps components to the index templates using them', () => {
    const usage = componentUsage([appEvents, appArchive, managedLogs]);
    expect(usage.get('app-settings')).toEqual(['app-events', 'logs']);
    expect(usage.get('app-mappings')).toEqual(['app-events']);
    expect(usage.has('missing')).toBe(false);
  });

  it('describes what a template block defines', () => {
    expect(describeContent(appSettings.component_template.template)).toBe('3 settings');
    expect(describeContent(appMappings.component_template.template)).toBe('mappings (3 fields)');
    expect(describeContent(appArchive.index_template.template)).toBe('1 setting · 1 alias');
    expect(describeContent({ mappings: {}, lifecycle: { data_retention: '7d' } })).toBe('mappings · lifecycle');
    expect(describeContent(undefined)).toBe('Empty');
    expect(describeContent({})).toBe('Empty');
  });

  it('builds list rows', () => {
    expect(indexTemplateRow(appEvents)).toMatchObject({
      kind: 'index',
      managed: false,
      patterns: ['app-events-*'],
      priority: 200,
      dataStream: true,
      composedOf: ['app-settings', 'app-mappings'],
    });
    expect(indexTemplateRow(managedLogs)).toMatchObject({ managed: true, description: 'default logs template' });
    const usage = componentUsage([appEvents]);
    expect(componentTemplateRow(appMappings, usage)).toMatchObject({
      kind: 'component',
      usedBy: ['app-events'],
      version: 2,
      contents: 'mappings (3 fields)',
    });
    expect(componentTemplateRow(appSettings, new Map()).usedBy).toEqual([]);
  });

  it('lists _meta entries other than the description', () => {
    expect(metaTags({ description: 'x', owner: 'team', managed: true })).toEqual([
      { key: 'managed', value: 'true' },
      { key: 'owner', value: 'team' },
    ]);
    expect(metaTags('nope')).toEqual([]);
  });
});

describe('filterRows', () => {
  const rows = [appEvents, appArchive, managedLogs, systemTemplate].map((entry) => indexTemplateRow(entry));

  it('hides managed templates unless asked', () => {
    expect(filterRows(rows, '', false).map((row) => row.name)).toEqual(['app-archive', 'app-events']);
    expect(filterRows(rows, '', true).map((row) => row.name)).toEqual([
      'app-archive',
      'app-events',
      '.kibana-reporting',
      'logs',
    ]);
  });

  it('matches name, patterns, components and description case-insensitively', () => {
    expect(filterRows(rows, 'ARCHIVE', false).map((row) => row.name)).toEqual(['app-archive']);
    expect(filterRows(rows, 'events-*', false).map((row) => row.name)).toEqual(['app-events']);
    expect(filterRows(rows, 'app-mappings', false).map((row) => row.name)).toEqual(['app-events']);
    expect(filterRows(rows, 'default logs', true).map((row) => row.name)).toEqual(['logs']);
    expect(filterRows(rows, '  ', false)).toHaveLength(2);
  });

  it('accepts regular expressions like the other filters', () => {
    expect(filterRows(rows, '^app-a', false).map((row) => row.name)).toEqual(['app-archive']);
    expect(filterRows(rows, 'events$', false).map((row) => row.name)).toEqual(['app-events']);
  });
});

describe('analyzeBody', () => {
  it('accepts the skeletons', () => {
    const index = analyzeBody(NEW_INDEX_TEMPLATE_BODY, 'index', []);
    expect(index.ok && index.problems).toEqual([]);
    const component = analyzeBody(NEW_COMPONENT_TEMPLATE_BODY, 'component');
    expect(component.ok && component.problems).toEqual([]);
  });

  it('reports syntax errors and non objects', () => {
    expect(analyzeBody('', 'index')).toEqual({ ok: false, message: 'The template body is required' });
    expect(analyzeBody('{', 'index').ok).toBe(false);
    expect(analyzeBody('[]', 'index')).toEqual({ ok: false, message: 'The template body must be a JSON object' });
  });

  it('checks index template structure', () => {
    const check = analyzeBody(
      JSON.stringify({
        index_patterns: [],
        priority: -1,
        version: 1.5,
        composed_of: ['app-settings', 'nope', 'ignored'],
        ignore_missing_component_templates: ['ignored'],
        settings: {},
        template: { mappings: [], foo: 1 },
        data_stream: true,
        surprise: 1,
      }),
      'index',
      ['app-settings'],
    );
    expect(check.ok).toBe(true);
    if (!check.ok) return;
    const messages = check.problems.map((problem) => `${problem.level}: ${problem.message}`);
    expect(messages).toEqual([
      'error: Add at least one entry to "index_patterns"',
      'error: "priority" must be a whole number of 0 or more',
      'error: "version" must be a whole number',
      'error: Component template "nope" does not exist; create it first or list it in "ignore_missing_component_templates"',
      'error: "data_stream" must be an object, e.g. {}',
      'error: Move "settings" inside "template": { … }',
      'error: "template.mappings" must be an object',
      'warning: Unknown field "template.foo"; Elasticsearch may reject it',
      'warning: Unknown field "surprise"; Elasticsearch may reject it',
    ]);
  });

  it('reads ignore_missing_component_templates', () => {
    expect(ignoredComponents({ ignore_missing_component_templates: ['a', 'b'] })).toEqual(['a', 'b']);
    expect(ignoredComponents({})).toEqual([]);
    expect(ignoredComponents(undefined)).toEqual([]);
  });

  it('skips the component existence check while the component list is unknown', () => {
    const source = JSON.stringify({ index_patterns: ['x-*'], composed_of: ['app-settings', 'nope'] });
    const unknown = analyzeBody(source, 'index', null);
    expect(unknown.ok && unknown.problems).toEqual([]);
    const known = analyzeBody(source, 'index', ['app-settings']);
    expect(known.ok && known.problems.map((problem) => problem.level)).toEqual(['error']);
  });

  it('rejects malformed patterns and composed_of', () => {
    const check = analyzeBody(JSON.stringify({ index_patterns: [1], composed_of: 'x', template: 'x' }), 'index');
    expect(check.ok && check.problems.map((problem) => problem.message)).toEqual([
      '"index_patterns" must be a list of index name patterns',
      '"composed_of" must be a list of component template names',
      '"template" must be an object with settings, mappings and aliases',
    ]);
  });

  it('checks component template structure', () => {
    const check = analyzeBody(JSON.stringify({ mappings: {}, _meta: 'x', index_patterns: ['a'] }), 'component');
    expect(check.ok && check.problems.map((problem) => `${problem.level}: ${problem.message}`)).toEqual([
      'error: Add a "template" object with settings, mappings or aliases',
      'error: "_meta" must be an object',
      'error: Move "mappings" inside "template": { … }',
      'warning: Unknown field "index_patterns"; Elasticsearch may reject it',
    ]);
  });
});

describe('list helpers', () => {
  it('upserts and removes by name and keeps unloaded lists unloaded', () => {
    const list = [appEvents, appArchive];
    const replaced = { ...appEvents, index_template: { index_patterns: ['x'] } };
    expect(upsertByName(list, replaced)?.map((entry) => entry.index_template.index_patterns)).toEqual([
      ['app-archive-*'],
      ['x'],
    ]);
    expect(upsertByName(undefined, appEvents)).toBeUndefined();
    expect(removeByName(list, 'app-events')?.map((entry) => entry.name)).toEqual(['app-archive']);
    expect(removeByName(undefined, 'x')).toBeUndefined();
  });

  it('pretty prints stored bodies', () => {
    expect(templateSource({ a: 1 })).toBe('{\n  "a": 1\n}');
    expect(templateSource(undefined)).toBe('{}');
  });

  it('maps the tab query parameter', () => {
    expect(parseKind('components')).toBe('component');
    expect(parseKind('component')).toBe('component');
    expect(parseKind(null)).toBe('index');
    expect(parseKind('junk')).toBe('index');
    expect(kindParam('component')).toBe('components');
    expect(kindParam('index')).toBeNull();
  });
});

describe('readable settings, mappings and aliases', () => {
  it('flattens settings with the index prefix', () => {
    expect(
      flattenSettings({
        index: { lifecycle: { name: 'p' }, number_of_shards: '1' },
        'index.codec': 'best_compression',
        number_of_replicas: 0,
        analysis: {},
        'index.routing.allocation.include._tier_preference': ['data_hot', 'data_warm'],
      }),
    ).toEqual([
      { key: 'index.analysis', value: '{}' },
      { key: 'index.codec', value: 'best_compression' },
      { key: 'index.lifecycle.name', value: 'p' },
      { key: 'index.number_of_replicas', value: '0' },
      { key: 'index.number_of_shards', value: '1' },
      { key: 'index.routing.allocation.include._tier_preference', value: 'data_hot, data_warm' },
    ]);
    expect(flattenSettings(undefined)).toEqual([]);
  });

  it('formats values', () => {
    expect(displayValue(null)).toBe('null');
    expect(displayValue(true)).toBe('true');
    expect(displayValue([1, 'a'])).toBe('1, a');
    expect(displayValue([{ a: 1 }])).toBe('[{"a":1}]');
  });

  it('lists mapping fields with objects, multi-fields and runtime fields', () => {
    const fields = mappingFields({
      dynamic: false,
      properties: {
        user: { properties: { name: { type: 'keyword' }, geo: { type: 'nested', properties: { lat: { type: 'float' } } } } },
        message: { type: 'text', fields: { raw: { type: 'keyword' } } },
      },
      runtime: { day: { type: 'keyword' } },
    });
    expect(fields.map((field) => [field.path, field.type, field.depth, field.multi, field.runtime])).toEqual([
      ['user', 'object', 0, false, false],
      ['user.name', 'keyword', 1, false, false],
      ['user.geo', 'nested', 1, false, false],
      ['user.geo.lat', 'float', 2, false, false],
      ['message', 'text', 0, false, false],
      ['message.raw', 'keyword', 1, true, false],
      ['day', 'keyword', 0, false, true],
    ]);
  });

  it('unwraps type-named mappings of Elasticsearch 6', () => {
    expect(mappingFields({ _doc: { properties: { a: { type: 'long' } } } }).map((field) => field.path)).toEqual(['a']);
    expect(mappingFields('x')).toEqual([]);
  });

  it('lists mapping options', () => {
    expect(
      mappingOptions({ properties: {}, dynamic: 'strict', _source: { enabled: false }, dynamic_templates: [{}, {}] }),
    ).toEqual([
      { key: '_source', value: '{"enabled":false}' },
      { key: 'dynamic', value: 'strict' },
      { key: 'dynamic_templates', value: '2 dynamic templates' },
    ]);
  });

  it('describes aliases with their flags', () => {
    expect(
      aliasEntries({
        b: { is_write_index: true, filter: { term: { a: 1 } }, routing: '1', is_hidden: true },
        a: {},
      }),
    ).toEqual([
      { name: 'a', flags: [] },
      { name: 'b', flags: ['write index', 'filtered', 'routing', 'hidden'] },
    ]);
  });
});

describe('buildResolvedView', () => {
  const simulate = {
    template: {
      settings: {
        index: {
          lifecycle: { name: 'app-events-policy' },
          routing: { allocation: { include: { _tier_preference: 'data_hot' } } },
          number_of_shards: '1',
          number_of_replicas: '1',
          refresh_interval: '5s',
        },
      },
      mappings: {
        properties: {
          '@timestamp': { type: 'date' },
          level: { type: 'keyword' },
          message: { type: 'text', fields: { raw: { type: 'keyword' } } },
        },
      },
      aliases: {},
    },
    overlapping: [{ name: 'logs', index_patterns: ['logs-*-*'] }, { bad: true }],
  };

  it('annotates each entry with the template that defines it', () => {
    const view = buildResolvedView(simulate as never, appEvents.index_template, [appSettings, appMappings]);
    const origins = Object.fromEntries(view.settings.map((entry) => [entry.key, originLabel(entry.origin)]));
    expect(origins).toEqual({
      'index.lifecycle.name': 'app-settings',
      'index.number_of_replicas': 'app-settings',
      'index.number_of_shards': 'app-settings',
      'index.refresh_interval': 'this template',
      'index.routing.allocation.include._tier_preference': 'Elasticsearch',
    });
    expect(view.fields.map((field) => [field.path, originLabel(field.origin)])).toEqual([
      ['@timestamp', 'app-mappings'],
      ['level', 'app-mappings'],
      ['message', 'app-mappings'],
      ['message.raw', 'app-mappings'],
    ]);
    expect(view.lifecycle).toBe('app-events-policy');
    expect(view.overlapping).toEqual([{ name: 'logs', patterns: 'logs-*-*' }]);
    expect(view.aliases).toEqual([]);
  });

  it('lets later sources win', () => {
    const template = {
      composed_of: ['a', 'b'],
      template: { aliases: { x: {} } },
    };
    const components: ComponentTemplateEntry[] = [
      { name: 'a', component_template: { template: { settings: { number_of_shards: 1 }, aliases: { x: {} } } } },
      { name: 'b', component_template: { template: { settings: { index: { number_of_shards: 2 } } } } },
    ];
    const view = buildResolvedView(
      { template: { settings: { index: { number_of_shards: '2' } }, aliases: { x: {} } } },
      template,
      components,
    );
    expect(originLabel(view.settings[0]!.origin)).toBe('b');
    expect(originLabel(view.aliases[0]!.origin)).toBe('this template');
  });

  it('copes with empty or malformed responses', () => {
    const view = buildResolvedView(undefined, undefined, []);
    expect(view).toEqual({ settings: [], fields: [], mappingOptions: [], aliases: [], overlapping: [], lifecycle: null });
  });
});
