interface HashLocation {
  location: Pick<Location, 'hash' | 'pathname' | 'search'>;
  history: Pick<History, 'replaceState'>;
}

export function normalizeLegacyHashbang(target: HashLocation): boolean {
  const normalizedRoute = legacyRouteFromHash(target.location.hash);
  if (!normalizedRoute) {
    return false;
  }
  target.history.replaceState(
    null,
    '',
    `${target.location.pathname}${target.location.search}#${normalizedRoute}`,
  );
  return true;
}

export function legacyRouteFromHash(hash: string): string | undefined {
  if (!hash.startsWith('#!')) {
    return undefined;
  }
  const legacyRoute = hash.slice(2);
  return legacyRoute.startsWith('/') ? legacyRoute : `/${legacyRoute}`;
}
