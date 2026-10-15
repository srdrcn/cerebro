import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Empty / zero-data placeholder. Project optional actions:
 *   <cerebro-empty icon="bi-inbox" heading="No snapshots">
 *     <button class="btn">Create</button>
 *   </cerebro-empty>
 * `tone="success"` paints the icon tile green for "all good" states.
 */
@Component({
  selector: 'cerebro-empty',
  host: {
    class: 'empty',
    '[class.empty--compact]': 'compact()',
    '[class.empty--success]': "tone() === 'success'",
  },
  template: `
    <span class="empty__icon" aria-hidden="true"><i class="bi" [class]="'bi ' + icon()"></i></span>
    <p class="empty__title">{{ heading() }}</p>
    @if (text()) {
      <p class="empty__text">{{ text() }}</p>
    }
    <div class="empty__actions"><ng-content /></div>
  `,
  styles: `
    .empty__actions:empty {
      display: none;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EmptyStateComponent {
  readonly icon = input('bi-inbox');
  readonly heading = input.required<string>();
  readonly text = input('');
  readonly compact = input(false);
  readonly tone = input<'default' | 'success'>('default');
}
