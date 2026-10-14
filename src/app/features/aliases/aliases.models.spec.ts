import { describe, expect, it } from 'vitest';
import {
  AliasChange,
  AliasDraft,
  EMPTY_ALIAS_DRAFT,
  aliasFilterError,
  aliasNameError,
  buildAliasActions,
  buildAliasAdd,
  draftFromRecord,
  hasDraftErrors,
  normalizeAliasRecords,
  parseFlag,
  shouldShowFieldError,
  validateAliasDraft,
  writeFlagFor,
} from './aliases.models';

describe('alias payload builders', () => {
  it('trims names, keeps the alias case, parses the filter and drops blank routing values', () => {
    expect(buildAliasAdd({
      alias: ' Search ',
      index: ' Logs-2026 ',
      filterText: '{"term":{"active":true}}',
      indexRouting: '  ',
      searchRouting: ' tenant-7 ',
    })).toEqual({
      add: {
        alias: 'Search',
        index: 'logs-2026',
        filter: { term: { active: true } },
        index_routing: undefined,
        search_routing: 'tenant-7',
      },
    });
  });

  it('sends the write index and hidden flags again so an update keeps them', () => {
    const base = { ...EMPTY_ALIAS_DRAFT, alias: 'w', index: 'a' };
    expect(buildAliasAdd({ ...base, writeIndex: true, hidden: true }).add).toMatchObject({
      is_write_index: true,
      is_hidden: true,
    });
    expect(buildAliasAdd({ ...base, writeIndex: false }).add.is_write_index).toBe(false);
    const unset = buildAliasAdd(base).add;
    expect('is_write_index' in unset).toBe(false);
    expect('is_hidden' in unset).toBe(false);
    expect(JSON.parse(JSON.stringify(buildAliasActions([{ kind: 'add', alias: unset }])))).toEqual([
      { add: { alias: 'w', index: 'a' } },
    ]);
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

describe('alias records from the backend', () => {
  it('turns null placeholders into absent properties', () => {
    expect(normalizeAliasRecords([
      { alias: 'catalog', index: 'products', filter: { term: { a: 1 } }, search_routing: null, index_routing: null },
      { alias: 'orders', index: 'orders-v2', filter: null, search_routing: '1,2', index_routing: 1 },
    ])).toEqual([
      { alias: 'catalog', index: 'products', filter: { term: { a: 1 } } },
      { alias: 'orders', index: 'orders-v2', search_routing: '1,2', index_routing: '1' },
    ]);
  });

  it('reads the write index and hidden flags when the backend reports them', () => {
    expect(normalizeAliasRecords([
      { alias: 'w', index: 'a', is_write_index: true, is_hidden: true },
      { alias: 'w', index: 'b', is_write_index: false, is_hidden: false },
      { alias: 'x', index: 'c', is_write_index: null, is_hidden: null },
    ])).toEqual([
      { alias: 'w', index: 'a', is_write_index: true, is_hidden: true },
      { alias: 'w', index: 'b', is_write_index: false },
      { alias: 'x', index: 'c' },
    ]);
  });

  it('rejects a response that is not a list', () => {
    expect(() => normalizeAliasRecords({} as never)).toThrow(/expected a list/);
  });


  it('parses flags given as booleans or strings', () => {
    expect([true, 'true', false, 'false', '-', null, undefined, 1].map(parseFlag)).toEqual([
      true,
      true,
      false,
      false,
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });

  it('pre-fills a draft from an existing assignment', () => {
    expect(draftFromRecord({ alias: 'catalog', index: 'products', filter: { term: { a: 1 } }, index_routing: '2' }))
      .toEqual({
        alias: 'catalog',
        index: 'products',
        filterText: '{\n  "term": {\n    "a": 1\n  }\n}',
        indexRouting: '2',
        searchRouting: '',
        writeIndex: undefined,
        hidden: false,
      });
    expect(draftFromRecord({ alias: 'a', index: 'b' })).toEqual({ ...EMPTY_ALIAS_DRAFT, alias: 'a', index: 'b' });
  });

  it('round-trips flags and upper case names through the form', () => {
    const record = { alias: 'Logs-UP', index: 'logs', is_write_index: true, is_hidden: true, search_routing: '9' };
    expect(buildAliasAdd(draftFromRecord(record)).add).toEqual({
      ...record,
      filter: undefined,
      index_routing: undefined,
    });
    const explicitFalse = { alias: 'w', index: 'b', is_write_index: false };
    expect(buildAliasAdd(draftFromRecord(explicitFalse)).add.is_write_index).toBe(false);
  });

  it('restores an explicit false write flag when the box is unticked', () => {
    expect(writeFlagFor(true, undefined)).toBe(true);
    expect(writeFlagFor(true, false)).toBe(true);
    expect(writeFlagFor(false, true)).toBeUndefined();
    expect(writeFlagFor(false, undefined)).toBeUndefined();
    expect(writeFlagFor(false, false)).toBe(false);
  });
});

describe('alias draft validation', () => {
  const draft: AliasDraft = { ...EMPTY_ALIAS_DRAFT, alias: 'recent', index: 'logs' };

  it('accepts a complete draft', () => {
    const errors = validateAliasDraft(draft, ['logs']);
    expect(errors).toEqual({});
    expect(hasDraftErrors(errors)).toBe(false);
  });

  it('requires an alias name and an index', () => {
    const errors = validateAliasDraft(EMPTY_ALIAS_DRAFT, []);
    expect(errors.alias).toBe('Enter an alias name.');
    expect(errors.index).toBe('Select the index the alias points to.');
    expect(hasDraftErrors(errors)).toBe(true);
  });

  it('applies the Elasticsearch naming rules', () => {
    expect(aliasNameError('_hidden')).toBe('An alias cannot start with _, - or +.');
    expect(aliasNameError('..')).toBe('An alias cannot be named "." or "..".');
    expect(aliasNameError('a b,c')).toBe('An alias cannot contain spaces ,.');
    expect(aliasNameError('tenant:1')).toBe('An alias cannot contain :.');
    expect(aliasNameError('x'.repeat(256))).toBe('An alias name cannot be longer than 255 bytes.');
    expect(aliasNameError('<logs-{now/d}>')).toBeUndefined();
    expect(aliasNameError(' Logs-Current ')).toBeUndefined();
  });

  it('rejects an alias named like an existing index', () => {
    expect(validateAliasDraft({ ...draft, alias: ' logs ' }, ['logs']).alias)
      .toBe('An index with this name already exists.');
    // Index names are lower case: an upper case alias cannot clash.
    expect(validateAliasDraft({ ...draft, alias: 'Logs' }, ['logs']).alias).toBeUndefined();
  });

  it('allows a single index routing value only', () => {
    expect(validateAliasDraft({ ...draft, indexRouting: '1,2' }, ['logs']).indexRouting)
      .toBe('Index routing accepts a single value.');
    expect(validateAliasDraft({ ...draft, searchRouting: '1,2' }, ['logs']).indexRouting).toBeUndefined();
  });

  it('reports malformed or non-object filters', () => {
    expect(validateAliasDraft({ ...draft, filterText: '{"term":' }, ['logs']).filter).toMatch(/^Invalid JSON: /);
    expect(aliasFilterError('[1]')).toBe('Alias filter must be a JSON object.');
    expect(aliasFilterError('  ')).toBeUndefined();
  });
});

describe('field error visibility', () => {
  it('waits for a submit attempt for empty fields and for blur for typed ones', () => {
    expect(shouldShowFieldError(undefined, true, true, 'x')).toBe(false);
    expect(shouldShowFieldError('Required', false, true, '')).toBe(false);
    expect(shouldShowFieldError('Required', true, false, '')).toBe(true);
    expect(shouldShowFieldError('Invalid', false, false, 'a b')).toBe(false);
    expect(shouldShowFieldError('Invalid', false, true, 'a b')).toBe(true);
  });
});
