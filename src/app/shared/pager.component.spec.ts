import { describe, expect, it } from 'vitest';
import { clampPage, pageSlice } from './pager.component';

describe('pager helpers', () => {
  it('clamps pages into range', () => {
    expect(clampPage(0, 10, 5)).toBe(1);
    expect(clampPage(9, 10, 5)).toBe(2);
    expect(clampPage(3, 0, 5)).toBe(1);
  });

  it('slices the requested page', () => {
    expect(pageSlice([1, 2, 3, 4, 5], 2, 2)).toEqual([3, 4]);
    expect(pageSlice([1, 2, 3], 10, 2)).toEqual([3]);
  });
});
