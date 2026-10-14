import { describe, expect, it } from 'vitest';
import { isRecord, stringList } from './json';
import { INVALID_INDEX_NAME_CHARACTERS, invalidCharacters, validateResourceName } from './names';
import { isInternalAttribute } from './node-attributes';

describe('json helpers', () => {
  it('recognises plain objects only', () => {
    expect(isRecord({ a: 1 })).toBe(true);
    expect(isRecord([])).toBe(false);
    expect(isRecord(null)).toBe(false);
    expect(isRecord('x')).toBe(false);
  });

  it('reads string lists, accepting a single string', () => {
    expect(stringList(['a', 1, 'b'])).toEqual(['a', 'b']);
    expect(stringList('logs-*')).toEqual(['logs-*']);
    expect(stringList('')).toEqual([]);
    expect(stringList({})).toEqual([]);
  });
});

describe('name rules', () => {
  it('lists the invalid characters a name contains', () => {
    expect(invalidCharacters('a,b#c')).toEqual([',', '#']);
    expect(invalidCharacters('remote:logs')).toEqual([]);
    expect(invalidCharacters('remote:logs', INVALID_INDEX_NAME_CHARACTERS)).toEqual([':']);
  });

  it('validates template and snapshot names', () => {
    expect(validateResourceName('', 'template')).toBe('Enter a name for the template');
    expect(validateResourceName('my template', 'template')).toBe('Template names cannot contain spaces');
    expect(validateResourceName('Logs', 'snapshot')).toBe('Snapshot names must be lowercase');
    expect(validateResourceName('_logs', 'template')).toBe('Template names cannot start with "_"');
    expect(validateResourceName('a*b?', 'template')).toBe('Template names cannot contain "*", "?"');
    expect(validateResourceName('app-logs', 'template')).toBeNull();
  });
});

describe('node attributes', () => {
  it('flags the attributes Elasticsearch adds on its own', () => {
    expect(isInternalAttribute('ml.machine_memory')).toBe(true);
    expect(isInternalAttribute('xpack.installed')).toBe(true);
    expect(isInternalAttribute('rack')).toBe(false);
  });
});
