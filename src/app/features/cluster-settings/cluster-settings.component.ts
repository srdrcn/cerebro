import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { AlertService } from '../../core/alert.service';
import { ClusterApiService } from '../../core/cluster-api.service';
import { ConnectionService } from '../../core/connection.service';
import { DialogService } from '../../core/dialog.service';
import { failureMessage, readableReason } from '../../core/errors';
import { pluralize } from '../../core/format';
import { PendingChangesAware } from '../../core/pending-changes.guard';
import { EmptyStateComponent } from '../../shared/empty-state.component';
import { NumberPipe, PluralPipe } from '../../shared/format.pipes';
import {
  ClusterSettingsResponse,
  buildClusterSavePayload,
  buildClusterSettingRows,
  summarizeOverrides,
} from './cluster-settings.models';
import { SettingsEditorComponent } from '../../shared/settings-editor/settings-editor.component';
import { SettingsSkeletonComponent } from '../../shared/settings-editor/settings-skeleton.component';
import {
  GroupingOptions,
  PendingChange,
  SettingDrafts,
  SettingErrors,
  SettingRow,
  pendingChanges,
  pruneDrafts,
  settingErrorsFor,
  withoutSavedDrafts,
} from '../../shared/settings-editor/settings-editor.models';

const GROUPING: GroupingOptions = {
  generalTitle: 'Other settings',
  generalFirst: false,
  featured: [
    'cluster.routing.allocation.enable',
    'cluster.routing.rebalance.enable',
    'cluster.routing.allocation.cluster_concurrent_rebalance',
    'cluster.routing.allocation.node_concurrent_recoveries',
    'indices.recovery.max_bytes_per_sec',
    'cluster.routing.allocation.disk.watermark.low',
    'cluster.routing.allocation.disk.watermark.high',
    'cluster.routing.allocation.disk.watermark.flood_stage',
    'cluster.routing.allocation.awareness.attributes',
    'cluster.max_shards_per_node',
    'action.destructive_requires_name',
    'cluster.blocks.read_only',
  ],
};

/** Settings Elasticsearch does not list until they are set, offered by "Add setting". */
const ADD_SUGGESTIONS: readonly string[] = [
  'cluster.routing.allocation.exclude._name',
  'cluster.routing.allocation.exclude._ip',
  'cluster.routing.allocation.exclude._host',
  'cluster.routing.allocation.include._name',
  'cluster.routing.allocation.require._name',
  'cluster.routing.allocation.awareness.force.zone.values',
  'logger._root',
  'logger.org.elasticsearch.cluster',
  'logger.org.elasticsearch.discovery',
  'logger.org.elasticsearch.indices.recovery',
  'logger.org.elasticsearch.transport',
];

@Component({
  selector: 'cerebro-cluster-settings',
  imports: [EmptyStateComponent, NumberPipe, PluralPipe, SettingsEditorComponent, SettingsSkeletonComponent],
  templateUrl: './cluster-settings.component.html',
  styleUrl: './cluster-settings.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ClusterSettingsComponent implements PendingChangesAware {
  private readonly api = inject(ClusterApiService);
  private readonly alerts = inject(AlertService);
  private readonly dialogs = inject(DialogService);
  private readonly connection = inject(ConnectionService);

  readonly grouping = GROUPING;
  readonly pluralize = pluralize;
  readonly addSuggestions = ADD_SUGGESTIONS;
  readonly rows = signal<readonly SettingRow[] | undefined>(undefined);
  readonly drafts = signal<SettingDrafts>({});
  readonly errors = signal<SettingErrors>({});
  readonly failed = signal(false);
  /** Why the settings could not be loaded, as Elasticsearch put it. */
  readonly loadError = signal<string | undefined>(undefined);
  readonly saving = signal(false);
  readonly reloading = signal(false);

  readonly overrides = computed(() => summarizeOverrides(this.rows() ?? []));
  readonly transientSettings = computed(() =>
    (this.rows() ?? []).filter((row) => row.transient !== undefined).map((row) => row.name),
  );
  /** Transient settings not yet staged to move to the persistent layer. */
  readonly unstagedTransient = computed(() => {
    const drafts = this.drafts();
    return (this.rows() ?? []).filter((row) => row.transient !== undefined && drafts[row.name] === undefined);
  });
  readonly pending = computed(() => pendingChanges(this.rows() ?? [], this.drafts()));

  private loadSequence = 0;
  private lastResponse = '';
  /** Cluster the rows and drafts belong to. */
  private loadedHost: string | undefined;

  constructor() {
    // Settings only change when someone edits them: they load on open, on a
    // cluster switch, after a save and on Reload, not on refresh ticks.
    effect(() => {
      const host = this.connection.host();
      untracked(() => {
        if (host !== this.loadedHost) {
          this.switchCluster(this.loadedHost, host);
        }
        if (host) {
          void this.load();
        }
      });
    });
  }

  async load(): Promise<void> {
    const sequence = ++this.loadSequence;
    try {
      const response = await this.api.post<ClusterSettingsResponse>('cluster_settings');
      if (sequence !== this.loadSequence) {
        return;
      }
      this.failed.set(false);
      const serialized = JSON.stringify(response);
      if (serialized === this.lastResponse && this.rows()) {
        return;
      }
      this.lastResponse = serialized;
      const rows = buildClusterSettingRows(response);
      this.rows.set(rows);
      this.drafts.update((drafts) => pruneDrafts(rows, drafts));
    } catch (error: unknown) {
      if (sequence === this.loadSequence) {
        this.loadError.set(readableReason(error));
        this.failed.set(true);
        this.alerts.error(failureMessage('Could not load cluster settings', error), error);
      }
    }
  }

  /** Reads the settings again, keeping the table and the staged changes on screen. */
  async reload(): Promise<void> {
    if (this.reloading()) {
      return;
    }
    this.reloading.set(true);
    try {
      await this.load();
    } finally {
      this.reloading.set(false);
    }
  }

  retry(): void {
    this.failed.set(false);
    this.rows.set(undefined);
    void this.load();
  }

  /** Stages every transient setting to be saved as persistent with its current value. */
  moveAllToPersistent(): void {
    const rows = this.unstagedTransient();
    this.drafts.update((drafts) => {
      const next = { ...drafts };
      for (const row of rows) {
        next[row.name] = { value: row.value, scope: 'persistent' };
      }
      return next;
    });
  }

  async confirmDiscard(): Promise<boolean> {
    const changes = this.pending();
    if (changes.length === 0) {
      return true;
    }
    return this.dialogs.confirm({
      title: 'Discard unsaved changes?',
      message: `${pluralize(changes.length, 'unsaved change')} to the cluster settings will be lost if you leave this page.`,
      items: changes.map((change) => change.name),
      confirmLabel: 'Discard changes',
      cancelLabel: 'Keep editing',
      tone: 'danger',
    });
  }

  review(changes: readonly PendingChange[]): void {
    this.dialogs.showJson(
      'Review pending changes',
      buildClusterSavePayload(changes, this.rows() ?? []),
      'PUT /_cluster/settings',
    );
  }

  async save(changes: readonly PendingChange[]): Promise<void> {
    if (this.saving() || changes.length === 0) {
      return;
    }
    this.saving.set(true);
    this.errors.set({});
    try {
      const settings = buildClusterSavePayload(changes, this.rows() ?? []);
      const response = await this.api.post<unknown>('cluster_settings/save', { settings });
      this.alerts.success(
        changes.length === 1 ? `Saved ${changes[0]?.name}` : `Saved ${pluralize(changes.length, 'cluster setting')}`,
        response,
      );
      this.lastResponse = '';
      await this.load();
      this.drafts.update((drafts) => withoutSavedDrafts(drafts, changes));
    } catch (error: unknown) {
      this.errors.set(settingErrorsFor(error, changes));
      this.alerts.error(failureMessage('Could not save cluster settings', error), error);
    } finally {
      this.saving.set(false);
    }
  }

  /**
   * Edits never follow the user to another cluster: switching host drops the
   * rows and drafts of the previous one before loading the new one.
   */
  private switchCluster(previous: string | undefined, next: string | undefined): void {
    this.loadedHost = next;
    if (previous === undefined) {
      return;
    }
    const discarded = this.pending().length;
    this.loadSequence++;
    this.lastResponse = '';
    this.rows.set(undefined);
    this.drafts.set({});
    this.errors.set({});
    this.failed.set(false);
    if (discarded > 0 && next !== undefined) {
      this.alerts.warn(`Discarded ${pluralize(discarded, 'pending change')} made on ${previous}`);
    }
  }
}
