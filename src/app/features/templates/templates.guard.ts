import { Route } from '@angular/router';
import { confirmDiscardPendingChanges } from '../../core/pending-changes.guard';

/**
 * Asks before in-app navigation leaves the legacy templates page with unsaved
 * editor changes, by adding the shared unsaved-changes guard to the route
 * that rendered it. Skipped when the route table already declares the guard,
 * so the question is never asked twice. Idempotent. Closing the browser tab
 * is covered by the page's `beforeunload` handler.
 */
export function registerTemplatesLeaveGuard(route: Route | null): void {
  if (!route) {
    return;
  }
  const guards = route.canDeactivate ?? [];
  if (!guards.includes(confirmDiscardPendingChanges)) {
    route.canDeactivate = [...guards, confirmDiscardPendingChanges];
  }
}
