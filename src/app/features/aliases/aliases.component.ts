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
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AlertService } from '../../core/alert.service';
import { ClipboardService } from '../../core/clipboard.service';
import { ClusterApiService } from '../../core/cluster-api.service';
import { ConnectionService } from '../../core/connection.service';
import { DialogService } from '../../core/dialog.service';
import { failureMessage, readableReason } from '../../core/errors';
import { plural, pluralize } from '../../core/format';
import { PendingChangesAware } from '../../core/pending-changes.guard';
import { RefreshService } from '../../core/refresh.service';
import { CodeEditorComponent } from '../../shared/code-editor.component';
import { EmptyStateComponent } from '../../shared/empty-state.component';
import { NumberPipe, PluralPipe } from '../../shared/format.pipes';
import { PagerComponent, clampPage, pageSlice } from '../../shared/pager.component';
import { SearchInputComponent } from '../../shared/search-input.component';
import { createSort } from '../../shared/sort-state';
import {
  AliasChange,
  AliasDraft,
  AliasDraftErrors,
  AliasRecord,
  EMPTY_ALIAS_DRAFT,
  RawAliasRecord,
  buildAliasActions,
  buildAliasAdd,
  draftFromRecord,
  hasDraftErrors,
  normalizeAliasName,
  normalizeAliasRecords,
  shouldShowFieldError,
  validateAliasDraft,
  writeFlagFor,
} from './aliases.models';
import {
  AliasSortField,
  DraftStatus,
  PendingItem,
  aliasNames,
  applyChangesLocally,
  assignmentKey,
  buildAliasRows,
  changeFor,
  countByKind,
  describePendingChanges,
  draftStatusFor,
  filterAliasRows,
  filterLabel,
  otherWriteIndices,
  prettyJson,
  revertChange,
  routingTags,
  sortAliasRows,
  sortIndexOptions,
  stageAddition,
  stageRemoval,
  summarizePendingItem,
} from './aliases.utils';

type DraftField = keyof AliasDraftErrors;

const PAGE_SIZE = 20;

@Component({
  selector: 'cerebro-aliases',
  imports: [
    CodeEditorComponent,
    EmptyStateComponent,
    FormsModule,
    NumberPipe,
    PagerComponent,
    PluralPipe,
    RouterLink,
    SearchInputComponent,
  ],
  templateUrl: './aliases.component.html',
  styleUrl: './aliases.component.css',
  host: { '(window:beforeunload)': 'onBeforeUnload($event)' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AliasesComponent implements PendingChangesAware {
  private readonly api = inject(ClusterApiService);
  private readonly alerts = inject(AlertService);
  private readonly dialogs = inject(DialogService);
  private readonly clipboard = inject(ClipboardService);
  private readonly refreshService = inject(RefreshService);
  private readonly connection = inject(ConnectionService);
  private readonly injector = inject(Injector);

  private readonly aliasInput = viewChild<ElementRef<HTMLInputElement>>('aliasInput');
  private readonly indexSelect = viewChild<ElementRef<HTMLSelectElement>>('indexSelect');
  private readonly indexRoutingInput = viewChild<ElementRef<HTMLInputElement>>('indexRoutingInput');
  private readonly filterEditor = viewChild<CodeEditorComponent>('filterEditor');
  private readonly pendingCard = viewChild<ElementRef<HTMLElement>>('pendingCard');
  private readonly pendingHeading = viewChild<ElementRef<HTMLElement>>('pendingHeading');
  private readonly problemNote = viewChild<ElementRef<HTMLElement>>('problemNote');

  readonly pageSize = PAGE_SIZE;

  // ---- Cluster data -------------------------------------------------------
  readonly aliases = signal<readonly AliasRecord[] | undefined>(undefined);
  readonly indices = signal<readonly string[] | undefined>(undefined);
  readonly loading = signal(false);
  readonly failed = signal(false);
  /** Why the aliases could not be loaded, as a sentence for the error state. */
  readonly loadError = signal<string | undefined>(undefined);
  readonly saving = signal(false);

  // ---- Table --------------------------------------------------------------
  readonly aliasQuery = signal('');
  readonly indexQuery = signal('');
  readonly sort = createSort<AliasSortField>('alias');
  readonly page = signal(1);
  readonly expanded = signal<ReadonlySet<string>>(new Set());

  // ---- Staged changes -----------------------------------------------------
  readonly changes = signal<readonly AliasChange[]>([]);
  readonly announcement = signal('');
  /** False while the pending changes card is scrolled out of view. */
  readonly pendingCardVisible = signal(true);

  // ---- Add alias form -----------------------------------------------------
  readonly draftAlias = signal('');
  readonly draftIndex = signal('');
  readonly draftIndexRouting = signal('');
  readonly draftSearchRouting = signal('');
  readonly draftFilter = signal('');
  readonly draftWriteIndex = signal<boolean | undefined>(undefined);
  readonly draftHidden = signal(false);
  readonly advancedOpen = signal(false);
  readonly submitted = signal(false);
  readonly touched = signal<ReadonlySet<DraftField>>(new Set());
  /** The write flag of the assignment loaded with "Edit", if any. */
  private editedWriteFlag: boolean | undefined;

  readonly rows = computed(() => buildAliasRows(this.aliases() ?? [], this.changes()));

  readonly visibleRows = computed(() =>
    sortAliasRows(
      filterAliasRows(this.rows(), this.aliasQuery(), this.indexQuery()),
      this.sort.field(),
      this.sort.reverse(),
    ),
  );

  readonly currentPage = computed(() =>
    clampPage(this.page(), this.visibleRows().length, PAGE_SIZE),
  );

  readonly pageRows = computed(() => pageSlice(this.visibleRows(), this.currentPage(), PAGE_SIZE));

  /** Counted over the table rows, staged additions included, like the filtered count. */
  readonly aliasCount = computed(() => aliasNames(this.rows().map((row) => row.record)).length);
  readonly filtering = computed(() => !!this.aliasQuery().trim() || !!this.indexQuery().trim());

  readonly aliasSuggestions = computed(() => aliasNames(this.aliases() ?? []));

  readonly pending = computed<readonly PendingItem[]>(() =>
    describePendingChanges(this.changes(), this.aliases() ?? [], this.indices()),
  );
  readonly pendingCounts = computed(() => countByKind(this.pending()));
  readonly problemCount = computed(
    () => this.pending().filter((item) => item.problem !== undefined).length,
  );

  readonly draft = computed<AliasDraft>(() => ({
    alias: this.draftAlias(),
    index: this.draftIndex(),
    filterText: this.draftFilter(),
    indexRouting: this.draftIndexRouting(),
    searchRouting: this.draftSearchRouting(),
    writeIndex: this.draftWriteIndex(),
    hidden: this.draftHidden(),
  }));

  readonly errors = computed(() => validateAliasDraft(this.draft(), this.indices() ?? []));

  readonly draftDirty = computed(
    () =>
      [
        this.draftAlias(),
        this.draftIndex(),
        this.draftIndexRouting(),
        this.draftSearchRouting(),
        this.draftFilter(),
      ].some((value) => value.trim() !== '') ||
      this.draftWriteIndex() === true ||
      this.draftHidden(),
  );

  readonly advancedCount = computed(
    () =>
      [this.draftIndexRouting(), this.draftSearchRouting(), this.draftFilter()].filter(
        (value) => value.trim() !== '',
      ).length,
  );

  private readonly draftName = computed(() => normalizeAliasName(this.draftAlias()));

  readonly draftKey = computed(() => {
    const alias = this.draftName();
    const index = this.draftIndex();
    return alias && index ? assignmentKey({ alias, index }) : undefined;
  });

  readonly draftExisting = computed(() => {
    const key = this.draftKey();
    return key === undefined
      ? undefined
      : this.aliases()?.find((record) => assignmentKey(record) === key);
  });

  readonly draftStatus = computed<DraftStatus>(() =>
    draftStatusFor(
      this.draftName(),
      this.draftIndex(),
      this.tryBuildRecord(),
      this.aliases() ?? [],
      this.changes(),
    ),
  );

  /** Update and restage edit an assignment; "new" adds one. */
  readonly editing = computed(() => this.draftStatus() !== 'new');

  /** Write indices that lose the flag when the draft becomes the write index. */
  readonly displacedWriters = computed<readonly AliasRecord[]>(() => {
    const alias = this.draftName();
    const index = this.draftIndex();
    if (this.draftWriteIndex() !== true || !alias || !index) {
      return [];
    }
    return otherWriteIndices(this.aliases() ?? [], this.changes(), alias, index);
  });

  /** Existing assignments of the alias name typed in the form. */
  private readonly draftSiblings = computed(() => {
    const alias = this.draftName();
    return alias
      ? applyChangesLocally(this.aliases() ?? [], this.changes()).filter(
          (record) => record.alias === alias && record.index !== this.draftIndex(),
        )
      : [];
  });

  /** Elasticsearch requires the same hidden flag on every index of an alias. */
  readonly hiddenNotice = computed<'mismatch' | undefined>(() => {
    const siblings = this.draftSiblings();
    const exists = siblings.length > 0 || this.draftExisting() !== undefined;
    if (!exists) {
      return undefined;
    }
    const hidden = this.draftHidden();
    return siblings.some((record) => (record.is_hidden === true) !== hidden)
      ? 'mismatch'
      : undefined;
  });

  readonly routing = routingTags;
  readonly filterLabel = filterLabel;
  readonly pretty = prettyJson;
  readonly pluralize = pluralize;

  private loadSequence = 0;
  private loadedHost: string | undefined;

  constructor() {
    effect(() => {
      this.refreshService.tick();
      const host = this.connection.host();
      if (!host) {
        return;
      }
      untracked(() => {
        if (this.loadedHost !== undefined && this.loadedHost !== host) {
          this.resetForHost();
        }
        this.loadedHost = host;
        void this.load();
      });
    });

    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const card = this.pendingCard()?.nativeElement;
      if (!card || typeof IntersectionObserver === 'undefined') {
        return;
      }
      // The shortcut bar shows while the card is (mostly) out of view.
      const observer = new IntersectionObserver(
        ([entry]) => this.pendingCardVisible.set(entry?.isIntersecting ?? true),
        { rootMargin: '0px 0px -120px 0px' },
      );
      observer.observe(card);
      destroyRef.onDestroy(() => observer.disconnect());
    });
  }

  // ---- Loading ------------------------------------------------------------

  async load(): Promise<void> {
    const sequence = ++this.loadSequence;
    this.loading.set(true);
    try {
      const [aliases, indices] = await Promise.allSettled([
        this.api.post<readonly RawAliasRecord[]>('aliases/get_aliases'),
        this.api.post<readonly string[]>('commons/indices'),
      ]);
      if (sequence !== this.loadSequence) {
        return;
      }
      let aliasesLoaded = false;
      if (aliases.status === 'fulfilled') {
        try {
          this.aliases.set(normalizeAliasRecords(aliases.value));
          this.failed.set(false);
          this.loadError.set(undefined);
          aliasesLoaded = true;
        } catch (error: unknown) {
          // An unexpected response shape.
          this.failed.set(true);
          this.loadError.set(readableReason(error));
          this.alerts.error(failureMessage('Could not load aliases', error), error);
        }
      } else {
        this.failed.set(true);
        this.loadError.set(readableReason(aliases.reason));
        this.alerts.error(failureMessage('Could not load aliases', aliases.reason), aliases.reason);
      }
      if (indices.status === 'fulfilled') {
        this.indices.set(sortIndexOptions(indices.value));
      } else if (aliasesLoaded) {
        this.alerts.error(failureMessage('Could not load the index list', indices.reason), indices.reason);
      }
    } catch (error: unknown) {
      if (sequence === this.loadSequence) {
        this.failed.set(true);
        this.loadError.set(readableReason(error));
        this.alerts.error(failureMessage('Could not load aliases', error), error);
      }
    } finally {
      if (sequence === this.loadSequence) {
        this.loading.set(false);
      }
    }
  }

  private resetForHost(): void {
    this.loadSequence++;
    this.aliases.set(undefined);
    this.indices.set(undefined);
    this.failed.set(false);
    this.loadError.set(undefined);
    this.changes.set([]);
    this.expanded.set(new Set());
    this.page.set(1);
    this.resetDraft();
  }

  // ---- Table --------------------------------------------------------------

  setAliasQuery(value: string): void {
    this.aliasQuery.set(value);
    this.page.set(1);
  }

  setIndexQuery(value: string): void {
    this.indexQuery.set(value);
    this.page.set(1);
  }

  clearFilters(): void {
    this.aliasQuery.set('');
    this.indexQuery.set('');
    this.page.set(1);
  }

  goToPage(page: number, card: HTMLElement): void {
    this.page.set(page);
    // Paging from the bottom of a long table: bring the first row back
    // (the sticky top bar hides the first ~56px of the viewport).
    if (card.getBoundingClientRect().top < 64) {
      card.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
  }

  isExpanded(key: string): boolean {
    return this.expanded().has(key);
  }

  toggleFilter(key: string): void {
    this.expanded.update((current) => {
      const next = new Set(current);
      if (!next.delete(key)) {
        next.add(key);
      }
      return next;
    });
  }

  copyFilter(record: AliasRecord): void {
    void this.clipboard.copyAndNotify(prettyJson(record.filter), `filter of ${record.alias}`);
  }

  indexLinkParams(index: string): Record<string, string | null> {
    return { ...this.connection.hostQuery(), index };
  }

  // ---- Staging ------------------------------------------------------------

  stageRemove(record: AliasRecord): void {
    this.changes.update((changes) => stageRemoval(changes, record, this.aliases() ?? []));
    this.announce(`Removal of ${record.alias} from ${record.index} staged.`);
  }

  revert(key: string): void {
    const change = changeFor(this.changes(), key);
    this.changes.update((changes) => revertChange(changes, key));
    if (change) {
      this.announce(`Change to ${change.alias.alias} on ${change.alias.index} reverted.`);
    }
  }

  /** Loads an existing or staged assignment into the form. */
  edit(record: AliasRecord): void {
    const draft = draftFromRecord(record);
    this.draftAlias.set(draft.alias);
    this.draftIndex.set(draft.index);
    this.draftIndexRouting.set(draft.indexRouting);
    this.draftSearchRouting.set(draft.searchRouting);
    this.draftFilter.set(draft.filterText);
    this.draftWriteIndex.set(draft.writeIndex);
    this.draftHidden.set(draft.hidden === true);
    this.editedWriteFlag = record.is_write_index;
    this.advancedOpen.set(true);
    this.submitted.set(false);
    this.touched.set(new Set());
    const input = this.aliasInput()?.nativeElement;
    input?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    input?.focus({ preventScroll: true });
  }

  setWriteIndex(checked: boolean): void {
    this.draftWriteIndex.set(writeFlagFor(checked, this.editedWriteFlag));
  }

  stage(): void {
    this.submitted.set(true);
    const errors = this.errors();
    if (hasDraftErrors(errors)) {
      if (errors.filter || errors.indexRouting) {
        this.advancedOpen.set(true);
      }
      this.focusFirstInvalid(errors);
      return;
    }
    const status = this.draftStatus();
    if (status === 'same') {
      this.announce('Nothing to stage: the assignment already has these settings.');
      return;
    }
    const record = this.tryBuildRecord();
    if (!record) {
      return;
    }
    // One write index per alias: the previous one gives the flag up.
    const displaced = this.displacedWriters();
    this.changes.update((changes) =>
      displaced.reduce(
        (staged, writer) => stageAddition(staged, { ...writer, is_write_index: false }),
        stageAddition(changes, record),
      ),
    );
    const verb = status === 'new' ? 'Addition' : 'Update';
    const moved =
      displaced.length > 0
        ? ` The write index moves from ${displaced.map((writer) => writer.index).join(', ')}.`
        : '';
    this.announce(`${verb} of ${record.alias} on ${record.index} staged.${moved}`);
    this.resetDraft();
    this.aliasInput()?.nativeElement.focus();
  }

  resetDraft(): void {
    this.draftAlias.set(EMPTY_ALIAS_DRAFT.alias);
    this.draftIndex.set(EMPTY_ALIAS_DRAFT.index);
    this.draftIndexRouting.set(EMPTY_ALIAS_DRAFT.indexRouting);
    this.draftSearchRouting.set(EMPTY_ALIAS_DRAFT.searchRouting);
    this.draftFilter.set(EMPTY_ALIAS_DRAFT.filterText);
    this.draftWriteIndex.set(EMPTY_ALIAS_DRAFT.writeIndex);
    this.draftHidden.set(EMPTY_ALIAS_DRAFT.hidden === true);
    this.editedWriteFlag = undefined;
    this.advancedOpen.set(false);
    this.submitted.set(false);
    this.touched.set(new Set());
  }

  /** Moves focus to the first field with an error, once the advanced section has rendered. */
  private focusFirstInvalid(errors: AliasDraftErrors): void {
    afterNextRender(
      () => {
        if (errors.alias) {
          this.aliasInput()?.nativeElement.focus();
        } else if (errors.index) {
          this.indexSelect()?.nativeElement.focus();
        } else if (errors.indexRouting) {
          this.indexRoutingInput()?.nativeElement.focus();
        } else if (errors.filter) {
          this.filterEditor()?.focus();
        }
      },
      { injector: this.injector },
    );
  }

  touch(field: DraftField): void {
    if (!this.touched().has(field)) {
      this.touched.update((current) => new Set(current).add(field));
    }
  }

  showError(field: DraftField): boolean {
    return shouldShowFieldError(
      this.errors()[field],
      this.submitted(),
      this.touched().has(field),
      this.fieldValue(field),
    );
  }

  private fieldValue(field: DraftField): string {
    switch (field) {
      case 'alias':
        return this.draftAlias();
      case 'index':
        return this.draftIndex();
      case 'indexRouting':
        return this.draftIndexRouting();
      default:
        return this.draftFilter();
    }
  }

  // ---- Applying -----------------------------------------------------------

  async apply(): Promise<void> {
    const items = this.pending();
    if (items.length === 0 || this.saving()) {
      return;
    }
    if (this.problemCount() > 0) {
      this.showProblems();
      return;
    }
    const counts = countByKind(items);
    const message =
      counts.remove > 0
        ? 'Everything is sent in one atomic request. Applications reading through a removed alias will stop resolving it.'
        : 'Everything is sent in one atomic request: either every change is applied or none is.';
    const confirmed = await this.dialogs.confirm({
      title: `Apply ${pluralize(items.length, 'alias change')}?`,
      message,
      items: items.map(summarizePendingItem),
      confirmLabel: `Apply ${pluralize(items.length, 'change')}`,
      tone: counts.remove > 0 ? 'danger' : 'default',
    });
    if (!confirmed) {
      return;
    }
    // An auto refresh while the dialog was open may have made some changes
    // stale: Elasticsearch would reject the whole atomic request.
    if (this.problemCount() > 0) {
      this.showProblems();
      return;
    }

    const submitted = this.changes();
    if (submitted.length === 0 || this.saving()) {
      return;
    }
    const host = this.connection.host();
    this.saving.set(true);
    try {
      const response = await this.api.post<unknown>('aliases/update_aliases', {
        changes: buildAliasActions(submitted),
      });
      if (this.connection.host() === host) {
        this.aliases.update((aliases) => applyChangesLocally(aliases ?? [], submitted));
        this.changes.update((changes) => changes.filter((change) => !submitted.includes(change)));
        void this.load();
      }
      this.alerts.success(`Applied ${pluralize(submitted.length, 'alias change')}`, response);
    } catch (error: unknown) {
      this.alerts.error(failureMessage('Could not apply the alias changes', error), error);
      // The cluster probably changed underneath: reloading flags the staged
      // changes that can no longer apply.
      if (this.connection.host() === host) {
        void this.load();
      }
    } finally {
      this.saving.set(false);
    }
  }

  /** Apply was pressed while staged changes cannot apply: point at the explanation. */
  private showProblems(): void {
    this.alerts.warn('Some staged changes cannot be applied. Revert or edit them and try again.');
    afterNextRender(
      () => {
        const note = this.problemNote()?.nativeElement;
        note?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        note?.focus({ preventScroll: true });
      },
      { injector: this.injector },
    );
  }

  async discardAll(): Promise<void> {
    const count = this.changes().length;
    if (count === 0) {
      return;
    }
    if (count > 1) {
      const confirmed = await this.dialogs.confirm({
        title: `Discard ${pluralize(count, 'pending change')}?`,
        message: 'Nothing has been sent to the cluster yet. The staged changes are dropped.',
        confirmLabel: 'Discard changes',
        tone: 'danger',
      });
      if (!confirmed) {
        return;
      }
    }
    this.changes.set([]);
    this.announce('All pending changes discarded.');
  }

  /** The shortcut bar on narrow screens jumps to the pending changes. */
  reviewPending(): void {
    this.pendingCard()?.nativeElement.scrollIntoView({ block: 'start', behavior: 'smooth' });
    this.pendingHeading()?.nativeElement.focus({ preventScroll: true });
  }

  /** Asks before in-app navigation drops staged changes (route guard). */
  async confirmDiscard(): Promise<boolean> {
    const count = this.changes().length;
    if (count === 0) {
      return true;
    }
    return this.dialogs.confirm({
      title: 'Discard unsaved changes?',
      message: `${pluralize(count, 'staged alias change')} ${plural(count, 'has', 'have')} not been applied and will be lost.`,
      confirmLabel: 'Discard changes',
      cancelLabel: 'Keep editing',
      tone: 'danger',
    });
  }

  onBeforeUnload(event: BeforeUnloadEvent): void {
    if (this.changes().length > 0) {
      event.preventDefault();
    }
  }

  kindIcon(item: PendingItem): string {
    switch (item.kind) {
      case 'add':
        return 'bi-plus-lg';
      case 'update':
        return 'bi-pencil';
      default:
        return 'bi-dash-lg';
    }
  }

  kindLabel(item: PendingItem): string {
    switch (item.kind) {
      case 'add':
        return 'Add';
      case 'update':
        return 'Update';
      default:
        return 'Remove';
    }
  }

  private tryBuildRecord(): AliasRecord | undefined {
    try {
      return buildAliasAdd(this.draft()).add;
    } catch {
      return undefined;
    }
  }

  private announce(message: string): void {
    // Re-setting the same text would not be announced again.
    this.announcement.set('');
    queueMicrotask(() => this.announcement.set(message));
  }
}
