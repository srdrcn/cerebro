import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AlertService } from '../../core/alert.service';
import { ClusterApiService } from '../../core/cluster-api.service';
import { ChecklistOption, IndexChecklistComponent } from './index-checklist.component';
import { SnapshotRecord, buildRestoreSnapshotPayload, defaultRestoreForm } from './snapshots.models';
import {
  errorReason,
  formatTimestamp,
  indexStatuses,
  isRenaming,
  pluralize,
  renameIndex,
  restoreTargetState,
  snapshotIndices,
  snapshotStart,
  validateRename,
} from './snapshots.utils';

/**
 * Modal form that restores (part of) a snapshot. It owns its form state and
 * the restore request; the parent only decides when it is shown.
 */
@Component({
  selector: 'cerebro-snapshot-restore',
  imports: [FormsModule, IndexChecklistComponent],
  templateUrl: './snapshot-restore.component.html',
  styleUrl: './snapshot-restore.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SnapshotRestoreComponent {
  private readonly api = inject(ClusterApiService);
  private readonly alerts = inject(AlertService);

  readonly repository = input.required<string>();
  readonly snapshot = input.required<SnapshotRecord>();
  /**
   * Names of the indices that currently exist in the cluster. Used until the
   * open/closed status of each index has been fetched.
   */
  readonly clusterIndices = input<readonly string[]>([]);

  readonly closed = output<void>();
  readonly restored = output<string>();

  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  private readonly defaults = defaultRestoreForm();
  readonly renamePattern = signal(this.defaults.renamePattern);
  readonly renameReplacement = signal(this.defaults.renameReplacement);
  readonly ignoreUnavailable = signal(this.defaults.ignoreUnavailable);
  readonly includeAliases = signal(this.defaults.includeAliases);
  // Elasticsearch defaults to false: restoring the global state replaces
  // persistent cluster settings, templates and pipelines, so opt in explicitly.
  readonly includeGlobalState = signal(false);
  readonly selected = signal<ReadonlySet<string>>(new Set());
  readonly submitted = signal(false);
  readonly restoring = signal(false);
  /** Why the last attempt failed; toasts are hidden behind the modal. */
  readonly failure = signal<string | null>(null);
  /** `index → open|close` from `_cat/indices`, or null until it answered. */
  readonly indexStatus = signal<ReadonlyMap<string, string> | null>(null);

  readonly indexNames = computed(() => {
    const snapshot = this.snapshot();
    const streams = Array.isArray(snapshot.data_streams) ? snapshot.data_streams : [];
    return [...new Set([...snapshotIndices(snapshot), ...streams])].sort((left, right) =>
      left.localeCompare(right),
    );
  });

  private readonly dataStreams = computed(
    () => new Set(Array.isArray(this.snapshot().data_streams) ? this.snapshot().data_streams : []),
  );

  readonly hasGlobalState = computed(() => this.snapshot().include_global_state !== false);

  private readonly renameErrors = computed(() =>
    validateRename(this.renamePattern(), this.renameReplacement()),
  );
  readonly patternError = computed(() => this.renameErrors().pattern);
  readonly replacementError = computed(() => this.renameErrors().replacement);
  /** A pattern without a replacement is only flagged once it matters. */
  readonly showReplacementError = computed(
    () => !!this.replacementError() && (this.submitted() || !!this.renameReplacement().trim()),
  );
  /** Elasticsearch renames only with a valid pattern *and* a replacement. */
  readonly renaming = computed(() => isRenaming(this.renamePattern(), this.renameReplacement()));

  private readonly existing = computed(() => new Set(this.clusterIndices()));

  private readonly targets = computed(() => {
    const pattern = this.renamePattern();
    const replacement = this.renameReplacement();
    const statuses = this.indexStatus();
    const existing = this.existing();
    return this.indexNames().map((name) => {
      const target = renameIndex(name, pattern, replacement);
      return { name, target, state: restoreTargetState(target, statuses, existing) };
    });
  });

  readonly options = computed<ChecklistOption[]>(() =>
    this.targets().map(({ name, target, state }) => ({
      name,
      ...(this.dataStreams().has(name) ? { badge: 'data stream' } : {}),
      ...(target !== name ? { detail: target } : {}),
      ...(state === 'open' ? { warn: true, warnLabel: 'exists' } : {}),
      ...(state === 'closed' ? { note: 'replaces closed' } : {}),
    })),
  );

  readonly selectedNames = computed(() =>
    this.indexNames().filter((name) => this.selected().has(name)),
  );

  /** Selected indices whose target is an open index: the restore fails. */
  readonly conflicts = computed(() =>
    this.targets().filter(({ name, state }) => state === 'open' && this.selected().has(name)),
  );

  /** Selected indices whose target is a closed index: it gets replaced. */
  readonly replacements = computed(() =>
    this.targets().filter(({ name, state }) => state === 'closed' && this.selected().has(name)),
  );

  readonly selectionError = computed(() =>
    this.selectedNames().length === 0 ? 'Select at least one index to restore.' : null,
  );

  readonly valid = computed(
    () => !this.selectionError() && !this.patternError() && !this.replacementError(),
  );

  readonly subtitle = computed(() => {
    const start = snapshotStart(this.snapshot());
    return [this.repository(), start === null ? null : `taken ${formatTimestamp(start)}`]
      .filter(Boolean)
      .join(' · ');
  });

  readonly submitLabel = computed(() => {
    const count = this.selectedNames().length;
    if (count === 0) {
      return 'Restore';
    }
    return count === this.indexNames().length && count > 1
      ? `Restore all ${count} indices`
      : `Restore ${pluralize(count, 'index', 'indices')}`;
  });

  readonly pluralize = pluralize;

  constructor() {
    afterNextRender(() => {
      this.selected.set(new Set(this.indexNames()));
      const dialog = this.dialog().nativeElement;
      if (!dialog.open) {
        dialog.showModal();
      }
      void this.loadIndexStatus();
    });
  }

  /**
   * The landing data only lists index names. Restoring over a closed index
   * replaces it while an open one makes the restore fail, so fetch the
   * status once; on failure every existing name keeps counting as open.
   */
  async loadIndexStatus(): Promise<void> {
    try {
      const rows = await this.api.post<unknown>('cat', { api: 'indices' });
      this.indexStatus.set(indexStatuses(rows));
    } catch {
      // Best effort: the names from the landing call are still used.
    }
  }

  /**
   * A restore starts without a confirmation, so Enter in a text field must
   * not submit it implicitly: only the restore button does.
   */
  preventImplicitSubmit(event: Event): void {
    if (event.target instanceof HTMLInputElement) {
      event.preventDefault();
    }
  }

  usePrefix(): void {
    this.renamePattern.set('(.+)');
    this.renameReplacement.set('restored-$1');
  }

  clearRename(): void {
    this.renamePattern.set('');
    this.renameReplacement.set('');
  }

  close(): void {
    if (this.restoring()) {
      return;
    }
    const dialog = this.dialog().nativeElement;
    if (dialog.open) {
      dialog.close();
    }
    this.closed.emit();
  }

  onCancel(event: Event): void {
    event.preventDefault();
    this.close();
  }

  onBackdropClick(event: MouseEvent): void {
    const dialog = this.dialog().nativeElement;
    if (event.target !== dialog) {
      return;
    }
    const rect = dialog.getBoundingClientRect();
    const inside =
      event.clientX >= rect.left &&
      event.clientX <= rect.right &&
      event.clientY >= rect.top &&
      event.clientY <= rect.bottom;
    if (!inside) {
      this.close();
    }
  }

  async restore(): Promise<void> {
    this.submitted.set(true);
    if (!this.valid() || this.restoring()) {
      return;
    }
    const selected = this.selectedNames();
    const all = selected.length === this.indexNames().length;
    const name = this.snapshot().snapshot;
    const payload = buildRestoreSnapshotPayload(this.repository(), name, {
      renamePattern: this.renaming() ? this.renamePattern() : '',
      renameReplacement: this.renaming() ? this.renameReplacement() : '',
      ignoreUnavailable: this.ignoreUnavailable(),
      includeAliases: this.includeAliases(),
      includeGlobalState: this.hasGlobalState() && this.includeGlobalState(),
      // Every index selected: let Elasticsearch restore the whole snapshot.
      indices: all ? [] : selected,
    });
    this.restoring.set(true);
    this.failure.set(null);
    try {
      const response = await this.api.post<unknown>('snapshots/restore', payload);
      this.alerts.success(
        `Restore of ${pluralize(selected.length, 'index', 'indices')} from ${name} started`,
        response,
      );
      this.restoring.set(false);
      this.restored.emit(name);
      this.close();
    } catch (error: unknown) {
      this.failure.set(errorReason(error) ?? 'Elasticsearch rejected the restore request.');
      this.alerts.error(`Could not restore snapshot ${name}`, error);
    } finally {
      this.restoring.set(false);
    }
  }
}
