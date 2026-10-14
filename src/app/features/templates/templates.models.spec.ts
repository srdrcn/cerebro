import { describe, expect, it } from 'vitest';
import { filterLegacyTemplates, parseTemplateBody } from './templates.models';

describe('legacy template helpers', () => {
  it('filters by both name and legacy pattern then sorts by name', () => {
    const templates = [
      { name: 'z-logs', template: { template: 'logs-*' } },
      { name: 'a-metrics', template: { template: 'metrics-*' } },
      { name: 'a-logs', template: { template: 'logs-2026-*' } },
    ];
    expect(filterLegacyTemplates(templates, 'a-', 'logs').map((item) => item.name)).toEqual(['a-logs']);
  });

  it('rejects a non-object template body', () => {
    expect(() => parseTemplateBody('[1, 2]')).toThrow('Template body must be a JSON object');
  });
});
