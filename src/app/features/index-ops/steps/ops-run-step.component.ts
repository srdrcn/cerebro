import { ChangeDetectionStrategy, Component, ElementRef, Injector, afterNextRender, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ClipboardService } from '../../../core/clipboard.service';
import { ConnectionService } from '../../../core/connection.service';
import { DialogService } from '../../../core/dialog.service';
import { formatCompact, formatDuration, formatNumber, pluralize, sentence } from '../../../core/format';
import { BytesPipe, DurationPipe, NumberPipe, PluralPipe } from '../../../shared/format.pipes';
import { MeterComponent } from '../../../shared/meter.component';
import { ReindexProgress, TaskOutcome } from '../index-ops.models';
import { IndexOpsStore, STUCK_PRIMARY_POLLS } from '../index-ops.store';
import { OPERATIONS, foreignRestrictions, groupFailures, releaseSourceRequest } from '../index-ops.utils';

const OUTCOMES: Readonly<Record<TaskOutcome, { readonly tone: string; readonly icon: string; readonly title: string }>> = {
  running: { tone: 'blue', icon: 'bi-arrow-repeat', title: 'Reindex running' },
  succeeded: { tone: 'green', icon: 'bi-check-lg', title: 'Reindex finished' },
  partial: { tone: 'yellow', icon: 'bi-exclamation-lg', title: 'Reindex stopped with failures' },
  failed: { tone: 'red', icon: 'bi-x-lg', title: 'Reindex failed' },
  cancelled: { tone: 'gray', icon: 'bi-slash-circle', title: 'Reindex cancelled' },
};

/** Step 5: progress, result and finishing actions. */
@Component({
  selector: 'cerebro-ops-run-step',
  imports: [BytesPipe, DurationPipe, MeterComponent, NumberPipe, PluralPipe, RouterLink],
  templateUrl: './ops-run-step.component.html',
  styleUrls: ['./ops-steps.css', './ops-run-step.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OpsRunStepComponent {
  readonly store = inject(IndexOpsStore);
  readonly connection = inject(ConnectionService);
  private readonly dialogs = inject(DialogService);
  private readonly clipboard = inject(ClipboardService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  readonly outcomes = OUTCOMES;
  readonly run = this.store.run;

  readonly resize = computed(() => {
    const run = this.run();
    return run.kind === 'resize' ? run : null;
  });
  readonly rollover = computed(() => {
    const run = this.run();
    return run.kind === 'rollover' ? run : null;
  });
  readonly reindex = computed(() => {
    const run = this.run();
    return run.kind === 'reindex' ? run : null;
  });

  readonly resizeLabel = computed(() => {
    const run = this.resize();
    return run ? OPERATIONS[run.operation].label.toLowerCase() : '';
  });

  /** A primary of the new index stayed unassigned for several polls. */
  readonly stuckShard = computed(() => {
    const run = this.resize();
    return run?.phase === 'recovering' && run.stuckPolls >= STUCK_PRIMARY_POLLS ? (run.recovery?.unassignedPrimaries[0] ?? null) : null;
  });

  /** The request that lifts what the wizard set on the source, `null` when nothing is left. */
  readonly releaseRequest = computed(() => {
    const source = this.store.finishedSource();
    return source && !this.store.sourceDeleted() ? releaseSourceRequest(source, this.store.sourceChanged()) : null;
  });

  /** "refuses writes and keeps its shards on es-node-1" (what the release lifts). */
  readonly sourceChanges = computed(() => {
    const settings = this.releaseRequest()?.preview.body ?? {};
    const parts: string[] = [];
    if ('index.blocks.write' in settings) {
      parts.push('refuses writes');
    }
    if ('index.routing.allocation.require._name' in settings) {
      parts.push(`keeps its shards on ${this.store.finishedSource()?.requiredNode ?? 'one node'}`);
    }
    return parts.join(' and ');
  });

  /** Blocks and node requirements on the source the wizard did not set (never lifted here). */
  readonly otherRestrictions = computed(() => {
    const source = this.store.finishedSource();
    return source && !this.store.sourceDeleted() ? foreignRestrictions(source, this.store.sourceChanged()) : [];
  });

  /** Failures grouped by reason; the index column is left out when every failure has the same index. */
  readonly failureGroups = computed(() => groupFailures(this.reindex()?.progress?.failures ?? [], 3));
  readonly failureIndex = computed(() => {
    const indices = new Set(this.failureGroups().map((group) => group.index));
    return indices.size === 1 ? ([...indices][0] ?? null) : undefined;
  });

  /** Query params of an in-app link: the host plus `params`. */
  linkTo(params: Record<string, string>): Record<string, string | null> {
    return { ...this.connection.hostQuery(), ...params };
  }

  /** Documents created, updated or deleted (what was actually written). */
  copied(progress: ReindexProgress): number {
    return progress.created + progress.updated + progress.deleted;
  }

  /** Meter colour of a reindex: the outcome once it ended. */
  progressTone(progress: ReindexProgress): string {
    return progress.outcome === 'running' || progress.outcome === 'succeeded' ? '' : OUTCOMES[progress.outcome].tone;
  }

  rate(value: number | null): string {
    return value === null ? '–' : `${formatCompact(value)}/s`;
  }

  eta(value: number | null): string {
    if (value === null) {
      return '–';
    }
    return value < 1000 ? 'Almost done' : formatDuration(value);
  }

  percentLabel(value: number | null): string {
    return value === null ? '' : `${value < 10 && value > 0 ? value.toFixed(1) : Math.floor(value)}%`;
  }

  /** The throttle Elasticsearch reports, or the one the request asked for once it reports -1 (ended). */
  throttle(progress: ReindexProgress): string {
    const rps = progress.requestsPerSecond ?? this.reindex()?.requestedRps ?? null;
    return rps === null ? 'Unlimited' : `${formatNumber(rps)} docs/s`;
  }

  showTask(): void {
    const run = this.reindex();
    if (run?.raw) {
      this.dialogs.showJson(`Task ${run.taskId ?? ''}`, run.raw, `GET /_tasks/${run.taskId ?? ''}`);
    }
  }

  copyTaskId(): void {
    const id = this.reindex()?.taskId;
    if (id) {
      void this.clipboard.copyAndNotify(id, 'task id');
    }
  }

  async release(): Promise<void> {
    if (await this.store.releaseFinishedSource()) {
      this.focusFinish();
    }
  }

  async deleteSource(): Promise<void> {
    if (await this.store.deleteFinishedSource()) {
      this.focusFinish();
    }
  }

  /** The finish heading keeps the keyboard in place once the button that was used disappears. */
  private focusFinish(): void {
    afterNextRender(
      () => {
        const heading = this.host.nativeElement.querySelector<HTMLElement>('#ops-finish-title');
        if (heading) {
          const top = heading.getBoundingClientRect().top;
          heading.focus({ preventScroll: top >= 0 && top < window.innerHeight });
        }
      },
      { injector: this.injector },
    );
  }

  readonly pluralize = pluralize;
  readonly sentence = sentence;
}
