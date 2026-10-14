import { ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AlertService } from '../../core/alert.service';
import { ClusterApiService } from '../../core/cluster-api.service';
import { ConnectionService } from '../../core/connection.service';
import { ModalService } from '../../core/modal.service';
import {
  REPOSITORY_FIELDS,
  RepositoryField,
  RepositoryRecord,
  RepositorySettings,
  RepositoryType,
  buildRepositoryPayload,
} from './repositories.models';

@Component({
  selector: 'cerebro-repositories',
  standalone: true,
  imports: [FormsModule],
  template: `
    <section aria-labelledby="repositories-title">
      <div class="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-4">
        <div>
          <h2 id="repositories-title" class="h4 mb-1">Snapshot repositories</h2>
          <p class="text-body-secondary mb-0">Repositories on {{ connection.host() || 'the connected cluster' }}.</p>
        </div>
        <button type="button" class="btn btn-outline-secondary btn-sm" (click)="load()" [disabled]="loading">
          <i class="bi bi-arrow-clockwise me-1" aria-hidden="true"></i>Refresh
        </button>
      </div>

      <div class="row g-4">
        <div class="col-xl-5">
          <div class="d-flex align-items-center justify-content-between mb-3">
            <h3 class="h5 mb-0">Existing repositories</h3>
            <span class="text-body-secondary small">{{ repositories.length }} repositories</span>
          </div>
          @if (loading) {
            <p class="text-body-secondary" role="status">Loading repositories…</p>
          } @else if (!repositories.length) {
            <p class="text-body-secondary py-4">No repositories configured.</p>
          } @else {
            <div class="table-responsive">
              <table class="table table-hover align-middle">
                <thead><tr><th>Name</th><th>Type</th><th class="text-end">Actions</th></tr></thead>
                <tbody>
                  @for (repository of repositories; track repository.name) {
                    <tr>
                      <td><i class="bi bi-database me-1" aria-hidden="true"></i>{{ repository.name }}</td>
                      <td><code>{{ repository.type }}</code></td>
                      <td class="text-end text-nowrap">
                        <button type="button" class="btn btn-link btn-sm text-body-secondary" (click)="view(repository)"
                                [attr.aria-label]="'View repository ' + repository.name"><i class="bi bi-braces" aria-hidden="true"></i></button>
                        <button type="button" class="btn btn-link btn-sm" (click)="edit(repository)"
                                [attr.aria-label]="'Edit repository ' + repository.name"><i class="bi bi-pencil" aria-hidden="true"></i></button>
                        <button type="button" class="btn btn-link btn-sm text-danger" (click)="remove(repository.name)"
                                [attr.aria-label]="'Delete repository ' + repository.name"><i class="bi bi-trash" aria-hidden="true"></i></button>
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }
        </div>

        <div class="col-xl-7">
          <div class="d-flex align-items-center justify-content-between mb-3">
            <h3 class="h5 mb-0">{{ updateMode ? 'Update repository' : 'Create new repository' }}</h3>
            @if (updateMode) {
              <button type="button" class="btn btn-link btn-sm text-decoration-none" (click)="resetForm()">New repository</button>
            }
          </div>
          <div class="row g-3">
            <div class="col-md-6">
              <label class="form-label" for="repository-name">Repository name</label>
              <input id="repository-name" class="form-control" [(ngModel)]="name" placeholder="Repository name" />
            </div>
            <div class="col-md-6">
              <label class="form-label" for="repository-type">Type</label>
              <select id="repository-type" class="form-select" [ngModel]="type" (ngModelChange)="changeType($event)">
                <option value="">Select type</option>
                @for (repositoryType of repositoryTypes; track repositoryType) {
                  <option [value]="repositoryType">{{ repositoryType }}</option>
                }
              </select>
            </div>

            @for (field of fields; track field.key) {
              <div [class.col-12]="field.wide" [class.col-md-6]="!field.wide">
                <label class="form-label" [for]="fieldId(field)">{{ field.label }}</label>
                @if (field.boolean) {
                  <select class="form-select" [id]="fieldId(field)" [ngModel]="settings[field.key] ?? ''"
                          (ngModelChange)="setField(field.key, $event)">
                    <option value="">Use Elasticsearch default</option>
                    <option [ngValue]="true">True</option>
                    <option [ngValue]="false">False</option>
                  </select>
                } @else {
                  <input class="form-control" [id]="fieldId(field)" [type]="field.secret ? 'password' : 'text'"
                         [placeholder]="field.placeholder" [ngModel]="settings[field.key] ?? ''"
                         (ngModelChange)="setField(field.key, $event)" />
                }
              </div>
            }
          </div>

          <div class="text-end mt-4">
            <button type="button" class="btn btn-success" (click)="save()" [disabled]="saving || !type">
              <i class="bi me-1" [class.bi-floppy]="updateMode" [class.bi-file-earmark-plus]="!updateMode" aria-hidden="true"></i>
              {{ saving ? 'Saving…' : (updateMode ? 'Update' : 'Create') }}
            </button>
          </div>
        </div>
      </div>
    </section>
  `,
})
export class RepositoriesComponent implements OnInit {
  private readonly api = inject(ClusterApiService);
  private readonly alerts = inject(AlertService);
  private readonly modal = inject(ModalService);
  private readonly cdr = inject(ChangeDetectorRef);
  readonly connection = inject(ConnectionService);

  readonly repositoryTypes: RepositoryType[] = ['fs', 'url', 's3', 'gcs', 'hdfs', 'azure'];
  repositories: RepositoryRecord[] = [];
  name = '';
  type: RepositoryType | '' = '';
  settings: RepositorySettings = {};
  loading = false;
  saving = false;

  ngOnInit(): void {
    void this.load();
  }

  get updateMode(): boolean {
    return this.repositories.some((repository) => repository.name === this.name);
  }

  get fields(): RepositoryField[] {
    return this.type ? REPOSITORY_FIELDS[this.type] : [];
  }

  async load(): Promise<void> {
    this.loading = true;
    try {
      const repositories = await this.api.post<RepositoryRecord[]>('repositories');
      this.repositories = [...repositories].sort((a, b) => a.name.localeCompare(b.name));
    } catch (error) {
      this.alerts.error('Error loading repositories', error);
    } finally {
      this.loading = false;
      this.cdr.markForCheck();
    }
  }

  edit(repository: RepositoryRecord): void {
    this.name = repository.name;
    this.type = repository.type;
    this.settings = { ...repository.settings };
  }

  view(repository: RepositoryRecord): void {
    this.modal.showJson(`Repository ${repository.name}`, repository);
  }

  changeType(type: RepositoryType | ''): void {
    if (type !== this.type) this.settings = {};
    this.type = type;
  }

  setField(key: string, value: string | boolean): void {
    this.settings = { ...this.settings, [key]: value };
  }

  resetForm(): void {
    this.name = '';
    this.type = '';
    this.settings = {};
  }

  async save(): Promise<void> {
    let payload: ReturnType<typeof buildRepositoryPayload>;
    try {
      payload = buildRepositoryPayload(this.name, this.type, this.settings);
    } catch (error) {
      this.alerts.error(String(error));
      return;
    }

    const updating = this.updateMode;
    if (updating && !(await this.modal.confirm(`Save settings for repository ${payload.name}?`))) return;
    this.saving = true;
    try {
      const response = await this.api.post<unknown>('repositories/create', payload);
      this.alerts.info(updating ? 'Successfully updated' : 'Repository successfully created', response);
      await this.load();
    } catch (error) {
      this.alerts.error(updating ? 'Error updating repository' : 'Error creating repository', error);
    } finally {
      this.saving = false;
      this.cdr.markForCheck();
    }
  }

  async remove(name: string): Promise<void> {
    if (!(await this.modal.confirm(`Delete repository ${name}?`))) return;
    try {
      const response = await this.api.post<unknown>('repositories/delete', { name });
      this.alerts.success('Operation successfully executed', response);
      if (this.name === name) this.resetForm();
      await this.load();
    } catch (error) {
      this.alerts.error('Operation failed', error);
    }
  }

  fieldId(field: RepositoryField): string {
    return `repository-${field.key.replaceAll('_', '-')}`;
  }
}
