import { inject } from '@angular/core';
import { CanDeactivateFn, Route } from '@angular/router';
import { DialogService } from '../../core/dialog.service';

/** A page that holds work which is lost when it is left. */
export interface PendingChangesAware {
  hasPendingChanges(): boolean;
}

/**
 * Asks before leaving the aliases page with staged changes (in-app
 * navigation; closing the tab is covered by `beforeunload`).
 */
export const confirmDiscardPendingAliasChanges: CanDeactivateFn<PendingChangesAware> = (
  component,
) => {
  if (!component.hasPendingChanges()) {
    return true;
  }
  return inject(DialogService).confirm({
    title: 'Discard pending alias changes?',
    message:
      'The staged changes have not been sent to the cluster. Leaving this page drops them.',
    confirmLabel: 'Discard changes',
    cancelLabel: 'Stay on this page',
    tone: 'danger',
  });
};

/**
 * Registers the guard on the route that rendered the page, unless the route
 * configuration already lists it. Idempotent.
 */
export function registerPendingChangesGuard(route: Route | null): void {
  if (!route) {
    return;
  }
  const guards = route.canDeactivate ?? [];
  if (!guards.includes(confirmDiscardPendingAliasChanges)) {
    route.canDeactivate = [...guards, confirmDiscardPendingAliasChanges];
  }
}
