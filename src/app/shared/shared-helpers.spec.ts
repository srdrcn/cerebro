import { describe, expect, it } from 'vitest';
import { navigationItemFor, NAVIGATION_ITEMS } from '../core/navigation';
import { scoreCommand } from './command-palette.component';
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

describe('command palette scoring', () => {
  it('ranks exact and prefix matches above fuzzy ones', () => {
    const exact = scoreCommand('Nodes', '', 'nodes');
    const prefix = scoreCommand('Nodes', '', 'no');
    const word = scoreCommand('Cluster settings', '', 'set');
    const keyword = scoreCommand('Overview', 'shards allocation', 'shards');
    const fuzzy = scoreCommand('Cluster settings', '', 'clst');

    expect(exact).toBeGreaterThan(prefix);
    expect(prefix).toBeGreaterThan(word);
    expect(word).toBeGreaterThan(keyword);
    expect(keyword).toBeGreaterThan(fuzzy);
    expect(fuzzy).toBeGreaterThan(0);
    expect(scoreCommand('Nodes', '', 'xyz')).toBe(0);
  });
});

describe('navigation', () => {
  it('resolves the current page from a URL', () => {
    expect(navigationItemFor('/nodes?host=x')?.label).toBe('Nodes');
    expect(navigationItemFor('/unknown')).toBeUndefined();
  });

  it('has unique routes', () => {
    const routes = NAVIGATION_ITEMS.map((item) => item.route);
    expect(new Set(routes).size).toBe(routes.length);
  });
});
