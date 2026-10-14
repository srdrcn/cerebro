import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  signal,
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
import { pluralize } from '../../core/format';
import { validateResourceName } from '../../core/names';
import { PendingChangesAware } from '../../core/pending-changes.guard';
import { RefreshService } from '../../core/refresh.service';
import { saveLabel, saveMode } from '../../core/save-mode';
import { CodeEditorComponent } from '../../shared/code-editor.component';
import { EmptyStateComponent } from '../../shared/empty-state.component';
import { NumberPipe, PluralPipe } from '../../shared/format.pipes';
import { SearchInputComponent } from '../../shared/search-input.component';
import {
  LegacyTemplate,
  NEW_TEMPLATE_BODY,
  analyzeTemplateBody,
  isManagedLegacyTemplate,
  searchLegacyTemplates,
  templateBodyWarning,
  templateOrder,
  templatePattern,
  templateSource,
  templateVersion,
  upsertTemplate,
} from './templates.models';

interface TemplateRow {
  readonly template: LegacyTemplate;
  readonly name: string;
  readonly patterns: string;
  readonly order: number | null;
  readonly version: number | null;
}

interface EditorBaseline {
  readonly name: string;
  readonly body: string;
}

const NEW_BASELINE: EditorBaseline = { name: '', body: NEW_TEMPLATE_BODY };

@Component({
  selector: 'cerebro-templates',
  imports: [
    CodeEditorComponent,
    EmptyStateComponent,
    FormsModule,
    NumberPipe,
    PluralPipe,
    RouterLink,
    SearchInputComponent,
  ],
  host: { '(window:beforeunload)': 'onBeforeUnload($event)' },
  templateUrl: './templates.component.html',
  styleUrl: './templates.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TemplatesComponent implements PendingChangesAware {
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

  readonly templates = signal<readonly LegacyTemplate[] | undefined>(undefined);
  readonly loading = signal(false);
  readonly failed = signal(false);
  /** Why the list could not be loaded, as a sentence for the error state. */
  readonly loadError = signal<string | undefined>(undefined);
  readonly query = signal('');
  /** Built-in templates (".monitoring-*", `_meta.managed`) are hidden by default. */
  readonly showManaged = signal(false);

  /** Name of the stored template being edited; null while writing a new one. */
  readonly selected = signal<string | null>(null);
  readonly name = signal('');
  readonly body = signal(NEW_TEMPLATE_BODY);
  readonly baseline = signal<EditorBaseline>(NEW_BASELINE);
  /** Set by the first save attempt: from then on every field error shows. */
  readonly submitted = signal(false);
  readonly saving = signal(false);
  readonly deleting = signal(false);

  readonly rows = computed<readonly TemplateRow[]>(() =>
    searchLegacyTemplates(this.templates() ?? [], this.query(), this.showManaged()).map((template) => ({
      template,
      name: template.name,
      patterns: templatePattern(template),
      order: templateOrder(template),
      version: templateVersion(template),
    })),
  );

  readonly managedCount = computed(
    () => (this.templates() ?? []).filter((template) => isManagedLegacyTemplate(template)).length,
  );
  /** Templates listed without a filter: managed ones count only while shown. */
  readonly totalCount = computed(
    () => (this.templates()?.length ?? 0) - (this.showManaged() ? 0 : this.managedCount()),
  );

  readonly names = computed(() => (this.templates() ?? []).map((template) => template.name));

  readonly selectedTemplate = computed(() => {
    const selected = this.selected();
    return (this.templates() ?? []).find((template) => template.name === selected);
  });

  /** The edited template was deleted on the cluster since it was opened. */
  readonly selectedMissing = computed(
    () => this.selected() !== null && this.templates() !== undefined && !this.selectedTemplate(),
  );

  readonly selectedPatterns = computed(() => {
    const template = this.selectedTemplate();
    return template ? templatePattern(template) : '';
  });

  readonly selectedVersion = computed(() => {
    const template = this.selectedTemplate();
    return template ? templateVersion(template) : null;
  });

  readonly nameValidation = computed(() => validateResourceName(this.name(), 'template'));
  /** Shown after a save attempt, or live once a name has been typed. */
  readonly nameError = computed(() =>
    this.name() !== '' || this.submitted() ? this.nameValidation() : null,
  );

  readonly bodyState = computed(() => analyzeTemplateBody(this.body()));
  readonly bodyError = computed(() => {
    const state = this.bodyState();
    return state.ok ? null : state.message;
  });
  readonly bodyWarning = computed(() => {
    const state = this.bodyState();
    return state.ok ? templateBodyWarning(state.value) : null;
  });
  /** Announced to screen readers: changes on transitions only, not per keystroke. */
  readonly bodyStatus = computed(() =>
    this.bodyError() ? 'Invalid JSON' : this.bodyWarning() ? 'Valid JSON, check the warning' : 'Valid JSON',
  );
  readonly bodyLinesLabel = computed(() => pluralize(this.body().split('\n').length, 'line'));

  readonly dirty = computed(() => {
    const baseline = this.baseline();
    return this.name() !== baseline.name || this.body() !== baseline.body;
  });

  readonly mode = computed(() => saveMode(this.name(), this.selected(), this.names()));
  readonly saveLabel = computed(() => saveLabel(this.mode(), 'template'));

  private loadSequence = 0;
  private destroyed = false;
  /** Template requested by the URL, opened once the list is loaded. */
  private pendingName: string | null = this.route.snapshot.queryParamMap.get('name');

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
    });
    effect(() => {
      this.refreshService.tick();
      if (this.connection.connected()) {
        void this.load();
      }
    });
    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((params) => void this.applyParams(params));
  }

  /** Follows links and history entries that name a template (?name=). */
  private async applyParams(params: ParamMap): Promise<void> {
    const name = params.get('name');
    if (name === this.selected()) {
      return;
    }
    if (this.templates() === undefined) {
      this.pendingName = name;
      return;
    }
    if (name === null) {
      // A link to this page without a template (sidebar, palette) keeps the
      // open template: write it back so the URL still describes the page.
      this.syncUrl();
      return;
    }
    const template = this.templates()?.find((item) => item.name === name);
    if (template) {
      await this.select(template);
    } else {
      this.alerts.warn(`The template ${name} does not exist`);
    }
    // A cancelled discard keeps the current template: put it back in the URL.
    this.syncUrl();
  }

  async load(): Promise<void> {
    const sequence = ++this.loadSequence;
    this.loading.set(true);
    try {
      const templates = await this.api.post<readonly LegacyTemplate[]>('templates');
      if (sequence === this.loadSequence) {
        this.templates.set(templates);
        this.failed.set(false);
        this.loadError.set(undefined);
        this.openPending();
      }
    } catch (error: unknown) {
      if (sequence === this.loadSequence) {
        this.failed.set(true);
        this.loadError.set(readableReason(error));
        this.alerts.error(failureMessage('Could not load legacy templates', error), error);
      }
    } finally {
      if (sequence === this.loadSequence) {
        this.loading.set(false);
      }
    }
  }

  /** Asks the browser to confirm closing the tab while edits are unsaved. */
  onBeforeUnload(event: BeforeUnloadEvent): void {
    if (this.dirty()) {
      event.preventDefault();
    }
  }

  async select(template: LegacyTemplate): Promise<void> {
    // The editor is tied to the template being saved until the request ends.
    if (this.saving()) {
      return;
    }
    if (this.selected() === template.name && !this.selectedMissing()) {
      this.revealEditor();
      return;
    }
    if (!(await this.confirmDiscard()) || this.saving()) {
      return;
    }
    this.open(template);
    this.syncUrl();
    this.revealEditor();
  }

  async newTemplate(): Promise<void> {
    if (this.saving()) {
      return;
    }
    if (this.selected() === null && !this.dirty()) {
      this.nameInput()?.nativeElement.focus();
      return;
    }
    if (!(await this.confirmDiscard()) || this.saving()) {
      return;
    }
    this.resetEditor();
    this.syncUrl();
    this.revealEditor();
    this.nameInput()?.nativeElement.focus();
  }

  discardChanges(): void {
    const baseline = this.baseline();
    this.name.set(baseline.name);
    this.body.set(baseline.body);
    this.submitted.set(false);
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
    const template = this.selectedTemplate();
    if (template) {
      this.dialogs.showJson(`Template ${template.name}`, template.template, this.selectedPatterns() || undefined);
    }
  }

  /** Validates on submit: the first invalid field gets the focus. */
  async save(): Promise<void> {
    if (this.saving() || this.deleting()) {
      return;
    }
    this.submitted.set(true);
    if (this.nameValidation()) {
      this.nameInput()?.nativeElement.focus();
      return;
    }
    const state = this.bodyState();
    if (!state.ok) {
      this.editor()?.focus();
      return;
    }
    if (this.mode() === 'update' && !this.dirty() && !this.selectedMissing()) {
      this.alerts.info(`Template ${this.name()} has no unsaved changes`);
      return;
    }
    const name = this.name();
    const body = this.body();
    const mode = this.mode();

    if (mode === 'overwrite') {
      const confirmed = await this.dialogs.confirm({
        title: `Overwrite template ${name}?`,
        message: `A template named ${name} already exists. Its patterns, settings, mappings and aliases will be replaced by this body.`,
        confirmLabel: 'Overwrite template',
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
      const response = await this.api.post<unknown>('templates/create', { name, template: state.value });
      this.alerts.success(created ? `Template ${name} created` : `Template ${name} updated`, response);
      // Known to exist now: list it right away so the editor never reports it
      // as missing while the list reloads.
      this.templates.update((list) => upsertTemplate(list, { name, template: state.value }));
      // The list is locked while saving, so the editor still belongs to the
      // saved template; edits typed meanwhile stay as unsaved changes on top.
      tracked = this.selected() === startSelected;
      if (tracked) {
        this.selected.set(name);
        this.baseline.set({ name, body });
        this.submitted.set(false);
        this.syncUrl();
      }
    } catch (error: unknown) {
      this.alerts.error(failureMessage(`Could not save template ${name}`, error), error);
      return;
    } finally {
      this.saving.set(false);
    }

    await this.load();
    // Show what Elasticsearch stored (normalized settings, default order)
    // unless the user moved on or kept typing while the list reloaded.
    const stored = this.templates()?.find((template) => template.name === name);
    if (tracked && stored && this.selected() === name && this.name() === name && this.body() === body) {
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
    const patterns = this.selectedPatterns();
    const confirmed = await this.dialogs.confirm({
      title: `Delete template ${name}?`,
      message: patterns
        ? `Existing indices are not affected, but new indices matching ${patterns} will no longer receive its settings, mappings and aliases.`
        : 'Existing indices are not affected.',
      confirmLabel: 'Delete template',
      tone: 'danger',
    });
    if (!confirmed) {
      return;
    }

    this.deleting.set(true);
    try {
      const response = await this.api.post<unknown>('templates/delete', { name });
      this.alerts.success(`Template ${name} deleted`, response);
      if (this.selected() === name) {
        this.resetEditor();
        this.syncUrl();
      }
      await this.load();
    } catch (error: unknown) {
      this.alerts.error(failureMessage(`Could not delete template ${name}`, error), error);
    } finally {
      this.deleting.set(false);
    }
  }

  /**
   * Resolves `true` when the editor holds nothing unsaved or the user agreed
   * to drop it. Used when switching templates and by the route guard.
   */
  async confirmDiscard(): Promise<boolean> {
    if (!this.dirty()) {
      return true;
    }
    const subject = this.selected() ?? (this.name() || 'the new template');
    return this.dialogs.confirm({
      title: 'Discard unsaved changes?',
      message: `Your changes to ${subject} have not been saved and will be lost.`,
      confirmLabel: 'Discard changes',
      cancelLabel: 'Keep editing',
      tone: 'danger',
    });
  }

  private open(template: LegacyTemplate): void {
    const source = templateSource(template);
    if (isManagedLegacyTemplate(template)) {
      this.showManaged.set(true);
    }
    this.selected.set(template.name);
    this.name.set(template.name);
    this.body.set(source);
    this.baseline.set({ name: template.name, body: source });
    this.submitted.set(false);
  }

  /** Opens the template named by the URL once the list has loaded. */
  private openPending(): void {
    const name = this.pendingName;
    if (name === null) {
      return;
    }
    this.pendingName = null;
    const template = this.templates()?.find((item) => item.name === name);
    if (!template) {
      this.alerts.warn(`The template ${name} does not exist`);
      this.syncUrl();
      return;
    }
    // Opening from the URL never discards edits typed while the list loaded.
    if (this.selected() === null && !this.dirty()) {
      this.open(template);
    } else {
      this.syncUrl();
    }
  }

  /** Keeps the open template in the URL so it can be reloaded and shared. */
  private syncUrl(): void {
    if (this.destroyed) {
      return;
    }
    this.router
      .navigate([], {
        relativeTo: this.route,
        queryParams: { name: this.selected() },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      })
      .catch(() => false);
  }

  private resetEditor(): void {
    this.selected.set(null);
    this.name.set(NEW_BASELINE.name);
    this.body.set(NEW_BASELINE.body);
    this.baseline.set(NEW_BASELINE);
    this.submitted.set(false);
  }

  /** On the single-column layout the editor sits below the list. */
  private revealEditor(): void {
    const card = this.editorCard()?.nativeElement;
    if (card && globalThis.matchMedia?.('(max-width: 1180px)').matches) {
      card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }
}
