import { Route } from '@angular/router';
import { describe, expect, it } from 'vitest';
import { confirmDiscardPendingChanges } from '../../core/pending-changes.guard';
import { registerTemplatesLeaveGuard } from './templates.guard';

describe('registerTemplatesLeaveGuard', () => {
  it('adds the unsaved-changes guard once and keeps the guards already configured', () => {
    const other = () => true;
    const route: Route = { path: 'templates', canDeactivate: [other] };
    registerTemplatesLeaveGuard(route);
    registerTemplatesLeaveGuard(route);
    expect(route.canDeactivate).toEqual([other, confirmDiscardPendingChanges]);
  });

  it('does not add a second copy when the route table already declares it', () => {
    const route: Route = { path: 'templates', canDeactivate: [confirmDiscardPendingChanges] };
    registerTemplatesLeaveGuard(route);
    expect(route.canDeactivate).toEqual([confirmDiscardPendingChanges]);
  });

  it('ignores a missing route configuration', () => {
    expect(() => registerTemplatesLeaveGuard(null)).not.toThrow();
  });
});
