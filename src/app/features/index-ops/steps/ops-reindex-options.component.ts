import { Location } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { ConnectionService } from '../../../core/connection.service';
import { CodeEditorComponent } from '../../../shared/code-editor.component';
import { CheckFix, ConflictsMode, ReindexOptions, SlicesMode } from '../index-ops.models';
import { IndexOpsStore } from '../index-ops.store';
import { ReindexField, sourceExpressions } from '../index-ops.utils';
import { OpsChecksComponent } from './ops-checks.component';

/** Step 3 of a reindex: destination, query, conflicts, limits and script. */
@Component({
  selector: 'cerebro-ops-reindex-options',
  imports: [CodeEditorComponent, OpsChecksComponent, RouterLink],
  // Coming back from creating the destination in another tab looks it up again.
  host: { '(window:focus)': 'store.recheckDest()' },
  templateUrl: './ops-reindex-options.component.html',
  styleUrls: ['./ops-steps.css', './ops-reindex-options.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OpsReindexOptionsComponent {
  readonly store = inject(IndexOpsStore);
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  readonly connection = inject(ConnectionService);
  private readonly touched = signal<ReadonlySet<ReindexField>>(new Set());

  readonly options = this.store.reindex;
  readonly showAdvanced = signal(false);
  /** Destinations offered while typing: existing indices and data streams. */
  readonly suggestions = computed(() => {
    const names = [...(this.store.indices() ?? []).filter((name) => !name.startsWith('.')), ...this.store.taken().dataStreams];
    return [...new Set(names)].sort((left, right) => left.localeCompare(right));
  });
  readonly firstSource = computed(() => {
    const lookup = this.store.sourcesLookup();
    return lookup.state === 'ready' ? (lookup.indices[0]?.name ?? null) : (sourceExpressions(this.options().sources)[0] ?? null);
  });

  showError(field: ReindexField): string | undefined {
    const error = this.store.reindexFieldErrors()[field];
    return error && (this.store.submitted() || this.touched().has(field)) ? error : undefined;
  }

  update<K extends keyof ReindexOptions>(field: K, value: ReindexOptions[K], touched?: ReindexField): void {
    this.store.reindex.update((options) => ({ ...options, [field]: value }));
    this.store.touch();
    if (touched) {
      this.touched.update((fields) => new Set([...fields, touched]));
    }
  }

  setConflicts(value: ConflictsMode): void {
    this.update('conflicts', value);
  }

  setSlices(value: SlicesMode): void {
    this.update('slicesMode', value);
  }

  /**
   * Query params of Create index for the destination. Create index does not
   * read `name` and `from` yet (shared change request); they are harmless until then.
   */
  readonly createParams = computed(() => {
    const params: Record<string, string | null> = { ...this.connection.hostQuery(), name: this.options().dest.trim() || null };
    const from = this.firstSource();
    if (from) {
      params['from'] = from;
    }
    return params;
  });

  onFix(fix: CheckFix): void {
    if (fix === 'create-destination') {
      // A new tab keeps the wizard and its options; the destination is looked up again on return.
      const url = this.router.serializeUrl(this.router.createUrlTree(['/create'], { queryParams: this.createParams() }));
      globalThis.open?.(this.location.prepareExternalUrl(url), '_blank', 'noopener');
    }
  }
}
