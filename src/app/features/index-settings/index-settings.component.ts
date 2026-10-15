import { Location } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { map } from 'rxjs';
import { AlertService } from '../../core/alert.service';
import { ClusterApiError } from '../../core/api-envelope';
import { ClusterApiService } from '../../core/cluster-api.service';
import { ConnectionService } from '../../core/connection.service';
import { DialogService } from '../../core/dialog.service';
import { failureMessage, readableReason } from '../../core/errors';
import { formatRelative, pluralize } from '../../core/format';
import { isRecord } from '../../core/json';
import { PendingChangesAware } from '../../core/pending-changes.guard';
import { EmptyStateComponent } from '../../shared/empty-state.component';
import { IndexPickerComponent } from '../../shared/index-picker.component';
import { SettingsEditorComponent } from '../../shared/settings-editor/settings-editor.component';
import {
  GroupingOptions,
  PendingChange,
  SettingDrafts,
  SettingErrors,
  SettingRow,
  buildFlatSettingsPayload,
  pendingChanges,
  pruneDrafts,
  settingErrorsFor,
  withoutSavedDrafts,
} from '../../shared/settings-editor/settings-editor.models';
import { SettingsSkeletonComponent } from '../../shared/settings-editor/settings-skeleton.component';
import {
  IndexMetadata,
  IndexSettingsResponse,
  buildIndexSettingRows,
  indexMetadata,
  resolveIndexSettings,
} from './index-settings.models';

type LoadState = 'idle' | 'loading' | 'ready' | 'missing' | 'multiple' | 'error';

const GROUPING: GroupingOptions = {
  stripPrefix: 'index.',
  generalTitle: 'General',
  generalFirst: true,
  featured: [
    'index.number_of_replicas',
    'index.auto_expand_replicas',
    'index.refresh_interval',
    'index.number_of_shards',
    'index.max_result_window',
    'index.priority',
    'index.hidden',
    'index.default_pipeline',
    'index.lifecycle.name',
    'index.routing.allocation.include._tier_preference',
    'index.blocks.write',
    'index.blocks.read_only',
  ],
};
const QUICK_PICKS = 8;

/** Settings Elasticsearch does not list until they are set, offered by "Add setting". */
const ADD_SUGGESTIONS: readonly string[] = [
  'index.routing.allocation.require._name',
  'index.routing.allocation.include._name',
  'index.routing.allocation.exclude._name',
  'index.routing.allocation.require._ip',
  'index.routing.allocation.exclude._ip',
  'index.routing.allocation.require._host',
  'index.routing.allocation.exclude._host',
];

@Component({
  selector: 'cerebro-index-settings',
  imports: [EmptyStateComponent, IndexPickerComponent, RouterLink, SettingsEditorComponent, SettingsSkeletonComponent],
  templateUrl: './index-settings.component.html',
  styleUrl: './index-settings.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class IndexSettingsComponent implements PendingChangesAware {
  private readonly api = inject(ClusterApiService);
  private readonly alerts = inject(AlertService);
  private readonly dialogs = inject(DialogService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  readonly connection = inject(ConnectionService);

  readonly grouping = GROUPING;
  readonly addSuggestions = ADD_SUGGESTIONS;
  /** The `index` query parameter (an index, or an alias resolving to one). */
  readonly index = toSignal(this.route.queryParamMap.pipe(map((params) => params.get('index') ?? '')), {
    initialValue: '',
  });

  readonly state = signal<LoadState>('idle');
  readonly rows = signal<readonly SettingRow[] | undefined>(undefined);
  readonly metadata = signal<IndexMetadata | undefined>(undefined);
  /** Concrete index the settings belong to. */
  readonly resolvedIndex = signal('');
  readonly candidates = signal<readonly string[]>([]);
  /** The `index` parameter the rows and drafts belong to (lags behind while a switch is confirmed). */
  readonly loadedIndex = signal('');
  readonly drafts = signal<SettingDrafts>({});
  readonly errors = signal<SettingErrors>({});
  readonly saving = signal(false);
  readonly reloading = signal(false);
  /** Why the settings could not be loaded, as Elasticsearch put it. */
  readonly loadError = signal<string | undefined>(undefined);
  /** Reference time of relative dates, moved on every load. */
  readonly now = signal(Date.now());

  readonly quickPicks = QUICK_PICKS;
  readonly overridden = computed(() => (this.rows() ?? []).filter((row) => row.origin === 'index').length);
  readonly pending = computed(() => pendingChanges(this.rows() ?? [], this.drafts()));

  private readonly picker = viewChild(IndexPickerComponent);
  private loadSequence = 0;
  private lastResponse = '';
  /** A Back/Forward switch to another index waits for the discard dialog. */
  private confirmingSwitch = false;
  /** History position of the entry showing the loaded index (see `historyPosition`). */
  private loadedPosition: number | undefined;

  constructor() {
    // Settings only change when someone edits them: they load on open, on an
    // index switch, after a save and on Reload, not on refresh ticks (another
    // cluster creates the page again).
    effect(() => {
      const index = this.index();
      untracked(() => {
        if (index !== this.loadedIndex()) {
          if (this.pending().length > 0) {
            // Picker switches discard first, so this is browser history navigation.
            void this.confirmHistorySwitch();
            return;
          }
          this.reset(index);
        } else {
          this.loadedPosition = this.historyPosition();
        }
        if (index) {
          void this.load(index);
        }
      });
    });
  }

  /**
   * Reloads (after a save or on Reload) leave the current state (ready,
   * missing, multiple or error) on screen until the answer arrives; only
   * switching index or an explicit retry shows the skeleton.
   */
  async load(index: string): Promise<void> {
    const sequence = ++this.loadSequence;
    try {
      const response = await this.api.post<IndexSettingsResponse>('index_settings', { index });
      if (sequence !== this.loadSequence || index !== this.index()) {
        return;
      }
      this.now.set(Date.now());
      const serialized = JSON.stringify(response);
      if (serialized === this.lastResponse && this.state() === 'ready') {
        return;
      }
      this.lastResponse = serialized;
      const resolved = resolveIndexSettings(response, index);
      if (resolved.kind === 'single') {
        const rows = buildIndexSettingRows(resolved.group);
        this.resolvedIndex.set(resolved.index);
        this.metadata.set(indexMetadata(resolved.group));
        this.rows.set(rows);
        this.drafts.update((drafts) => pruneDrafts(rows, drafts));
        this.state.set('ready');
      } else {
        this.rows.set(undefined);
        this.metadata.set(undefined);
        this.resolvedIndex.set('');
        this.candidates.set(resolved.kind === 'multiple' ? resolved.indices : []);
        this.state.set(resolved.kind);
      }
    } catch (error: unknown) {
      if (sequence !== this.loadSequence || index !== this.index()) {
        return;
      }
      if (error instanceof ClusterApiError && error.status === 404) {
        this.rows.set(undefined);
        this.metadata.set(undefined);
        this.resolvedIndex.set('');
        this.state.set('missing');
      } else {
        // Keep showing the last good values when a reload fails.
        if (this.state() !== 'ready') {
          this.loadError.set(readableReason(error));
          this.state.set('error');
        }
        this.alerts.error(failureMessage(`Could not load the settings of ${index}`, error), error);
      }
    }
  }

  age(date: Date): string {
    return formatRelative(date.getTime(), this.now());
  }

  /** Reads the settings again, keeping the table and the staged changes on screen. */
  async reload(): Promise<void> {
    const index = this.index();
    if (!index || this.reloading()) {
      return;
    }
    this.reloading.set(true);
    try {
      await this.load(index);
    } finally {
      this.reloading.set(false);
    }
  }

  retry(): void {
    const index = this.index();
    if (index) {
      this.state.set('loading');
      void this.load(index);
    }
  }

  async pick(next: string): Promise<void> {
    if (next === this.index()) {
      return;
    }
    if (this.pending().length > 0) {
      const confirmed = await this.confirmDiscardDrafts('will be lost.', 'Discard and switch');
      if (!confirmed) {
        this.picker()?.revert();
        return;
      }
      this.drafts.set({});
    }
    this.navigate(next);
  }

  navigate(index: string): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { index: index || null },
      queryParamsHandling: 'merge',
    });
  }

  async confirmDiscard(): Promise<boolean> {
    if (this.pending().length === 0) {
      return true;
    }
    return this.confirmDiscardDrafts('will be lost if you leave this page.', 'Discard changes');
  }

  review(changes: readonly PendingChange[]): void {
    this.dialogs.showJson(
      'Review pending changes',
      buildFlatSettingsPayload(changes),
      `PUT /${this.resolvedIndex()}/_settings`,
    );
  }

  async save(changes: readonly PendingChange[]): Promise<void> {
    const index = this.resolvedIndex();
    if (this.saving() || changes.length === 0 || !index) {
      return;
    }
    this.saving.set(true);
    this.errors.set({});
    try {
      const response = await this.api.post<unknown>('index_settings/update', {
        index,
        settings: buildFlatSettingsPayload(changes),
      });
      this.alerts.success(
        changes.length === 1 ? `Saved ${changes[0]?.name} on ${index}` : `Saved ${pluralize(changes.length, 'setting')} on ${index}`,
        response,
      );
      this.lastResponse = '';
      await this.load(this.index());
      this.drafts.update((drafts) => withoutSavedDrafts(drafts, changes));
    } catch (error: unknown) {
      this.errors.set(settingErrorsFor(error, changes));
      this.alerts.error(failureMessage(`Could not save the settings of ${index}`, error), error);
    } finally {
      this.saving.set(false);
    }
  }

  private confirmDiscardDrafts(consequence: string, confirmLabel: string): Promise<boolean> {
    const changes = this.pending();
    return this.dialogs.confirm({
      title: 'Discard unsaved changes?',
      message: `${pluralize(changes.length, 'unsaved change')} to ${this.resolvedIndex() || this.loadedIndex()} ${consequence}`,
      items: changes.map((change) => change.name),
      confirmLabel,
      cancelLabel: 'Keep editing',
      tone: 'danger',
    });
  }

  /**
   * The `index` query parameter changed while edits are pending (Back or
   * Forward; the canDeactivate guard does not run for query parameters).
   * Either discard the edits and show the new index, or put the edited index
   * back in the URL.
   */
  private async confirmHistorySwitch(): Promise<void> {
    if (this.confirmingSwitch) {
      return;
    }
    this.confirmingSwitch = true;
    try {
      if (await this.confirmDiscardDrafts('will be lost.', 'Discard and switch')) {
        const index = this.index();
        this.reset(index);
        if (index) {
          void this.load(index);
        }
      } else {
        this.restoreHistoryEntry();
      }
    } finally {
      this.confirmingSwitch = false;
    }
  }

  /**
   * Puts the edited index back in the URL after a declined Back/Forward. With
   * the router's `computed` cancel resolution every entry carries its
   * position, so the browser simply steps back to the edited entry and the
   * history stays exactly as it was. Without positions, a new entry for the
   * edited index is pushed instead, so another Back asks again rather than
   * leaving the page.
   */
  private restoreHistoryEntry(): void {
    const loaded = this.loadedPosition;
    const current = this.historyPosition();
    if (loaded !== undefined && current !== undefined && loaded !== current) {
      this.location.historyGo(loaded - current);
      return;
    }
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { index: this.loadedIndex() || null },
      queryParamsHandling: 'merge',
    });
  }

  /** Position of the current history entry, as recorded by the router (`computed` mode only). */
  private historyPosition(): number | undefined {
    const state: unknown = this.location.getState();
    const position = isRecord(state) ? state['ɵrouterPageId'] : undefined;
    return typeof position === 'number' ? position : undefined;
  }

  private reset(index: string): void {
    this.loadedPosition = this.historyPosition();
    this.loadedIndex.set(index);
    this.loadSequence++;
    this.lastResponse = '';
    this.rows.set(undefined);
    this.metadata.set(undefined);
    this.resolvedIndex.set('');
    this.candidates.set([]);
    this.drafts.set({});
    this.errors.set({});
    this.state.set(index ? 'loading' : 'idle');
  }
}
