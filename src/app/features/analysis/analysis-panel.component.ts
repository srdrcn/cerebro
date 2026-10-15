import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AlertService } from '../../core/alert.service';
import { ClusterApiService } from '../../core/cluster-api.service';
import { DialogService } from '../../core/dialog.service';
import { failureMessage, readableReason } from '../../core/errors';
import { groupIndexNames, pluralize } from '../../core/format';
import { readJsonPreference, writeJsonPreference } from '../../core/preferences';
import { EmptyStateComponent } from '../../shared/empty-state.component';
import { NumberPipe } from '../../shared/format.pipes';
import { AnalysisMode, AnalysisRun, OptionGroup, TextSegment } from './analysis.models';
import {
  analysisAnnouncement,
  analyzerGroups,
  asNames,
  asTokens,
  defaultTarget,
  parseSelection,
  textSegments,
  tokenSummary,
} from './analysis.utils';

interface ModeConfig {
  readonly title: string;
  readonly subtitle: string;
  readonly icon: string;
  readonly targetLabel: string;
  readonly targetNoun: string;
  readonly placeholder: string;
  readonly optionsEndpoint: string;
  readonly analyzeEndpoint: string;
  readonly param: 'field' | 'analyzer';
  readonly idleText: string;
}

const MODES: Readonly<Record<AnalysisMode, ModeConfig>> = {
  field: {
    title: 'Analyze by field',
    subtitle: 'Uses the analyzer mapped to a text field.',
    icon: 'bi-input-cursor-text',
    targetLabel: 'Field',
    targetNoun: 'fields',
    placeholder: 'Select a field',
    optionsEndpoint: 'analysis/fields',
    analyzeEndpoint: 'analysis/analyze/field',
    param: 'field',
    idleText: 'Pick an index and a text field, type some text and run the analysis to see the tokens it would index.',
  },
  analyzer: {
    title: 'Analyze by analyzer',
    subtitle: 'Runs a built-in or index-defined analyzer.',
    icon: 'bi-funnel',
    targetLabel: 'Analyzer',
    targetNoun: 'analyzers',
    placeholder: 'Select an analyzer',
    optionsEndpoint: 'analysis/analyzers',
    analyzeEndpoint: 'analysis/analyze/analyzer',
    param: 'analyzer',
    idleText: 'Pick an index and an analyzer, type some text and run the analysis to see the tokens it produces.',
  },
};

const PREFERENCE_PREFIX = 'cerebro.analysis.';

let nextPanelId = 0;

@Component({
  selector: 'cerebro-analysis-panel',
  imports: [EmptyStateComponent, FormsModule, NumberPipe],
  templateUrl: './analysis-panel.component.html',
  styleUrl: './analysis-panel.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AnalysisPanelComponent {
  private readonly api = inject(ClusterApiService);
  private readonly alerts = inject(AlertService);
  private readonly dialogs = inject(DialogService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly document = inject(DOCUMENT);

  readonly mode = input.required<AnalysisMode>();
  /** Open indices of the cluster, loaded once by the page. */
  readonly indices = input.required<readonly string[]>();
  readonly indicesLoading = input(false);

  readonly id = `analysis-${nextPanelId++}`;
  readonly pluralize = pluralize;
  readonly config = computed(() => MODES[this.mode()]);
  readonly shortcut = /Mac|iPhone|iPad/.test(this.document.defaultView?.navigator.userAgent ?? '')
    ? '⌘'
    : 'Ctrl';

  readonly index = signal('');
  readonly target = signal('');
  /**
   * Remembered field/analyzer waiting for the options of its index. It stays
   * remembered when those options fail to load, until the user picks another.
   */
  private readonly pendingTarget = signal('');
  readonly text = signal('');
  readonly options = signal<readonly string[]>([]);
  readonly optionsLoading = signal(false);
  readonly optionsFailed = signal(false);
  readonly submitted = signal(false);

  readonly run = signal<AnalysisRun | null>(null);
  readonly running = signal(false);
  readonly runError = signal<string | null>(null);
  readonly hovered = signal<number | null>(null);
  readonly pinned = signal<number | null>(null);
  readonly active = computed(() => this.hovered() ?? this.pinned());

  readonly indexGroups = computed(() => groupIndexNames(this.indices()));

  readonly targetGroups = computed<readonly OptionGroup[]>(() =>
    this.mode() === 'analyzer'
      ? analyzerGroups(this.options())
      : [{ label: '', options: this.options() }],
  );

  readonly targetDisabled = computed(
    () =>
      !this.index() ||
      this.optionsLoading() ||
      (this.mode() === 'field' && this.options().length === 0),
  );

  readonly targetPlaceholder = computed(() => {
    if (!this.index()) {
      return 'Select an index first';
    }
    if (this.optionsLoading()) {
      return `Loading ${this.config().targetNoun}…`;
    }
    if (this.mode() === 'field' && this.options().length === 0) {
      return this.optionsFailed() ? 'Fields unavailable' : 'No text fields';
    }
    return this.config().placeholder;
  });

  readonly errors = computed(() => ({
    index: this.index() ? null : 'Choose an index',
    target: this.target() ? null : `Choose ${this.mode() === 'field' ? 'a field' : 'an analyzer'}`,
    text: this.text() ? null : 'Enter some text to analyze',
  }));

  readonly invalid = computed(() => {
    const errors = this.errors();
    return Boolean(errors.index ?? errors.target ?? errors.text);
  });

  readonly summary = computed(() => tokenSummary(this.run()?.tokens ?? []));
  /** Outcome announced to screen readers (cleared while a run is in flight). */
  readonly announcement = computed(() =>
    this.running() ? '' : analysisAnnouncement(this.run(), this.runError()),
  );
  readonly segments = computed(() => {
    const run = this.run();
    return run ? textSegments(run.text, run.tokens) : [];
  });

  private restored = false;
  private optionsSequence = 0;
  private analyzeSequence = 0;

  constructor() {
    // Restore the last index and field/analyzer once the indices are known.
    effect(() => {
      const indices = this.indices();
      if (this.restored || indices.length === 0) {
        return;
      }
      this.restored = true;
      untracked(() => {
        const saved = parseSelection(readJsonPreference<unknown>(this.preferenceKey(), null));
        if (saved && indices.includes(saved.index)) {
          this.selectIndex(saved.index, saved.target);
        }
      });
    });

    // Forget a selected index that disappeared after a refresh (deleted or closed).
    effect(() => {
      const indices = this.indices();
      const index = untracked(() => this.index());
      if (index && indices.length > 0 && !indices.includes(index)) {
        untracked(() => this.selectIndex(''));
      }
    });

    // Remember the selection, never the text.
    effect(() => {
      const selection = { index: this.index(), target: this.pendingTarget() || this.target() };
      if (this.restored) {
        writeJsonPreference(this.preferenceKey(), selection);
      }
    });
  }

  selectIndex(index: string, preferredTarget = ''): void {
    this.index.set(index);
    this.target.set('');
    this.pendingTarget.set(index ? preferredTarget : '');
    this.options.set([]);
    this.optionsFailed.set(false);
    this.clearResults();
    if (!index) {
      this.optionsSequence++;
      this.optionsLoading.set(false);
      return;
    }
    void this.loadOptions(index);
  }

  selectTarget(target: string): void {
    this.target.set(target);
    this.pendingTarget.set('');
  }

  async loadOptions(index: string): Promise<void> {
    const sequence = ++this.optionsSequence;
    const config = this.config();
    const preferredTarget = this.pendingTarget() || this.target();
    this.optionsLoading.set(true);
    this.optionsFailed.set(false);
    try {
      const names = asNames(await this.api.post<unknown>(config.optionsEndpoint, { index }));
      if (sequence !== this.optionsSequence) {
        return;
      }
      this.options.set(names);
      this.target.set(defaultTarget(this.mode(), names, preferredTarget));
      this.pendingTarget.set('');
    } catch (error: unknown) {
      if (sequence !== this.optionsSequence) {
        return;
      }
      this.optionsFailed.set(true);
      if (this.mode() === 'analyzer') {
        // Built-in analyzers still work without the index's own list.
        this.target.set(defaultTarget('analyzer', [], preferredTarget));
      }
      this.alerts.error(failureMessage(`Could not load the ${config.targetNoun} of ${index}`, error), error);
    } finally {
      if (sequence === this.optionsSequence) {
        this.optionsLoading.set(false);
      }
    }
  }

  retryOptions(): void {
    const index = this.index();
    if (index) {
      void this.loadOptions(index);
    }
  }

  onTextKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      void this.analyze();
    }
  }

  async analyze(): Promise<void> {
    this.submitted.set(true);
    if (this.invalid()) {
      this.focusFirstInvalid();
      return;
    }
    if (this.optionsLoading()) {
      return;
    }

    const config = this.config();
    const request = { index: this.index(), target: this.target(), text: this.text() };
    const sequence = ++this.analyzeSequence;
    this.running.set(true);
    this.runError.set(null);
    try {
      const response = await this.api.post<unknown>(config.analyzeEndpoint, {
        index: request.index,
        [config.param]: request.target,
        text: request.text,
      });
      if (sequence !== this.analyzeSequence) {
        return;
      }
      this.hovered.set(null);
      this.pinned.set(null);
      this.run.set({ ...request, tokens: asTokens(response), raw: response });
    } catch (error: unknown) {
      if (sequence !== this.analyzeSequence) {
        return;
      }
      this.run.set(null);
      this.runError.set(readableReason(error) ?? 'The cluster could not analyze the text.');
      this.alerts.error(failureMessage(`Could not analyze the text with ${request.target}`, error), error);
    } finally {
      if (sequence === this.analyzeSequence) {
        this.running.set(false);
      }
    }
  }

  togglePin(index: number): void {
    this.pinned.update((current) => (current === index ? null : index));
  }

  segmentActive(segment: TextSegment): boolean {
    const active = this.active();
    return active !== null && segment.tokens.includes(active);
  }

  segmentTitle(segment: TextSegment): string {
    const run = this.run();
    if (!run || segment.tokens.length === 0) {
      return 'Not part of any token';
    }
    return segment.tokens.map((index) => run.tokens[index]?.token ?? '').join(', ');
  }

  showRaw(): void {
    const run = this.run();
    if (run) {
      this.dialogs.showJson('Analysis tokens', run.raw, `${run.index} · ${run.target}`);
    }
  }

  private clearResults(): void {
    this.analyzeSequence++;
    this.running.set(false);
    this.run.set(null);
    this.runError.set(null);
    this.hovered.set(null);
    this.pinned.set(null);
    this.submitted.set(false);
  }

  private focusFirstInvalid(): void {
    afterNextRender(
      () => {
        this.host.nativeElement
          .querySelector<HTMLElement>('[aria-invalid="true"]:not(:disabled)')
          ?.focus();
      },
      { injector: this.injector },
    );
  }

  private preferenceKey(): string {
    return `${PREFERENCE_PREFIX}${this.mode()}`;
  }
}
