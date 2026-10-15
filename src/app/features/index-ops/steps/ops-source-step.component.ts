import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ConnectionService } from '../../../core/connection.service';
import { listSample } from '../../../core/format';
import { healthLabel, healthTone } from '../../../core/health';
import { groupIndexOptions } from '../../../shared/index-picker.component';
import { BytesPipe, NumberPipe, PluralPipe } from '../../../shared/format.pipes';
import { isResizeKind } from '../index-ops.models';
import { IndexOpsStore } from '../index-ops.store';
import { sourceExpressions, totalDocs } from '../index-ops.utils';

/** Closed indices named before "and N more". */
const SKIPPED_PREVIEW = 10;

/** Step 2: the index, the alias or data stream, or the source indices. */
@Component({
  selector: 'cerebro-ops-source-step',
  imports: [BytesPipe, NumberPipe, PluralPipe, RouterLink],
  templateUrl: './ops-source-step.component.html',
  styleUrls: ['./ops-steps.css', './ops-source-step.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OpsSourceStepComponent {
  readonly store = inject(IndexOpsStore);
  readonly connection = inject(ConnectionService);

  readonly healthLabel = healthLabel;
  readonly healthTone = healthTone;

  readonly isResize = computed(() => isResizeKind(this.store.operation()));
  readonly groups = computed(() => groupIndexOptions(this.store.indices() ?? []));

  readonly aliasTargets = computed(() => this.store.rolloverTargets().filter((target) => target.kind === 'alias' && !target.hidden));
  readonly streamTargets = computed(() => this.store.rolloverTargets().filter((target) => target.kind === 'data-stream' && !target.hidden));
  readonly hiddenTargets = computed(() => this.store.rolloverTargets().filter((target) => target.hidden));
  readonly rollable = computed(() => this.store.rolloverTargets().filter((target) => !target.problem).length);

  readonly sourceIndices = computed(() => {
    const lookup = this.store.sourcesLookup();
    return lookup.state === 'ready' ? lookup.indices : [];
  });
  /** Closed indices only a pattern matched: the reindex skips them. */
  readonly skippedIndices = computed(() => {
    const lookup = this.store.sourcesLookup();
    return lookup.state === 'ready' ? (lookup.skipped ?? []) : [];
  });
  readonly skippedNames = computed(() => {
    return listSample(
      this.skippedIndices().map((index) => index.name),
      SKIPPED_PREVIEW,
    );
  });
  readonly sourceDocs = computed(() => totalDocs(this.sourceIndices()));
  readonly sourceSize = computed(() => this.sourceIndices().reduce((sum, index) => sum + (index.primarySize ?? 0), 0));
  /** Indices not already named in the sources, for "Add an index". */
  readonly addable = computed(() => {
    const named = new Set(sourceExpressions(this.store.reindex().sources));
    return this.groups().regular.filter((name) => !named.has(name));
  });

  /** The source index (resize) or the alias / data stream (rollover). */
  pickSource(name: string): void {
    void this.store.chooseSource(name);
  }

  setSources(value: string): void {
    this.store.reindex.update((options) => ({ ...options, sources: value }));
    this.store.touch();
  }

  addSource(select: HTMLSelectElement): void {
    const name = select.value;
    select.value = '';
    if (!name) {
      return;
    }
    const current = sourceExpressions(this.store.reindex().sources);
    this.setSources([...current, name].join(', '));
  }
}
