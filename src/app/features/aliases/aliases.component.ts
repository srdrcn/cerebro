import { ChangeDetectionStrategy, Component } from '@angular/core';

// Placeholder while the Aliases page is rebuilt on the new design system.
@Component({
  selector: 'cerebro-aliases',
  template: `
    <section class="page">
      <header class="page-header">
        <div class="page-header__text">
          <h1 class="page-title">Aliases</h1>
          <p class="page-subtitle">This page is being rebuilt.</p>
        </div>
      </header>
    </section>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AliasesComponent {}
