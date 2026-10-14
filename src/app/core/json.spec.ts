import { describe, expect, it } from 'vitest';
import { isRecord, stringList } from './json';

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
