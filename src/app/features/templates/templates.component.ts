import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { AlertService } from '../../core/alert.service';
import { ClusterApiService } from '../../core/cluster-api.service';
import { ConnectionService } from '../../core/connection.service';
import { DialogService } from '../../core/dialog.service';
import { PendingChangesAware } from '../../core/pending-changes.guard';
import { RefreshService } from '../../core/refresh.service';
import { CodeEditorComponent } from '../../shared/code-editor.component';
import { EmptyStateComponent } from '../../shared/empty-state.component';
import { SearchInputComponent } from '../../shared/search-input.component';
import {
  LegacyTemplate,
  NEW_TEMPLATE_BODY,
  SaveMode,
  analyzeTemplateBody,
  saveMode,
  searchLegacyTemplates,
  templateBodyWarning,
  templateOrder,
  templatePattern,
  templateSource,
  templateVersion,
  upsertTemplate,
  validateTemplateName,
} from './templates.models';
import { registerTemplatesLeaveGuard } from './templates.guard';

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

const SAVE_LABELS: Readonly<Record<SaveMode, string>> = {
  create: 'Create template',
  update: 'Save changes',
  overwrite: 'Overwrite template',
  copy: 'Save as new template',
};

const NEW_BASELINE: EditorBaseline = { name: '', body: NEW_TEMPLATE_BODY };

@Component({
  selector: 'cerebro-templates',
  imports: [CodeEditorComponent, EmptyStateComponent, FormsModule, RouterLink, SearchInputComponent],
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
  readonly connection = inject(ConnectionService);

  private readonly editor = viewChild(CodeEditorComponent);
  private readonly nameInput = viewChild<ElementRef<HTMLInputElement>>('nameInput');
  private readonly editorCard = viewChild<ElementRef<HTMLElement>>('editorCard');

  readonly templates = signal<readonly LegacyTemplate[] | undefined>(undefined);
  readonly loading = signal(false);
  readonly failed = signal(false);
  readonly query = signal('');

  /** Name of the stored template being edited; null while writing a new one. */
  readonly selected = signal<string | null>(null);
  readonly name = signal('');
  readonly body = signal(NEW_TEMPLATE_BODY);
  readonly baseline = signal<EditorBaseline>(NEW_BASELINE);
  readonly nameTouched = signal(false);
  readonly saving = signal(false);
  readonly deleting = signal(false);

  readonly rows = computed<readonly TemplateRow[]>(() =>
    searchLegacyTemplates(this.templates() ?? [], this.query()).map((template) => ({
      template,
      name: template.name,
      patterns: templatePattern(template),
      order: templateOrder(template),
      version: templateVersion(template),
    })),
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

  readonly nameValidation = computed(() => validateTemplateName(this.name()));
  readonly nameError = computed(() =>
    this.name() !== '' || this.nameTouched() ? this.nameValidation() : null,
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
  readonly bodyLines = computed(() => this.body().split('\n').length);
  readonly bodyLinesLabel = computed(() => {
    const lines = this.bodyLines();
    return lines === 1 ? '1 line' : `${lines} lines`;
  });

  readonly dirty = computed(() => {
    const baseline = this.baseline();
    return this.name() !== baseline.name || this.body() !== baseline.body;
  });

  readonly mode = computed(() => saveMode(this.name(), this.selected(), this.names()));
  readonly saveLabel = computed(() => SAVE_LABELS[this.mode()]);

  readonly blocker = computed<string | null>(() => {
    if (this.nameValidation()) {
      return this.nameValidation();
    }
    if (this.bodyError()) {
      return 'Fix the template body';
    }
    if (this.mode() === 'update' && !this.dirty() && !this.selectedMissing()) {
      return 'No changes to save';
    }
    return null;
  });

  readonly canSave = computed(() => this.blocker() === null && !this.saving() && !this.deleting());

  private loadSequence = 0;

  constructor() {
    // Asks before in-app navigation drops unsaved editor changes.
    registerTemplatesLeaveGuard(inject(ActivatedRoute).routeConfig);

    effect(() => {
      this.refreshService.tick();
      if (this.connection.connected()) {
        void this.load();
      }
    });
  }

  async load(): Promise<void> {
    const sequence = ++this.loadSequence;
    this.loading.set(true);
    try {
      const templates = await this.api.post<readonly LegacyTemplate[]>('templates');
      if (sequence === this.loadSequence) {
        this.templates.set(templates);
        this.failed.set(false);
      }
    } catch (error: unknown) {
      if (sequence === this.loadSequence) {
        this.failed.set(true);
        this.alerts.error('Could not load legacy templates', error);
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
    const source = templateSource(template);
    this.selected.set(template.name);
    this.name.set(template.name);
    this.body.set(source);
    this.baseline.set({ name: template.name, body: source });
    this.nameTouched.set(false);
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
    this.revealEditor();
    this.nameInput()?.nativeElement.focus();
  }

  discardChanges(): void {
    const baseline = this.baseline();
    this.name.set(baseline.name);
    this.body.set(baseline.body);
    this.nameTouched.set(false);
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

  async save(): Promise<void> {
    if (this.saving()) {
      return;
    }
    if (!this.canSave()) {
      this.nameTouched.set(true);
      if (this.nameValidation()) {
        this.nameInput()?.nativeElement.focus();
      }
      return;
    }

    const state = this.bodyState();
    if (!state.ok) {
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
        this.nameTouched.set(false);
      }
    } catch (error: unknown) {
      this.alerts.error(`Could not save template ${name}`, error);
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
      }
      await this.load();
    } catch (error: unknown) {
      this.alerts.error(`Could not delete template ${name}`, error);
    } finally {
      this.deleting.set(false);
    }
  }

  /**
   * Resolves `true` when the editor holds nothing unsaved or the user agreed
   * to drop it. Used when switching templates and, through the route's
   * unsaved-changes guard, when leaving the page.
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

  private resetEditor(): void {
    this.selected.set(null);
    this.name.set(NEW_BASELINE.name);
    this.body.set(NEW_BASELINE.body);
    this.baseline.set(NEW_BASELINE);
    this.nameTouched.set(false);
  }

  /** On the single-column layout the editor sits below the list. */
  private revealEditor(): void {
    const card = this.editorCard()?.nativeElement;
    if (card && globalThis.matchMedia?.('(max-width: 1180px)').matches) {
      card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }
}
