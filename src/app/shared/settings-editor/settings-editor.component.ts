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
  input,
  model,
  output,
  signal,
  untracked,
  viewChild,
  viewChildren,
} from '@angular/core';
import { DialogService } from '../../core/dialog.service';
import { pluralize } from '../../core/format';
import { readPreference, writePreference } from '../../core/preferences';
import { EmptyStateComponent } from '../empty-state.component';
import { NumberPipe, PluralPipe } from '../format.pipes';
import { SearchInputComponent } from '../search-input.component';
import {
  GroupingOptions,
  PendingChange,
  SettingDraft,
  SettingDrafts,
  SettingErrors,
  SettingGroupView,
  SettingRow,
  SettingScope,
  customSettingRows,
  defaultScope,
  filterSettingRows,
  groupEditorRows,
  isNoopDraft,
  isOverridden,
  matchesSettingQuery,
  movesToPersistent,
  normalizeSettingName,
  pendingChanges,
  settingNameError,
} from './settings-editor.models';

/** Everything the template needs for one setting, precomputed once per change. */
interface SettingItem {
  readonly row: SettingRow;
  readonly inputId: string;
  /** Part of the name shared with the group (rendered dimmed). */
  readonly namePrefix: string;
  /** Remaining name split after every dot so long keys wrap between segments. */
  readonly nameParts: readonly string[];
  readonly display: string;
  readonly draft: SettingDraft | undefined;
  readonly change: PendingChange | undefined;
  readonly error: string | undefined;
  /** Shows the persistent / transient choice (cluster settings). */
  readonly showScope: boolean;
  readonly scope: SettingScope;
  /** The change moves a transient setting to the persistent layer. */
  readonly moves: boolean;
}

interface GroupItem {
  readonly group: SettingGroupView;
  readonly id: string;
  readonly items: readonly SettingItem[];
  readonly pending: number;
}

let nextEditorId = 0;

/** Distance from the top of the viewport at which a group counts as current. */
const SPY_OFFSET_PX = 160;

/**
 * Searchable, grouped settings form with per-setting revert and a sticky
 * bar for pending changes. The parent owns the rows and the drafts and
 * performs the actual save.
 */
@Component({
  selector: 'cerebro-settings-editor',
  imports: [EmptyStateComponent, NumberPipe, PluralPipe, SearchInputComponent],
  templateUrl: './settings-editor.component.html',
  styleUrl: './settings-editor.component.css',
  host: {
    '(window:keydown)': 'onWindowKeydown($event)',
    '(window:beforeunload)': 'onBeforeUnload($event)',
  },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsEditorComponent {
  private readonly dialogs = inject(DialogService);
  private readonly destroyRef = inject(DestroyRef);

  readonly rows = input.required<readonly SettingRow[]>();
  /** Pending edits by setting name (two-way bound). */
  readonly drafts = model<SettingDrafts>({});
  /** Lets every change pick between persistent and transient (cluster settings). */
  readonly scoped = input(false);
  readonly grouping = input<GroupingOptions>({});
  /** Field level errors returned by the last save, by setting name. */
  readonly errors = input<SettingErrors>({});
  readonly saving = input(false);
  /** Prefix of the localStorage keys remembering the toolbar toggles. */
  readonly preferenceKey = input.required<string>();
  /** Accessible name of the whole editor ("Cluster settings"). */
  readonly label = input.required<string>();
  /** Shown when the "Only overridden" filter leaves nothing. */
  readonly noOverridesText = input('Every setting uses its default value.');
  /** Unlisted settings offered by the "Add setting" form (affix settings, loggers…). */
  readonly addSuggestions = input<readonly string[]>([]);
  /** Subtitle of the "Add setting" form. */
  readonly addDescription = input('Stage a value for a setting that is not listed, such as an allocation filter.');

  readonly save = output<readonly PendingChange[]>();
  readonly review = output<readonly PendingChange[]>();

  readonly id = `settings-editor-${nextEditorId++}`;
  readonly pluralize = pluralize;
  readonly query = signal('');
  readonly showStatic = signal(false);
  readonly onlyOverridden = signal(false);
  readonly activeGroup = signal<string | undefined>(undefined);

  readonly pending = computed(() => pendingChanges(this.rows(), this.drafts()));
  private readonly pendingByName = computed(
    () => new Map(this.pending().map((change) => [change.name, change])),
  );

  /** Rows for settings added by name; only changes when such a setting is added or removed. */
  private readonly customRows = computed(() => customSettingRows(this.rows(), this.drafts()), {
    equal: (left, right) =>
      left.length === right.length && left.every((row, index) => row.name === right[index]?.name),
  });
  private readonly allRows = computed(() => [...this.rows(), ...this.customRows()]);
  private readonly rowsByName = computed(() => new Map(this.rows().map((row) => [row.name, row])));

  readonly visibleRows = computed(() =>
    filterSettingRows(
      this.allRows(),
      { query: this.query(), showStatic: this.showStatic(), onlyOverridden: this.onlyOverridden() },
      new Set(this.pendingByName().keys()),
    ),
  );

  /**
   * Only the static toggle shapes the groups, so cards stay put while
   * searching or filtering on overridden settings.
   */
  private readonly allGroups = computed(() => groupEditorRows(this.allRows(), this.showStatic(), this.grouping()));

  readonly groups = computed<readonly GroupItem[]>(() => {
    const drafts = this.drafts();
    const changes = this.pendingByName();
    const errors = this.errors();
    const scoped = this.scoped();
    const visible = new Set(this.visibleRows().map((row) => row.name));
    const groups = this.allGroups()
      .map((group) => ({ ...group, rows: group.rows.filter((row) => visible.has(row.name)) }))
      .filter((group) => group.rows.length > 0);
    return groups.map((group) => {
      const items = group.rows.map((row): SettingItem => {
        const draft = drafts[row.name];
        const change = changes.get(row.name);
        const error = errors[row.name];
        const shared = group.prefix && row.name.startsWith(group.prefix) ? group.prefix : '';
        const hasValue = draft !== undefined && draft.value.trim() !== '';
        return {
          row,
          inputId: this.inputIdFor(row.name),
          namePrefix: shared,
          nameParts: splitAfterDots(row.name.slice(shared.length)),
          display: draft ? draft.value : row.value,
          draft,
          change,
          // Only while the rejected value is still the one being edited.
          error: error && change && change.to === error.value ? error.message : undefined,
          // A transient setting keeps the choice even before its value changes,
          // so it can be moved to the persistent layer as it is.
          showScope: scoped && hasValue && (change !== undefined || row.transient !== undefined),
          scope: draft?.scope ?? defaultScope(row),
          moves: scoped && draft !== undefined && movesToPersistent(row, draft),
        };
      });
      return {
        group,
        id: `${this.id}-group-${group.key ? group.key.replace(/[^\w-]/g, '_') : 'general'}`,
        items,
        pending: items.filter((item) => item.change).length,
      };
    });
  });

  /** The search or "Only overridden" narrows the list (the static toggle only shapes it). */
  readonly filtering = computed(() => this.query().trim() !== '' || this.onlyOverridden());

  readonly counts = computed(() => {
    const rows = this.rows();
    const showStatic = this.showStatic();
    return {
      /** Settings listed while no filter is active. */
      total: this.allRows().filter((row) => showStatic || row.editable).length,
      static: rows.filter((row) => !row.editable).length,
      overridden: rows.filter((row) => isOverridden(row)).length,
    };
  });

  /** Static settings that the other filters would show but the toggle hides. */
  readonly hiddenStaticMatches = computed(() => {
    if (this.showStatic()) {
      return 0;
    }
    const query = this.query();
    const onlyOverridden = this.onlyOverridden();
    return this.rows().filter(
      (row) =>
        !row.editable && matchesSettingQuery(row.name, query) && (!onlyOverridden || isOverridden(row)),
    ).length;
  });

  // ---- "Add setting" form ----

  readonly adding = signal(false);
  readonly newName = signal('');
  readonly newValue = signal('');
  /** Errors are only shown once the form was submitted. */
  readonly addAttempted = signal(false);
  readonly newSettingName = computed(() => normalizeSettingName(this.newName(), this.grouping().stripPrefix ?? ''));
  /** The typed name is already listed: adding it edits that setting. */
  readonly newNameMatch = computed(() => this.rowsByName().get(this.newSettingName()));
  readonly newNameError = computed(() => {
    const name = this.newSettingName();
    const error = settingNameError(name);
    if (error) {
      return error;
    }
    const existing = this.newNameMatch();
    if (existing && !existing.editable) {
      return `${name} is ${(existing.lockLabel ?? 'read-only').toLowerCase()} and cannot be changed here`;
    }
    return undefined;
  });
  readonly newValueError = computed(() => (this.newValue().trim() === '' ? 'Enter a value' : undefined));
  /** The shortest suggestion without the optional prefix, so the example fits the field. */
  readonly addPlaceholder = computed(() => {
    const prefix = this.grouping().stripPrefix ?? '';
    const [example] = this.addSuggestions()
      .map((name) => (prefix && name.startsWith(prefix) ? name.slice(prefix.length) : name))
      .sort((left, right) => left.length - right.length);
    return `e.g. ${example ?? 'cluster.routing.allocation.enable'}`;
  });
  readonly suggestions = computed(() => {
    const listed = this.rowsByName();
    const drafts = this.drafts();
    return this.addSuggestions().filter((name) => !listed.has(name) && !(name in drafts));
  });

  readonly scopeSummary = computed(() => {
    const changes = this.pending();
    return {
      resets: changes.filter((change) => change.to === null).length,
      persistent: changes.filter((change) => change.to !== null && change.scope === 'persistent').length,
      transient: changes.filter((change) => change.to !== null && change.scope === 'transient').length,
    };
  });

  private readonly injector = inject(Injector);
  private readonly sections = viewChildren<ElementRef<HTMLElement>>('section');
  private readonly toc = viewChild<ElementRef<HTMLElement>>('toc');
  private readonly addForm = viewChild<ElementRef<HTMLFormElement>>('addForm');
  private readonly addButton = viewChild<ElementRef<HTMLButtonElement>>('addButton');
  private scrollFrame = 0;
  /** Scroll spying pauses while a table of contents jump scrolls smoothly. */
  private spyPausedUntil = 0;

  constructor() {
    effect(() => {
      const key = this.preferenceKey();
      untracked(() => {
        this.showStatic.set(readPreference(`${key}.show-static`) === 'true');
        this.onlyOverridden.set(readPreference(`${key}.only-overridden`) === 'true');
      });
    });

    effect(() => {
      this.sections();
      untracked(() => this.spyActiveGroup());
    });

    effect(() => {
      const errors = this.errors();
      untracked(() => this.revealFirstError(errors));
    });

    effect(() => {
      const active = this.activeGroup();
      const toc = this.toc()?.nativeElement;
      if (active !== undefined && toc) {
        untracked(() => revealActiveLink(toc));
      }
    });

    const onScroll = () => {
      if (!this.scrollFrame) {
        this.scrollFrame = requestAnimationFrame(() => {
          this.scrollFrame = 0;
          this.spyActiveGroup();
        });
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    this.destroyRef.onDestroy(() => {
      window.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(this.scrollFrame);
    });
  }

  setShowStatic(value: boolean): void {
    this.showStatic.set(value);
    writePreference(`${this.preferenceKey()}.show-static`, String(value));
  }

  setOnlyOverridden(value: boolean): void {
    this.onlyOverridden.set(value);
    writePreference(`${this.preferenceKey()}.only-overridden`, String(value));
  }

  clearFilters(): void {
    this.query.set('');
    this.setOnlyOverridden(false);
  }

  edit(row: SettingRow, value: string): void {
    this.drafts.update((drafts) => {
      const scope = drafts[row.name]?.scope ?? defaultScope(row);
      // Settings added by name stay until they are removed explicitly.
      if (!row.custom && value === row.value && scope === defaultScope(row)) {
        return without(drafts, row.name);
      }
      return { ...drafts, [row.name]: { value, scope } };
    });
  }

  /** Forgets drafts that do nothing once the field loses focus. */
  settle(row: SettingRow): void {
    const draft = this.drafts()[row.name];
    if (draft && !row.custom && isNoopDraft(row, draft)) {
      this.drafts.update((drafts) => without(drafts, row.name));
    }
  }

  /** Stages a transient setting to be saved as persistent with its current value. */
  makePersistent(row: SettingRow): void {
    this.drafts.update((drafts) => ({
      ...drafts,
      [row.name]: { value: drafts[row.name]?.value ?? row.value, scope: 'persistent' },
    }));
  }

  setScope(row: SettingRow, scope: SettingScope): void {
    this.drafts.update((drafts) => {
      const draft = drafts[row.name];
      return draft ? { ...drafts, [row.name]: { ...draft, scope } } : drafts;
    });
  }

  /** Arrow keys move between the two options of the scope radio group. */
  onScopeKeydown(event: KeyboardEvent, row: SettingRow, scope: SettingScope): void {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
      return;
    }
    event.preventDefault();
    const next: SettingScope = scope === 'persistent' ? 'transient' : 'persistent';
    this.setScope(row, next);
    const group = event.currentTarget as HTMLElement;
    const index = next === 'persistent' ? 0 : 1;
    requestAnimationFrame(() => group.querySelectorAll<HTMLElement>('[role="radio"]')[index]?.focus());
  }

  revert(row: SettingRow, focus?: HTMLInputElement): void {
    this.drafts.update((drafts) => without(drafts, row.name));
    // An added setting disappears with its draft: focus moves back to "Add setting".
    (row.custom ? this.addButton()?.nativeElement : focus)?.focus();
  }

  resetToDefault(row: SettingRow): void {
    this.drafts.update((drafts) => ({
      ...drafts,
      [row.name]: { value: '', scope: drafts[row.name]?.scope ?? defaultScope(row) },
    }));
  }

  onFieldKeydown(event: KeyboardEvent, row: SettingRow): void {
    if (event.key === 'Escape' && this.drafts()[row.name]) {
      event.preventDefault();
      event.stopPropagation();
      this.revert(row, event.target instanceof HTMLInputElement ? event.target : undefined);
    }
  }

  async discard(): Promise<void> {
    const count = this.pending().length;
    if (count > 1) {
      const confirmed = await this.dialogs.confirm({
        title: 'Discard unsaved changes?',
        message: `${pluralize(count, 'unsaved change')} will be lost.`,
        items: this.pending().map((change) => change.name),
        confirmLabel: 'Discard changes',
        cancelLabel: 'Keep editing',
        tone: 'danger',
      });
      if (!confirmed) {
        return;
      }
    }
    this.drafts.set({});
  }

  requestSave(): void {
    const changes = this.pending();
    if (changes.length > 0 && !this.saving()) {
      this.save.emit(changes);
    }
  }

  requestReview(): void {
    this.review.emit(this.pending());
  }

  jumpTo(group: GroupItem): void {
    const element = document.getElementById(group.id);
    if (!element) {
      return;
    }
    this.activeGroup.set(group.group.key);
    this.spyPausedUntil = performance.now() + 1000;
    element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    element.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true });
  }

  onWindowKeydown(event: KeyboardEvent): void {
    if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 's' || this.pending().length === 0) {
      return;
    }
    // Never let the browser save the page while edits are pending…
    event.preventDefault();
    // …but do not save behind a modal (Review, Discard confirmation, command palette).
    if (this.dialogs.state() === undefined && !document.querySelector('dialog[open]')) {
      this.requestSave();
    }
  }

  onBeforeUnload(event: BeforeUnloadEvent): void {
    if (this.pending().length > 0) {
      event.preventDefault();
    }
  }

  openAdd(): void {
    this.adding.set(true);
    afterNextRender(
      () => {
        const form = this.addForm()?.nativeElement;
        form?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        form?.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true });
      },
      { injector: this.injector },
    );
  }

  /** Closes the form, moving focus back to `returnFocus` (the "Add setting" button). */
  cancelAdd(returnFocus?: HTMLElement): void {
    this.adding.set(false);
    this.newName.set('');
    this.newValue.set('');
    this.addAttempted.set(false);
    returnFocus?.focus();
  }

  /** Stages the typed setting as a pending change (or edits it when it is already listed). */
  submitAdd(event: Event): void {
    event.preventDefault();
    this.addAttempted.set(true);
    if (this.newNameError() || this.newValueError()) {
      const invalid = this.newNameError() ? `${this.id}-add-name` : `${this.id}-add-value`;
      document.getElementById(invalid)?.focus();
      return;
    }
    const name = this.newSettingName();
    const value = this.newValue();
    const existing = this.newNameMatch();
    this.drafts.update((drafts) => ({
      ...drafts,
      [name]: { value, scope: drafts[name]?.scope ?? (existing ? defaultScope(existing) : 'persistent') },
    }));
    if (!matchesSettingQuery(name, this.query())) {
      this.query.set('');
    }
    this.cancelAdd();
    this.reveal(name);
  }

  private inputIdFor(name: string): string {
    return `${this.id}-${name.replace(/[^\w-]/g, '_')}`;
  }

  /** Scrolls a setting's field into view and focuses it once it is rendered. */
  private reveal(name: string): void {
    afterNextRender(
      () => {
        const field = document.getElementById(this.inputIdFor(name));
        if (field instanceof HTMLInputElement) {
          field.scrollIntoView({ behavior: 'smooth', block: 'center' });
          field.focus({ preventScroll: true });
        }
      },
      { injector: this.injector },
    );
  }

  /** Brings the field a failed save is about into view, even if the search hid it. */
  private revealFirstError(errors: SettingErrors): void {
    const row = this.allRows().find((candidate) => errors[candidate.name] !== undefined);
    if (!row) {
      return;
    }
    if (!matchesSettingQuery(row.name, this.query())) {
      this.query.set('');
    }
    this.reveal(row.name);
  }

  /** Highlights the last group whose header scrolled past the sticky toolbar. */
  private spyActiveGroup(): void {
    if (performance.now() < this.spyPausedUntil) {
      return;
    }
    const threshold = SPY_OFFSET_PX;
    let active: string | undefined;
    for (const section of this.sections()) {
      const element = section.nativeElement;
      if (active !== undefined && element.getBoundingClientRect().top > threshold) {
        break;
      }
      active = element.dataset['groupKey'] ?? '';
    }
    this.activeGroup.set(active);
  }
}

/** Keeps the highlighted table of contents entry visible inside its own scroll area. */
function revealActiveLink(toc: HTMLElement): void {
  requestAnimationFrame(() => {
    const link = toc.querySelector<HTMLElement>('.settings-toc__link.is-active');
    if (!link) {
      return;
    }
    const top = link.offsetTop;
    const bottom = top + link.offsetHeight;
    if (top < toc.scrollTop) {
      toc.scrollTop = top - 8;
    } else if (bottom > toc.scrollTop + toc.clientHeight) {
      toc.scrollTop = bottom - toc.clientHeight + 8;
    }
  });
}

function splitAfterDots(name: string): string[] {
  return name.split(/(?<=\.)/);
}

function without(drafts: SettingDrafts, name: string): SettingDrafts {
  if (!(name in drafts)) {
    return drafts;
  }
  const { [name]: _removed, ...rest } = drafts;
  return rest;
}
