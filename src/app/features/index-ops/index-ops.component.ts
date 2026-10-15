import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ConnectionService } from '../../core/connection.service';
import { DialogService } from '../../core/dialog.service';
import { formatBytes, formatNumber, pluralize } from '../../core/format';
import { healthLabel } from '../../core/health';
import { PendingChangesAware } from '../../core/pending-changes.guard';
import { EmptyStateComponent } from '../../shared/empty-state.component';
import { PluralPipe } from '../../shared/format.pipes';
import { OperationKind, WIZARD_STEPS, WizardStep, isOperationKind, isResizeKind } from './index-ops.models';
import { IndexOpsStore } from './index-ops.store';
import { OpsOperationStepComponent } from './steps/ops-operation-step.component';
import { OpsReindexOptionsComponent } from './steps/ops-reindex-options.component';
import { OpsResizeOptionsComponent } from './steps/ops-resize-options.component';
import { OpsReviewStepComponent } from './steps/ops-review-step.component';
import { OpsRolloverOptionsComponent } from './steps/ops-rollover-options.component';
import { OpsRunStepComponent } from './steps/ops-run-step.component';
import { OpsSourceStepComponent } from './steps/ops-source-step.component';

interface SummaryRow {
  readonly label: string;
  readonly value: string;
  readonly mono?: boolean;
}

const NOTES: Readonly<Record<OperationKind, string>> = {
  shrink:
    'The source stays searchable. Preparing it blocks writes and gathers a copy of each shard on one node; the last step offers to undo both, or to delete the source once the new index is green.',
  split:
    'The source stays searchable but must refuse writes until the split is done. The new index shares the segment files where the file system allows it, so the split itself is quick.',
  clone:
    'The source stays searchable but must refuse writes until the clone is done. The clone gets the settings, mappings and documents of the source.',
  rollover:
    'A rollover changes where new documents go: existing documents stay in the old index. An alias whose write index is not marked is_write_index moves to the new index, so the old one leaves it. With conditions, nothing happens unless one of them is met.',
  reindex:
    'The reindex runs as a background task: you can leave this page and follow it under Tasks. It copies documents only, not settings or mappings.',
};

interface StepHeading {
  readonly icon: string;
  readonly title: string;
  readonly subtitle: string;
}

/**
 * Index operations wizard (`/index_ops?op=&index=`): choose an operation,
 * its source and options with live preflight checks, review the exact
 * requests, then run it and follow its progress.
 */
@Component({
  selector: 'cerebro-index-ops',
  imports: [
    EmptyStateComponent,
    OpsOperationStepComponent,
    OpsReindexOptionsComponent,
    OpsResizeOptionsComponent,
    OpsReviewStepComponent,
    OpsRolloverOptionsComponent,
    OpsRunStepComponent,
    OpsSourceStepComponent,
    PluralPipe,
    RouterLink,
  ],
  providers: [IndexOpsStore],
  host: { '(window:beforeunload)': 'onBeforeUnload($event)' },
  templateUrl: './index-ops.component.html',
  styleUrl: './index-ops.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class IndexOpsComponent implements PendingChangesAware {
  readonly store = inject(IndexOpsStore);
  readonly connection = inject(ConnectionService);
  private readonly dialogs = inject(DialogService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  readonly steps = WIZARD_STEPS;

  /** `op|index|task|target` of the URL, to tell links from the wizard's own URL updates. */
  private urlKey: string | null = null;
  /** Counts links followed, so a link that waited for a dialog yields to a later one. */
  private linkSequence = 0;

  /** The step whose Continue was refused; the message follows the live state. */
  private readonly attempted = signal<WizardStep | null>(null);
  readonly blocked = computed<string | undefined>(() => {
    const step = this.store.step();
    if (this.attempted() !== step) {
      return undefined;
    }
    switch (step) {
      case 'operation':
        return this.store.operation() ? undefined : 'Choose an operation first.';
      case 'source':
        return this.sourceProblem() ?? undefined;
      case 'options':
        return this.optionsProblem() ?? undefined;
      default:
        return undefined;
    }
  });

  readonly stepIndex = computed(() => WIZARD_STEPS.findIndex((step) => step.key === this.store.step()));

  readonly heading = computed<StepHeading>(() => {
    const info = this.store.info();
    switch (this.store.step()) {
      case 'operation':
        return { icon: 'bi-tools', title: 'Choose an operation', subtitle: 'Each one creates or fills another index; nothing changes before the last step.' };
      case 'source':
        return {
          icon: 'bi-database',
          title: info?.sourceLabel ?? 'Source',
          subtitle:
            info?.kind === 'rollover'
              ? 'The alias or data stream whose write index is replaced.'
              : info?.kind === 'reindex'
                ? 'The indices whose documents are copied.'
                : 'The index that is copied. It is not changed by the operation itself.',
        };
      case 'options':
        return { icon: 'bi-sliders', title: 'Options and checks', subtitle: 'The checks follow the cluster live and update as you type.' };
      case 'review':
        return { icon: 'bi-eye', title: 'Review the requests', subtitle: 'Exactly what is sent to Elasticsearch when you confirm.' };
      case 'run':
        return { icon: 'bi-play-circle', title: 'Progress', subtitle: 'Follows the operation until it is done.' };
    }
  });

  /** Value shown under each completed step of the stepper. */
  readonly stepValues = computed<Readonly<Record<WizardStep, string>>>(() => {
    const info = this.store.info();
    const operation = this.store.operation();
    const sourceValue = operation === 'reindex' ? this.store.reindex().sources.trim() : this.store.source();
    const checks = this.store.checkSummary();
    return {
      operation: info?.label ?? '',
      source: sourceValue,
      options:
        // Reaching the review needed passing checks; afterwards they no longer matter.
        this.stepIndex() > 2
          ? 'Checks passed'
          : this.store.furthest() >= 2 && this.store.checks().length > 0
          ? checks.fail > 0
            ? `${pluralize(checks.fail, 'check')} failed`
            : checks.pending > 0
              ? 'Checking…'
              : 'Checks passed'
          : '',
      // A run picked up after a reload has no request in hand.
      review: this.store.furthest() >= 3 && this.store.requests().length > 0 ? pluralize(this.store.requests().length, 'request') : '',
      run: '',
    };
  });

  readonly note = computed(() => {
    const operation = this.store.operation();
    return operation ? NOTES[operation] : null;
  });

  readonly summaryRows = computed<readonly SummaryRow[]>(() => {
    const store = this.store;
    const operation = store.operation();
    if (isResizeKind(operation)) {
      const rows: SummaryRow[] = [];
      const run = store.run();
      // A run picked up after a reload knows the source from the run, not from the options.
      const source = store.sourceIndex() ?? (run.kind === 'resize' ? store.finishedSource() : null);
      if (store.source()) {
        rows.push({ label: 'Source', value: store.source(), mono: true });
      }
      if (source) {
        rows.push(
          { label: 'Documents', value: source.docs === null ? '–' : formatNumber(source.docs) },
          { label: 'Primary size', value: formatBytes(source.primarySize) },
          {
            label: 'Shards',
            value: `${pluralize(source.primaries ?? 0, 'primary', 'primaries')} × ${pluralize(source.replicas ?? 0, 'replica')}`,
          },
          { label: 'Health', value: healthLabel(source.health) },
        );
      }
      const target = store.target().trim() || (run.kind === 'resize' ? run.target : '');
      if (store.step() !== 'source' && target) {
        rows.push({ label: 'Target', value: target, mono: true });
        const shards = store.shards();
        if (shards !== null) {
          rows.push({ label: 'Target shards', value: `${pluralize(shards, 'primary', 'primaries')} × ${pluralize(store.resizeOptions().replicas ?? source?.replicas ?? 0, 'replica')}` });
        } else if (run.kind === 'resize' && run.recovery && run.recovery.primaries > 0) {
          rows.push({ label: 'Target shards', value: `${pluralize(run.recovery.primaries, 'primary', 'primaries')}, ${pluralize(run.recovery.total, 'copy', 'copies')}` });
        }
      }
      return rows;
    }
    if (operation === 'rollover') {
      const target = store.rolloverTarget();
      if (!target) {
        return [];
      }
      const dry = store.dryRun();
      const rows: SummaryRow[] = [
        { label: target.kind === 'alias' ? 'Alias' : 'Data stream', value: target.name, mono: true },
        { label: 'Write index', value: target.writeIndex ?? 'none', mono: true },
      ];
      const next = dry.state === 'ready' ? dry.preview.newIndex : store.newIndex().trim() || store.generatedName();
      if (next && store.run().kind === 'idle') {
        rows.push({ label: 'New index', value: next, mono: true });
      }
      const conditions = Object.values(store.conditions()).filter((value) => value.trim()).length;
      if (store.step() !== 'source') {
        rows.push({ label: 'Conditions', value: conditions === 0 ? 'None (roll over now)' : pluralize(conditions, 'condition') });
      }
      return rows;
    }
    if (operation === 'reindex') {
      const options = store.reindex();
      const rows: SummaryRow[] = [];
      if (options.sources.trim()) {
        rows.push({ label: 'Sources', value: options.sources.trim(), mono: true });
      }
      const lookup = store.sourcesLookup();
      if (lookup.state === 'ready') {
        const docs = lookup.indices.reduce((sum, index) => sum + (index.docs ?? 0), 0);
        rows.push({ label: 'Matches', value: `${pluralize(lookup.indices.length, 'index', 'indices')} · ${pluralize(docs, 'document')}` });
      }
      if (options.dest.trim()) {
        rows.push({ label: 'Destination', value: options.dest.trim(), mono: true });
      }
      if (store.step() !== 'source') {
        rows.push({ label: 'On conflicts', value: options.conflicts === 'proceed' ? 'Proceed (count them)' : 'Abort' });
      }
      return rows;
    }
    return [];
  });

  /** Step 1 only needs a footer to go on with an operation chosen earlier; a run hides it until it ends. */
  readonly showFooter = computed(() => {
    switch (this.store.step()) {
      case 'operation':
        return this.store.operation() !== null || !!this.blocked();
      case 'run':
        return !this.store.running();
      default:
        return true;
    }
  });

  /**
   * The run can be retried with other choices: the request was refused, or a
   * reindex failed, stopped with failures, was cancelled or got lost.
   */
  readonly canRetry = computed(() => {
    const run = this.store.run();
    if (run.kind === 'idle') {
      return false;
    }
    if (run.phase === 'failed') {
      return true;
    }
    if (run.kind === 'reindex') {
      const outcome = run.progress?.outcome;
      return run.phase === 'lost' || (run.phase === 'done' && (outcome === 'failed' || outcome === 'partial' || outcome === 'cancelled'));
    }
    return false;
  });

  /** What a reload must restore while a run is in progress or done: the task or the new index. */
  private readonly runParams = computed<{ readonly task: string | null; readonly target: string | null }>(() => {
    const run = this.store.run();
    if (run.kind === 'reindex' && run.taskId && run.phase !== 'failed') {
      return { task: run.taskId, target: null };
    }
    if (run.kind === 'resize' && (run.phase === 'recovering' || run.phase === 'done')) {
      return { task: null, target: run.target };
    }
    return { task: null, target: null };
  });

  readonly runLabel = computed(() => this.store.info()?.runLabel ?? 'Run');
  readonly runTone = computed(() => (this.store.risk() ? 'danger' : 'primary'));

  constructor() {
    // Deep links (`?op=shrink&index=logs`) and links followed while on the page.
    const subscription = this.route.queryParamMap.subscribe((params) => {
      const op = params.get('op');
      const kind = isOperationKind(op) ? op : null;
      const index = kind ? (params.get('index') ?? '') : '';
      const task = kind === 'reindex' ? params.get('task') : null;
      const target = isResizeKind(kind) && index ? params.get('target') : null;
      const key = `${kind ?? ''}|${index}|${task ?? ''}|${target ?? ''}`;
      // Only links that change the URL apply (not the URL the wizard writes).
      if (key === this.urlKey) {
        return;
      }
      this.urlKey = key;
      untracked(() => void this.followLink(kind, index, task, target));
    });
    inject(DestroyRef).onDestroy(() => subscription.unsubscribe());

    // Keep the URL in step with the wizard (bookmarks, reloads), written
    // when the operation, the source or the step changes.
    effect(() => {
      this.store.operation();
      this.store.source();
      this.runParams();
      this.store.step();
      untracked(() => this.writeUrl());
    });
  }

  /**
   * A link followed while on the page (sidebar, command palette, Back and
   * Forward). One without an operation, or with the operation and source
   * already open, keeps the wizard; another one asks before it drops edits or
   * forgets a block, and a declined one puts the wizard's URL back.
   */
  private async followLink(kind: OperationKind | null, index: string, task: string | null, target: string | null): Promise<void> {
    const sequence = ++this.linkSequence;
    const store = this.store;
    const open = store.operation() !== null;
    const same = kind === store.operation() && index === store.currentSourceParam() && !task && !target;
    if (store.running() || (open && (!kind || same))) {
      this.writeUrl(true);
      return;
    }
    if (store.dirty()) {
      const discard = await this.confirmDiscard();
      if (sequence !== this.linkSequence) {
        return;
      }
      if (!discard) {
        this.writeUrl(true);
        return;
      }
      if (store.sourceChanged()?.index !== index) {
        // The user chose to leave the block in place: stop reminding.
        store.forgetChanges();
      }
    }
    // A reload during (or after) a run follows it again instead of offering to start another one.
    if (task) {
      store.resumeReindex(task, index);
    } else if (target && isResizeKind(kind)) {
      void store.resumeResize(kind, index, target);
    } else {
      store.applyParams(kind, index);
    }
  }

  /** Writes the wizard's state to the URL (`force`: also when it matches the last URL seen). */
  private writeUrl(force = false): void {
    const op = this.store.operation();
    const { task, target } = this.runParams();
    const index = op === 'reindex' ? this.store.reindex().sources.trim() : this.store.source();
    const key = `${op ?? ''}|${op ? index : ''}|${task ?? ''}|${target ?? ''}`;
    if (key === this.urlKey && !force) {
      return;
    }
    this.urlKey = key;
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { op: op ?? null, index: op && index ? index : null, task, target },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  /* ---- Navigation ------------------------------------------------------------- */

  /** Steps before the current one can be revisited until the operation runs. */
  canVisit(index: number): boolean {
    return this.store.run().kind === 'idle' && index < this.stepIndex();
  }

  visit(step: WizardStep, index: number): void {
    if (this.canVisit(index)) {
      this.store.goTo(step);
      this.focusHeading();
    }
  }

  back(): void {
    const previous = WIZARD_STEPS[this.stepIndex() - 1];
    if (previous && this.store.run().kind === 'idle') {
      this.store.goTo(previous.key);
      this.focusHeading();
    }
  }

  continue(): void {
    this.attempted.set(null);
    switch (this.store.step()) {
      case 'operation':
        if (this.store.operation()) {
          this.advance('source');
        } else {
          this.attempted.set('operation');
        }
        return;
      case 'source':
        this.continueFromSource();
        return;
      case 'options':
        this.continueFromOptions();
        return;
      case 'review':
        void this.store.execute();
        this.focusHeading();
        return;
      case 'run':
        return;
    }
  }

  private continueFromSource(): void {
    const operation = this.store.operation();
    const problem = this.sourceProblem();
    if (problem) {
      this.attempted.set('source');
      this.focusFirst('[data-source-field]');
      return;
    }
    if (operation) {
      this.advance('options');
    }
  }

  /** Why the source step cannot be left, or `null`. */
  private sourceProblem(): string | null {
    const operation = this.store.operation();
    if (operation === 'reindex') {
      const lookup = this.store.sourcesLookup();
      if (!this.store.reindex().sources.trim()) {
        return 'Enter the indices to copy from.';
      }
      switch (lookup.state) {
        case 'idle':
        case 'loading':
          return 'Still looking up the sources; try again in a moment.';
        case 'error':
          return lookup.reason;
        case 'missing':
          return 'No index matches the sources.';
        case 'ready':
          return lookup.indices.length === 0 ? 'No index matches the sources.' : null;
      }
    }
    if (operation === 'rollover') {
      const target = this.store.rolloverTarget();
      if (!target) {
        return 'Choose an alias or a data stream.';
      }
      return target.problem ? `${target.name}: ${target.problem}.` : null;
    }
    const lookup = this.store.sourceLookup();
    if (!this.store.source()) {
      return 'Choose the source index.';
    }
    switch (lookup.state) {
      case 'idle':
      case 'loading':
        return 'Still loading the index; try again in a moment.';
      case 'missing':
        return `No index named ${this.store.source()} exists.`;
      case 'error':
        return lookup.reason;
      case 'ready':
        return null;
    }
  }

  private continueFromOptions(): void {
    this.store.submitted.set(true);
    const problem = this.optionsProblem();
    if (!problem) {
      this.advance('review');
      return;
    }
    this.attempted.set('options');
    this.focusFirst(this.store.hasFieldErrors() ? '[aria-invalid="true"]' : '#ops-checks-title');
  }

  /** Why the options step cannot be left, or `null`. */
  private optionsProblem(): string | null {
    if (this.store.hasFieldErrors()) {
      return 'Correct the highlighted fields.';
    }
    const summary = this.store.checkSummary();
    if (summary.fail > 0) {
      return `${pluralize(summary.fail, 'check')} ${summary.fail === 1 ? 'fails' : 'fail'}: fix ${summary.fail === 1 ? 'it' : 'them'} before reviewing.`;
    }
    if (summary.pending > 0) {
      return `Waiting for ${pluralize(summary.pending, 'check')} to finish.`;
    }
    return null;
  }

  advance(step: WizardStep): void {
    this.store.goTo(step);
    this.focusHeading();
  }

  startOver(): void {
    void this.confirmDiscard().then((discard) => {
      if (discard) {
        // The user chose to leave the block in place: stop reminding.
        this.store.forgetChanges();
        this.store.resetAll();
        this.focusHeading();
      }
    });
  }

  /** After a failed or stopped run: the review with the same choices. */
  retry(): void {
    this.store.backToReview();
    this.focusHeading();
  }

  changeOptions(): void {
    this.store.changeOptions();
    this.focusHeading();
  }

  /** Moves focus to the step heading after the step renders. */
  private focusHeading(): void {
    this.focusFirst('#ops-step-title', true);
  }

  private focusFirst(selector: string, preventScroll = false): void {
    afterNextRender(
      () => {
        const element = this.host.nativeElement.querySelector<HTMLElement>(selector);
        if (element) {
          element.focus({ preventScroll });
          if (preventScroll) {
            const top = element.getBoundingClientRect().top;
            if (top < 0 || top > window.innerHeight * 0.6) {
              element.scrollIntoView({ block: 'start' });
            }
          }
        }
      },
      { injector: this.injector },
    );
  }

  /* ---- Pending changes -------------------------------------------------------- */

  onBeforeUnload(event: BeforeUnloadEvent): void {
    if (this.store.dirty()) {
      event.preventDefault();
    }
  }

  async confirmDiscard(): Promise<boolean> {
    if (!this.store.dirty()) {
      return true;
    }
    const info = this.store.info();
    const changed = this.store.sourceChanged();
    const blocked = changed
      ? `${changed.index} still refuses writes${changed.requiredNode ? ` and keeps its shards on ${changed.requiredNode}` : ''} (set by this wizard)`
      : '';
    const pending = this.store.edited() && this.store.run().kind === 'idle';
    if (!pending && changed) {
      return this.dialogs.confirm({
        title: `Leave ${changed.index} blocked?`,
        message: `${blocked}. Lift it with “Allow writes again” before leaving, or later under Index settings.`,
        confirmLabel: 'Leave it blocked',
        cancelLabel: 'Stay',
        tone: 'warning',
      });
    }
    return this.dialogs.confirm({
      title: 'Discard this operation?',
      message:
        `The ${info ? info.kind : 'operation'} has not run. The source and options you chose will be lost.` +
        (blocked ? ` ${blocked}: lift it under Index settings if you do not run it later.` : ''),
      confirmLabel: 'Discard',
      cancelLabel: 'Keep editing',
      tone: 'danger',
    });
  }
}
