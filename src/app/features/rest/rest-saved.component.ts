import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { AlertService } from '../../core/alert.service';
import { DialogService } from '../../core/dialog.service';
import { formatRelative, formatTimestamp, pluralize } from '../../core/format';
import { readPreference, writePreference } from '../../core/preferences';
import { RefreshService } from '../../core/refresh.service';
import { EmptyStateComponent } from '../../shared/empty-state.component';
import { NumberPipe, PluralPipe } from '../../shared/format.pipes';
import { MenuComponent } from '../../shared/menu.component';
import { SearchInputComponent } from '../../shared/search-input.component';
import type { SavedRequest, SavedSort } from './rest-saved.models';
import { RestSavedStore } from './rest-saved.store';
import {
  bodySummary,
  filterSavedRequests,
  isSavedSort,
  sameName,
  sortSavedRequests,
} from './rest-saved.utils';

const SORT_KEY = 'cerebro.rest.saved-sort';

/** The "Saved" tab of the REST console: filter, sort and manage saved requests. */
@Component({
  selector: 'cerebro-rest-saved',
  imports: [EmptyStateComponent, MenuComponent, NumberPipe, PluralPipe, SearchInputComponent],
  templateUrl: './rest-saved.component.html',
  styleUrl: './rest-saved.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'rest-saved' },
})
export class RestSavedComponent {
  private readonly store = inject(RestSavedStore);
  private readonly dialogs = inject(DialogService);
  private readonly alerts = inject(AlertService);
  private readonly refresh = inject(RefreshService);

  /** "Ctrl" or "⌘", for the keyboard hint. */
  readonly modKey = input('Ctrl');
  /** The editor differs from the linked saved request. */
  readonly dirty = input(false);

  readonly load = output<SavedRequest>();
  readonly rename = output<SavedRequest>();
  readonly saveCurrent = output<void>();
  readonly importFile = output<void>();

  readonly pluralize = pluralize;
  readonly query = signal('');
  readonly sort = signal<SavedSort>(this.initialSort());

  readonly requests = this.store.requests;
  readonly readOnly = this.store.readOnly;
  readonly linked = this.store.linked;
  readonly visible = computed(() =>
    filterSavedRequests(sortSavedRequests(this.store.requests(), this.sort()), this.query()),
  );

  /** Relative times are refreshed with the page's auto refresh. */
  private readonly now = computed(() => {
    this.refresh.tick();
    this.store.requests();
    return Date.now();
  });

  setSort(sort: SavedSort): void {
    this.sort.set(sort);
    writePreference(SORT_KEY, sort);
  }

  isLinked(request: SavedRequest): boolean {
    const linked = this.linked();
    return linked !== null && sameName(linked.name, request.name);
  }

  usedLabel(request: SavedRequest): string {
    return request.lastUsedAt === null ? 'Not used yet' : formatRelative(request.lastUsedAt, this.now());
  }

  usedTitle(request: SavedRequest): string {
    const used =
      request.lastUsedAt === null ? 'Not loaded yet' : `Last used ${formatTimestamp(request.lastUsedAt)}`;
    return `${used} · changed ${formatTimestamp(request.updatedAt)}`;
  }

  summary(request: SavedRequest): string {
    return bodySummary(request.path, request.body);
  }

  duplicate(request: SavedRequest): void {
    const { copy, stored } = this.store.duplicate(request.name);
    if (copy === null) {
      return;
    }
    if (stored) {
      this.alerts.success(`Duplicated as “${copy.name}”`);
    } else {
      this.alerts.warn(
        `Duplicated as “${copy.name}”, but the browser did not store it`,
        this.store.notStoredDetail(),
      );
    }
  }

  viewJson(request: SavedRequest): void {
    this.dialogs.showJson(request.name, request, `${request.method} ${request.path}`);
  }

  async remove(request: SavedRequest): Promise<void> {
    const confirmed = await this.dialogs.confirm({
      title: `Delete “${request.name}”?`,
      message:
        'The saved request is removed from this browser. Export your saved requests first if you want to keep a copy.',
      items: [`${request.method} ${request.path}`],
      confirmLabel: 'Delete saved request',
      tone: 'danger',
    });
    if (!confirmed) {
      return;
    }
    if (this.store.remove(request.name)) {
      this.alerts.success(`Deleted “${request.name}”`);
    } else {
      this.alerts.warn(
        `Deleted “${request.name}”, but the browser did not store the change`,
        this.store.notStoredDetail(),
      );
    }
  }

  private initialSort(): SavedSort {
    const stored = readPreference(SORT_KEY);
    return isSavedSort(stored) ? stored : 'name';
  }
}
