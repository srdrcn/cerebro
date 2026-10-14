import { DatePipe } from '@angular/common';
import { ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AlertService } from '../../core/alert.service';
import { ClusterApiService } from '../../core/cluster-api.service';
import { ConnectionService } from '../../core/connection.service';
import { ModalService } from '../../core/modal.service';
import {
  CreateSnapshotForm,
  RestoreSnapshotForm,
  SnapshotIndex,
  SnapshotLandingData,
  SnapshotRecord,
  buildCreateSnapshotPayload,
  buildRestoreSnapshotPayload,
  defaultRestoreForm,
} from './snapshots.models';

@Component({
  selector: 'cerebro-snapshots',
  standalone: true,
  imports: [DatePipe, FormsModule],
  template: `
    <section aria-labelledby="snapshots-title">
      <div class="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-4">
        <div>
          <h2 id="snapshots-title" class="h4 mb-1">Snapshots</h2>
          <p class="text-body-secondary mb-0">Create and restore backups for {{ connection.host() || 'the connected cluster' }}.</p>
        </div>
        <button type="button" class="btn btn-outline-secondary btn-sm" (click)="load()" [disabled]="loading">
          <i class="bi bi-arrow-clockwise me-1" aria-hidden="true"></i>Refresh
        </button>
      </div>

      <div class="row g-4">
        <div class="col-xl-6">
          <div class="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-3">
            <h3 class="h5 mb-0">Existing snapshots</h3>
            <div>
              <label class="visually-hidden" for="snapshot-repository-filter">Repository</label>
              <select id="snapshot-repository-filter" class="form-select form-select-sm" [ngModel]="selectedRepository"
                      (ngModelChange)="selectRepository($event)">
                <option value="">Select repository</option>
                @for (repository of repositories; track repository) { <option [value]="repository">{{ repository }}</option> }
              </select>
            </div>
          </div>

          @if (loadingSnapshots) {
            <p class="text-body-secondary" role="status">Loading snapshots…</p>
          } @else if (!selectedRepository) {
            <p class="text-body-secondary py-4">Select a repository to load its snapshots.</p>
          } @else if (!snapshots.length) {
            <p class="text-body-secondary py-4">No snapshots found in this repository.</p>
          } @else {
            <div class="list-group list-group-flush">
              @for (snapshot of snapshots; track snapshotKey(snapshot)) {
                <article class="list-group-item px-0 py-3">
                  <div class="d-flex align-items-start gap-2">
                    <i class="bi bi-database mt-1" aria-hidden="true"></i>
                    <div class="flex-grow-1 min-width-0">
                      <div class="fw-semibold text-break">{{ snapshot.snapshot }}</div>
                      <div class="small text-body-secondary">
                        @if (snapshot.start_time) { {{ snapshot.start_time | date:'yyyy-MM-dd HH:mm:ss Z' }} · }
                        {{ snapshot.state || 'unknown state' }}
                      </div>
                    </div>
                    <button type="button" class="btn btn-link btn-sm text-body-secondary" (click)="view(snapshot)"
                            aria-label="View snapshot JSON"><i class="bi bi-braces" aria-hidden="true"></i></button>
                    <button type="button" class="btn btn-link btn-sm" (click)="toggleRestore(snapshot)"
                            aria-label="Restore snapshot"><i class="bi bi-download" aria-hidden="true"></i></button>
                    <button type="button" class="btn btn-link btn-sm text-danger" (click)="remove(snapshot.snapshot)"
                            aria-label="Delete snapshot"><i class="bi bi-trash" aria-hidden="true"></i></button>
                  </div>

                  @if (expandedSnapshot === snapshotKey(snapshot)) {
                    <div class="border-top mt-3 pt-3">
                      <h4 class="h6">Restore options</h4>
                      <div class="row g-3">
                        <div class="col-md-6">
                          <label class="form-label" [for]="'rename-pattern-' + snapshotKey(snapshot)">Rename pattern</label>
                          <input class="form-control" [id]="'rename-pattern-' + snapshotKey(snapshot)"
                                 [(ngModel)]="restoreForms[snapshotKey(snapshot)].renamePattern" placeholder="index_(.+)" />
                        </div>
                        <div class="col-md-6">
                          <label class="form-label" [for]="'rename-replacement-' + snapshotKey(snapshot)">Rename replacement</label>
                          <input class="form-control" [id]="'rename-replacement-' + snapshotKey(snapshot)"
                                 [(ngModel)]="restoreForms[snapshotKey(snapshot)].renameReplacement" placeholder="restored_index_$1" />
                        </div>
                        <div class="col-md-6">
                          <div class="form-check mb-2">
                            <input class="form-check-input" type="checkbox" [id]="'restore-ignore-' + snapshotKey(snapshot)"
                                   [(ngModel)]="restoreForms[snapshotKey(snapshot)].ignoreUnavailable" />
                            <label class="form-check-label" [for]="'restore-ignore-' + snapshotKey(snapshot)">Ignore unavailable indices</label>
                          </div>
                          <div class="form-check mb-2">
                            <input class="form-check-input" type="checkbox" [id]="'restore-aliases-' + snapshotKey(snapshot)"
                                   [(ngModel)]="restoreForms[snapshotKey(snapshot)].includeAliases" />
                            <label class="form-check-label" [for]="'restore-aliases-' + snapshotKey(snapshot)">Include aliases</label>
                          </div>
                          <div class="form-check">
                            <input class="form-check-input" type="checkbox" [id]="'restore-global-' + snapshotKey(snapshot)"
                                   [(ngModel)]="restoreForms[snapshotKey(snapshot)].includeGlobalState" />
                            <label class="form-check-label" [for]="'restore-global-' + snapshotKey(snapshot)">Include global state</label>
                          </div>
                        </div>
                        <div class="col-md-6">
                          <label class="form-label" [for]="'restore-indices-' + snapshotKey(snapshot)">Indices</label>
                          <select class="form-select" multiple size="7" [id]="'restore-indices-' + snapshotKey(snapshot)"
                                  [(ngModel)]="restoreForms[snapshotKey(snapshot)].indices">
                            @for (index of snapshot.indices || []; track index) { <option [value]="index">{{ index }}</option> }
                          </select>
                          <div class="form-text">Defaults to all if none is selected.</div>
                        </div>
                      </div>
                      <div class="text-end mt-3">
                        <button type="button" class="btn btn-success btn-sm" (click)="restore(snapshot)" [disabled]="restoring">
                          <i class="bi bi-download me-1" aria-hidden="true"></i>{{ restoring ? 'Restoring…' : 'Restore' }}
                        </button>
                      </div>
                    </div>
                  }
                </article>
              }
            </div>
          }
        </div>

        <div class="col-xl-6">
          <h3 class="h5 mb-3">Create new snapshot</h3>
          <div class="row g-3">
            <div class="col-sm-6">
              <label class="form-label" for="create-snapshot-repository">Repository</label>
              <select id="create-snapshot-repository" class="form-select" [(ngModel)]="createForm.repository">
                <option value="">Select repository</option>
                @for (repository of repositories; track repository) { <option [value]="repository">{{ repository }}</option> }
              </select>
            </div>
            <div class="col-sm-6">
              <label class="form-label" for="create-snapshot-name">Snapshot name</label>
              <input id="create-snapshot-name" class="form-control" [(ngModel)]="createForm.snapshot" placeholder="Snapshot name" />
            </div>
            <div class="col-md-5">
              <div class="form-check mb-2">
                <input id="create-snapshot-ignore" class="form-check-input" type="checkbox" [(ngModel)]="createForm.ignoreUnavailable" />
                <label class="form-check-label" for="create-snapshot-ignore">Ignore unavailable indices</label>
              </div>
              <div class="form-check mb-2">
                <input id="create-snapshot-global" class="form-check-input" type="checkbox" [(ngModel)]="createForm.includeGlobalState" />
                <label class="form-check-label" for="create-snapshot-global">Include global state</label>
              </div>
              <div class="form-check">
                <input id="show-special-indices" class="form-check-input" type="checkbox" [(ngModel)]="showSpecialIndices" />
                <label class="form-check-label" for="show-special-indices">Show special indices</label>
              </div>
            </div>
            <div class="col-md-7">
              <label class="form-label" for="create-snapshot-indices">Indices</label>
              <select id="create-snapshot-indices" class="form-select" multiple size="12" [(ngModel)]="createForm.indices">
                @for (index of visibleIndices; track index.name) { <option [value]="index.name">{{ index.name }}</option> }
              </select>
              <div class="form-text">Defaults to all if none is selected.</div>
            </div>
          </div>
          <div class="text-end mt-4">
            <button type="button" class="btn btn-success" (click)="create()" [disabled]="creating">
              <i class="bi bi-file-earmark-plus me-1" aria-hidden="true"></i>{{ creating ? 'Creating…' : 'Create' }}
            </button>
          </div>
        </div>
      </div>
    </section>
  `,
})
export class SnapshotsComponent implements OnInit {
  private readonly api = inject(ClusterApiService);
  private readonly alerts = inject(AlertService);
  private readonly modal = inject(ModalService);
  private readonly cdr = inject(ChangeDetectorRef);
  readonly connection = inject(ConnectionService);

  indices: SnapshotIndex[] = [];
  repositories: string[] = [];
  selectedRepository = '';
  snapshots: SnapshotRecord[] = [];
  showSpecialIndices = false;
  expandedSnapshot = '';
  restoreForms: Record<string, RestoreSnapshotForm> = {};
  createForm: CreateSnapshotForm = {
    repository: '', snapshot: '', ignoreUnavailable: false, includeGlobalState: true, indices: [],
  };
  loading = false;
  loadingSnapshots = false;
  creating = false;
  restoring = false;

  ngOnInit(): void {
    void this.load();
  }

  get visibleIndices(): SnapshotIndex[] {
    return this.indices
      .filter((index) => this.showSpecialIndices || !index.special)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async load(): Promise<void> {
    this.loading = true;
    try {
      const data = await this.api.post<SnapshotLandingData>('snapshots');
      this.indices = data.indices;
      this.repositories = [...data.repositories].sort((a, b) => a.localeCompare(b));
      if (this.selectedRepository && !this.repositories.includes(this.selectedRepository)) {
        this.selectedRepository = '';
        this.snapshots = [];
      } else if (this.selectedRepository) {
        await this.loadSnapshots(this.selectedRepository);
      }
    } catch (error) {
      this.alerts.error('Error loading repositories', error);
    } finally {
      this.loading = false;
      this.cdr.markForCheck();
    }
  }

  selectRepository(repository: string): void {
    this.selectedRepository = repository;
    this.snapshots = [];
    this.expandedSnapshot = '';
    if (repository) void this.loadSnapshots(repository);
  }

  async loadSnapshots(repository: string): Promise<void> {
    this.loadingSnapshots = true;
    try {
      const snapshots = await this.api.post<SnapshotRecord[]>('snapshots/load', { repository });
      if (repository === this.selectedRepository) this.snapshots = snapshots;
    } catch (error) {
      this.alerts.error('Error loading snapshots', error);
    } finally {
      this.loadingSnapshots = false;
      this.cdr.markForCheck();
    }
  }

  async create(): Promise<void> {
    let payload: Record<string, unknown>;
    try {
      payload = buildCreateSnapshotPayload(this.createForm);
    } catch (error) {
      this.alerts.error(String(error));
      return;
    }
    this.creating = true;
    try {
      const response = await this.api.post<unknown>('snapshots/create', payload);
      this.alerts.info('Snapshot successfully created', response);
      if (this.selectedRepository === this.createForm.repository) await this.loadSnapshots(this.selectedRepository);
    } catch (error) {
      this.alerts.error('Error creating snapshot', error);
    } finally {
      this.creating = false;
      this.cdr.markForCheck();
    }
  }

  async remove(snapshot: string): Promise<void> {
    if (!this.selectedRepository || !(await this.modal.confirm(`Delete snapshot ${snapshot}?`))) return;
    try {
      await this.api.post<unknown>('snapshots/delete', { repository: this.selectedRepository, snapshot });
      this.alerts.info('Snapshot successfully deleted');
      await this.loadSnapshots(this.selectedRepository);
    } catch (error) {
      this.alerts.error('Error deleting snapshot', error);
    }
  }

  toggleRestore(snapshot: SnapshotRecord): void {
    const key = this.snapshotKey(snapshot);
    if (!this.restoreForms[key]) this.restoreForms[key] = defaultRestoreForm();
    this.expandedSnapshot = this.expandedSnapshot === key ? '' : key;
  }

  async restore(snapshot: SnapshotRecord): Promise<void> {
    const form = this.restoreForms[this.snapshotKey(snapshot)];
    if (!this.selectedRepository || !form) return;
    this.restoring = true;
    try {
      const payload = buildRestoreSnapshotPayload(this.selectedRepository, snapshot.snapshot, form);
      const response = await this.api.post<unknown>('snapshots/restore', payload);
      this.alerts.info('Snapshot successfully restored', response);
    } catch (error) {
      this.alerts.error('Error restoring snapshot', error);
    } finally {
      this.restoring = false;
      this.cdr.markForCheck();
    }
  }

  view(snapshot: SnapshotRecord): void {
    this.modal.showJson(`Snapshot ${snapshot.snapshot}`, snapshot);
  }

  snapshotKey(snapshot: SnapshotRecord): string {
    return String(snapshot.uuid || snapshot.snapshot);
  }
}
