import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, ParamMap, Router } from '@angular/router';
import { skip } from 'rxjs';
import { AlertService } from '../../core/alert.service';
import { ClusterApiService } from '../../core/cluster-api.service';
import { ConnectionService } from '../../core/connection.service';
import { DialogService } from '../../core/dialog.service';
import { failureMessage, readableReason } from '../../core/errors';
import { pluralize } from '../../core/format';
import { revealWhenStacked } from '../../core/layout';
import { PendingChangesAware } from '../../core/pending-changes.guard';
import { readPreference, writePreference } from '../../core/preferences';
import { RefreshService } from '../../core/refresh.service';
import { saveLabel, saveMode } from '../../core/save-mode';
import { CodeEditorComponent } from '../../shared/code-editor.component';
import { EmptyStateComponent } from '../../shared/empty-state.component';
import { NumberPipe, PluralPipe } from '../../shared/format.pipes';
import { SearchInputComponent } from '../../shared/search-input.component';
import {
  FieldChange,
  PipelineSummary,
  PipelinesResponse,
  ProcessorView,
  SimulateDoc,
  SimulateResponse,
  SimulationResult,
  SimulationStep,
} from './pipelines.models';
import {
  NEW_PIPELINE_BODY,
  analyzePipelineBody,
  buildSimulatePayload,
  filterPipelines,
  normalizePipelines,
  normalizeSimulation,
  overallChanges,
  parseSampleDocs,
  pipelineSource,
  pipelineWarnings,
  processorViews,
  sampleDocsFor,
  simulationAnnouncement,
  validatePipelineId,
  withDescription,
} from './pipelines.utils';

interface EditorBaseline {
  readonly id: string;
  readonly body: string;
}

interface StepView extends SimulationStep {
  readonly key: string;
  readonly sourceText: string | null;
}

interface ResultView {
  readonly result: SimulationResult;
  readonly sourceText: string | null;
  readonly changes: readonly FieldChange[];
  readonly steps: readonly StepView[] | null;
  readonly ran: number;
}

const STATUS_BADGES: Readonly<Record<string, string>> = {
  success: 'badge-green',
  error: 'badge-red',
  error_ignored: 'badge-yellow',
  dropped: 'badge-purple',
};

const STATUS_LABELS: Readonly<Record<string, string>> = {
  success: 'Success',
  error: 'Failed',
  skipped: 'Skipped',
  error_ignored: 'Error ignored',
  dropped: 'Dropped',
};

const NEW_BASELINE: EditorBaseline = { id: '', body: NEW_PIPELINE_BODY };
const SHOW_MANAGED_PREFERENCE = 'cerebro.pipelines.showManaged';
const VERBOSE_PREFERENCE = 'cerebro.pipelines.verbose';

function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

@Component({
  selector: 'cerebro-pipelines',
  imports: [CodeEditorComponent, EmptyStateComponent, FormsModule, NumberPipe, PluralPipe, SearchInputComponent],
  host: { '(window:beforeunload)': 'onBeforeUnload($event)' },
  templateUrl: './pipelines.component.html',
  styleUrl: './pipelines.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PipelinesComponent implements PendingChangesAware {
  private readonly api = inject(ClusterApiService);
  private readonly alerts = inject(AlertService);
  private readonly dialogs = inject(DialogService);
  private readonly refreshService = inject(RefreshService);
  private readonly connection = inject(ConnectionService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  private readonly editor = viewChild<CodeEditorComponent>('pipelineEditor');
  private readonly docsEditor = viewChild<CodeEditorComponent>('docsEditor');
  private readonly idInput = viewChild<ElementRef<HTMLInputElement>>('idInput');
  private readonly editorCard = viewChild<ElementRef<HTMLElement>>('editorCard');
  private readonly resultsHeading = viewChild<ElementRef<HTMLElement>>('resultsHeading');

  readonly pipelines = signal<readonly PipelineSummary[] | undefined>(undefined);
  readonly loading = signal(false);
  readonly failed = signal(false);
  /** Readable reason of the last failed load, for the error state. */
  readonly loadError = signal<string | undefined>(undefined);
  readonly query = signal('');
  readonly showManaged = signal(readPreference(SHOW_MANAGED_PREFERENCE) === 'true');

  /** Id of the stored pipeline being edited; null while writing a new one. */
  readonly selected = signal<string | null>(null);
  readonly id = signal('');
  readonly body = signal(NEW_PIPELINE_BODY);
  readonly baseline = signal<EditorBaseline>(NEW_BASELINE);
  /** Set by the first save attempt: field errors show from then on. */
  readonly submitted = signal(false);
  readonly saving = signal(false);
  readonly deleting = signal(false);

  readonly managedCount = computed(() => (this.pipelines() ?? []).filter((pipeline) => pipeline.managed).length);
  /** Pipelines listed before the text filter (the selected managed one stays listed). */
  readonly listTotal = computed(
    () => filterPipelines(this.pipelines() ?? [], '', this.showManaged(), this.selected()).length,
  );
  readonly visiblePipelines = computed(() =>
    filterPipelines(this.pipelines() ?? [], this.query(), this.showManaged(), this.selected()),
  );
  readonly ids = computed(() => (this.pipelines() ?? []).map((pipeline) => pipeline.id));

  readonly selectedPipeline = computed(() => {
    const selected = this.selected();
    return (this.pipelines() ?? []).find((pipeline) => pipeline.id === selected);
  });
  readonly selectedMissing = computed(
    () => this.selected() !== null && this.pipelines() !== undefined && !this.selectedPipeline(),
  );

  readonly idValidation = computed(() => validatePipelineId(this.id()));
  readonly idError = computed(() => (this.id() !== '' || this.submitted() ? this.idValidation() : null));

  readonly bodyState = computed(() => analyzePipelineBody(this.body()));
  readonly bodyError = computed(() => {
    const state = this.bodyState();
    return state.ok ? null : state.message;
  });
  readonly bodyWarnings = computed(() => {
    const state = this.bodyState();
    return state.ok ? pipelineWarnings(state.value) : [];
  });
  /** Announced to screen readers: changes on transitions only, not per keystroke. */
  readonly bodyStatus = computed(() =>
    this.bodyError() ? 'Invalid pipeline' : this.bodyWarnings().length > 0 ? 'Valid JSON, check the warnings' : 'Valid JSON',
  );
  /** Last valid parse of the editor, so the processor list survives typos. */
  private lastValidBody = computed(() => {
    const state = this.bodyState();
    return state.ok ? state.value : (this.selectedPipeline()?.pipeline ?? null);
  });
  readonly processors = computed<readonly ProcessorView[]>(() => processorViews(this.lastValidBody()?.processors));
  readonly onFailure = computed<readonly ProcessorView[]>(() => processorViews(this.lastValidBody()?.on_failure));
  readonly description = computed(() => {
    const state = this.bodyState();
    const value = state.ok ? state.value.description : undefined;
    return typeof value === 'string' ? value : '';
  });

  readonly dirty = computed(() => {
    const baseline = this.baseline();
    return this.id() !== baseline.id || this.body() !== baseline.body;
  });
  readonly mode = computed(() => saveMode(this.id(), this.selected(), this.ids()));
  readonly saveLabel = computed(() => saveLabel(this.mode(), 'pipeline'));

  // ---- Test pipeline ----
  readonly sampleDocs = signal(sampleDocsFor(undefined));
  readonly sampleTouched = signal(false);
  readonly verbose = signal(readPreference(VERBOSE_PREFERENCE) !== 'false');
  readonly simulating = signal(false);
  readonly simError = signal<string | null>(null);
  readonly results = signal<readonly SimulationResult[] | undefined>(undefined);
  readonly resultInputs = signal<readonly SimulateDoc[]>([]);
  readonly resultBody = signal<string | null>(null);
  readonly resultVerbose = signal(false);
  readonly openSteps = signal<ReadonlySet<string>>(new Set());

  readonly docsState = computed(() => parseSampleDocs(this.sampleDocs()));
  readonly docsError = computed(() => {
    const state = this.docsState();
    return state.ok ? null : state.message;
  });
  readonly docsCount = computed(() => {
    const state = this.docsState();
    return state.ok ? state.docs.length : 0;
  });
  readonly resultsStale = computed(() => this.results() !== undefined && this.resultBody() !== this.body());
  readonly resultViews = computed<readonly ResultView[]>(() => {
    const inputs = this.resultInputs();
    return (this.results() ?? []).map((result) => ({
      result,
      sourceText: result.source ? json(result.source) : null,
      changes: result.steps ? [] : overallChanges(result, inputs[result.position - 1]),
      ran: result.steps ? result.steps.filter((step) => step.status !== 'skipped').length : 0,
      steps: result.steps
        ? result.steps.map((step) => ({
            ...step,
            key: `${result.position}-${step.position}`,
            sourceText: step.source ? json(step.source) : null,
          }))
        : null,
    }));
  });
  readonly resultSummary = computed(() => {
    const results = this.results() ?? [];
    return {
      ok: results.filter((result) => result.outcome === 'ok').length,
      error: results.filter((result) => result.outcome === 'error').length,
      dropped: results.filter((result) => result.outcome === 'dropped').length,
    };
  });
  /** Short text announced to screen readers after each run (the results themselves are not live). */
  readonly announcement = signal('');

  private loadSequence = 0;
  private simulateSequence = 0;
  private pendingSelection: string | null = null;
  private destroyed = false;

  constructor() {
    inject(DestroyRef).onDestroy(() => (this.destroyed = true));

    const params = this.route.snapshot.queryParamMap;
    this.pendingSelection = params.get('pipeline') ?? params.get('id') ?? params.get('name');

    effect(() => {
      this.refreshService.tick();
      if (this.connection.connected()) {
        untracked(() => void this.load());
      }
    });

    // Later links and history entries (the constructor read the first one).
    this.route.queryParamMap.pipe(skip(1), takeUntilDestroyed()).subscribe((next) => this.applyParams(next));
  }

  /**
   * Follows a link or history entry that names a pipeline (?pipeline=). A
   * link without one (the sidebar, the palette) keeps the open pipeline and
   * writes it back, so the URL always describes the page.
   */
  private applyParams(params: ParamMap): void {
    if (this.destroyed) {
      return;
    }
    const requested = params.get('pipeline') ?? params.get('id') ?? params.get('name');
    if (requested !== null && requested !== this.selected()) {
      const pipelines = this.pipelines();
      if (!pipelines) {
        this.pendingSelection = requested;
        return;
      }
      const pipeline = pipelines.find((item) => item.id === requested);
      if (!pipeline) {
        this.alerts.warn(`Ingest pipeline ${requested} does not exist`);
        this.updateUrl();
        return;
      }
      // A declined discard keeps the open pipeline: put it back in the URL.
      void this.select(pipeline).then(() => this.updateUrl());
      return;
    }
    if (params.get('pipeline') !== this.selected() || params.has('id') || params.has('name')) {
      this.updateUrl();
    }
  }

  async load(): Promise<void> {
    const sequence = ++this.loadSequence;
    this.loading.set(true);
    try {
      const response = await this.api.post<PipelinesResponse>('pipelines');
      if (sequence !== this.loadSequence) {
        return;
      }
      const pipelines = normalizePipelines(response);
      this.pipelines.set(pipelines);
      this.failed.set(false);
      this.loadError.set(undefined);
      this.syncEditorWithCluster(pipelines);
      this.applyPendingSelection(pipelines);
    } catch (error: unknown) {
      if (sequence === this.loadSequence) {
        this.failed.set(true);
        this.loadError.set(readableReason(error));
        this.alerts.error(failureMessage('Could not load ingest pipelines', error), error);
      }
    } finally {
      if (sequence === this.loadSequence) {
        this.loading.set(false);
      }
    }
  }

  private syncEditorWithCluster(pipelines: readonly PipelineSummary[]): void {
    const selected = this.selected();
    if (selected === null || this.dirty() || this.saving()) {
      return;
    }
    const stored = pipelines.find((pipeline) => pipeline.id === selected);
    if (stored) {
      const source = pipelineSource(stored.pipeline);
      if (source !== this.baseline().body) {
        this.body.set(source);
        this.baseline.set({ id: selected, body: source });
      }
    }
  }

  private applyPendingSelection(pipelines: readonly PipelineSummary[]): void {
    const id = this.pendingSelection;
    if (id === null) {
      return;
    }
    this.pendingSelection = null;
    if (this.destroyed) {
      return;
    }
    const pipeline = pipelines.find((item) => item.id === id);
    if (pipeline) {
      this.openPipeline(pipeline);
    } else {
      this.alerts.warn(`Ingest pipeline ${id} does not exist`);
      this.updateUrl();
    }
  }

  onBeforeUnload(event: BeforeUnloadEvent): void {
    if (this.dirty()) {
      event.preventDefault();
    }
  }

  setShowManaged(value: boolean): void {
    this.showManaged.set(value);
    writePreference(SHOW_MANAGED_PREFERENCE, String(value));
  }

  setVerbose(value: boolean): void {
    this.verbose.set(value);
    writePreference(VERBOSE_PREFERENCE, String(value));
  }

  // ---- Selection & editor ----

  async select(pipeline: PipelineSummary): Promise<void> {
    if (this.saving()) {
      return;
    }
    if (this.selected() === pipeline.id && !this.selectedMissing()) {
      this.revealEditor();
      return;
    }
    if (!(await this.confirmDiscard()) || this.saving()) {
      return;
    }
    this.openPipeline(pipeline);
    this.revealEditor();
  }

  private openPipeline(pipeline: PipelineSummary): void {
    const source = pipelineSource(pipeline.pipeline);
    this.selected.set(pipeline.id);
    this.id.set(pipeline.id);
    this.body.set(source);
    this.baseline.set({ id: pipeline.id, body: source });
    this.submitted.set(false);
    this.resetTest(pipeline.pipeline);
    this.updateUrl();
  }

  async newPipeline(): Promise<void> {
    if (this.saving()) {
      return;
    }
    if (this.selected() === null && !this.dirty()) {
      this.idInput()?.nativeElement.focus();
      return;
    }
    if (!(await this.confirmDiscard()) || this.saving()) {
      return;
    }
    this.resetEditor();
    this.revealEditor();
    queueMicrotask(() => this.idInput()?.nativeElement.focus());
  }

  discardChanges(): void {
    const baseline = this.baseline();
    this.id.set(baseline.id);
    this.body.set(baseline.body);
    this.submitted.set(false);
  }

  setDescription(value: string): void {
    const next = withDescription(this.body(), value);
    if (next !== null) {
      this.body.set(next);
    }
  }

  format(): void {
    const editor = this.editor();
    if (!editor) {
      return;
    }
    if (editor.format()) {
      editor.focus();
    } else {
      this.alerts.warn('Fix the JSON syntax before formatting', this.bodyError() ?? undefined);
    }
  }

  viewJson(): void {
    const pipeline = this.selectedPipeline();
    if (pipeline) {
      this.dialogs.showJson(`Pipeline ${pipeline.id}`, pipeline.pipeline, pipeline.description ?? undefined);
    }
  }

  /** Validates on submit: the first invalid field gets the focus. */
  async save(): Promise<void> {
    if (this.saving() || this.deleting()) {
      return;
    }
    this.submitted.set(true);
    if (this.idValidation()) {
      this.idInput()?.nativeElement.focus();
      return;
    }
    const state = this.bodyState();
    if (!state.ok) {
      this.editor()?.focus();
      return;
    }
    if (this.mode() === 'update' && !this.dirty() && !this.selectedMissing()) {
      this.alerts.info(`Pipeline ${this.id()} has no unsaved changes`);
      return;
    }
    const id = this.id();
    const body = this.body();
    const mode = this.mode();

    if (mode === 'overwrite') {
      const confirmed = await this.dialogs.confirm({
        title: `Overwrite pipeline ${id}?`,
        message: `A pipeline named ${id} already exists. Its processors will be replaced, and every index or request that uses it gets the new behaviour.`,
        confirmLabel: 'Overwrite pipeline',
        tone: 'danger',
      });
      if (!confirmed) {
        return;
      }
    }

    const created = mode === 'create' || mode === 'copy' || this.selectedMissing();
    const startSelected = this.selected();
    this.saving.set(true);
    let tracked = false;
    try {
      const response = await this.api.post<unknown>('pipelines/save', { id, pipeline: state.value });
      this.alerts.success(created ? `Pipeline ${id} created` : `Pipeline ${id} updated`, response);
      tracked = this.selected() === startSelected;
      if (tracked) {
        this.selected.set(id);
        this.baseline.set({ id, body });
        this.submitted.set(false);
        this.updateUrl();
      }
    } catch (error: unknown) {
      this.alerts.error(failureMessage(`Could not save pipeline ${id}`, error), error);
      return;
    } finally {
      this.saving.set(false);
    }

    await this.load();
    const stored = this.pipelines()?.find((pipeline) => pipeline.id === id);
    if (tracked && stored && this.selected() === id && this.id() === id && this.body() === body) {
      const source = pipelineSource(stored.pipeline);
      this.body.set(source);
      this.baseline.set({ id, body: source });
    }
  }

  async remove(): Promise<void> {
    const pipeline = this.selectedPipeline();
    if (!pipeline || this.deleting() || this.saving()) {
      return;
    }
    const confirmed = await this.dialogs.confirm({
      title: `Delete pipeline ${pipeline.id}?`,
      message:
        'Indexing requests and index settings (index.default_pipeline / index.final_pipeline) that still reference it will start failing. This cannot be undone.',
      confirmLabel: 'Delete pipeline',
      tone: 'danger',
    });
    if (!confirmed) {
      return;
    }
    this.deleting.set(true);
    try {
      const response = await this.api.post<unknown>('pipelines/delete', { id: pipeline.id });
      this.alerts.success(`Pipeline ${pipeline.id} deleted`, response);
      if (this.selected() === pipeline.id) {
        this.resetEditor();
      }
      await this.load();
    } catch (error: unknown) {
      this.alerts.error(failureMessage(`Could not delete pipeline ${pipeline.id}`, error), error);
    } finally {
      this.deleting.set(false);
    }
  }

  private resetEditor(): void {
    this.selected.set(null);
    this.id.set(NEW_BASELINE.id);
    this.body.set(NEW_BASELINE.body);
    this.baseline.set(NEW_BASELINE);
    this.submitted.set(false);
    const state = analyzePipelineBody(NEW_BASELINE.body);
    this.resetTest(state.ok ? state.value : undefined);
    this.updateUrl();
  }

  /**
   * Resolves `true` when the editor holds nothing unsaved or the user agreed
   * to drop it. Used when switching pipelines and by the route guard.
   */
  async confirmDiscard(): Promise<boolean> {
    if (!this.dirty()) {
      return true;
    }
    const subject = this.selected() ?? (this.id() || 'the new pipeline');
    return this.dialogs.confirm({
      title: 'Discard unsaved changes?',
      message: `Your changes to ${subject} have not been saved and will be lost.`,
      confirmLabel: 'Discard changes',
      cancelLabel: 'Keep editing',
      tone: 'danger',
    });
  }

  private revealEditor(): void {
    revealWhenStacked(this.editorCard()?.nativeElement);
  }

  /** Keeps the selected pipeline bookmarkable; never navigates once the page is gone. */
  private updateUrl(): void {
    if (this.destroyed) {
      return;
    }
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { pipeline: this.selected(), id: null, name: null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  // ---- Test pipeline ----

  private resetTest(pipeline: Parameters<typeof sampleDocsFor>[0]): void {
    this.simulateSequence++;
    this.simulating.set(false);
    this.results.set(undefined);
    this.simError.set(null);
    this.announcement.set('');
    this.openSteps.set(new Set());
    if (!this.sampleTouched()) {
      this.sampleDocs.set(sampleDocsFor(pipeline));
    }
  }

  setSampleDocs(value: string): void {
    this.sampleDocs.set(value);
    this.sampleTouched.set(true);
  }

  regenerateSamples(): void {
    const state = this.bodyState();
    this.sampleDocs.set(sampleDocsFor(state.ok ? state.value : this.selectedPipeline()?.pipeline));
    this.sampleTouched.set(false);
  }

  formatSamples(): void {
    const editor = this.docsEditor();
    if (editor && !editor.format()) {
      this.alerts.warn('Fix the JSON syntax before formatting', this.docsError() ?? undefined);
    }
  }

  /** Validates on submit: an invalid pipeline or sample document gets the focus. */
  async simulate(): Promise<void> {
    if (this.simulating()) {
      return;
    }
    const pipelineState = this.bodyState();
    if (!pipelineState.ok) {
      this.alerts.warn('Fix the pipeline JSON before testing it', pipelineState.message);
      this.editor()?.focus();
      return;
    }
    const docsState = this.docsState();
    if (!docsState.ok) {
      this.docsEditor()?.focus();
      return;
    }
    const sequence = ++this.simulateSequence;
    const body = this.body();
    const verbose = this.verbose();
    this.simulating.set(true);
    this.simError.set(null);
    try {
      const response = await this.api.post<SimulateResponse>(
        'pipelines/simulate',
        buildSimulatePayload(pipelineState.value, docsState.docs, verbose),
      );
      if (sequence !== this.simulateSequence) {
        return;
      }
      const results = normalizeSimulation(response, docsState.docs);
      this.results.set(results);
      this.announcement.set(simulationAnnouncement(results));
      this.resultInputs.set(docsState.docs);
      this.resultBody.set(body);
      this.resultVerbose.set(verbose);
      this.openSteps.set(new Set());
      queueMicrotask(() => this.resultsHeading()?.nativeElement.focus({ preventScroll: true }));
    } catch (error: unknown) {
      if (sequence === this.simulateSequence) {
        const reason = readableReason(error) ?? 'The cluster did not answer the simulate request.';
        this.results.set(undefined);
        this.simError.set(reason);
        this.announcement.set(`Elasticsearch rejected the simulation: ${reason}`);
      }
    } finally {
      if (sequence === this.simulateSequence) {
        this.simulating.set(false);
      }
    }
  }

  isStepOpen(key: string): boolean {
    return this.openSteps().has(key);
  }

  toggleStep(key: string): void {
    this.openSteps.update((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  showResultJson(view: ResultView): void {
    this.dialogs.showJson(`Document ${view.result.position} simulation`, view.result.raw, 'Raw _simulate response');
  }

  readonly pluralize = pluralize;

  statusLabel(status: string): string {
    return STATUS_LABELS[status] ?? status;
  }

  /** Badge tone of a verbose step; skipped steps stay neutral. */
  statusBadge(status: string): string {
    return STATUS_BADGES[status] ?? '';
  }

  changeSymbol(change: FieldChange): string {
    return change.kind === 'added' ? '+' : change.kind === 'removed' ? '−' : '~';
  }
}
