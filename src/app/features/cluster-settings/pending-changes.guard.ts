import { CanDeactivateFn } from '@angular/router';

/** A page that may hold unsaved edits. */
export interface PendingChangesAware {
  /** Resolves `true` when the page can be left (nothing pending, or the user agreed to discard). */
  confirmDiscard(): Promise<boolean>;
}

/**
 * Asks before an in-app navigation drops unsaved settings edits. Register it
 * on the `cluster_settings` and `index_settings` routes with
 * `canDeactivate: [confirmDiscardPendingChanges]`. Query parameter changes
 * (such as switching index) do not run it; those pages confirm themselves.
 */
export const confirmDiscardPendingChanges: CanDeactivateFn<PendingChangesAware> = (component) =>
  component ? component.confirmDiscard() : true;
