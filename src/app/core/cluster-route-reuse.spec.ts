import { ActivatedRouteSnapshot, Route, convertToParamMap } from '@angular/router';
import { describe, expect, it } from 'vitest';
import { CLUSTER_VIEW, ClusterRouteReuseStrategy } from './cluster-route-reuse';

const ilm: Route = { path: 'ilm', data: { [CLUSTER_VIEW]: true } };
const connect: Route = { path: 'connect' };

function snapshot(routeConfig: Route, params: Record<string, string>): ActivatedRouteSnapshot {
  return {
    routeConfig,
    data: routeConfig.data ?? {},
    queryParamMap: convertToParamMap(params),
  } as unknown as ActivatedRouteSnapshot;
}

describe('ClusterRouteReuseStrategy', () => {
  const strategy = new ClusterRouteReuseStrategy();

  it('recreates a cluster view for another host', () => {
    expect(
      strategy.shouldReuseRoute(
        snapshot(ilm, { host: 'http://localhost:9299', policy: 'app-events-policy' }),
        snapshot(ilm, { host: 'http://localhost:9200', policy: 'app-events-policy' }),
      ),
    ).toBe(false);
  });

  it('reuses a cluster view when other query parameters change', () => {
    expect(
      strategy.shouldReuseRoute(
        snapshot(ilm, { host: 'http://localhost:9200', policy: 'b' }),
        snapshot(ilm, { host: 'http://localhost:9200 ', policy: 'a' }),
      ),
    ).toBe(true);
  });

  it('keeps the page when a URL names no host (the connected cluster stays)', () => {
    expect(strategy.shouldReuseRoute(snapshot(ilm, {}), snapshot(ilm, { host: 'http://localhost:9200' }))).toBe(true);
  });

  it('leaves other routes to the default rules', () => {
    expect(
      strategy.shouldReuseRoute(
        snapshot(connect, { host: 'http://localhost:9299' }),
        snapshot(connect, { host: 'http://localhost:9200' }),
      ),
    ).toBe(true);
    expect(strategy.shouldReuseRoute(snapshot(connect, {}), snapshot(ilm, {}))).toBe(false);
  });
});
