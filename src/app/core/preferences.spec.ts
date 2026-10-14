import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  readJsonPreference,
  readPreference,
  removePreference,
  writeJsonPreference,
  writePreference,
} from './preferences';

const KEY = 'cerebro.test-preference';

describe('preferences', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    try {
      localStorage.removeItem(KEY);
    } catch {
      // Storage may be stubbed out by a test.
    }
  });

  it('reads back what was written', () => {
    expect(writePreference(KEY, 'compact')).toBe(true);
    expect(readPreference(KEY)).toBe('compact');
    removePreference(KEY);
    expect(readPreference(KEY)).toBeNull();
  });

  it('round-trips JSON values', () => {
    expect(writeJsonPreference(KEY, { columns: ['a', 'b'] })).toBe(true);
    expect(readJsonPreference(KEY, {})).toEqual({ columns: ['a', 'b'] });
  });

  it('falls back when the stored JSON is invalid or missing', () => {
    expect(readJsonPreference(KEY, ['fallback'])).toEqual(['fallback']);
    localStorage.setItem(KEY, '{not json');
    expect(readJsonPreference(KEY, ['fallback'])).toEqual(['fallback']);
  });

  it('reports refused writes and survives a throwing storage', () => {
    const failing = {
      getItem: () => {
        throw new DOMException('blocked', 'SecurityError');
      },
      setItem: () => {
        throw new DOMException('full', 'QuotaExceededError');
      },
      removeItem: () => {
        throw new DOMException('blocked', 'SecurityError');
      },
    };
    vi.stubGlobal('localStorage', failing);

    expect(writePreference(KEY, 'x')).toBe(false);
    expect(writeJsonPreference(KEY, { a: 1 })).toBe(false);
    expect(readPreference(KEY)).toBeNull();
    expect(readJsonPreference(KEY, 'fallback')).toBe('fallback');
    expect(() => removePreference(KEY)).not.toThrow();
  });

  it('reports writes as refused when storage is unavailable', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(writePreference(KEY, 'x')).toBe(false);
    expect(readPreference(KEY)).toBeNull();
  });
});
