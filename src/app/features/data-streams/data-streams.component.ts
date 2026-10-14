import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AlertService } from '../../core/alert.service';
import { ClusterApiService } from '../../core/cluster-api.service';
import { ConnectionService } from '../../core/connection.service';
import { DialogService } from '../../core/dialog.service';
import { RefreshService } from '../../core/refresh.service';
import { EmptyStateComponent } from '../../shared/empty-state.component';
import { BytesPipe, NumberPipe } from '../../shared/format.pipes';
import { MenuComponent } from '../../shared/menu.component';
import { SearchInputComponent } from '../../shared/search-input.component';
import {
  DataStream,
  DataStreamStats,
  DataStreamsResponse,
  RolloverResponse,
  StreamRow,
  StreamSortField,
} from './data-streams.models';
import { failureMessage, pluralize } from '../index-templates/index-templates.utils';
import {
  buildRows,
  filterRows,
  formatRelative,
  formatTimestamp,
  healthDescription,
  isInternal,
  keepsStreamLink,
  linkedStreamMissing,
  missingStreamMessage,
  nextBackingIndex,
  relinkExpanded,
  revealsInternal,
  shortIndexName,
  sortRows,
  streamNameParam,
  summarize,
} from './data-streams.utils';

type RowAction = 'rollover' | 'delete';

interface SortColumn {
  readonly field: StreamSortField;
  readonly label: string;
  readonly numeric: boolean;
}

@Component({
  selector: 'cerebro-data-streams',
  imports: [BytesPipe, EmptyStateComponent, FormsModule, MenuComponent, NumberPipe, RouterLink, SearchInputComponent],
  templateUrl: './data-streams.component.html',
  styleUrl: './data-streams.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DataStreamsComponent {
  private readonly api = inject(ClusterApiService);
  private readonly alerts = inject(AlertService);
  private readonly dialogs = inject(DialogService);
  private readonly refreshService = inject(RefreshService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly connection = inject(ConnectionService);

  readonly streams = signal<readonly DataStream[] | undefined>(undefined);
  readonly stats = signal<DataStreamStats | null>(null);
  readonly loading = signal(false);
  readonly failed = signal(false);
  readonly now = signal(Date.now());

  readonly query = signal('');
  readonly showInternal = signal(false);
  readonly sortField = signal<StreamSortField>('name');
  readonly reverse = signal(false);
  readonly expanded = signal<ReadonlySet<string>>(new Set());
  readonly busy = signal<ReadonlyMap<string, RowAction>>(new Map());
  /** Stream named by the `?name=` deep link while the search box still shows it. */
  readonly linkedName = signal<string | null>(null);

  readonly columns: Readonly<Record<StreamSortField, SortColumn>> = {
    name: { field: 'name', label: 'Data stream', numeric: false },
    health: { field: 'health', label: 'Health', numeric: false },
    indices: { field: 'indices', label: 'Backing indices', numeric: true },
    size: { field: 'size', label: 'Size', numeric: true },
    lastEvent: { field: 'lastEvent', label: 'Last event', numeric: false },
  };

  readonly allRows = computed(() => buildRows(this.streams(), this.stats()));
  readonly internalCount = computed(() => this.allRows().filter((row) => isInternal(row)).length);
  readonly scopedRows = computed(() => this.allRows().filter((row) => this.showInternal() || !isInternal(row)));
  readonly rows = computed(() =>
    sortRows(filterRows(this.allRows(), this.query(), this.showInternal()), this.sortField(), this.reverse()),
  );
  readonly summary = computed(() => summarize(this.scopedRows()));
  readonly statsMissing = computed(() => this.streams() !== undefined && this.stats() === null);
  readonly linkedMissing = computed(() =>
    linkedStreamMissing(this.allRows(), this.linkedName(), this.streams() !== undefined),
  );
  readonly missingMessage = computed(() => {
    const name = this.linkedName();
    return name === null ? null : missingStreamMessage(name);
  });

  private loadSequence = 0;
  /** Linked stream whose hidden/system visibility still has to be checked after a load. */
  private pendingReveal: string | null = null;
  /** Navigations started here to drop `?name=`; their emissions are echoes. */
  private urlWrites = 0;
  /** Row expanded by the latest `?name=` link (not by the user); it collapses when the link changes. */
  private linkExpanded: string | null = null;

  constructor() {
    effect(() => {
      this.refreshService.tick();
      if (this.connection.connected()) {
        void untracked(() => this.load());
      }
    });

    // `?name=` deep links from /index_detail and /ilm: filter to the stream and
    // expand it. A later plain /data_streams link clears the linked filter.
    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      if (this.urlWrites > 0) {
        return;
      }
      const name = streamNameParam(params.get('name'));
      const previous = untracked(this.linkedName);
      if (name === previous) {
        return;
      }
      if (name === null) {
        if (previous !== null && keepsStreamLink(untracked(this.query), previous)) {
          this.query.set('');
        }
        this.linkedName.set(null);
        this.pendingReveal = null;
        this.relink(null);
        return;
      }
      this.query.set(name);
      this.linkedName.set(name);
      this.relink(name);
      this.pendingReveal = name;
      this.revealPending();
    });

    // Once the user edits or clears the filter the link no longer applies.
    effect(() => {
      const query = this.query();
      const linked = this.linkedName();
      if (linked !== null && !keepsStreamLink(query, linked)) {
        untracked(() => {
          this.linkedName.set(null);
          this.pendingReveal = null;
          this.dropNameParam();
        });
      }
    });
  }

  async load(): Promise<void> {
    const sequence = ++this.loadSequence;
    this.loading.set(true);
    try {
      const response = await this.api.post<DataStreamsResponse>('data_streams');
      if (sequence !== this.loadSequence) {
        return;
      }
      this.now.set(Date.now());
      this.streams.set(Array.isArray(response?.data_streams) ? response.data_streams : []);
      this.stats.set(response?.stats ?? null);
      this.failed.set(false);
      this.revealPending();
    } catch (error: unknown) {
      if (sequence === this.loadSequence) {
        this.failed.set(true);
        this.alerts.error(failureMessage('Could not load data streams', error), error);
      }
    } finally {
      if (sequence === this.loadSequence) {
        this.loading.set(false);
      }
    }
  }

  sortBy(field: StreamSortField): void {
    if (this.sortField() === field) {
      this.reverse.update((value) => !value);
    } else {
      this.sortField.set(field);
      // Numbers and recency are most useful largest / newest / worst first.
      this.reverse.set(field !== 'name');
    }
  }

  ariaSort(field: StreamSortField): 'ascending' | 'descending' | 'none' {
    if (this.sortField() !== field) {
      return 'none';
    }
    return this.reverse() ? 'descending' : 'ascending';
  }

  sortIcon(field: StreamSortField): string {
    if (this.sortField() !== field) {
      return 'bi-arrow-down-up';
    }
    return this.reverse() ? 'bi-arrow-down' : 'bi-arrow-up';
  }

  isExpanded(name: string): boolean {
    return this.expanded().has(name);
  }

  toggle(name: string): void {
    if (name === this.linkExpanded) {
      // The user now owns this row's state: a later link must not collapse it.
      this.linkExpanded = null;
    }
    this.expanded.update((current) => {
      const next = new Set(current);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  }

  resetFilters(): void {
    this.query.set('');
  }

  relative(time: number | null): string {
    return formatRelative(time, this.now());
  }

  absolute(time: number | null): string {
    return formatTimestamp(time);
  }

  healthTitle(row: StreamRow): string {
    return healthDescription(row.health);
  }

  shortName(index: string, stream: string): string {
    return shortIndexName(index, stream);
  }

  busyAction(name: string): RowAction | undefined {
    return this.busy().get(name);
  }

  viewJson(row: StreamRow): void {
    this.dialogs.showJson(`Data stream ${row.name}`, row.stream, pluralize(row.indexCount, 'backing index', 'backing indices'));
  }

  async rollover(row: StreamRow): Promise<void> {
    if (this.busy().has(row.name)) {
      return;
    }
    const next = nextBackingIndex(row.name, row.generation, Date.now());
    const confirmed = await this.dialogs.confirm({
      title: `Roll over ${row.name}?`,
      message:
        `Elasticsearch creates a new write index (${next}) that receives all new documents from now on. ` +
        `${row.writeIndex ?? 'The current write index'} keeps its data and stays searchable.`,
      confirmLabel: 'Roll over',
    });
    if (!confirmed) {
      return;
    }
    this.setBusy(row.name, 'rollover');
    try {
      const response = await this.api.post<RolloverResponse>('data_streams/rollover', { name: row.name });
      this.alerts.success(
        response?.new_index ? `Rolled over ${row.name}: new write index ${response.new_index}` : `Rolled over ${row.name}`,
        response,
      );
      this.expanded.update((current) => new Set(current).add(row.name));
      await this.load();
    } catch (error: unknown) {
      this.alerts.error(failureMessage(`Could not roll over ${row.name}`, error), error);
    } finally {
      this.setBusy(row.name, undefined);
    }
  }

  async remove(row: StreamRow): Promise<void> {
    if (this.busy().has(row.name)) {
      return;
    }
    const count = row.indexCount;
    const indices = pluralize(count, 'backing index', 'backing indices');
    const confirmed = await this.dialogs.confirm({
      title: `Delete data stream ${row.name}?`,
      message:
        `This permanently deletes the data stream and its ${indices} listed below, including every document stored in them. ` +
        `It cannot be undone. A new document sent to ${row.name} would create an empty stream again.`,
      items: row.backingIndices.map((index) => index.name),
      confirmLabel: count === 1 ? 'Delete stream and 1 index' : `Delete stream and ${count} indices`,
      tone: 'danger',
    });
    if (!confirmed) {
      return;
    }
    this.setBusy(row.name, 'delete');
    try {
      const response = await this.api.post<unknown>('data_streams/delete', { name: row.name });
      this.alerts.success(`Data stream ${row.name} deleted`, response);
      this.streams.update((list) => list?.filter((stream) => stream.name !== row.name));
      this.expanded.update((current) => {
        const next = new Set(current);
        next.delete(row.name);
        return next;
      });
      await this.load();
    } catch (error: unknown) {
      this.alerts.error(failureMessage(`Could not delete data stream ${row.name}`, error), error);
    } finally {
      this.setBusy(row.name, undefined);
    }
  }

  /** Hidden and system streams are filtered out by default: show them for a link to one. */
  private revealPending(): void {
    const name = this.pendingReveal;
    if (name === null || this.streams() === undefined) {
      return;
    }
    this.pendingReveal = null;
    if (revealsInternal(this.allRows(), name)) {
      this.showInternal.set(true);
    }
  }

  /** Collapse the row the previous link opened (unless the user re-toggled it) and open the new one. */
  private relink(name: string | null): void {
    const previous = this.linkExpanded;
    this.expanded.update((current) => relinkExpanded(current, previous, name));
    this.linkExpanded = name;
  }

  private dropNameParam(): void {
    if (this.route.snapshot.queryParamMap.get('name') === null) {
      return;
    }
    this.urlWrites++;
    void this.router
      .navigate([], {
        relativeTo: this.route,
        queryParams: { name: null },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      })
      .finally(() => this.urlWrites--);
  }

  private setBusy(name: string, action: RowAction | undefined): void {
    this.busy.update((current) => {
      const next = new Map(current);
      if (action) {
        next.set(name, action);
      } else {
        next.delete(name);
      }
      return next;
    });
  }
}
