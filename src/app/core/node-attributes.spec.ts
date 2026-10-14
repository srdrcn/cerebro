import { describe, expect, it } from 'vitest';
import { isInternalAttribute } from './node-attributes';

describe('node attributes', () => {
  it('flags the attributes Elasticsearch adds on its own', () => {
    expect(isInternalAttribute('ml.machine_memory')).toBe(true);
    expect(isInternalAttribute('xpack.installed')).toBe(true);
    expect(isInternalAttribute('rack')).toBe(false);
  });
});
