import { inject } from '@angular/core';
import { CanDeactivateFn, Route } from '@angular/router';
import { DialogService } from '../../core/dialog.service';

/** A page whose editor holds work that is lost when it is left. */
export interface PendingTemplateChanges {
  hasPendingChanges(): boolean;
  /** What the changes belong to, e.g. the template name. */
  pendingChangesSubject(): string;
}

/**
 * Asks before leaving the index templates page with unsaved editor changes
 * (in-app navigation; closing the browser tab is covered by `beforeunload`).
 */
export const confirmDiscardTemplateChanges: CanDeactivateFn<PendingTemplateChanges> = (component) => {
  if (!component.hasPendingChanges()) {
    return true;
  }
  return inject(DialogService).confirm({
    title: 'Discard unsaved changes?',
    message: `Your changes to ${component.pendingChangesSubject()} have not been saved. Leaving this page drops them.`,
    confirmLabel: 'Discard changes',
    cancelLabel: 'Stay on this page',
    tone: 'danger',
  });
};

/**
 * Registers the guard on the route that rendered the page, unless the route
 * configuration already lists it (the shared route table stays untouched on
 * disk). Idempotent.
 */
export function registerPendingChangesGuard(route: Route | null): void {
  if (!route) {
    return;
  }
  const guards = route.canDeactivate ?? [];
  if (!guards.includes(confirmDiscardTemplateChanges)) {
    route.canDeactivate = [...guards, confirmDiscardTemplateChanges];
  }
}
