import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AlertService } from '../../core/alert.service';
import { ClipboardService } from '../../core/clipboard.service';
import { ClusterApiService } from '../../core/cluster-api.service';
import { ConnectionService } from '../../core/connection.service';
import { failureMessage, readableReason } from '../../core/errors';
import { pluralize } from '../../core/format';
import { RefreshService } from '../../core/refresh.service';
import { EmptyStateComponent } from '../../shared/empty-state.component';
import { NumberPipe, PluralPipe } from '../../shared/format.pipes';
import { PagerComponent, clampPage, pageSlice } from '../../shared/pager.component';
import { SearchInputComponent } from '../../shared/search-input.component';
import { createSort } from '../../shared/sort-state';
import {
  CAT_APIS,
  CAT_API_INFO,
  CatApi,
  CatApiInfo,
  CatRow,
  asCatRows,
  catApiFromParam,
  catApiValue,
  catCellText,
  catCellTone,
  catColumns,
  catKeyParts,
  catRowsToTsv,
  filterCatRows,
  isCatRecord,
  numericColumns,
  sortCatRows,
} from './cat.utils';

/** Rows rendered per page; CAT shards/segments can be very large. */
const CAT_PAGE_SIZE = 250;

interface CatApiOption {
  readonly api: CatApi;
  readonly value: string;
  readonly info: CatApiInfo;
}

export interface CatResult {
  readonly api: CatApi;
  readonly rows: readonly CatRow[];
  readonly columns: readonly string[];
  readonly numeric: ReadonlySet<string>;
  /** Epoch milliseconds of the load. */
  readonly loadedAt: number;
}

interface CatFailure {
  readonly api: CatApi;
  readonly reason: string | undefined;
}

@Component({
  selector: 'cerebro-cat',
  imports: [DatePipe, EmptyStateComponent, FormsModule, NumberPipe, PagerComponent, PluralPipe, RouterLink, SearchInputComponent],
  templateUrl: './cat.component.html',
  styleUrl: './cat.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CatComponent {
  private readonly api = inject(ClusterApiService);
  private readonly alerts = inject(AlertService);
  private readonly clipboard = inject(ClipboardService);
  private readonly refreshService = inject(RefreshService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly connection = inject(ConnectionService);

  readonly pageSize = CAT_PAGE_SIZE;
  readonly pluralize = pluralize;
  readonly options: readonly CatApiOption[] = CAT_APIS.map((api) => ({
    api,
    value: catApiValue(api),
    info: CAT_API_INFO[api],
  }));

  private readonly queryParams = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });
  readonly apiParam = computed(() => this.queryParams().get('api'));
  readonly selectedApi = computed(() => catApiFromParam(this.apiParam()));
  readonly unknownApi = computed(() => Boolean(this.apiParam()) && this.selectedApi() === null);
  readonly selectedOption = computed(() =>
    this.options.find((option) => option.api === this.selectedApi()),
  );

  /** Links keep the connected host and swap the `api` query parameter. */
  readonly links = computed(() => {
    const hostQuery = this.connection.hostQuery();
    return new Map(this.options.map((option) => [option.api, { ...hostQuery, api: option.value }]));
  });

  readonly result = signal<CatResult | null>(null);
  readonly failure = signal<CatFailure | null>(null);
  readonly loading = signal(false);
  /** Loads the user asked for (silent auto refreshes do not spin buttons). */
  readonly manualLoading = signal(false);
  readonly filter = signal('');
  /** No column (`''`) keeps the order Elasticsearch returned. */
  readonly sort = createSort<string>('', {
    // Numbers are most useful largest first, text alphabetically.
    descendingFirst: (column) => this.result()?.numeric.has(column) ?? false,
  });
  readonly page = signal(1);

  /** Data of the selected API only — never show another API's rows. */
  readonly current = computed(() => {
    const result = this.result();
    return result && result.api === this.selectedApi() ? result : null;
  });

  readonly currentFailure = computed(() => {
    const failure = this.failure();
    return failure && failure.api === this.selectedApi() ? failure : null;
  });

  /** The single row of a single-row API (health, count, master), if shown as a record. */
  readonly record = computed(() => {
    const result = this.current();
    return result && isCatRecord(result.api, result.rows) ? (result.rows[0] ?? null) : null;
  });

  readonly visibleRows = computed(() => {
    const result = this.current();
    if (!result) {
      return [];
    }
    return sortCatRows(
      filterCatRows(result.rows, result.columns, this.filter()),
      this.sort.field() || null,
      this.sort.reverse(),
    );
  });

  /** Rows "Copy as TSV" copies: what the table shows, or the whole record. */
  readonly copyRows = computed(() => {
    const result = this.current();
    if (!result) {
      return [];
    }
    return this.record() ? result.rows : this.visibleRows();
  });

  readonly currentPage = computed(() =>
    clampPage(this.page(), this.visibleRows().length, this.pageSize),
  );
  readonly pageRows = computed(() =>
    pageSlice(this.visibleRows(), this.currentPage(), this.pageSize),
  );

  private loadSequence = 0;

  constructor() {
    effect(() => {
      this.refreshService.tick();
      const api = this.selectedApi();
      if (api && this.connection.connected()) {
        untracked(() => void this.load(api));
      }
    });
  }

  async load(api: CatApi, manual = false): Promise<void> {
    const sequence = ++this.loadSequence;
    this.manualLoading.set(manual);
    if (this.result()?.api !== api) {
      // A different API: start from a clean table.
      this.result.set(null);
      this.filter.set('');
      this.sort.field.set('');
      this.sort.reverse.set(false);
      this.page.set(1);
    }
    this.loading.set(true);
    try {
      const response = await this.api.post<unknown>('cat', { api: catApiValue(api) });
      if (sequence !== this.loadSequence) {
        return;
      }
      const rows = asCatRows(response);
      const columns = catColumns(rows);
      this.result.set({
        api,
        rows,
        columns,
        numeric: numericColumns(rows, columns),
        loadedAt: Date.now(),
      });
      this.failure.set(null);
      const sortColumn = this.sort.field();
      if (sortColumn && !columns.includes(sortColumn)) {
        this.sort.field.set('');
      }
    } catch (error: unknown) {
      if (sequence !== this.loadSequence) {
        return;
      }
      this.failure.set({ api, reason: readableReason(error) });
      this.alerts.error(failureMessage(`Could not load _cat/${catApiValue(api)}`, error), error);
    } finally {
      if (sequence === this.loadSequence) {
        this.loading.set(false);
        this.manualLoading.set(false);
      }
    }
  }

  /** Re-runs the request when the already selected API is chosen again. */
  rerunIfSelected(api: CatApi): void {
    if (api === this.selectedApi()) {
      void this.load(api, true);
    }
  }

  async choose(value: string): Promise<void> {
    const api = catApiFromParam(value);
    if (!api) {
      return;
    }
    if (api === this.selectedApi()) {
      void this.load(api, true);
      return;
    }
    await this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { api: catApiValue(api) },
      queryParamsHandling: 'merge',
    });
  }

  refresh(): void {
    const api = this.selectedApi();
    if (api) {
      void this.load(api, true);
    }
  }

  setFilter(value: string): void {
    this.filter.set(value);
    this.page.set(1);
  }

  sortBy(column: string): void {
    this.sort.sortBy(column);
    this.page.set(1);
  }

  async copyTsv(): Promise<void> {
    const result = this.current();
    if (!result) {
      return;
    }
    const rows = this.copyRows();
    await this.clipboard.copy(
      catRowsToTsv(result.columns, rows),
      () => this.alerts.success(`Copied ${pluralize(rows.length, 'row')} as TSV`),
      (error: unknown) => this.alerts.error(failureMessage('Could not copy the rows', error), error),
    );
  }

  keyParts(column: string): readonly string[] {
    return catKeyParts(column);
  }

  cellText(row: CatRow, column: string): string {
    return catCellText(row[column]);
  }

  /** Tooltip for values long enough to be truncated. */
  cellTitle(row: CatRow, column: string): string | null {
    const text = catCellText(row[column]);
    return text.length > 48 ? text : null;
  }

  /** Badge and dot classes of health and shard-state cells, `null` for other cells. */
  cellStatus(row: CatRow, column: string): { readonly badge: string; readonly dot: string } | null {
    const tone = catCellTone(column, row[column]);
    if (tone === null) {
      return null;
    }
    return { badge: tone === 'gray' ? 'badge' : `badge badge-${tone}`, dot: `dot dot-sm dot-${tone}` };
  }
}
