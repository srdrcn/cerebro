import { describe, expect, it } from 'vitest';
import {
  NEW_TEMPLATE_BODY,
  analyzeTemplateBody,
  parseTemplateBody,
  searchLegacyTemplates,
  templateBodyWarning,
  templateOrder,
  templatePattern,
  templatePatterns,
  templateSource,
  templateVersion,
  upsertTemplate,
} from './templates.models';

describe('legacy template helpers', () => {
  it('rejects a non-object template body', () => {
    expect(() => parseTemplateBody('[1, 2]')).toThrow('Template body must be a JSON object');
  });

  it('reads patterns from the legacy key, a string or an array', () => {
    expect(templatePatterns({ name: 'a', template: { template: 'logs-*' } })).toEqual(['logs-*']);
    expect(templatePatterns({ name: 'b', template: { index_patterns: 'metrics-*' } })).toEqual(['metrics-*']);
    expect(templatePatterns({ name: 'c', template: { index_patterns: ['x-*', 1, 'y-*'] } })).toEqual([
      'x-*',
      'y-*',
    ]);
    expect(templatePatterns({ name: 'd', template: {} })).toEqual([]);
    expect(templatePattern({ name: 'c', template: { index_patterns: ['x-*', 'y-*'] } })).toBe('x-*, y-*');
  });

  it('reads the order and version when they are numbers', () => {
    expect(templateOrder({ name: 'a', template: { order: 3 } })).toBe(3);
    expect(templateOrder({ name: 'a', template: { order: '3' } })).toBeNull();
    expect(templateVersion({ name: 'a', template: { version: 8120099 } })).toBe(8120099);
    expect(templateVersion({ name: 'a', template: {} })).toBeNull();
  });
});

describe('template search', () => {
  const templates = [
    { name: 'metrics', template: { index_patterns: ['metrics-*'] } },
    { name: '.monitoring-es', template: { index_patterns: ['.monitoring-es-7-*'] } },
    { name: 'logs-template', template: { index_patterns: ['logs-*', 'app-*'] } },
  ];

  it('matches the name or any pattern, case-insensitively', () => {
    expect(searchLegacyTemplates(templates, 'LOGS').map((item) => item.name)).toEqual(['logs-template']);
    expect(searchLegacyTemplates(templates, 'app-').map((item) => item.name)).toEqual(['logs-template']);
    expect(searchLegacyTemplates(templates, '7-*').map((item) => item.name)).toEqual(['.monitoring-es']);
  });

  it('returns every template sorted by name for a blank query', () => {
    expect(searchLegacyTemplates(templates, '  ').map((item) => item.name)).toEqual([
      '.monitoring-es',
      'logs-template',
      'metrics',
    ]);
  });
});

describe('template body', () => {
  it('reports parse errors without throwing', () => {
    expect(analyzeTemplateBody('')).toEqual({ ok: false, message: 'Template body is required' });
    expect(analyzeTemplateBody('{"a":')).toMatchObject({ ok: false });
    expect(analyzeTemplateBody('[]')).toEqual({ ok: false, message: 'Template body must be a JSON object' });
    expect(analyzeTemplateBody('{"order":1}')).toEqual({ ok: true, value: { order: 1 } });
  });

  it('warns when no index pattern is declared', () => {
    expect(templateBodyWarning({ settings: {} })).toBe(
      'Add "index_patterns" so the template matches new indices',
    );
    expect(templateBodyWarning({ index_patterns: [] })).not.toBeNull();
    expect(templateBodyWarning({ index_patterns: ['a-*'] })).toBeNull();
    expect(templateBodyWarning({ template: 'a-*' })).toBeNull();
  });

  it('starts new templates from a valid body with index patterns', () => {
    const body = parseTemplateBody(NEW_TEMPLATE_BODY);
    expect(templateBodyWarning(body)).toBeNull();
  });

  it('pretty prints stored templates', () => {
    expect(templateSource({ name: 'a', template: { order: 1 } })).toBe('{\n  "order": 1\n}');
  });
});

describe('upsert template', () => {
  const logs = { name: 'logs', template: { index_patterns: ['logs-*'] } };
  const metrics = { name: 'metrics', template: { index_patterns: ['metrics-*'] } };

  it('adds a new template to a loaded list', () => {
    expect(upsertTemplate([logs], metrics)).toEqual([logs, metrics]);
  });

  it('replaces a template with the same name', () => {
    const updated = { name: 'logs', template: { index_patterns: ['logs-v2-*'] } };
    expect(upsertTemplate([logs, metrics], updated)).toEqual([metrics, updated]);
  });

  it('leaves an unloaded list unloaded', () => {
    expect(upsertTemplate(undefined, logs)).toBeUndefined();
  });
});
