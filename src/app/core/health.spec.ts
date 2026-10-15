import { describe, expect, it } from 'vitest';
import { healthFromShardCopies, healthLabel, healthTone } from './health';

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

  it('derives index health from shard copies by Elasticsearch rules', () => {
    const copy = (primary: boolean, state: string) => ({ primary, state });
    expect(healthFromShardCopies([])).toBe('gray');
    expect(healthFromShardCopies([copy(true, 'STARTED'), copy(false, 'started')])).toBe('green');
    // A relocating copy is still active.
    expect(healthFromShardCopies([copy(true, 'RELOCATING'), copy(false, 'relocating')])).toBe('green');
    expect(healthFromShardCopies([copy(true, 'started'), copy(false, 'UNASSIGNED')])).toBe('yellow');
    expect(healthFromShardCopies([copy(true, 'started'), copy(false, 'initializing')])).toBe('yellow');
    expect(healthFromShardCopies([copy(true, 'INITIALIZING'), copy(false, 'unassigned')])).toBe('red');
    expect(healthFromShardCopies([copy(true, 'unassigned')])).toBe('red');
  });
});
