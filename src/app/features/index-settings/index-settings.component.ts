import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
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
import { failureMessage } from '../../core/errors';
import { formatTimestamp, pluralize } from '../../core/format';
import { PendingChangesAware } from '../../core/pending-changes.guard';
import { RefreshService } from '../../core/refresh.service';
import { EmptyStateComponent } from '../../shared/empty-state.component';
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
  groupIndexOptions,
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
  imports: [EmptyStateComponent, RouterLink, SettingsEditorComponent, SettingsSkeletonComponent],
  templateUrl: './index-settings.component.html',
  styleUrl: './index-settings.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class IndexSettingsComponent implements PendingChangesAware {
  private readonly api = inject(ClusterApiService);
  private readonly alerts = inject(AlertService);
  private readonly dialogs = inject(DialogService);
  private readonly refreshService = inject(RefreshService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly connection = inject(ConnectionService);

  readonly grouping = GROUPING;
  readonly formatTimestamp = formatTimestamp;
  readonly addSuggestions = ADD_SUGGESTIONS;
  /** The `index` query parameter (an index, or an alias resolving to one). */
  readonly index = toSignal(this.route.queryParamMap.pipe(map((params) => params.get('index') ?? '')), {
    initialValue: '',
  });

  readonly indices = signal<readonly string[] | undefined>(undefined);
  /** The index list could not be loaded (as opposed to the cluster having none). */
  readonly indicesFailed = signal(false);
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

  readonly options = computed(() => {
    const groups = groupIndexOptions(this.indices() ?? []);
    const index = this.index();
    const known = groups.regular.includes(index) || groups.system.includes(index);
    return { ...groups, extra: index && !known ? index : '' };
  });
  readonly quickPicks = computed(() => this.options().regular.slice(0, QUICK_PICKS));
  readonly overridden = computed(() => (this.rows() ?? []).filter((row) => row.origin === 'index').length);
  readonly pending = computed(() => pendingChanges(this.rows() ?? [], this.drafts()));

  private readonly picker = viewChild<ElementRef<HTMLSelectElement>>('picker');
  private loadSequence = 0;
  private indicesSequence = 0;
  /** Cluster the rows and drafts belong to. */
  private loadedHost: string | undefined;
  /** Cluster the index list belongs to. */
  private indicesHost: string | undefined;
  private lastResponse = '';
  /** A Back/Forward switch to another index waits for the discard dialog. */
  private confirmingSwitch = false;

  constructor() {
    effect(() => {
      this.refreshService.tick();
      const host = this.connection.host();
      untracked(() => {
        if (host !== this.indicesHost) {
          this.indicesHost = host;
          this.indicesSequence++;
          this.indices.set(undefined);
          this.indicesFailed.set(false);
        }
        if (host) {
          void this.loadIndices();
        }
      });
    });

    effect(() => {
      this.refreshService.tick();
      const index = this.index();
      const host = this.connection.host();
      untracked(() => {
        if (host !== this.loadedHost) {
          this.switchCluster(this.loadedHost, host);
          this.reset(index);
        } else if (index !== this.loadedIndex()) {
          if (this.pending().length > 0) {
            // Picker switches discard first, so this is browser history navigation.
            void this.confirmHistorySwitch();
            return;
          }
          this.reset(index);
        }
        if (host && index) {
          void this.load(index);
        }
      });
    });
  }

  async loadIndices(): Promise<void> {
    const sequence = ++this.indicesSequence;
    try {
      const indices = await this.api.post<readonly string[]>('commons/indices');
      if (sequence === this.indicesSequence) {
        this.indices.set(indices);
        this.indicesFailed.set(false);
      }
    } catch (error: unknown) {
      // A failed background refresh keeps the list that is already shown.
      if (sequence === this.indicesSequence && this.indices() === undefined) {
        this.indicesFailed.set(true);
        this.alerts.error(failureMessage('Could not load indices', error), error);
      }
    }
  }

  retryIndices(): void {
    this.indicesFailed.set(false);
    void this.loadIndices();
  }

  /**
   * Background refreshes leave the current state (ready, missing, multiple or
   * error) on screen until the answer arrives; only switching index or an
   * explicit retry shows the skeleton.
   */
  async load(index: string): Promise<void> {
    const sequence = ++this.loadSequence;
    try {
      const response = await this.api.post<IndexSettingsResponse>('index_settings', { index });
      if (sequence !== this.loadSequence || index !== this.index()) {
        return;
      }
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
        // Keep showing the last good values when a background refresh fails.
        if (this.state() !== 'ready') {
          this.state.set('error');
        }
        this.alerts.error(failureMessage(`Could not load the settings of ${index}`, error), error);
      }
    }
  }

  retry(): void {
    const index = this.index();
    if (index) {
      this.state.set('loading');
      void this.load(index);
    }
  }

  async pick(select: HTMLSelectElement): Promise<void> {
    const next = select.value;
    if (next === this.index()) {
      return;
    }
    if (this.pending().length > 0) {
      const confirmed = await this.confirmDiscardDrafts('will be lost.', 'Discard and switch');
      if (!confirmed) {
        select.value = this.index();
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

  focusPicker(): void {
    this.picker()?.nativeElement.focus();
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

  /** Edits never follow the user to another cluster, even to an index of the same name. */
  private switchCluster(previous: string | undefined, next: string | undefined): void {
    this.loadedHost = next;
    const discarded = this.pending().length;
    if (previous !== undefined && next !== undefined && discarded > 0) {
      this.alerts.warn(`Discarded ${pluralize(discarded, 'pending change')} made on ${previous}`);
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
        if (this.connection.host() && index) {
          void this.load(index);
        }
      } else {
        await this.router.navigate([], {
          relativeTo: this.route,
          queryParams: { index: this.loadedIndex() || null },
          queryParamsHandling: 'merge',
          replaceUrl: true,
        });
      }
    } finally {
      this.confirmingSwitch = false;
    }
  }

  private reset(index: string): void {
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
