import { ChangeDetectionStrategy, Component, ElementRef, Injector, afterNextRender, computed, inject, signal } from '@angular/core';
import { formatBytes, formatDuration, formatNumber } from '../../../core/format';
import { CheckFix, RolloverConditionKey } from '../index-ops.models';
import { IndexOpsStore } from '../index-ops.store';
import { ROLLOVER_CONDITIONS, conditionCurrent, conditionSupported } from '../index-ops.utils';
import { OpsChecksComponent } from './ops-checks.component';

/** Step 3 of a rollover: conditions, new index name and a live dry run. */
@Component({
  selector: 'cerebro-ops-rollover-options',
  imports: [OpsChecksComponent],
  templateUrl: './ops-rollover-options.component.html',
  styleUrls: ['./ops-steps.css', './ops-rollover-options.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OpsRolloverOptionsComponent {
  readonly store = inject(IndexOpsStore);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  /** The conditions the connected version knows (max_primary_shard_size needs 7.12, max_primary_shard_docs 8.2). */
  readonly definitions = computed(() => ROLLOVER_CONDITIONS.filter((condition) => conditionSupported(condition, this.store.clusterVersion())));
  readonly unsupported = computed(() =>
    ROLLOVER_CONDITIONS.filter((condition) => !conditionSupported(condition, this.store.clusterVersion())).map((condition) => condition.param),
  );
  private readonly touched = signal<ReadonlySet<string>>(new Set());

  readonly target = this.store.rolloverTarget;
  readonly preview = computed(() => {
    const dry = this.store.dryRun();
    return dry.state === 'ready' ? dry.preview : null;
  });
  readonly anyCondition = computed(() => Object.values(this.store.conditions()).some((value) => value.trim() !== ''));

  showError(field: string): string | undefined {
    const error = this.store.fieldErrors()[field];
    return error && (this.store.submitted() || this.touched().has(field)) ? error : undefined;
  }

  setCondition(key: RolloverConditionKey, value: string): void {
    this.store.conditions.update((conditions) => ({ ...conditions, [key]: value }));
    this.mark(key);
  }

  setNewIndex(value: string): void {
    this.store.newIndex.set(value);
    this.mark('newIndex');
  }

  private mark(field: string): void {
    this.store.touch();
    this.touched.update((fields) => new Set([...fields, field]));
  }

  async onFix(fix: CheckFix): Promise<void> {
    if (fix === 'make-write-index' && (await this.store.makeExplicitWriteIndex())) {
      afterNextRender(
        () => {
          const heading = this.host.nativeElement.querySelector<HTMLElement>('#ops-checks-title');
          if (heading) {
            const top = heading.getBoundingClientRect().top;
            heading.focus({ preventScroll: top >= 0 && top < window.innerHeight });
          }
        },
        { injector: this.injector },
      );
    }
  }

  /** "Now 5 documents" next to a condition. */
  current(key: RolloverConditionKey): string | null {
    const value = conditionCurrent(key, this.store.writeFacts(), this.store.now());
    if (value === null) {
      return null;
    }
    const definition = ROLLOVER_CONDITIONS.find((condition) => condition.key === key);
    switch (definition?.kind) {
      case 'age':
        return formatDuration(value);
      case 'size':
        return formatBytes(value);
      default:
        return `${formatNumber(value)} ${value === 1 ? 'document' : 'documents'}`;
    }
  }

  /** Whether the dry run says the condition is met (`null` before it ran). */
  met(key: RolloverConditionKey): boolean | null {
    const param = ROLLOVER_CONDITIONS.find((condition) => condition.key === key)?.param;
    const value = this.store.conditions()[key].trim();
    if (!value) {
      return null;
    }
    const result = this.preview()?.conditions.find((condition) => condition.key === param);
    return result ? result.met : null;
  }
}
