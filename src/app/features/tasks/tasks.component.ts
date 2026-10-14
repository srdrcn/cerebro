import { ChangeDetectionStrategy, Component } from '@angular/core';

// Placeholder: the Tasks page is being built.
@Component({
  selector: 'cerebro-tasks',
  template: `
    <section class="page">
      <header class="page-header">
        <div class="page-header__text">
          <h1 class="page-title">Tasks</h1>
          <p class="page-subtitle">This page is being built.</p>
        </div>
      </header>
    </section>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TasksComponent {}
