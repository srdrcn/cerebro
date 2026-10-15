import { CanDeactivateFn } from '@angular/router';

/** A page that may hold unsaved edits. */
export interface PendingChangesAware {
  /**
   * Resolves `true` when the page can be left: nothing is pending, or the
   * user agreed to discard it (typically through `DialogService.confirm`
   * with `tone: 'danger'`).
   */
  confirmDiscard(): boolean | Promise<boolean>;
}

function isPendingChangesAware(component: unknown): component is PendingChangesAware {
  return (
    typeof component === 'object' &&
    component !== null &&
    typeof (component as Partial<PendingChangesAware>).confirmDiscard === 'function'
  );
}

/**
 * Asks before an in-app navigation drops unsaved edits. Declare it on the
 * route of every editor page in app.routes.ts:
 *
 *   { path: 'cluster_settings', loadComponent: …, canDeactivate: [confirmDiscardPendingChanges] }
 *
 * Pages that do not implement `PendingChangesAware` are always left. Closing
 * or reloading the tab is not covered; pages handle `beforeunload` for that.
 */
export const confirmDiscardPendingChanges: CanDeactivateFn<unknown> = (component) =>
  isPendingChangesAware(component) ? component.confirmDiscard() : true;
