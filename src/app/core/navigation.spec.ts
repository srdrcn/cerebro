import { describe, expect, it } from 'vitest';
import { navigationItemFor, NAVIGATION_ITEMS } from './navigation';

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
