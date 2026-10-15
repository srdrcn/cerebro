import { isManagedTemplate } from './templates';

describe('isManagedTemplate', () => {
  it('treats system names and _meta.managed: true as managed', () => {
    expect(isManagedTemplate('.monitoring-es', undefined)).toBe(true);
    expect(isManagedTemplate('logs', { managed: true })).toBe(true);
  });

  it('keeps user templates and non-boolean flags unmanaged', () => {
    expect(isManagedTemplate('logs', { managed: 'true' })).toBe(false);
    expect(isManagedTemplate('app-events', { owner: 'x' })).toBe(false);
    expect(isManagedTemplate('app-events', null)).toBe(false);
    expect(isManagedTemplate('app-events', ['managed'])).toBe(false);
  });
});
