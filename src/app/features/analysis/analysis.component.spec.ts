import { describe, expect, it } from 'vitest';
import { sortedNames } from './analysis.component';

describe('analysis option normalization', () => {
  it('sorts and de-duplicates index, analyzer, and field names', () => {
    expect(sortedNames(['zeta', 'alpha', 'zeta', 'beta'])).toEqual([
      'alpha',
      'beta',
      'zeta',
    ]);
  });
});
