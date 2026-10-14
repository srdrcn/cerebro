import { describe, expect, it } from 'vitest';
import { AliasChange, buildAliasActions, buildAliasAdd } from './aliases.models';

describe('alias payload builders', () => {
  it('normalizes names, parses the filter and drops blank routing values', () => {
    expect(buildAliasAdd({
      alias: ' Search ',
      index: ' Logs-2026 ',
      filterText: '{"term":{"active":true}}',
      indexRouting: '  ',
      searchRouting: ' tenant-7 ',
    })).toEqual({
      add: {
        alias: 'search',
        index: 'logs-2026',
        filter: { term: { active: true } },
        index_routing: undefined,
        search_routing: 'tenant-7',
      },
    });
  });

  it('builds one Elasticsearch atomic actions array', () => {
    const changes: AliasChange[] = [
      { kind: 'add', alias: { alias: 'current', index: 'logs' } },
      { kind: 'remove', alias: { alias: 'old', index: 'logs', filter: { match_all: {} } } },
    ];
    expect(buildAliasActions(changes)).toEqual([
      { add: { alias: 'current', index: 'logs' } },
      { remove: { alias: 'old', index: 'logs' } },
    ]);
  });
});
