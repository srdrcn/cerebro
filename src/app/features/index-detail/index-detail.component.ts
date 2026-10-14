import { ChangeDetectionStrategy, Component } from '@angular/core';

// Placeholder: the Index details page is being built.
@Component({
  selector: 'cerebro-index-detail',
  template: `
    <section class="page">
      <header class="page-header">
        <div class="page-header__text">
          <h1 class="page-title">Index details</h1>
          <p class="page-subtitle">This page is being built.</p>
        </div>
      </header>
    </section>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class IndexDetailComponent {}
