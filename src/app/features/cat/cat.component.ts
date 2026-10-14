import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AlertService } from '../../core/alert.service';
import { ClusterApiService } from '../../core/cluster-api.service';
import {
  CAT_APIS,
  CatApi,
  CatRow,
  SortDirection,
  asCatRows,
  catApiValue,
  catCellText,
  catColumns,
  sortCatRows,
} from './cat.utils';

@Component({
  selector: 'cerebro-cat',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <main class="container-fluid py-3" aria-labelledby="cat-title">
      <h1 id="cat-title" class="h4">cat apis</h1>
      <div class="row g-2 align-items-end">
        <div class="col-sm">
          <label for="cat-api" class="visually-hidden">CAT API</label>
          <select id="cat-api" class="form-select" [(ngModel)]="selectedApi">
            <option value="">select a CAT API</option>
            @for (api of apis; track api) {
              <option [value]="api">{{ api }}</option>
            }
          </select>
        </div>
        <div class="col-sm-auto">
          <button
            type="button"
            class="btn btn-success w-100"
            [disabled]="loading() || !selectedApi"
            (click)="execute()"
          >
            {{ loading() ? 'executing…' : 'execute' }}
          </button>
        </div>
      </div>

      <section class="mt-3" aria-live="polite" aria-busy="{{ loading() }}">
        @if (executed() && rows().length === 0 && !loading() && !failed()) {
          <p class="h4 text-center text-body-secondary py-4">No data available</p>
        }

        @if (failed() && !loading()) {
          <p class="h4 text-center text-danger py-4" role="status">
            Unable to load CAT data.
          </p>
        }

        @if (columns().length > 0) {
          <div class="table-responsive">
            <table class="table table-sm table-hover align-middle">
              <thead>
                <tr>
                  @for (column of columns(); track column) {
                    <th scope="col" [attr.aria-sort]="ariaSort(column)">
                      <button
                        type="button"
                        class="btn btn-link link-body-emphasis p-0 text-decoration-none fw-semibold"
                        (click)="sort(column)"
                      >
                        {{ column }}
                        @if (sortColumn() === column) {
                          <i
                            class="bi"
                            [class.bi-caret-up-fill]="sortDirection() === 'asc'"
                            [class.bi-caret-down-fill]="sortDirection() === 'desc'"
                            aria-hidden="true"
                          ></i>
                        }
                      </button>
                    </th>
                  }
                </tr>
              </thead>
              <tbody>
                @for (row of sortedRows(); track $index) {
                  <tr>
                    @for (column of columns(); track column) {
                      <td>{{ cell(row, column) }}</td>
                    }
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      </section>
    </main>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CatComponent {
  private readonly api = inject(ClusterApiService);
  private readonly alerts = inject(AlertService);

  readonly apis = CAT_APIS;
  readonly rows = signal<readonly CatRow[]>([]);
  readonly columns = signal<readonly string[]>([]);
  readonly loading = signal(false);
  readonly executed = signal(false);
  readonly failed = signal(false);
  readonly sortColumn = signal<string | null>(null);
  readonly sortDirection = signal<SortDirection>('desc');
  readonly sortedRows = computed(() =>
    sortCatRows(this.rows(), this.sortColumn(), this.sortDirection()),
  );

  selectedApi: CatApi | '' = '';

  async execute(): Promise<void> {
    if (!this.selectedApi) {
      return;
    }

    this.loading.set(true);
    this.executed.set(false);
    this.failed.set(false);
    try {
      const response = await this.api.post<unknown>('cat', {
        api: catApiValue(this.selectedApi),
      });
      const rows = asCatRows(response);
      const columns = catColumns(rows);
      this.rows.set(rows);
      this.columns.set(columns);
      this.sortColumn.set(columns[0] ?? null);
      this.sortDirection.set('desc');
      this.executed.set(true);
    } catch (error: unknown) {
      // Never leave stale data visible after a failed CAT request.
      this.rows.set([]);
      this.columns.set([]);
      this.sortColumn.set(null);
      this.sortDirection.set('desc');
      this.executed.set(true);
      this.failed.set(true);
      this.alerts.error('Error executing request', error);
    } finally {
      this.loading.set(false);
    }
  }

  sort(column: string): void {
    if (this.sortColumn() === column) {
      this.sortDirection.update((direction) =>
        direction === 'asc' ? 'desc' : 'asc',
      );
    } else {
      this.sortColumn.set(column);
      this.sortDirection.set('desc');
    }
  }

  ariaSort(column: string): 'ascending' | 'descending' | 'none' {
    if (this.sortColumn() !== column) {
      return 'none';
    }
    return this.sortDirection() === 'asc' ? 'ascending' : 'descending';
  }

  cell(row: CatRow, column: string): string {
    return catCellText(row[column]);
  }
}
