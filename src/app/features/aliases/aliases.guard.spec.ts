import { describe, expect, it } from 'vitest';
import { Route } from '@angular/router';
import { confirmDiscardPendingAliasChanges, registerPendingChangesGuard } from './aliases.guard';

describe('pending changes guard registration', () => {
  it('adds the guard once and keeps the guards already configured', () => {
    const other = () => true;
    const route: Route = { path: 'aliases', canDeactivate: [other] };
    registerPendingChangesGuard(route);
    registerPendingChangesGuard(route);
    expect(route.canDeactivate).toEqual([other, confirmDiscardPendingAliasChanges]);
  });

  it('ignores a missing route configuration', () => {
    expect(() => registerPendingChangesGuard(null)).not.toThrow();
  });
});
