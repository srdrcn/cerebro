import { describe, expect, it } from 'vitest';
import { healthLabel, healthTone } from './health';

describe('health helpers', () => {
  it('maps Elasticsearch colours case-insensitively', () => {
    expect(healthTone('green')).toBe('green');
    expect(healthTone('YELLOW')).toBe('yellow');
    expect(healthTone(' Red ')).toBe('red');
    expect(healthTone('unknown')).toBe('gray');
    expect(healthTone(undefined)).toBe('gray');
    expect(healthTone(3)).toBe('gray');
  });

  it('labels colours in sentence case', () => {
    expect(healthLabel('GREEN')).toBe('Green');
    expect(healthLabel('yellow')).toBe('Yellow');
    expect(healthLabel(null)).toBe('Unknown');
  });
});
