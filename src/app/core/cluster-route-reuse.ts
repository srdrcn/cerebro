import { Injectable } from '@angular/core';
import { ActivatedRouteSnapshot, BaseRouteReuseStrategy } from '@angular/router';

/** `data` flag of the routes that show one cluster (see `app.routes.ts`). */
export const CLUSTER_VIEW = 'clusterView';

function hostOf(route: ActivatedRouteSnapshot): string | undefined {
  return route.queryParamMap.get('host')?.trim() || undefined;
}

/**
 * Angular reuses a page when only the query string changes. For a cluster
 * view a different `?host=` (Back/Forward across clusters, a pasted or
 * bookmarked link) means a different cluster, so the page is created again
 * instead of keeping the previous cluster's lists, selection and editors.
 * `canDeactivate` still runs first. A URL without `host` keeps the connected
 * cluster (`requireConnection`), so it never counts as a change.
 */
@Injectable()
export class ClusterRouteReuseStrategy extends BaseRouteReuseStrategy {
  override shouldReuseRoute(future: ActivatedRouteSnapshot, current: ActivatedRouteSnapshot): boolean {
    if (!super.shouldReuseRoute(future, current)) {
      return false;
    }
    if (future.data[CLUSTER_VIEW] !== true) {
      return true;
    }
    const next = hostOf(future);
    const previous = hostOf(current);
    return !next || !previous || next === previous;
  }
}
