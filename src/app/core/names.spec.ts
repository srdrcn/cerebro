import { describe, expect, it } from 'vitest';
import { INVALID_INDEX_NAME_CHARACTERS, invalidCharacters, validateResourceName } from './names';

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
