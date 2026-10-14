import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { ConnectionService } from './connection.service';

/** Cluster views require a target host; otherwise send the user to Connect. */
export const requireConnection: CanActivateFn = (route) => {
  const connection = inject(ConnectionService);
  if (connection.connected()) {
    return true;
  }
  const host = route.queryParamMap.get('host');
  if (host?.trim()) {
    connection.connect(host);
    return true;
  }
  return inject(Router).createUrlTree(['/connect']);
};
