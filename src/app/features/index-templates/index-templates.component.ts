import { ChangeDetectionStrategy, Component } from '@angular/core';

// Placeholder: the Index templates page is being built.
@Component({
  selector: 'cerebro-index-templates',
  template: `
    <section class="page">
      <header class="page-header">
        <div class="page-header__text">
          <h1 class="page-title">Index templates</h1>
          <p class="page-subtitle">This page is being built.</p>
        </div>
      </header>
    </section>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class IndexTemplatesComponent {}
