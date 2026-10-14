import { describe, expect, it } from 'vitest';
import {
  aliasNames,
  analyzeBody,
  bodyOverridesFields,
  buildIndexMetadata,
  cloneIndexMetadata,
  cloneableMetadata,
  elasticsearchReason,
  shardLayout,
  sortIndexNames,
  utf8Length,
  validateCount,
  validateIndexName,
} from './create-index.models';

describe('create index payload', () => {
  it('uses simple shard and replica inputs when custom JSON is blank', () => {
    expect(buildIndexMetadata('', ' 5 ', '1')).toEqual({
      settings: { index: { number_of_shards: '5', number_of_replicas: '1' } },
    });
  });

  it('keeps custom JSON authoritative', () => {
    expect(buildIndexMetadata('{"settings":{"refresh_interval":"30s"}}', '5', '1')).toEqual({
      settings: { refresh_interval: '30s' },
    });
  });

  it('falls back to the fields when the custom JSON is an empty object', () => {
    expect(buildIndexMetadata(' {} ', '2', '')).toEqual({
      settings: { index: { number_of_shards: '2' } },
    });
  });

  it('rejects custom JSON that is not an object', () => {
    expect(() => buildIndexMetadata('[1]', '', '')).toThrow('Index settings must be a JSON object');
  });

  it('clones only settings and mappings from index metadata', () => {
    expect(cloneableMetadata({ settings: { a: 1 }, mappings: { properties: {} } })).toEqual({
      settings: { a: 1 }, mappings: { properties: {} },
    });
  });
});

describe('custom JSON body analysis', () => {
  it('classifies empty, invalid and object bodies', () => {
    expect(analyzeBody('  ')).toEqual({ kind: 'empty' });
    expect(analyzeBody('{"a":')).toMatchObject({ kind: 'invalid' });
    expect(analyzeBody('"text"')).toEqual({ kind: 'invalid', message: 'The body must be a JSON object' });
    expect(analyzeBody('{"settings":{}}')).toEqual({ kind: 'object', value: { settings: {} }, keys: 1 });
  });

  it('only overrides the fields when the object has keys', () => {
    expect(bodyOverridesFields(analyzeBody('{}'))).toBe(false);
    expect(bodyOverridesFields(analyzeBody('{"mappings":{}}'))).toBe(true);
    expect(bodyOverridesFields(analyzeBody('{oops'))).toBe(false);
  });

  it('reads shard and replica counts from nested or flat settings', () => {
    expect(shardLayout({ settings: { index: { number_of_shards: '3', number_of_replicas: 0 } } })).toEqual({
      shards: '3',
      replicas: '0',
    });
    expect(shardLayout({ settings: { 'index.number_of_shards': 2, number_of_replicas: '1' } })).toEqual({
      shards: '2',
      replicas: '1',
    });
    expect(shardLayout({ mappings: {} })).toEqual({ shards: null, replicas: null });
  });
});

describe('index name validation', () => {
  it('accepts valid names', () => {
    expect(validateIndexName('logs-2026.10.15')).toEqual({ error: null, warning: null });
    expect(validateIndexName('my_index+1')).toEqual({ error: null, warning: null });
  });

  it('requires a name', () => {
    expect(validateIndexName('').error).toBe('Enter a name for the index');
  });

  it('enforces the Elasticsearch naming rules', () => {
    expect(validateIndexName('Logs').error).toBe('Index names must be lowercase');
    expect(validateIndexName('my index').error).toBe('Index names cannot contain spaces');
    expect(validateIndexName('.').error).toBe('Index names cannot be "." or ".."');
    expect(validateIndexName('..').error).toBe('Index names cannot be "." or ".."');
    expect(validateIndexName('-logs').error).toBe('Index names cannot start with "-"');
    expect(validateIndexName('_logs').error).toBe('Index names cannot start with "_"');
    expect(validateIndexName('+logs').error).toBe('Index names cannot start with "+"');
    expect(validateIndexName('a/b*c').error).toBe('Index names cannot contain "/", "*"');
    expect(validateIndexName('remote:index').error).toBe('Index names cannot contain ":"');
    expect(validateIndexName('a#b').error).toBe('Index names cannot contain "#"');
  });

  it('limits names to 255 UTF-8 bytes', () => {
    expect(utf8Length('é')).toBe(2);
    expect(validateIndexName('a'.repeat(255)).error).toBeNull();
    expect(validateIndexName('é'.repeat(128)).error).toBe(
      'Index names are limited to 255 bytes (this one has 256)',
    );
  });

  it('rejects names of existing indices', () => {
    expect(validateIndexName('products', ['customers', 'products']).error).toBe(
      'An index named "products" already exists',
    );
  });

  it('warns about dot-prefixed names', () => {
    expect(validateIndexName('.internal')).toEqual({
      error: null,
      warning: 'Names starting with "." are reserved for hidden and system indices',
    });
  });
});

describe('shard and replica validation', () => {
  it('accepts blank values and whole numbers in range', () => {
    expect(validateCount('', 1)).toBeNull();
    expect(validateCount(' 3 ', 1, 1024)).toBeNull();
    expect(validateCount('0', 0)).toBeNull();
  });

  it('rejects fractions, negatives and out of range values', () => {
    expect(validateCount('1.5', 1)).toBe('Use a whole number');
    expect(validateCount('-1', 0)).toBe('Use a whole number');
    expect(validateCount('0', 1)).toBe('Must be at least 1');
    expect(validateCount('2000', 1, 1024)).toBe('Must be at most 1024');
  });
});

describe('cloning index metadata', () => {
  const metadata = {
    settings: {
      index: {
        routing: { allocation: { include: { _tier_preference: 'data_content' } } },
        number_of_shards: '2',
        provided_name: 'products',
        creation_date: '1791983838153',
        number_of_replicas: '2',
        uuid: 'q-Rc7rw0StykxYajn-lR3Q',
        version: { created: '8512000' },
      },
    },
    mappings: { _doc: { properties: { sku: { type: 'keyword' } } } },
  };

  it('drops the internal settings Elasticsearch refuses on creation', () => {
    const cloned = cloneIndexMetadata(metadata);
    expect(cloned.metadata['settings']).toEqual({
      index: {
        routing: { allocation: { include: { _tier_preference: 'data_content' } } },
        number_of_shards: '2',
        number_of_replicas: '2',
      },
    });
    expect(cloned.removedSettings).toEqual([
      'index.uuid',
      'index.creation_date',
      'index.provided_name',
      'index.version',
    ]);
  });

  it('unwraps the _doc mapping type of 7.x+ indices', () => {
    const cloned = cloneIndexMetadata(metadata);
    expect(cloned.metadata['mappings']).toEqual({ properties: { sku: { type: 'keyword' } } });
    expect(cloned.unwrappedType).toBe('_doc');
  });

  it('keeps the mapping type of indices created before 7.0', () => {
    const cloned = cloneIndexMetadata({
      settings: { index: { version: { created: '6080099' } } },
      mappings: { _doc: { properties: {} } },
    });
    expect(cloned.metadata['mappings']).toEqual({ _doc: { properties: {} } });
    expect(cloned.unwrappedType).toBeNull();
    expect(cloned.metadata['settings']).toEqual({});
  });

  it('handles flat setting names and leaves the source untouched', () => {
    const source = {
      settings: { 'index.uuid': 'x', 'index.version.created': '8000099', 'index.number_of_shards': '1' },
      mappings: {},
    };
    const cloned = cloneIndexMetadata(source);
    expect(cloned.metadata).toEqual({ settings: { 'index.number_of_shards': '1' }, mappings: {} });
    expect(source.settings['index.uuid']).toBe('x');
  });

  it('defaults missing settings and mappings to empty objects', () => {
    expect(cloneIndexMetadata({}).metadata).toEqual({ settings: {}, mappings: {} });
  });
});

describe('index name sorting', () => {
  it('lists regular indices before dot-prefixed ones', () => {
    expect(sortIndexNames(['products', '.kibana', 'customers', 'products'])).toEqual({
      regular: ['customers', 'products'],
      special: ['.kibana'],
    });
  });
});

describe('alias name conflicts', () => {
  it('rejects a name already used by an alias', () => {
    expect(validateIndexName('logs', ['logs-2026.10.14'], ['logs', 'catalog']).error).toBe(
      'An alias named "logs" already exists',
    );
    expect(validateIndexName('logs-v2', ['logs-2026.10.14'], ['logs']).error).toBeNull();
  });

  it('reads unique alias names from _cat/aliases rows', () => {
    expect(
      aliasNames([
        { alias: 'logs', index: 'logs-1' },
        { alias: 'logs', index: 'logs-2' },
        { alias: 'catalog', index: 'products' },
        { index: 'broken' },
        null,
      ]),
    ).toEqual(['logs', 'catalog']);
    expect(aliasNames({ error: 'forbidden' })).toEqual([]);
  });
});

describe('Elasticsearch error reasons', () => {
  it('reads the reason of an error response body', () => {
    const error = {
      status: 400,
      body: {
        error: {
          root_cause: [{ type: 'invalid_index_name_exception', reason: 'root reason' }],
          type: 'invalid_index_name_exception',
          reason: 'Invalid index name [logs], already exists as alias',
        },
        status: 400,
      },
    };
    expect(elasticsearchReason(error)).toBe('Invalid index name [logs], already exists as alias');
  });

  it('falls back to the root cause or a plain string error', () => {
    expect(elasticsearchReason({ body: { error: { root_cause: [{ reason: 'root reason' }] } } })).toBe(
      'root reason',
    );
    expect(elasticsearchReason({ body: { error: 'IndexAlreadyExistsException[[x] already exists]' } })).toBe(
      'IndexAlreadyExistsException[[x] already exists]',
    );
  });

  it('returns null when there is no reason', () => {
    expect(elasticsearchReason(new Error('network'))).toBeNull();
    expect(elasticsearchReason({ body: { acknowledged: false } })).toBeNull();
    expect(elasticsearchReason(undefined)).toBeNull();
  });
});
