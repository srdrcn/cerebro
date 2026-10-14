import { ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AlertService } from '../../core/alert.service';
import { ClusterApiService } from '../../core/cluster-api.service';
import { ConnectionService } from '../../core/connection.service';
import {
  AliasAction,
  AliasChange,
  AliasDraft,
  AliasRecord,
  buildAliasActions,
  buildAliasAdd,
} from './aliases.models';

@Component({
  selector: 'cerebro-aliases',
  standalone: true,
  imports: [FormsModule],
  template: `
    <section aria-labelledby="aliases-title">
      <div class="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-4">
        <div>
          <h2 id="aliases-title" class="h4 mb-1">Aliases</h2>
          <p class="text-body-secondary mb-0">
            Manage aliases on {{ connection.host() || 'the connected cluster' }}.
          </p>
        </div>
        <button type="button" class="btn btn-outline-secondary btn-sm" (click)="load()" [disabled]="loading">
          <i class="bi bi-arrow-clockwise me-1" aria-hidden="true"></i>Refresh
        </button>
      </div>

      <div class="row g-4">
        <div class="col-xl-6">
          <div class="d-flex align-items-center justify-content-between mb-3">
            <h3 class="h5 mb-0">Current aliases</h3>
            <span class="text-body-secondary small">{{ filteredAliases.length }} assignments</span>
          </div>

          <div class="row g-2 mb-3">
            <div class="col-sm-6">
              <label class="visually-hidden" for="alias-filter">Filter by alias</label>
              <input id="alias-filter" class="form-control" placeholder="Filter by alias"
                     [(ngModel)]="aliasFilter" (ngModelChange)="resetPage()" />
            </div>
            <div class="col-sm-6">
              <label class="visually-hidden" for="alias-index-filter">Filter by index</label>
              <input id="alias-index-filter" class="form-control" placeholder="Filter by index"
                     [(ngModel)]="indexFilter" (ngModelChange)="resetPage()" />
            </div>
          </div>

          @if (loading) {
            <p class="text-body-secondary" role="status">Loading aliases…</p>
          } @else if (!filteredAliases.length) {
            <p class="text-body-secondary py-4 mb-0">No aliases match the current filters.</p>
          } @else {
            <div class="table-responsive">
              <table class="table table-hover align-middle">
                <thead>
                  <tr><th>Alias</th><th>Index</th><th>Routing</th><th class="text-end">Actions</th></tr>
                </thead>
                <tbody>
                  @for (alias of pageAliases; track alias.index + ':' + alias.alias) {
                    <tr [class.opacity-50]="isRemoved(alias)">
                      <td>
                        <button type="button" class="btn btn-link p-0 text-start text-decoration-none"
                                (click)="toggleDetails(alias)">
                          <i class="bi bi-tag me-1" aria-hidden="true"></i>{{ alias.alias }}
                        </button>
                      </td>
                      <td>{{ alias.index }}</td>
                      <td class="small text-body-secondary">
                        {{ alias.search_routing || '—' }} / {{ alias.index_routing || '—' }}
                      </td>
                      <td class="text-end">
                        <button type="button" class="btn btn-outline-danger btn-sm" (click)="stageRemove(alias)"
                                [disabled]="isRemoved(alias)" [attr.aria-label]="'Remove alias ' + alias.alias">
                          <i class="bi bi-trash" aria-hidden="true"></i>
                        </button>
                      </td>
                    </tr>
                    @if (expandedAlias === aliasKey(alias)) {
                      <tr>
                        <td colspan="4" class="bg-body-tertiary">
                          @if (alias.filter) {
                            <pre class="small mb-0 text-wrap">{{ pretty(alias.filter) }}</pre>
                          } @else {
                            <span class="small text-body-secondary">No filter set.</span>
                          }
                        </td>
                      </tr>
                    }
                  }
                </tbody>
              </table>
            </div>
            @if (pageCount > 1) {
              <nav class="d-flex align-items-center justify-content-end gap-2" aria-label="Alias pages">
                <button type="button" class="btn btn-outline-secondary btn-sm" (click)="page = page - 1"
                        [disabled]="page === 1">Previous</button>
                <span class="small text-body-secondary">{{ page }} / {{ pageCount }}</span>
                <button type="button" class="btn btn-outline-secondary btn-sm" (click)="page = page + 1"
                        [disabled]="page === pageCount">Next</button>
              </nav>
            }
          }
        </div>

        <div class="col-xl-6">
          <h3 class="h5 mb-3">Stage changes</h3>
          <div class="row g-3">
            <div class="col-sm-6">
              <label class="form-label" for="new-alias">Alias</label>
              <input id="new-alias" class="form-control" [(ngModel)]="draft.alias" placeholder="Alias name" />
            </div>
            <div class="col-sm-6">
              <label class="form-label" for="new-alias-index">Index</label>
              <select id="new-alias-index" class="form-select" [(ngModel)]="draft.index">
                <option value="">Select index</option>
                @for (index of indices; track index) { <option [value]="index">{{ index }}</option> }
              </select>
            </div>
            <div class="col-12">
              <button type="button" class="btn btn-link px-0 text-decoration-none" (click)="showAdvanced = !showAdvanced">
                <i class="bi me-1" [class.bi-chevron-right]="!showAdvanced" [class.bi-chevron-down]="showAdvanced"
                   aria-hidden="true"></i>Routing and filter
              </button>
            </div>
            @if (showAdvanced) {
              <div class="col-sm-6">
                <label class="form-label" for="index-routing">Index routing</label>
                <input id="index-routing" class="form-control" [(ngModel)]="draft.indexRouting" />
              </div>
              <div class="col-sm-6">
                <label class="form-label" for="search-routing">Search routing</label>
                <input id="search-routing" class="form-control" [(ngModel)]="draft.searchRouting" />
              </div>
              <div class="col-12">
                <label class="form-label" for="alias-filter-json">Filter JSON</label>
                <textarea id="alias-filter-json" class="form-control font-monospace" rows="8"
                          [(ngModel)]="draft.filterText" spellcheck="false" placeholder='{ "term": { "status": "active" } }'></textarea>
              </div>
            }
            <div class="col-12 text-end">
              <button type="button" class="btn btn-info" (click)="stageAdd()">
                <i class="bi bi-plus-lg me-1" aria-hidden="true"></i>Add change
              </button>
            </div>
          </div>

          <hr class="my-4" />
          <div class="d-flex align-items-center justify-content-between mb-2">
            <h4 class="h6 mb-0">Pending changes</h4>
            <span class="badge text-bg-secondary">{{ changes.length }}</span>
          </div>
          @if (!changes.length) {
            <p class="small text-body-secondary">Changes are applied together in one atomic request.</p>
          } @else {
            <div class="list-group list-group-flush mb-3">
              @for (change of changes; track $index; let i = $index) {
                <div class="list-group-item px-0 d-flex align-items-center gap-2">
                  <i class="bi" [class.bi-tag-fill]="change.kind === 'add'" [class.bi-tag]="change.kind === 'remove'"
                     [class.text-info]="change.kind === 'add'" [class.text-danger]="change.kind === 'remove'"
                     aria-hidden="true"></i>
                  <span class="flex-grow-1">
                    <strong>{{ change.alias.alias }}</strong>
                    {{ change.kind === 'add' ? 'assigned to' : 'unassigned from' }}
                    <strong>{{ change.alias.index }}</strong>
                  </span>
                  <button type="button" class="btn btn-link btn-sm text-body-secondary" (click)="revert(i)"
                          aria-label="Revert change"><i class="bi bi-arrow-counterclockwise" aria-hidden="true"></i></button>
                </div>
              }
            </div>
            <div class="text-end">
              <button type="button" class="btn btn-success" (click)="apply()" [disabled]="saving">
                {{ saving ? 'Applying…' : 'Apply changes' }}
              </button>
            </div>
          }
        </div>
      </div>
    </section>
  `,
})
export class AliasesComponent implements OnInit {
  private readonly api = inject(ClusterApiService);
  private readonly alerts = inject(AlertService);
  private readonly cdr = inject(ChangeDetectorRef);
  readonly connection = inject(ConnectionService);

  aliases: AliasRecord[] = [];
  indices: string[] = [];
  changes: AliasChange[] = [];
  draft: AliasDraft = { alias: '', index: '', filterText: '', indexRouting: '', searchRouting: '' };
  aliasFilter = '';
  indexFilter = '';
  expandedAlias = '';
  showAdvanced = false;
  loading = false;
  saving = false;
  page = 1;
  readonly pageSize = 15;

  ngOnInit(): void {
    void this.load();
  }

  get filteredAliases(): AliasRecord[] {
    return this.aliases
      .filter((item) => item.alias.includes(this.aliasFilter) && item.index.includes(this.indexFilter))
      .sort((left, right) => left.alias.localeCompare(right.alias) || left.index.localeCompare(right.index));
  }

  get pageCount(): number {
    return Math.max(1, Math.ceil(this.filteredAliases.length / this.pageSize));
  }

  get pageAliases(): AliasRecord[] {
    const safePage = Math.min(this.page, this.pageCount);
    return this.filteredAliases.slice((safePage - 1) * this.pageSize, safePage * this.pageSize);
  }

  async load(): Promise<void> {
    this.loading = true;
    try {
      const [aliases, indices] = await Promise.all([
        this.api.post<AliasRecord[]>('aliases/get_aliases'),
        this.api.post<string[]>('commons/indices'),
      ]);
      this.aliases = aliases;
      this.indices = [...indices].sort((a, b) => a.localeCompare(b));
      this.resetPage();
    } catch (error) {
      this.alerts.error('Error while fetching aliases', error);
    } finally {
      this.loading = false;
      this.cdr.markForCheck();
    }
  }

  stageAdd(): void {
    try {
      const action = buildAliasAdd(this.draft);
      this.changes = [...this.changes, { kind: 'add', alias: action.add }];
      this.draft = { alias: '', index: '', filterText: '', indexRouting: '', searchRouting: '' };
    } catch (error) {
      this.alerts.error(error instanceof SyntaxError ? 'Malformed filter' : String(error), error);
    }
  }

  stageRemove(alias: AliasRecord): void {
    if (!this.isRemoved(alias)) {
      this.changes = [...this.changes, { kind: 'remove', alias }];
    }
  }

  revert(position: number): void {
    this.changes = this.changes.filter((_, index) => index !== position);
  }

  async apply(): Promise<void> {
    if (!this.changes.length) return;
    this.saving = true;
    try {
      const changes: AliasAction[] = buildAliasActions(this.changes);
      const response = await this.api.post<unknown>('aliases/update_aliases', { changes });
      this.changes = [];
      this.alerts.success('Aliases successfully updated', response);
      await this.load();
    } catch (error) {
      this.alerts.error('Error while updating aliases', error);
    } finally {
      this.saving = false;
      this.cdr.markForCheck();
    }
  }

  isRemoved(alias: AliasRecord): boolean {
    return this.changes.some((change) => change.kind === 'remove' && change.alias === alias);
  }

  resetPage(): void {
    this.page = 1;
  }

  aliasKey(alias: AliasRecord): string {
    return `${alias.index}:${alias.alias}`;
  }

  toggleDetails(alias: AliasRecord): void {
    const key = this.aliasKey(alias);
    this.expandedAlias = this.expandedAlias === key ? '' : key;
  }

  pretty(value: unknown): string {
    return JSON.stringify(value, null, 2);
  }
}
