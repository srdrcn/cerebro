import { inject } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivateFn, Router, RunGuardsAndResolvers } from '@angular/router';
import { ConnectionService } from './connection.service';

/**
 * Cluster views require a target host; otherwise send the user to Connect.
 * The `?host=` of the URL wins over the connected host, so history entries,
 * bookmarks and pasted links always show the cluster their URL names.
 */
export const requireConnection: CanActivateFn = (route) => {
  const connection = inject(ConnectionService);
  const host = route.queryParamMap.get('host')?.trim();
  if (connection.connected()) {
    if (host && host !== connection.host()) {
      connection.followUrlHost(host);
    }
    return true;
  }
  if (host) {
    connection.connect(host);
    return true;
  }
  return inject(Router).createUrlTree(['/connect']);
};

/**
 * `runGuardsAndResolvers` for cluster views: besides path parameter changes,
 * run the guards again (`canDeactivate`, then `requireConnection`) when only
 * the `host` query parameter changed on the same page, for example on Back
 * after switching clusters. Other query parameters (filters, the selected
 * index) do not re-run them.
 */
export const hostOrParamsChange: Exclude<RunGuardsAndResolvers, string> = (
  from: ActivatedRouteSnapshot,
  to: ActivatedRouteSnapshot,
) =>
  from.queryParamMap.get('host') !== to.queryParamMap.get('host') ||
  JSON.stringify(from.params) !== JSON.stringify(to.params);
