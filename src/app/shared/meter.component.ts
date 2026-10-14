import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { clampPercent, severity } from '../core/format';

/** Thin usage bar that turns amber/red past the warn/danger thresholds. */
@Component({
  selector: 'cerebro-meter',
  host: {
    class: 'meter',
    role: 'meter',
    '[class.meter-sm]': 'small()',
    '[class.is-warn]': 'level() === "warn"',
    '[class.is-danger]': 'level() === "danger"',
    '[attr.aria-valuenow]': 'percent()',
    'aria-valuemin': '0',
    'aria-valuemax': '100',
    '[attr.aria-label]': 'label() || null',
  },
  template: `<span [style.width.%]="percent()"></span>`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MeterComponent {
  readonly value = input<number | null | undefined>(0);
  readonly warn = input(75);
  readonly danger = input(90);
  readonly small = input(false);
  readonly label = input('');

  readonly percent = computed(() => clampPercent(this.value()));
  readonly level = computed(() => severity(this.value(), this.warn(), this.danger()));
}
