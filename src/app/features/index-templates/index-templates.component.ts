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
import { ActivatedRoute, ParamMap, Router, RouterLink } from '@angular/router';
import { AlertService } from '../../core/alert.service';
import { ClusterApiService } from '../../core/cluster-api.service';
import { ConnectionService } from '../../core/connection.service';
import { DialogService } from '../../core/dialog.service';
import { failureMessage, readableReason } from '../../core/errors';
import { pluralize, sentence } from '../../core/format';
import { JsonRecord, isRecord } from '../../core/json';
import { validateResourceName } from '../../core/names';
import { PendingChangesAware } from '../../core/pending-changes.guard';
import { RefreshService } from '../../core/refresh.service';
import { saveLabel, saveMode } from '../../core/save-mode';
import { CodeEditorComponent } from '../../shared/code-editor.component';
import { EmptyStateComponent } from '../../shared/empty-state.component';
import { NumberPipe, PluralPipe } from '../../shared/format.pipes';
import { SearchInputComponent } from '../../shared/search-input.component';
import {
  ComponentTemplateBody,
  ComponentTemplateEntry,
  ComponentTemplatesResponse,
  IndexTemplateBody,
  IndexTemplateEntry,
  IndexTemplatesResponse,
  NEW_COMPONENT_TEMPLATE_BODY,
  NEW_INDEX_TEMPLATE_BODY,
  ResolvedView,
  SettingEntry,
  SimulateResponse,
  TemplateKind,
  TemplateRow,
} from './index-templates.models';
import {
  analyzeBody,
  buildResolvedView,
  componentTemplateRow,
  componentUsage,
  composedOf,
  describeContent,
  filterRows,
  ignoredComponents,
  indexPatterns,
  indexTemplateRow,
  isDataStreamTemplate,
  isManagedTemplate,
  isUnknownEndpoint,
  kindParam,
  metaDescription,
  metaTags,
  parseKind,
  removeByName,
  templatePriority,
  templateSource,
  templateVersion,
  upsertByName,
} from './index-templates.utils';
import { ResolvedTemplateComponent } from './resolved-template.component';

interface EditorBaseline {
  readonly name: string;
  readonly body: string;
}

/** Facts shown above the editor, read from the (valid) editor content. */
interface EditorSummary {
  readonly patterns: readonly string[];
  readonly priority: number | null;
  readonly version: number | null;
  readonly dataStream: boolean;
  /** `missing`: does not exist; `optional`: listed in ignore_missing_component_templates. */
  readonly composedOf: readonly { readonly name: string; readonly missing: boolean; readonly optional: boolean }[];
  readonly contents: string;
  readonly description: string | null;
  readonly meta: readonly SettingEntry[];
}

type PreviewState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading'; readonly name: string }
  | { readonly status: 'error'; readonly name: string; readonly message: string }
  | {
      readonly status: 'ready';
      readonly name: string;
      readonly view: ResolvedView;
      readonly raw: SimulateResponse;
      readonly patterns: string;
      readonly components: number;
    };

const KIND_NOUN: Readonly<Record<TemplateKind, string>> = {
  index: 'index template',
  component: 'component template',
};

function skeleton(kind: TemplateKind): string {
  return kind === 'index' ? NEW_INDEX_TEMPLATE_BODY : NEW_COMPONENT_TEMPLATE_BODY;
}

@Component({
  selector: 'cerebro-index-templates',
  imports: [
    CodeEditorComponent,
    EmptyStateComponent,
    FormsModule,
    NumberPipe,
    PluralPipe,
    ResolvedTemplateComponent,
    RouterLink,
    SearchInputComponent,
  ],
  host: { '(window:beforeunload)': 'onBeforeUnload($event)' },
  templateUrl: './index-templates.component.html',
  styleUrl: './index-templates.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class IndexTemplatesComponent implements PendingChangesAware {
  private readonly api = inject(ClusterApiService);
  private readonly alerts = inject(AlertService);
  private readonly dialogs = inject(DialogService);
  private readonly refreshService = inject(RefreshService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly connection = inject(ConnectionService);

  private readonly editor = viewChild(CodeEditorComponent);
  private readonly nameInput = viewChild<ElementRef<HTMLInputElement>>('nameInput');
  private readonly editorCard = viewChild<ElementRef<HTMLElement>>('editorCard');
  private readonly previewCard = viewChild<ElementRef<HTMLElement>>('previewCard');

  readonly indexTemplates = signal<readonly IndexTemplateEntry[] | undefined>(undefined);
  readonly componentTemplates = signal<readonly ComponentTemplateEntry[] | undefined>(undefined);
  readonly loading = signal(false);
  readonly failed = signal(false);
  /** Why the lists could not be loaded, as a sentence for the error state. */
  readonly loadError = signal<string | undefined>(undefined);

  readonly tab = signal<TemplateKind>(parseKind(this.route.snapshot.queryParamMap.get('tab')));
  readonly query = signal('');
  readonly showManaged = signal(false);

  /** Kind and name of the stored template being edited (null: a new one). */
  readonly kind = signal<TemplateKind>(this.tab());
  readonly selected = signal<string | null>(null);
  readonly name = signal('');
  readonly body = signal(skeleton(this.tab()));
  readonly baseline = signal<EditorBaseline>({ name: '', body: skeleton(this.tab()) });
  /** Set by the first save attempt: from then on every field error shows. */
  readonly submitted = signal(false);
  readonly saving = signal(false);
  readonly deleting = signal(false);
  readonly saveError = signal<string | null>(null);
  readonly preview = signal<PreviewState>({ status: 'idle' });

  readonly loaded = computed(
    () => this.indexTemplates() !== undefined && this.componentTemplates() !== undefined,
  );

  readonly usage = computed(() => componentUsage(this.indexTemplates() ?? []));

  private readonly allRows = computed<Readonly<Record<TemplateKind, readonly TemplateRow[]>>>(() => {
    const usage = this.usage();
    return {
      index: (this.indexTemplates() ?? []).map((entry) => indexTemplateRow(entry)),
      component: (this.componentTemplates() ?? []).map((entry) => componentTemplateRow(entry, usage)),
    };
  });

  /** Visible (non managed unless shown) templates per tab, for the tab badges. */
  readonly counts = computed<Readonly<Record<TemplateKind, number>>>(() => {
    const rows = this.allRows();
    const show = this.showManaged();
    return {
      index: rows.index.filter((row) => show || !row.managed).length,
      component: rows.component.filter((row) => show || !row.managed).length,
    };
  });

  readonly managedCount = computed(() => this.allRows()[this.tab()].filter((row) => row.managed).length);
  readonly totalCount = computed(() => this.allRows()[this.tab()].filter((row) => this.showManaged() || !row.managed).length);
  readonly rows = computed(() => filterRows(this.allRows()[this.tab()], this.query(), this.showManaged()));

  readonly componentNames = computed(() => (this.componentTemplates() ?? []).map((entry) => entry.name));

  private readonly namesOfKind = computed(() =>
    this.kind() === 'index'
      ? (this.indexTemplates() ?? []).map((entry) => entry.name)
      : this.componentNames(),
  );

  readonly selectedIndexTemplate = computed(() => {
    const name = this.selected();
    return this.kind() === 'index' && name !== null
      ? (this.indexTemplates() ?? []).find((entry) => entry.name === name)
      : undefined;
  });

  readonly selectedComponentTemplate = computed(() => {
    const name = this.selected();
    return this.kind() === 'component' && name !== null
      ? (this.componentTemplates() ?? []).find((entry) => entry.name === name)
      : undefined;
  });

  readonly selectedBody = computed<JsonRecord | undefined>(
    () => this.selectedIndexTemplate()?.index_template ?? this.selectedComponentTemplate()?.component_template,
  );

  readonly selectedManaged = computed(() => {
    const name = this.selected();
    return name !== null && isManagedTemplate(name, this.selectedBody()?.['_meta']);
  });

  /** The edited template was deleted on the cluster since it was opened. */
  readonly selectedMissing = computed(
    () => this.selected() !== null && this.loaded() && this.selectedBody() === undefined,
  );

  readonly usedBy = computed(() => {
    const name = this.selected();
    return this.kind() === 'component' && name !== null ? (this.usage().get(name) ?? []) : [];
  });

  readonly nameValidation = computed(() => validateResourceName(this.name(), 'template'));
  /** Shown after a save attempt, or live once a name has been typed. */
  readonly nameError = computed(() => (this.name() !== '' || this.submitted() ? this.nameValidation() : null));

  readonly check = computed(() =>
    analyzeBody(this.body(), this.kind(), this.componentTemplates() === undefined ? null : this.componentNames()),
  );
  readonly syntaxError = computed(() => {
    const check = this.check();
    return check.ok ? null : check.message;
  });
  readonly problems = computed(() => {
    const check = this.check();
    return check.ok ? check.problems : [];
  });
  readonly errors = computed(() => this.problems().filter((problem) => problem.level === 'error'));
  readonly warnings = computed(() => this.problems().filter((problem) => problem.level === 'warning'));
  readonly bodyInvalid = computed(() => this.syntaxError() !== null || this.errors().length > 0);
  /** Announced to screen readers: changes on transitions only, not per keystroke. */
  readonly bodyStatus = computed(() => {
    if (this.syntaxError() !== null) {
      return 'Invalid JSON';
    }
    const errors = this.errors().length;
    return errors > 0 ? pluralize(errors, 'problem') : 'Valid JSON';
  });

  /** What the editor content describes; falls back to the stored template. */
  readonly summary = computed<EditorSummary | null>(() => {
    const check = this.check();
    const body = check.ok ? check.value : this.selectedBody();
    if (!body) {
      return null;
    }
    const components = this.componentNames();
    const known = this.componentTemplates() !== undefined;
    if (this.kind() === 'index') {
      const template = body as IndexTemplateBody;
      const ignored = ignoredComponents(template);
      return {
        patterns: indexPatterns(template),
        priority: templatePriority(template),
        version: templateVersion(template),
        dataStream: isDataStreamTemplate(template),
        composedOf: composedOf(template).map((name) => {
          const absent = known && !components.includes(name);
          return { name, missing: absent && !ignored.includes(name), optional: absent && ignored.includes(name) };
        }),
        contents: describeContent(isRecord(template.template) ? template.template : undefined),
        description: metaDescription(template._meta),
        meta: metaTags(template._meta),
      };
    }
    const component = body as ComponentTemplateBody;
    return {
      patterns: [],
      priority: null,
      version: templateVersion(component),
      dataStream: false,
      composedOf: [],
      contents: describeContent(isRecord(component.template) ? component.template : undefined),
      description: metaDescription(component._meta),
      meta: metaTags(component._meta),
    };
  });

  readonly selectedPatterns = computed(() => indexPatterns(this.selectedIndexTemplate()?.index_template).join(', '));

  readonly bodyLinesLabel = computed(() => pluralize(this.body().split('\n').length, 'line'));

  readonly dirty = computed(() => {
    const baseline = this.baseline();
    return this.name() !== baseline.name || this.body() !== baseline.body;
  });

  readonly mode = computed(() => saveMode(this.name(), this.selected(), this.namesOfKind()));
  readonly saveLabel = computed(() => saveLabel(this.mode(), 'template'));
  readonly noun = computed(() => KIND_NOUN[this.kind()]);
  readonly pluralize = pluralize;

  readonly canPreview = computed(
    () => this.kind() === 'index' && this.selectedIndexTemplate() !== undefined && this.preview().status !== 'loading',
  );

  private loadSequence = 0;
  private previewSequence = 0;
  private destroyed = false;
  /** Template requested by the URL, opened once the lists are loaded. */
  private pendingName: string | null = this.route.snapshot.queryParamMap.get('name');
  /** Last opened template per tab, restored when switching back. */
  private readonly lastSelected: Record<TemplateKind, string | null> = { index: null, component: null };

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
    });
    effect(() => {
      this.refreshService.tick();
      if (this.connection.connected()) {
        void untracked(() => this.load());
      }
    });
    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((params) => void this.applyParams(params));
  }

  /** Follows links and history entries that change the tab or template. */
  private async applyParams(params: ParamMap): Promise<void> {
    const kind = parseKind(params.get('tab'));
    const name = params.get('name');
    if (kind === this.tab() && name === null) {
      // A link to this page without a template (sidebar, palette) keeps the
      // open template: write it back so the URL still describes the page.
      if (this.loaded()) {
        if (this.selected() !== null) {
          this.syncUrl();
        }
      } else {
        this.pendingName = null;
      }
      return;
    }
    if (kind === this.tab() && name === this.selected() && kind === this.kind()) {
      return;
    }
    if (!this.loaded()) {
      this.tab.set(kind);
      this.pendingName = name;
      if (!this.dirty() && this.selected() === null) {
        this.resetEditor(kind);
      }
      return;
    }
    if (name !== null) {
      await this.openTemplate(kind, name);
    } else {
      await this.setTab(kind);
    }
    // A cancelled discard keeps the current template: put it back in the URL.
    this.syncUrl();
  }

  async load(): Promise<void> {
    const sequence = ++this.loadSequence;
    this.loading.set(true);
    try {
      const [indexResponse, componentResponse] = await Promise.all([
        this.api.post<IndexTemplatesResponse>('index_templates'),
        this.api.post<ComponentTemplatesResponse>('component_templates'),
      ]);
      if (sequence !== this.loadSequence) {
        return;
      }
      this.indexTemplates.set(indexResponse?.index_templates ?? []);
      this.componentTemplates.set(componentResponse?.component_templates ?? []);
      this.failed.set(false);
      this.loadError.set(undefined);
      this.openPending();
    } catch (error: unknown) {
      if (sequence === this.loadSequence) {
        this.failed.set(true);
        this.loadError.set(this.describeLoadFailure(error));
        this.alerts.error(failureMessage('Could not load index templates', error), error);
      }
    } finally {
      if (sequence === this.loadSequence) {
        this.loading.set(false);
      }
    }
  }

  /**
   * The reason for the error state. The version hint is only added when the
   * cluster answered without the composable template APIs, not when it is down.
   */
  private describeLoadFailure(error: unknown): string {
    const reason = readableReason(error);
    const versionHint = 'Composable templates need Elasticsearch 7.8 or later.';
    if (isUnknownEndpoint(error)) {
      return reason ? `${reason} ${versionHint}` : versionHint;
    }
    return reason ?? 'The cluster did not answer the template requests.';
  }

  /** Asks the browser to confirm closing the tab while edits are unsaved. */
  onBeforeUnload(event: BeforeUnloadEvent): void {
    if (this.dirty()) {
      event.preventDefault();
    }
  }

  async setTab(kind: TemplateKind): Promise<void> {
    if (kind === this.tab() || this.saving()) {
      return;
    }
    if (!(await this.confirmDiscard())) {
      return;
    }
    this.tab.set(kind);
    const previous = this.lastSelected[kind];
    const entry = previous === null ? undefined : this.bodyOf(kind, previous);
    if (previous !== null && entry) {
      this.open(kind, previous, entry);
    } else {
      this.resetEditor(kind);
    }
    this.syncUrl();
  }

  /** Arrow keys move between the tabs (WAI-ARIA tabs pattern). */
  onTabKeydown(event: KeyboardEvent): void {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
      return;
    }
    event.preventDefault();
    const next: TemplateKind = this.tab() === 'index' ? 'component' : 'index';
    void this.setTab(next).then(() => {
      document.getElementById(`templates-tab-${this.tab()}`)?.focus();
    });
  }

  async select(row: TemplateRow): Promise<void> {
    await this.openTemplate(row.kind, row.name);
  }

  /** Opens a template by kind and name (also from composed_of / used-by chips). */
  async openTemplate(kind: TemplateKind, name: string): Promise<void> {
    if (this.saving()) {
      return;
    }
    if (this.kind() === kind && this.selected() === name && !this.selectedMissing()) {
      this.revealEditor();
      return;
    }
    const entry = this.bodyOf(kind, name);
    if (!entry) {
      this.alerts.warn(`The ${KIND_NOUN[kind]} ${name} does not exist`);
      return;
    }
    if (!(await this.confirmDiscard()) || this.saving()) {
      return;
    }
    if (isManagedTemplate(name, entry['_meta'])) {
      this.showManaged.set(true);
    }
    this.tab.set(kind);
    this.open(kind, name, entry);
    this.syncUrl();
    this.revealEditor();
  }

  async newTemplate(): Promise<void> {
    if (this.saving()) {
      return;
    }
    const kind = this.tab();
    if (this.kind() === kind && this.selected() === null && !this.dirty()) {
      this.nameInput()?.nativeElement.focus();
      return;
    }
    if (!(await this.confirmDiscard()) || this.saving()) {
      return;
    }
    this.resetEditor(kind);
    this.syncUrl();
    this.revealEditor();
    this.nameInput()?.nativeElement.focus();
  }

  discardChanges(): void {
    const baseline = this.baseline();
    this.name.set(baseline.name);
    this.body.set(baseline.body);
    this.submitted.set(false);
    this.saveError.set(null);
  }

  format(): void {
    const editor = this.editor();
    if (!editor) {
      return;
    }
    if (editor.format()) {
      editor.focus();
    } else {
      this.alerts.warn('Fix the JSON syntax before formatting', this.syntaxError() ?? undefined);
    }
  }

  viewJson(): void {
    const name = this.selected();
    const body = this.selectedBody();
    if (name !== null && body) {
      this.dialogs.showJson(
        `${this.kind() === 'index' ? 'Index template' : 'Component template'} ${name}`,
        body,
        this.kind() === 'index' ? this.selectedPatterns() || undefined : describeContent(isRecord(body['template']) ? body['template'] : undefined),
      );
    }
  }

  /** Validates on submit: the first invalid field gets the focus. */
  async save(): Promise<void> {
    if (this.saving() || this.deleting()) {
      return;
    }
    // Without the lists, an existing name cannot be told apart from a new one.
    if (!this.loaded()) {
      this.alerts.warn(
        this.failed() ? 'Load the templates again before saving' : 'Wait for the templates to load before saving',
      );
      return;
    }
    this.submitted.set(true);
    if (this.nameValidation()) {
      this.nameInput()?.nativeElement.focus();
      return;
    }
    const check = this.check();
    if (!check.ok || this.errors().length > 0) {
      this.editor()?.focus();
      return;
    }
    if (this.mode() === 'update' && !this.dirty() && !this.selectedMissing()) {
      this.alerts.info(`${sentence(this.noun())} ${this.name()} has no unsaved changes`);
      return;
    }
    const kind = this.kind();
    const noun = KIND_NOUN[kind];
    const name = this.name();
    const body = this.body();
    const mode = this.mode();

    if (mode === 'overwrite') {
      const confirmed = await this.dialogs.confirm({
        title: `Overwrite ${noun} ${name}?`,
        message: `A ${noun} named ${name} already exists. Its whole definition will be replaced by this body.`,
        confirmLabel: `Overwrite ${noun}`,
        tone: 'danger',
      });
      if (!confirmed || this.saving()) {
        return;
      }
    }

    const created = mode === 'create' || mode === 'copy' || this.selectedMissing();
    const startSelected = this.selected();
    this.saving.set(true);
    this.saveError.set(null);
    let tracked = false;
    try {
      const path = kind === 'index' ? 'index_templates/save' : 'component_templates/save';
      const response = await this.api.post<unknown>(path, { name, template: check.value });
      this.alerts.success(`${sentence(noun)} ${name} ${created ? 'created' : 'updated'}`, response);
      if (kind === 'index') {
        this.indexTemplates.update((list) => upsertByName(list, { name, index_template: check.value }));
      } else {
        this.componentTemplates.update((list) => upsertByName(list, { name, component_template: check.value }));
      }
      tracked = this.selected() === startSelected && this.kind() === kind;
      if (tracked) {
        this.selected.set(name);
        this.baseline.set({ name, body });
        this.submitted.set(false);
        this.lastSelected[kind] = name;
        this.syncUrl();
        if (this.preview().status !== 'idle') {
          void this.loadPreview(false);
        }
      }
    } catch (error: unknown) {
      const message = failureMessage(`Could not save ${noun} ${name}`, error);
      this.saveError.set(message);
      this.alerts.error(message, error);
      return;
    } finally {
      this.saving.set(false);
    }

    await this.load();
    // Show what Elasticsearch stored unless the user moved on or kept typing.
    const stored = this.bodyOf(kind, name);
    if (tracked && stored && this.kind() === kind && this.selected() === name && this.name() === name && this.body() === body) {
      const source = templateSource(stored);
      this.body.set(source);
      this.baseline.set({ name, body: source });
    }
  }

  async remove(): Promise<void> {
    const name = this.selected();
    if (name === null || this.deleting() || this.saving()) {
      return;
    }
    const kind = this.kind();
    const noun = KIND_NOUN[kind];
    const users = this.usedBy();
    if (kind === 'component' && users.length > 0) {
      this.alerts.warn(
        `${name} is still used by ${users.join(', ')}. Remove it from "composed_of" there before deleting it.`,
      );
      return;
    }
    const patterns = this.selectedPatterns();
    const dataStream = kind === 'index' && isDataStreamTemplate(this.selectedIndexTemplate()?.index_template);
    const confirmed = await this.dialogs.confirm({
      title: `Delete ${noun} ${name}?`,
      message: dataStream
        ? `This template creates data streams${patterns ? ` matching ${patterns}` : ''}. Elasticsearch refuses to delete it while data streams created from it exist; delete those streams on the Data streams page first. This cannot be undone.`
        : kind === 'index'
          ? `Existing indices keep their settings and mappings, but new indices${patterns ? ` matching ${patterns}` : ''} will no longer be created from this template.`
          : 'Index templates no longer reference it, so nothing else changes. This cannot be undone.',
      confirmLabel: `Delete ${noun}`,
      tone: 'danger',
    });
    if (!confirmed) {
      return;
    }
    this.deleting.set(true);
    try {
      const path = kind === 'index' ? 'index_templates/delete' : 'component_templates/delete';
      const response = await this.api.post<unknown>(path, { name });
      this.alerts.success(`${sentence(noun)} ${name} deleted`, response);
      if (kind === 'index') {
        this.indexTemplates.update((list) => removeByName(list, name));
      } else {
        this.componentTemplates.update((list) => removeByName(list, name));
      }
      if (this.lastSelected[kind] === name) {
        this.lastSelected[kind] = null;
      }
      if (this.kind() === kind && this.selected() === name) {
        this.resetEditor(kind);
        this.syncUrl();
      }
      void this.load();
    } catch (error: unknown) {
      this.alerts.error(failureMessage(`Could not delete ${noun} ${name}`, error), error);
    } finally {
      this.deleting.set(false);
    }
  }

  /** Resolves the open index template; `reveal` scrolls the preview into view. */
  async loadPreview(reveal = true): Promise<void> {
    const template = this.selectedIndexTemplate();
    if (!template) {
      return;
    }
    const name = template.name;
    const sequence = ++this.previewSequence;
    this.preview.set({ status: 'loading', name });
    if (reveal) {
      this.revealPreview();
    }
    try {
      const response = await this.api.post<SimulateResponse>('index_templates/simulate', { name });
      if (sequence !== this.previewSequence) {
        return;
      }
      const stored = this.indexTemplates()?.find((entry) => entry.name === name)?.index_template;
      this.preview.set({
        status: 'ready',
        name,
        raw: response,
        view: buildResolvedView(response, stored, this.componentTemplates() ?? []),
        patterns: indexPatterns(stored).join(', '),
        components: composedOf(stored).length,
      });
    } catch (error: unknown) {
      if (sequence === this.previewSequence) {
        this.preview.set({ status: 'error', name, message: failureMessage('Elasticsearch could not resolve the template', error) });
      }
    }
  }

  closePreview(): void {
    this.previewSequence++;
    this.preview.set({ status: 'idle' });
  }

  viewPreviewJson(): void {
    const preview = this.preview();
    if (preview.status === 'ready') {
      this.dialogs.showJson(`Resolved template ${preview.name}`, preview.raw, preview.patterns || undefined);
    }
  }

  setShowManaged(show: boolean): void {
    this.showManaged.set(show);
  }

  private bodyOf(kind: TemplateKind, name: string): JsonRecord | undefined {
    return kind === 'index'
      ? this.indexTemplates()?.find((entry) => entry.name === name)?.index_template
      : this.componentTemplates()?.find((entry) => entry.name === name)?.component_template;
  }

  private open(kind: TemplateKind, name: string, body: JsonRecord): void {
    const source = templateSource(body);
    this.kind.set(kind);
    this.selected.set(name);
    this.name.set(name);
    this.body.set(source);
    this.baseline.set({ name, body: source });
    this.submitted.set(false);
    this.saveError.set(null);
    this.lastSelected[kind] = name;
    if (this.preview().status !== 'idle') {
      this.closePreview();
    }
  }

  private resetEditor(kind: TemplateKind): void {
    const body = skeleton(kind);
    this.kind.set(kind);
    this.selected.set(null);
    this.name.set('');
    this.body.set(body);
    this.baseline.set({ name: '', body });
    this.submitted.set(false);
    this.saveError.set(null);
    this.closePreview();
  }

  private openPending(): void {
    const name = this.pendingName;
    if (name === null) {
      return;
    }
    this.pendingName = null;
    const kind = this.tab();
    const entry = this.bodyOf(kind, name);
    if (!entry) {
      this.alerts.warn(`The ${KIND_NOUN[kind]} ${name} does not exist`);
      this.syncUrl();
      return;
    }
    if (isManagedTemplate(name, entry['_meta'])) {
      this.showManaged.set(true);
    }
    this.open(kind, name, entry);
  }

  /**
   * Resolves `true` when the editor holds nothing unsaved or the user agreed
   * to drop it. Used when switching templates and by the route guard.
   */
  async confirmDiscard(): Promise<boolean> {
    if (!this.dirty()) {
      return true;
    }
    const subject = this.selected() ?? (this.name() || `the new ${this.noun()}`);
    return this.dialogs.confirm({
      title: 'Discard unsaved changes?',
      message: `Your changes to ${subject} have not been saved and will be lost.`,
      confirmLabel: 'Discard changes',
      cancelLabel: 'Keep editing',
      tone: 'danger',
    });
  }

  /** Keeps the tab and the open template in the URL so it can be shared. */
  private syncUrl(): void {
    if (this.destroyed) {
      return;
    }
    this.router
      .navigate([], {
        relativeTo: this.route,
        queryParams: { tab: kindParam(this.tab()), name: this.selected() },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      })
      .catch(() => false);
  }

  /** On the single-column layout the editor sits below the list. */
  private revealEditor(): void {
    const card = this.editorCard()?.nativeElement;
    if (card && globalThis.matchMedia?.('(max-width: 1180px)').matches) {
      card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  private revealPreview(): void {
    setTimeout(() => this.previewCard()?.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }
}
