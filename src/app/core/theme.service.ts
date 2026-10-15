import { DOCUMENT } from '@angular/common';
import { Injectable, computed, inject, signal } from '@angular/core';
import { readPreference, writePreference } from './preferences';

export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'cerebro.theme';

function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark';
}

/**
 * Keeps the `data-theme` attribute of <html> in sync with the user's choice.
 * "system" removes the attribute so the stylesheet follows the OS setting.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly document = inject(DOCUMENT);
  private readonly media = this.document.defaultView?.matchMedia?.(
    '(prefers-color-scheme: dark)',
  );
  private readonly systemDark = signal(this.media?.matches ?? false);
  private readonly preferenceState = signal<ThemePreference>(
    this.initialPreference(),
  );

  readonly preference = this.preferenceState.asReadonly();
  readonly resolved = computed<ResolvedTheme>(() => {
    const preference = this.preferenceState();
    if (preference === 'system') {
      return this.systemDark() ? 'dark' : 'light';
    }
    return preference;
  });

  constructor() {
    this.media?.addEventListener?.('change', (event) =>
      this.systemDark.set(event.matches),
    );
    this.apply(this.preferenceState());
  }

  set(preference: ThemePreference): void {
    this.preferenceState.set(preference);
    writePreference(THEME_STORAGE_KEY, preference);
    this.apply(preference);
  }

  /** Cycles light → dark → system. */
  cycle(): void {
    const order: readonly ThemePreference[] = ['light', 'dark', 'system'];
    const next = order[(order.indexOf(this.preferenceState()) + 1) % order.length];
    this.set(next ?? 'system');
  }

  private initialPreference(): ThemePreference {
    const stored = readPreference(THEME_STORAGE_KEY);
    return isThemePreference(stored) ? stored : 'system';
  }

  private apply(preference: ThemePreference): void {
    const root = this.document.documentElement;
    if (preference === 'system') {
      root.removeAttribute('data-theme');
    } else {
      root.setAttribute('data-theme', preference);
    }
  }
}
