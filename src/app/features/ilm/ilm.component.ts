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
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AlertService } from '../../core/alert.service';
import { ClusterApiService } from '../../core/cluster-api.service';
import { ConnectionService } from '../../core/connection.service';
import { DialogService } from '../../core/dialog.service';
import { formatDuration } from '../../core/format';
import { readPreference, writePreference } from '../../core/preferences';
import { RefreshService } from '../../core/refresh.service';
import { CodeEditorComponent } from '../../shared/code-editor.component';
import { EmptyStateComponent } from '../../shared/empty-state.component';
import { MenuComponent } from '../../shared/menu.component';
import { SearchInputComponent } from '../../shared/search-input.component';
import {
  ExplainFilter,
  ExplainRow,
  ExplainSortField,
  IlmExplainResponse,
  IlmPoliciesResponse,
  IlmPolicySummary,
  SaveMode,
} from './ilm.models';
import {
  NEW_POLICY_BODY,
  analyzePolicyBody,
  errorReason,
  filterExplain,
  filterPolicies,
  needsAttention,
  normalizeExplain,
  normalizePolicies,
  phaseViews,
  policySource,
  policyWarnings,
  saveMode,
  sortExplain,
  summarizeExplain,
  usageExplainTarget,
  usageLabel,
  validatePolicyName,
} from './ilm.utils';

type IlmTab = 'policies' | 'status';

interface EditorBaseline {
  readonly name: string;
  readonly body: string;
}

const SAVE_LABELS: Readonly<Record<SaveMode, string>> = {
  create: 'Create policy',
  update: 'Save changes',
  overwrite: 'Overwrite policy',
  copy: 'Save as new policy',
};

const NEW_BASELINE: EditorBaseline = { name: '', body: NEW_POLICY_BODY };
const SHOW_MANAGED_PREFERENCE = 'cerebro.ilm.showManaged';
const USAGE_PREVIEW = 8;

@Component({
  selector: 'cerebro-ilm',
  imports: [
    CodeEditorComponent,
    EmptyStateComponent,
    FormsModule,
    MenuComponent,
    RouterLink,
    SearchInputComponent,
  ],
  host: { '(window:beforeunload)': 'onBeforeUnload($event)' },
  templateUrl: './ilm.component.html',
  styleUrl: './ilm.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class IlmComponent {
  private readonly api = inject(ClusterApiService);
  private readonly alerts = inject(AlertService);
  private readonly dialogs = inject(DialogService);
  private readonly refreshService = inject(RefreshService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly connection = inject(ConnectionService);

  private readonly editor = viewChild(CodeEditorComponent);
  private readonly nameInput = viewChild<ElementRef<HTMLInputElement>>('nameInput');
  private readonly detailColumn = viewChild<ElementRef<HTMLElement>>('detailColumn');
  private readonly explainInput = viewChild<ElementRef<HTMLInputElement>>('explainInput');

  readonly usagePreview = USAGE_PREVIEW;
  readonly tab = signal<IlmTab>('policies');

  // ---- Policies ----
  readonly policies = signal<readonly IlmPolicySummary[] | undefined>(undefined);
  readonly loading = signal(false);
  readonly failed = signal(false);
  readonly query = signal('');
  readonly showManaged = signal(readPreference(SHOW_MANAGED_PREFERENCE) === 'true');

  /** Name of the stored policy being edited; null while writing a new one. */
  readonly selected = signal<string | null>(null);
  readonly name = signal('');
  readonly body = signal(NEW_POLICY_BODY);
  readonly baseline = signal<EditorBaseline>(NEW_BASELINE);
  readonly nameTouched = signal(false);
  readonly saving = signal(false);
  readonly deleting = signal(false);
  readonly expandedUsage = signal<ReadonlySet<string>>(new Set());

  readonly managedCount = computed(() => (this.policies() ?? []).filter((policy) => policy.managed).length);
  readonly visiblePolicies = computed(() =>
    filterPolicies(this.policies() ?? [], this.query(), this.showManaged(), this.selected()),
  );
  /** Policies listed before the text filter (the selected managed one stays listed). */
  readonly listTotal = computed(
    () => filterPolicies(this.policies() ?? [], '', this.showManaged(), this.selected()).length,
  );
  readonly names = computed(() => (this.policies() ?? []).map((policy) => policy.name));

  readonly selectedPolicy = computed(() => {
    const selected = this.selected();
    return (this.policies() ?? []).find((policy) => policy.name === selected);
  });

  /** The edited policy was deleted on the cluster since it was opened. */
  readonly selectedMissing = computed(
    () => this.selected() !== null && this.policies() !== undefined && !this.selectedPolicy(),
  );

  readonly nameValidation = computed(() => validatePolicyName(this.name()));
  readonly nameError = computed(() => (this.name() !== '' || this.nameTouched() ? this.nameValidation() : null));

  readonly bodyState = computed(() => analyzePolicyBody(this.body()));
  readonly bodyError = computed(() => {
    const state = this.bodyState();
    return state.ok ? null : state.message;
  });
  readonly bodyWarnings = computed(() => {
    const state = this.bodyState();
    return state.ok ? policyWarnings(state.value) : [];
  });

  readonly dirty = computed(() => {
    const baseline = this.baseline();
    return this.name() !== baseline.name || this.body() !== baseline.body;
  });

  /** Timeline of the policy in the editor (reflects unsaved edits while the JSON is valid). */
  readonly previewPhases = computed(() => {
    const state = this.bodyState();
    if (state.ok) {
      return phaseViews(state.value);
    }
    return this.selectedPolicy()?.phases ?? [];
  });
  readonly previewStale = computed(() => !this.bodyState().ok);

  readonly mode = computed(() => saveMode(this.name(), this.selected(), this.names()));
  readonly saveLabel = computed(() => SAVE_LABELS[this.mode()]);
  readonly blocker = computed<string | null>(() => {
    if (this.nameValidation()) {
      return this.nameValidation();
    }
    if (this.bodyError()) {
      return 'Fix the policy JSON';
    }
    if (this.mode() === 'update' && !this.dirty() && !this.selectedMissing()) {
      return 'No changes to save';
    }
    return null;
  });
  readonly canSave = computed(() => this.blocker() === null && !this.saving() && !this.deleting());

  // ---- Lifecycle status ----
  readonly explainTarget = signal('');
  readonly explainedTarget = signal<string | null>(null);
  readonly explainRows = signal<readonly ExplainRow[] | undefined>(undefined);
  readonly explainLoading = signal(false);
  readonly explainError = signal<string | null>(null);
  readonly explainFilter = signal<ExplainFilter>('all');
  readonly explainQuery = signal('');
  readonly explainSort = signal<ExplainSortField>('index');
  readonly explainReverse = signal(false);

  readonly explainSummary = computed(() => summarizeExplain(this.explainRows() ?? []));
  readonly visibleExplainRows = computed(() =>
    sortExplain(
      filterExplain(this.explainRows() ?? [], this.explainFilter(), this.explainQuery()),
      this.explainSort(),
      this.explainReverse(),
    ),
  );

  /** Policy requested through ?policy=, opened once the list has loaded. */
  private pendingSelection: string | null = null;
  private loadSequence = 0;
  private explainSequence = 0;
  private destroyed = false;

  constructor() {
    inject(DestroyRef).onDestroy(() => (this.destroyed = true));

    const params = this.route.snapshot.queryParamMap;
    const requestedTab = params.get('tab');
    const requestedIndex = params.get('index');
    this.pendingSelection = params.get('policy') ?? params.get('name');
    if (requestedIndex) {
      this.explainTarget.set(requestedIndex);
    }
    if (requestedTab === 'status' || (requestedIndex && !this.pendingSelection)) {
      this.tab.set('status');
    }

    effect(() => {
      this.refreshService.tick();
      if (!this.connection.connected()) {
        return;
      }
      untracked(() => {
        void this.load();
        const target = this.explainedTarget();
        if (target !== null) {
          void this.explain(target, true);
        } else if (this.tab() === 'status' && this.explainTarget().trim()) {
          void this.explain(this.explainTarget());
        }
      });
    });
  }

  async load(): Promise<void> {
    const sequence = ++this.loadSequence;
    this.loading.set(true);
    try {
      const response = await this.api.post<IlmPoliciesResponse>('ilm/policies');
      if (sequence !== this.loadSequence) {
        return;
      }
      const policies = normalizePolicies(response);
      this.policies.set(policies);
      this.failed.set(false);
      this.syncEditorWithCluster(policies);
      this.applyPendingSelection(policies);
    } catch (error: unknown) {
      if (sequence === this.loadSequence) {
        this.failed.set(true);
        this.alerts.error('Could not load lifecycle policies', error);
      }
    } finally {
      if (sequence === this.loadSequence) {
        this.loading.set(false);
      }
    }
  }

  /** Keeps an untouched editor in sync when the policy changes on the cluster. */
  private syncEditorWithCluster(policies: readonly IlmPolicySummary[]): void {
    const selected = this.selected();
    if (selected === null || this.dirty() || this.saving()) {
      return;
    }
    const stored = policies.find((policy) => policy.name === selected);
    if (stored) {
      const source = policySource(stored.policy);
      if (source !== this.baseline().body) {
        this.body.set(source);
        this.baseline.set({ name: selected, body: source });
      }
    }
  }

  private applyPendingSelection(policies: readonly IlmPolicySummary[]): void {
    const name = this.pendingSelection;
    if (name === null) {
      return;
    }
    this.pendingSelection = null;
    if (this.destroyed) {
      return;
    }
    const policy = policies.find((item) => item.name === name);
    if (policy) {
      this.openPolicy(policy);
    } else {
      this.alerts.warn(`Lifecycle policy ${name} does not exist`);
    }
  }

  onBeforeUnload(event: BeforeUnloadEvent): void {
    if (this.dirty()) {
      event.preventDefault();
    }
  }

  setTab(tab: IlmTab): void {
    if (this.tab() === tab) {
      return;
    }
    this.tab.set(tab);
    this.updateUrl();
    if (tab === 'status' && this.explainRows() === undefined && !this.explainLoading()) {
      if (this.explainTarget().trim()) {
        void this.explain(this.explainTarget());
      } else {
        queueMicrotask(() => this.explainInput()?.nativeElement.focus());
      }
    }
  }

  onTabKeydown(event: KeyboardEvent): void {
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault();
      const next: IlmTab = this.tab() === 'policies' ? 'status' : 'policies';
      this.setTab(next);
      queueMicrotask(() => document.getElementById(`ilm-tab-${next}`)?.focus());
    }
  }

  setShowManaged(value: boolean): void {
    this.showManaged.set(value);
    writePreference(SHOW_MANAGED_PREFERENCE, String(value));
  }

  // ---- Selection & editor ----

  async select(policy: IlmPolicySummary): Promise<void> {
    if (this.saving()) {
      return;
    }
    if (this.selected() === policy.name && !this.selectedMissing()) {
      this.revealDetail();
      return;
    }
    if (!(await this.confirmDiscard()) || this.saving()) {
      return;
    }
    this.openPolicy(policy);
    this.revealDetail();
  }

  private openPolicy(policy: IlmPolicySummary): void {
    const source = policySource(policy.policy);
    this.selected.set(policy.name);
    this.name.set(policy.name);
    this.body.set(source);
    this.baseline.set({ name: policy.name, body: source });
    this.nameTouched.set(false);
    this.expandedUsage.set(new Set());
    this.updateUrl();
  }

  async newPolicy(): Promise<void> {
    if (this.saving()) {
      return;
    }
    if (this.tab() !== 'policies') {
      this.setTab('policies');
    }
    if (this.selected() === null && !this.dirty()) {
      this.nameInput()?.nativeElement.focus();
      return;
    }
    if (!(await this.confirmDiscard()) || this.saving()) {
      return;
    }
    this.resetEditor();
    this.revealDetail();
    queueMicrotask(() => this.nameInput()?.nativeElement.focus());
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
    const policy = this.selectedPolicy();
    if (policy) {
      this.dialogs.showJson(`Policy ${policy.name}`, policy.entry, policy.version !== null ? `Version ${policy.version}` : undefined);
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
        title: `Overwrite policy ${name}?`,
        message: `A lifecycle policy named ${name} already exists. Its phases will be replaced by this policy, and every index using it follows the new phases.`,
        confirmLabel: 'Overwrite policy',
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
      const response = await this.api.post<unknown>('ilm/policies/save', { name, policy: state.value });
      this.alerts.success(created ? `Policy ${name} created` : `Policy ${name} updated`, response);
      tracked = this.selected() === startSelected;
      if (tracked) {
        this.selected.set(name);
        this.baseline.set({ name, body });
        this.nameTouched.set(false);
        this.updateUrl();
      }
    } catch (error: unknown) {
      this.alerts.error(`Could not save policy ${name}: ${errorReason(error) ?? 'unknown error'}`, error);
      return;
    } finally {
      this.saving.set(false);
    }

    await this.load();
    // Show what Elasticsearch stored unless the user kept typing meanwhile.
    const stored = this.policies()?.find((policy) => policy.name === name);
    if (tracked && stored && this.selected() === name && this.name() === name && this.body() === body) {
      const source = policySource(stored.policy);
      this.body.set(source);
      this.baseline.set({ name, body: source });
    }
  }

  async remove(): Promise<void> {
    const policy = this.selectedPolicy();
    if (!policy || this.deleting() || this.saving()) {
      return;
    }
    const usage = policy.usage;
    const confirmed = await this.dialogs.confirm({
      title: `Delete policy ${policy.name}?`,
      message:
        usage.total > 0
          ? `This policy is in use (${usageLabel(usage)}). Elasticsearch refuses to delete policies that indices still use; detach it from them first.`
          : 'Indices created later can no longer use this policy. This cannot be undone.',
      items: [...usage.indices, ...usage.dataStreams.map((name) => `${name} (data stream)`), ...usage.templates.map((name) => `${name} (template)`)],
      confirmLabel: 'Delete policy',
      tone: 'danger',
    });
    if (!confirmed) {
      return;
    }
    this.deleting.set(true);
    try {
      const response = await this.api.post<unknown>('ilm/policies/delete', { name: policy.name });
      this.alerts.success(`Policy ${policy.name} deleted`, response);
      if (this.selected() === policy.name) {
        this.resetEditor();
      }
      await this.load();
    } catch (error: unknown) {
      this.alerts.error(`Could not delete policy ${policy.name}: ${errorReason(error) ?? 'unknown error'}`, error);
    } finally {
      this.deleting.set(false);
    }
  }

  isUsageExpanded(group: string): boolean {
    return this.expandedUsage().has(group);
  }

  toggleUsage(group: string): void {
    this.expandedUsage.update((current) => {
      const next = new Set(current);
      if (next.has(group)) {
        next.delete(group);
      } else {
        next.add(group);
      }
      return next;
    });
  }

  usageSlice(group: string, items: readonly string[]): readonly string[] {
    return this.isUsageExpanded(group) ? items : items.slice(0, USAGE_PREVIEW);
  }

  checkStatus(policy: IlmPolicySummary): void {
    const explain = usageExplainTarget(policy.usage, policy.name);
    if (!explain) {
      return;
    }
    this.explainTarget.set(explain.target);
    this.explainFilter.set('all');
    this.explainQuery.set(explain.query);
    this.tab.set('status');
    this.updateUrl();
    void this.explain(explain.target);
  }

  usageLabel = usageLabel;
  needsAttention = needsAttention;

  private resetEditor(): void {
    this.selected.set(null);
    this.name.set(NEW_BASELINE.name);
    this.body.set(NEW_BASELINE.body);
    this.baseline.set(NEW_BASELINE);
    this.nameTouched.set(false);
    this.updateUrl();
  }

  private async confirmDiscard(): Promise<boolean> {
    if (!this.dirty()) {
      return true;
    }
    const subject = this.selected() ?? (this.name() || 'the new policy');
    return this.dialogs.confirm({
      title: 'Discard unsaved changes?',
      message: `Your changes to ${subject} have not been saved and will be lost.`,
      confirmLabel: 'Discard changes',
      cancelLabel: 'Keep editing',
      tone: 'danger',
    });
  }

  private revealDetail(): void {
    const column = this.detailColumn()?.nativeElement;
    if (column && globalThis.matchMedia?.('(max-width: 1180px)').matches) {
      column.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  /** Keeps the selected policy, tab and explain target bookmarkable. */
  private updateUrl(): void {
    if (this.destroyed) {
      return;
    }
    const status = this.tab() === 'status';
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        tab: status ? 'status' : null,
        policy: !status ? this.selected() : null,
        index: status ? this.explainedTarget() ?? (this.explainTarget().trim() || null) : null,
        name: null,
      },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  // ---- Lifecycle status ----

  submitExplain(): void {
    const target = this.explainTarget().trim();
    if (!target) {
      this.explainInput()?.nativeElement.focus();
      return;
    }
    void this.explain(target).then(() => this.updateUrl());
  }

  explainPreset(target: string): void {
    this.explainTarget.set(target);
    this.submitExplain();
  }

  async explain(target: string, silent = false): Promise<void> {
    const trimmed = target.trim();
    if (!trimmed) {
      return;
    }
    const sequence = ++this.explainSequence;
    this.explainLoading.set(true);
    if (!silent) {
      this.explainError.set(null);
      if (this.explainedTarget() !== trimmed) {
        this.explainRows.set(undefined);
      }
    }
    try {
      const response = await this.api.post<IlmExplainResponse>('ilm/explain', { index: trimmed });
      if (sequence === this.explainSequence) {
        this.explainRows.set(normalizeExplain(response));
        this.explainedTarget.set(trimmed);
        this.explainError.set(null);
      }
    } catch (error: unknown) {
      if (sequence === this.explainSequence) {
        this.explainError.set(errorReason(error) ?? 'The cluster did not answer the explain request.');
        if (!silent) {
          this.explainRows.set(undefined);
          this.explainedTarget.set(null);
        }
      }
    } finally {
      if (sequence === this.explainSequence) {
        this.explainLoading.set(false);
      }
    }
  }

  retryExplain(): void {
    void this.explain(this.explainedTarget() ?? this.explainTarget());
  }

  sortExplainBy(field: ExplainSortField): void {
    if (this.explainSort() === field) {
      this.explainReverse.update((value) => !value);
    } else {
      this.explainSort.set(field);
      this.explainReverse.set(field === 'age');
    }
  }

  ariaSort(field: ExplainSortField): 'ascending' | 'descending' | 'none' {
    if (this.explainSort() !== field) {
      return 'none';
    }
    return this.explainReverse() ? 'descending' : 'ascending';
  }

  sortIcon(field: ExplainSortField): string {
    if (this.explainSort() !== field) {
      return 'bi-arrow-down-up';
    }
    return this.explainReverse() ? 'bi-arrow-down' : 'bi-arrow-up';
  }

  showExplainJson(row: ExplainRow): void {
    this.dialogs.showJson(`Lifecycle of ${row.index}`, row.raw, row.policy ? `Policy ${row.policy}` : 'Not managed by ILM');
  }

  openPolicyByName(name: string): void {
    const policy = (this.policies() ?? []).find((item) => item.name === name);
    if (!policy) {
      this.alerts.warn(`Lifecycle policy ${name} was not found`);
      return;
    }
    if (policy.managed && !this.showManaged()) {
      this.setShowManaged(true);
    }
    this.tab.set('policies');
    void this.select(policy).then(() => this.updateUrl());
  }

  formatAge(row: ExplainRow): string {
    return row.ageMillis === null ? row.age ?? '–' : formatDuration(row.ageMillis);
  }

  isHidden(index: string): boolean {
    return index.startsWith('.');
  }
}
