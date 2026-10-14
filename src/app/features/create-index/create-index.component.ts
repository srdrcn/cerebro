import { ChangeDetectionStrategy, Component } from '@angular/core';

// Placeholder while the Create index page is rebuilt on the new design system.
@Component({
  selector: 'cerebro-create-index',
  template: `
    <section class="page">
      <header class="page-header">
        <div class="page-header__text">
          <h1 class="page-title">Create index</h1>
          <p class="page-subtitle">This page is being rebuilt.</p>
        </div>
      </header>
    </section>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CreateIndexComponent {}
