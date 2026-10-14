import { describe, expect, it } from 'vitest';
import { createSort } from './sort-state';

describe('createSort', () => {
  it('starts on the initial column in ascending order', () => {
    const sort = createSort<'name' | 'heap'>('name');
    expect(sort.isActive('name')).toBe(true);
    expect(sort.ariaSort('name')).toBe('ascending');
    expect(sort.ariaSort('heap')).toBe('none');
    expect(sort.icon('name')).toBe('bi-arrow-up');
    expect(sort.icon('heap')).toBe('bi-arrow-down-up');
  });

  it('flips the active column and resets the direction for a new one', () => {
    const sort = createSort<'name' | 'heap'>('name');
    sort.sortBy('name');
    expect(sort.ariaSort('name')).toBe('descending');
    expect(sort.icon('name')).toBe('bi-arrow-down');

    sort.sortBy('heap');
    expect(sort.field()).toBe('heap');
    expect(sort.reverse()).toBe(false);
  });

  it('starts selected columns in descending order', () => {
    const sort = createSort<'name' | 'heap'>('name', { descendingFirst: (field) => field !== 'name' });
    sort.sortBy('heap');
    expect(sort.ariaSort('heap')).toBe('descending');
    sort.sortBy('name');
    expect(sort.ariaSort('name')).toBe('ascending');
  });
});
