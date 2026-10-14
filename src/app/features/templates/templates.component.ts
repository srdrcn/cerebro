import { ChangeDetectionStrategy, Component } from '@angular/core';

// Placeholder while the Index templates page is rebuilt on the new design system.
@Component({
  selector: 'cerebro-templates',
  template: `
    <section class="page">
      <header class="page-header">
        <div class="page-header__text">
          <h1 class="page-title">Index templates</h1>
          <p class="page-subtitle">This page is being rebuilt.</p>
        </div>
      </header>
    </section>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TemplatesComponent {}
