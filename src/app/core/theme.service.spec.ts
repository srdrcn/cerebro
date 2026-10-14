import { TestBed } from '@angular/core/testing';
import { THEME_STORAGE_KEY, ThemeService } from './theme.service';

describe('ThemeService', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  it('follows the system by default and forces a theme when chosen', () => {
    const service = TestBed.inject(ThemeService);
    expect(service.preference()).toBe('system');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);

    service.set('dark');
    expect(service.resolved()).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');

    service.set('system');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });

  it('cycles light → dark → system', () => {
    const service = TestBed.inject(ThemeService);
    service.set('light');
    service.cycle();
    expect(service.preference()).toBe('dark');
    service.cycle();
    expect(service.preference()).toBe('system');
    service.cycle();
    expect(service.preference()).toBe('light');
  });

  it('restores a stored preference and ignores garbage', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'light');
    expect(TestBed.inject(ThemeService).preference()).toBe('light');

    TestBed.resetTestingModule();
    localStorage.setItem(THEME_STORAGE_KEY, 'purple');
    expect(TestBed.inject(ThemeService).preference()).toBe('system');
  });
});
