import { ChangeDetectionStrategy, Component } from '@angular/core';

/** The cerebro helmet, drawn with currentColor so it follows the theme. */
@Component({
  selector: 'cerebro-logo',
  host: { class: 'brand-mark', 'aria-hidden': 'true' },
  template: `
    <svg viewBox="0 0 64 64" fill="none" width="100%" height="100%">
      <path d="M15 43c0-15.5 7.6-25 17-25s17 9.5 17 25" fill="currentColor" fill-opacity=".18" />
      <path d="M27.5 12.5C19 11.5 12.5 18 11.5 31" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" />
      <path d="M36.5 12.5C45 11.5 51.5 18 52.5 31" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" />
      <path d="M27 9h10l-1.6 13h-6.8z" fill="currentColor" />
      <circle cx="32" cy="26" r="5.2" fill="var(--surface)" stroke="currentColor" stroke-width="3" />
      <rect x="7" y="30" width="9" height="18" rx="4" fill="currentColor" />
      <rect x="48" y="30" width="9" height="18" rx="4" fill="currentColor" />
      <ellipse cx="24.5" cy="41.5" rx="4.2" ry="1.7" fill="var(--accent)" />
      <ellipse cx="39.5" cy="41.5" rx="4.2" ry="1.7" fill="var(--accent)" />
    </svg>
  `,
  styles: `
    :host {
      display: inline-block;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LogoComponent {}
