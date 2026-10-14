import { ActivatedRouteSnapshot, RouterStateSnapshot } from '@angular/router';
import { describe, expect, it } from 'vitest';
import { PendingChangesAware, confirmDiscardPendingChanges } from './pending-changes.guard';

describe('confirmDiscardPendingChanges', () => {
  const route = {} as ActivatedRouteSnapshot;
  const state = {} as RouterStateSnapshot;

  it('asks the page whether its pending changes may be discarded', async () => {
    const page = (answer: boolean): PendingChangesAware => ({ confirmDiscard: () => Promise.resolve(answer) });
    await expect(confirmDiscardPendingChanges(page(false), route, state, state)).resolves.toBe(false);
    await expect(confirmDiscardPendingChanges(page(true), route, state, state)).resolves.toBe(true);
  });

  it('lets the navigation through when there is no page instance', () => {
    expect(confirmDiscardPendingChanges(null as unknown as PendingChangesAware, route, state, state)).toBe(true);
  });
});
