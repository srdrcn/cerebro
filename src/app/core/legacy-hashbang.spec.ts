import {
  legacyRouteFromHash,
  normalizeLegacyHashbang,
} from './legacy-hashbang';

describe('normalizeLegacyHashbang', () => {
  it('normalizes a hashbang while preserving the outer path and query', () => {
    const replaceState = vi.fn();
    const changed = normalizeLegacyHashbang({
      location: {
        hash: '#!overview?host=local',
        pathname: '/cerebro/',
        search: '?theme=dark',
      },
      history: { replaceState },
    });

    expect(changed).toBe(true);
    expect(replaceState).toHaveBeenCalledWith(
      null,
      '',
      '/cerebro/?theme=dark#/overview?host=local',
    );
  });

  it('leaves a modern Angular hash unchanged', () => {
    const replaceState = vi.fn();
    const changed = normalizeLegacyHashbang({
      location: { hash: '#/overview', pathname: '/', search: '' },
      history: { replaceState },
    });

    expect(changed).toBe(false);
    expect(replaceState).not.toHaveBeenCalled();
  });

  it('returns the route that must win Angular initial navigation', () => {
    expect(legacyRouteFromHash('#!/rest?host=local')).toBe('/rest?host=local');
    expect(legacyRouteFromHash('#!overview')).toBe('/overview');
    expect(legacyRouteFromHash('#/rest')).toBeUndefined();
  });
});
