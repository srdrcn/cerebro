import { DatePipe, KeyValuePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AlertService } from '../../core/alert.service';
import { ClusterApiService } from '../../core/cluster-api.service';
import { ConnectionService } from '../../core/connection.service';
import { DialogService } from '../../core/dialog.service';
import { elasticsearchReason, failureMessage, readableReason } from '../../core/errors';
import { formatNumber, listSample, pluralize, sortIndexNames, textMatcher } from '../../core/format';
import { EmptyStateComponent } from '../../shared/empty-state.component';
import { NumberPipe, PluralPipe } from '../../shared/format.pipes';
import { MenuComponent } from '../../shared/menu.component';
import { SearchInputComponent } from '../../shared/search-input.component';
import {
  BooleanChoice,
  SlowlogForm,
  SlowlogGroup,
  SlowlogIndex,
  SlowlogLevel,
  SlowlogPresetKey,
} from './performance.models';
import {
  SLOWLOG_GROUPS,
  SLOWLOG_LEVELS,
  SLOWLOG_PRESETS,
  buildSlowlogSettings,
  describeForm,
  describeLevels,
  describeOverwrites,
  detectPreset,
  filterIndexNames,
  formFromIndex,
  groupPickerNames,
  hasEmptyFields,
  isBackingIndex,
  orderWarning,
  otherSettingLabel,
  parseSlowlog,
  presetThresholds,
  resetSlowlogSettings,
  sameForm,
  thresholdWarning,
  validateSlowlogForm,
  verifySlowlog,
} from './performance.utils';

const EMPTY_FORM: SlowlogForm = formFromIndex(undefined);

/** Indices named in a confirmation message before "and N more". */
const NAMED_INDICES = 6;

@Component({
  selector: 'cerebro-slow-logs',
  imports: [DatePipe, EmptyStateComponent, FormsModule, KeyValuePipe, MenuComponent, NumberPipe, PluralPipe, RouterLink, SearchInputComponent],
  templateUrl: './slow-logs.component.html',
  styleUrl: './slow-logs.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SlowLogsComponent {
  private readonly api = inject(ClusterApiService);
  private readonly alerts = inject(AlertService);
  private readonly dialogs = inject(DialogService);
  readonly connection = inject(ConnectionService);

  /**
   * Whether the tab is shown. Slow log settings only change when someone
   * edits them, so they load when the tab opens (not on refresh ticks),
   * after Apply or Reset, and on Reload.
   */
  readonly active = input(false);
  /** Number of indices with slow log settings (for the tab badge). */
  readonly configured = output<number>();

  readonly groups = SLOWLOG_GROUPS;
  readonly levels = SLOWLOG_LEVELS;
  readonly presets = SLOWLOG_PRESETS;
  readonly describeLevels = describeLevels;
  readonly otherSettingLabel = otherSettingLabel;
  readonly pluralize = pluralize;
  /** Selected indices shown as chips before "and N more". */
  readonly chipLimit = 8;

  // ---- Configured indices ----
  readonly rows = signal<readonly SlowlogIndex[] | undefined>(undefined);
  readonly raw = signal<unknown>(undefined);
  readonly loading = signal(false);
  readonly loadError = signal<string | undefined>(undefined);
  readonly staleReason = signal<string | undefined>(undefined);
  readonly loadedAt = signal(0);
  readonly query = signal('');
  readonly visibleRows = computed(() => {
    const matches = textMatcher(this.query());
    return (this.rows() ?? []).filter((row) => matches(row.index));
  });

  // ---- Index list of the editor ----
  readonly indexNames = signal<readonly string[] | undefined>(undefined);
  readonly indicesError = signal<string | undefined>(undefined);
  readonly pickerQuery = signal('');
  readonly selected = signal<ReadonlySet<string>>(new Set());
  readonly pickerNames = computed(() => filterIndexNames(sortIndexNames(this.indexNames() ?? []), this.pickerQuery()));
  /** Regular, data stream backing and system indices; "Select all" only takes regular ones. */
  readonly pickerGroups = computed(() => groupPickerNames(this.pickerNames()));
  readonly selectedBacking = computed(() => [...this.selected()].filter(isBackingIndex).length);
  readonly selectedSystem = computed(() => [...this.selected()].filter((name) => name.startsWith('.') && !isBackingIndex(name)).length);
  readonly hiddenSelected = computed(() => {
    const shown = new Set(this.pickerNames());
    return [...this.selected()].filter((name) => !shown.has(name)).length;
  });
  readonly selectedList = computed(() => sortIndexNames([...this.selected()]));

  // ---- Editor ----
  readonly form = signal<SlowlogForm>(EMPTY_FORM);
  private readonly baseline = signal<SlowlogForm>(EMPTY_FORM);
  readonly submitted = signal(false);
  readonly errors = computed(() => validateSlowlogForm(this.form()));
  readonly selectionError = computed(() => (this.selected().size === 0 ? 'Choose at least one index' : null));
  readonly preset = computed(() => detectPreset(this.form().thresholds));
  readonly presetDescription = computed(() => {
    const preset = this.preset();
    if (preset === null) {
      return 'Nothing set: every threshold uses the default, which logs nothing.';
    }
    if (preset === 'custom') {
      return 'Custom thresholds. Pick a preset to start over.';
    }
    return this.presets.find((entry) => entry.key === preset)?.description ?? '';
  });
  readonly dirty = computed(() => !sameForm(this.form(), this.baseline()));
  readonly applying = signal(false);
  readonly resetting = signal(false);
  readonly busy = computed(() => this.applying() || this.resetting());
  readonly announcement = signal('');
  /** The editor needs the index list or the table: hidden while both failed to load. */
  readonly showEditor = computed(() => !(this.loadError() && this.indexNames() === undefined));

  private readonly editorCard = viewChild<ElementRef<HTMLElement>>('editorCard');
  private readonly editorTitle = viewChild<ElementRef<HTMLElement>>('editorTitle');
  private readonly tableTitle = viewChild<ElementRef<HTMLElement>>('tableTitle');
  private readonly pickerSearch = viewChild<SearchInputComponent>('pickerSearch');
  private sequence = 0;
  private indicesSequence = 0;
  private wasActive = false;

  constructor() {
    effect(() => {
      const active = this.active();
      const connected = this.connection.connected();
      untracked(() => {
        if (!connected) {
          return;
        }
        const opened = active && !this.wasActive;
        this.wasActive = active;
        if (!opened) {
          return;
        }
        // Settings once (then after changes and on Reload); index names on every visit.
        if (this.rows() === undefined && !this.loading()) {
          void this.load();
        }
        void this.loadIndices();
      });
    });
  }

  // ---- Loading ----------------------------------------------------------------------

  /** Loads the slow log settings; resolves `true` when they were read. */
  async load(): Promise<boolean> {
    const sequence = ++this.sequence;
    this.loading.set(true);
    try {
      const response = await this.api.post<unknown>('performance/slowlog');
      if (sequence !== this.sequence) {
        return false;
      }
      const rows = parseSlowlog(response);
      this.rows.set(rows);
      this.raw.set(response);
      this.loadedAt.set(Date.now());
      this.loadError.set(undefined);
      this.staleReason.set(undefined);
      this.configured.emit(rows.length);
      return true;
    } catch (error: unknown) {
      if (sequence !== this.sequence) {
        return false;
      }
      if (this.rows() === undefined) {
        this.loadError.set(readableReason(error) ?? 'The cluster did not answer the slow log settings request.');
      } else {
        this.staleReason.set(readableReason(error) ?? 'The request failed.');
      }
      this.alerts.error(failureMessage('Could not load slow log settings', error), error);
      return false;
    } finally {
      if (sequence === this.sequence) {
        this.loading.set(false);
      }
    }
  }

  /** Reads the settings and the index list again. */
  reload(): void {
    void this.load();
    void this.loadIndices();
  }

  async loadIndices(): Promise<void> {
    const sequence = ++this.indicesSequence;
    try {
      const names = await this.api.post<unknown>('commons/indices');
      if (sequence !== this.indicesSequence) {
        return;
      }
      const list = Array.isArray(names) ? names.filter((name): name is string => typeof name === 'string') : [];
      this.indexNames.set(list);
      this.indicesError.set(undefined);
      // Forget selected indices that were deleted meanwhile.
      const known = new Set(list);
      const selected = this.selected();
      if ([...selected].some((name) => !known.has(name))) {
        this.selected.set(new Set([...selected].filter((name) => known.has(name))));
      }
    } catch (error: unknown) {
      if (sequence === this.indicesSequence && this.indexNames() === undefined) {
        this.indicesError.set(failureMessage('Could not load the index list', error));
      }
    }
  }

  retry(): void {
    this.loadError.set(undefined);
    void this.load();
    void this.loadIndices();
  }

  // ---- Selection --------------------------------------------------------------------

  isSelected(name: string): boolean {
    return this.selected().has(name);
  }

  toggleIndex(name: string): void {
    const wasEmpty = this.selected().size === 0;
    this.selected.update((current) => {
      const next = new Set(current);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
    // Picking a first, configured index into an untouched form starts from its settings.
    const row = this.rows()?.find((entry) => entry.index === name);
    if (wasEmpty && this.selected().has(name) && row && !this.dirty() && sameForm(this.form(), EMPTY_FORM)) {
      const form = formFromIndex(row);
      this.form.set(form);
      this.baseline.set(form);
      this.announcement.set(`Loaded the current slow log settings of ${name}`);
    }
  }

  /** Selects the regular indices shown; system, hidden and backing indices are picked one by one. */
  selectShown(): void {
    this.selected.update((current) => new Set([...current, ...this.pickerGroups().regular]));
  }

  clearSelection(): void {
    this.selected.set(new Set());
  }

  // ---- Form -------------------------------------------------------------------------

  threshold(group: SlowlogGroup, level: SlowlogLevel): string {
    return this.form().thresholds[group][level];
  }

  setThreshold(group: SlowlogGroup, level: SlowlogLevel, value: string): void {
    this.form.update((form) => ({
      ...form,
      thresholds: { ...form.thresholds, [group]: { ...form.thresholds[group], [level]: value } },
    }));
  }

  setSource(value: string): void {
    this.form.update((form) => ({ ...form, source: value }));
  }

  setReformat(value: BooleanChoice): void {
    this.form.update((form) => ({ ...form, reformat: value }));
  }

  applyPreset(key: SlowlogPresetKey): void {
    this.form.update((form) => ({ ...form, thresholds: presetThresholds(key) }));
  }

  fieldId(group: SlowlogGroup, level: SlowlogLevel): string {
    return `slowlog-${group}-${level}`;
  }

  fieldError(group: SlowlogGroup, level: SlowlogLevel): string | null {
    return this.submitted() || this.touched(group, level) ? (this.errors()[`${group}.${level}`] ?? null) : null;
  }

  /** Errors of a row, shown live once the value was changed from what was loaded. */
  rowErrors(group: SlowlogGroup): { readonly level: SlowlogLevel; readonly id: string; readonly message: string }[] {
    return this.levels.flatMap((level) => {
      const message = this.fieldError(group, level);
      return message ? [{ level, id: `${this.fieldId(group, level)}-error`, message }] : [];
    });
  }

  orderWarning(group: SlowlogGroup): string | null {
    return orderWarning(this.form().thresholds[group]);
  }

  /** Levels of a row set to 0, which log every request. */
  zeroWarnings(group: SlowlogGroup): readonly SlowlogLevel[] {
    return this.levels.filter((level) => !this.errors()[`${group}.${level}`] && thresholdWarning(this.form().thresholds[group][level]));
  }

  sourceError(): string | null {
    const changed = this.form().source.trim() !== this.baseline().source.trim();
    return this.submitted() || changed ? (this.errors()['source'] ?? null) : null;
  }

  private touched(group: SlowlogGroup, level: SlowlogLevel): boolean {
    return this.form().thresholds[group][level].trim() !== this.baseline().thresholds[group][level].trim();
  }

  // ---- Table actions ------------------------------------------------------------------

  async edit(row: SlowlogIndex): Promise<void> {
    if (!(await this.confirmDiscard())) {
      return;
    }
    const form = formFromIndex(row);
    this.selected.set(new Set([row.index]));
    this.form.set(form);
    this.baseline.set(form);
    this.submitted.set(false);
    this.pickerQuery.set('');
    this.revealEditor();
  }

  showJson(row: SlowlogIndex): void {
    this.dialogs.showJson(`Slow log settings of ${row.index}`, row.settings, 'Explicitly set, flat settings');
  }

  showAllJson(): void {
    this.dialogs.showJson('Slow log settings', this.raw(), 'index.search.slowlog.* and index.indexing.slowlog.*');
  }

  configureNew(): void {
    this.revealEditor();
    queueMicrotask(() => this.pickerSearch()?.focus());
  }

  async resetRow(row: SlowlogIndex): Promise<void> {
    await this.reset([row.index], 'table');
  }

  // ---- Apply / reset ------------------------------------------------------------------

  async apply(): Promise<void> {
    if (this.busy()) {
      return;
    }
    this.submitted.set(true);
    if (this.selectionError()) {
      this.pickerSearch()?.focus();
      return;
    }
    const firstError = Object.keys(this.errors())[0];
    if (firstError) {
      const id = firstError === 'source' ? 'slowlog-source' : `slowlog-${firstError.replace('.', '-')}`;
      this.editorCard()?.nativeElement.querySelector<HTMLElement>(`#${id}`)?.focus();
      return;
    }
    const indices = this.selectedList();
    const form = this.form();
    const selectedRows = (this.rows() ?? []).filter((row) => indices.includes(row.index));
    const overwrites = describeOverwrites(form, selectedRows).map((line) => `Overwrites ${line}`);
    const notes = [
      `${listSample(indices, NAMED_INDICES)}.`,
      hasEmptyFields(form) ? 'Empty fields reset the setting to its default.' : '',
      this.selectedBacking() > 0
        ? 'Backing indices of data streams keep this only until the next rollover: change the index template of the data stream for new backing indices.'
        : '',
      this.selectedSystem() > 0 ? 'Writing settings of system indices is deprecated and may be refused.' : '',
    ];
    const confirmed = await this.dialogs.confirm({
      title: `Apply slow log settings to ${pluralize(indices.length, 'index', 'indices')}?`,
      message: notes.filter((note) => note !== '').join(' '),
      items: [...overwrites, ...describeForm(form)],
      confirmLabel: 'Apply settings',
    });
    if (!confirmed) {
      return;
    }
    const settings = buildSlowlogSettings(form);
    this.applying.set(true);
    let failure: unknown;
    let failed = false;
    try {
      await this.api.post<unknown>('index_settings/bulk_update', { indices, settings });
    } catch (error: unknown) {
      failed = true;
      failure = error;
    }
    try {
      const outcome = await this.verify(indices, settings, failed, failure, {
        done: `Slow log settings applied to ${pluralize(indices.length, 'index', 'indices')}`,
        partial: 'Slow log settings applied',
        failed: 'Could not apply slow log settings',
      });
      if (outcome !== 'failed') {
        this.baseline.set(form);
        this.submitted.set(false);
      }
    } finally {
      this.applying.set(false);
      this.focusAfterChange(this.editorTitle());
    }
  }

  /**
   * Reads the settings back after a change and reports what happened: the
   * backend sends the indices in batches and stops at the first error, so a
   * failure can leave a change half applied.
   */
  private async verify(
    indices: readonly string[],
    sent: Readonly<Record<string, string | null>>,
    failed: boolean,
    error: unknown,
    messages: { readonly done: string; readonly partial: string; readonly failed: string },
  ): Promise<'done' | 'partial' | 'failed'> {
    const reloaded = await this.load();
    const { applied, missing } = reloaded ? verifySlowlog(indices, sent, this.rows() ?? []) : { applied: [], missing: [] };
    if (!failed && (!reloaded || missing.length === 0)) {
      this.announcement.set(messages.done);
      this.alerts.success(messages.done);
      return 'done';
    }
    if (reloaded && applied.length > 0) {
      const reason = (failed ? elasticsearchReason(error) : null) ?? 'the settings read back differ';
      const message = `${messages.partial} to ${formatNumber(applied.length)} of ${pluralize(indices.length, 'index', 'indices')}; not applied to ${listSample(missing, NAMED_INDICES)}: ${reason}`;
      this.announcement.set(message);
      this.alerts.warn(message);
      return 'partial';
    }
    this.announcement.set(messages.failed);
    this.alerts.error(failureMessage(messages.failed, error ?? 'the settings read back differ'), error);
    return 'failed';
  }

  /** Puts focus back on a stable element once the busy buttons are enabled again. */
  private focusAfterChange(target: ElementRef<HTMLElement> | undefined): void {
    queueMicrotask(() => target?.nativeElement.focus({ preventScroll: true }));
  }

  async resetSelected(): Promise<void> {
    if (this.selected().size === 0) {
      this.submitted.set(true);
      this.pickerSearch()?.focus();
      return;
    }
    await this.reset(this.selectedList(), 'editor');
  }

  private async reset(indices: readonly string[], from: 'table' | 'editor'): Promise<void> {
    if (this.busy() || indices.length === 0) {
      return;
    }
    const rows = (this.rows() ?? []).filter((row) => indices.includes(row.index));
    const confirmed = await this.dialogs.confirm({
      title: `Reset the slow logs of ${pluralize(indices.length, 'index', 'indices')} to the defaults?`,
      message: `${listSample(indices, NAMED_INDICES)}. Every slow log threshold and option is removed from these indices, so they log nothing until thresholds are set again.`,
      confirmLabel: 'Reset to defaults',
      tone: 'danger',
    });
    if (!confirmed) {
      return;
    }
    const settings = resetSlowlogSettings(rows);
    this.resetting.set(true);
    let failure: unknown;
    let failed = false;
    try {
      await this.api.post<unknown>('index_settings/bulk_update', { indices, settings });
    } catch (error: unknown) {
      failed = true;
      failure = error;
    }
    try {
      const outcome = await this.verify(indices, settings, failed, failure, {
        done: `Slow logs of ${pluralize(indices.length, 'index', 'indices')} reset to the defaults`,
        partial: 'Slow logs reset',
        failed: 'Could not reset slow log settings',
      });
      const editing = this.selectedList();
      if (outcome !== 'failed' && editing.length === indices.length && editing.every((name) => indices.includes(name))) {
        this.form.set(EMPTY_FORM);
        this.baseline.set(EMPTY_FORM);
        this.submitted.set(false);
      }
    } finally {
      this.resetting.set(false);
      // A row reset removes the row whose menu was used: focus the table title instead.
      this.focusAfterChange(from === 'table' ? this.tableTitle() : this.editorTitle());
    }
  }

  discardChanges(): void {
    this.form.set(this.baseline());
    this.submitted.set(false);
  }

  /** Resolves `true` when nothing is unsaved or the user agreed to drop the edits. */
  async confirmDiscard(): Promise<boolean> {
    if (!this.dirty()) {
      return true;
    }
    return this.dialogs.confirm({
      title: 'Discard unsaved slow log changes?',
      message: 'The thresholds you edited have not been applied and will be lost.',
      confirmLabel: 'Discard changes',
      cancelLabel: 'Keep editing',
      tone: 'danger',
    });
  }

  private revealEditor(): void {
    const card = this.editorCard()?.nativeElement;
    if (!card) {
      return;
    }
    const view = card.ownerDocument.defaultView;
    const reduceMotion = view?.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    card.scrollIntoView?.({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
    this.editorTitle()?.nativeElement.focus({ preventScroll: true });
  }
}
