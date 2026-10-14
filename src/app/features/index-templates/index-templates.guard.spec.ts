import { describe, expect, it } from 'vitest';
import { Route } from '@angular/router';
import { confirmDiscardTemplateChanges, registerPendingChangesGuard } from './index-templates.guard';

describe('index templates pending changes guard registration', () => {
  it('adds the guard once and keeps the guards already configured', () => {
    const other = () => true;
    const route: Route = { path: 'index_templates', canDeactivate: [other] };
    registerPendingChangesGuard(route);
    registerPendingChangesGuard(route);
    expect(route.canDeactivate).toEqual([other, confirmDiscardTemplateChanges]);
  });

  it('ignores a missing route configuration', () => {
    expect(() => registerPendingChangesGuard(null)).not.toThrow();
  });
});
