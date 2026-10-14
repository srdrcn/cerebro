import { ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AlertService } from '../../core/alert.service';
import { ClusterApiService } from '../../core/cluster-api.service';
import { ConnectionService } from '../../core/connection.service';
import { ModalService } from '../../core/modal.service';
import { IndexMetadata, buildIndexMetadata, cloneableMetadata } from './create-index.models';

@Component({
  selector: 'cerebro-create-index',
  standalone: true,
  imports: [FormsModule, RouterLink],
  template: `
    <section aria-labelledby="create-index-title">
      <div class="mb-4">
        <h2 id="create-index-title" class="h4 mb-1">Create index</h2>
        <p class="text-body-secondary mb-0">Create an index on {{ connection.host() || 'the connected cluster' }}.</p>
      </div>

      <div class="row g-4">
        <div class="col-lg-5">
          <div class="row g-3">
            <div class="col-12">
              <label class="form-label" for="index-name">Name</label>
              <input id="index-name" class="form-control" [(ngModel)]="name" placeholder="Index name" autocomplete="off" />
            </div>
            <div class="col-sm-6">
              <label class="form-label" for="index-shards">Number of shards</label>
              <input id="index-shards" class="form-control" type="number" min="1" step="1"
                     [(ngModel)]="shards" placeholder="# of shards" />
            </div>
            <div class="col-sm-6">
              <label class="form-label" for="index-replicas">Number of replicas</label>
              <input id="index-replicas" class="form-control" type="number" min="0" step="1"
                     [(ngModel)]="replicas" placeholder="# of replicas" />
            </div>
            <div class="col-12">
              <label class="form-label" for="source-index">Load settings and mappings from existing index</label>
              <select id="source-index" class="form-select" [(ngModel)]="sourceIndex"
                      (ngModelChange)="loadIndexMetadata($event)" [disabled]="loadingIndices">
                <option value="">Select index</option>
                @for (index of indices; track index) { <option [value]="index">{{ index }}</option> }
              </select>
            </div>
          </div>

          <div class="alert alert-light border mt-4 small mb-0">
            Custom JSON takes precedence over the shard and replica fields. Leave it empty to use the values above.
          </div>
        </div>

        <div class="col-lg-7">
          <div class="d-flex align-items-center justify-content-between gap-2 mb-2">
            <label class="form-label mb-0" for="index-settings-json">Settings and mappings JSON</label>
            <button type="button" class="btn btn-link btn-sm text-decoration-none" (click)="preview()">Preview JSON</button>
          </div>
          <textarea id="index-settings-json" class="form-control font-monospace" rows="24" spellcheck="false"
                    [(ngModel)]="settingsText" placeholder='{ "settings": {}, "mappings": {} }'></textarea>
        </div>
      </div>

      <div class="d-flex justify-content-end gap-2 mt-4">
        <a class="btn btn-outline-secondary" routerLink="/cluster">Back</a>
        <button type="button" class="btn btn-primary" (click)="create()" [disabled]="creating">
          <i class="bi bi-check-lg me-1" aria-hidden="true"></i>{{ creating ? 'Creating…' : 'Create' }}
        </button>
      </div>
    </section>
  `,
})
export class CreateIndexComponent implements OnInit {
  private readonly api = inject(ClusterApiService);
  private readonly alerts = inject(AlertService);
  private readonly modal = inject(ModalService);
  private readonly cdr = inject(ChangeDetectorRef);
  readonly connection = inject(ConnectionService);

  name = '';
  shards = '';
  replicas = '';
  sourceIndex = '';
  settingsText = '';
  indices: string[] = [];
  loadingIndices = false;
  creating = false;

  ngOnInit(): void {
    void this.loadIndices();
  }

  async loadIndices(): Promise<void> {
    this.loadingIndices = true;
    try {
      const indices = await this.api.post<string[]>('commons/indices');
      this.indices = [...indices].sort((a, b) => a.localeCompare(b));
    } catch (error) {
      this.alerts.error('Error loading indices', error);
    } finally {
      this.loadingIndices = false;
      this.cdr.markForCheck();
    }
  }

  async loadIndexMetadata(index: string): Promise<void> {
    if (!index) return;
    try {
      const metadata = await this.api.post<IndexMetadata>('create_index/get_index_metadata', { index });
      this.settingsText = JSON.stringify(cloneableMetadata(metadata), null, 2);
    } catch (error) {
      this.alerts.error('Error while loading index settings', error);
    } finally {
      this.cdr.markForCheck();
    }
  }

  preview(): void {
    try {
      this.modal.showJson('Index metadata', buildIndexMetadata(this.settingsText, this.shards, this.replicas));
    } catch (error) {
      this.alerts.error('Malformed settings', error);
    }
  }

  async create(): Promise<void> {
    const index = this.name.trim();
    if (!index) {
      this.alerts.error('You must specify a valid index name');
      return;
    }

    let metadata: Record<string, unknown>;
    try {
      metadata = buildIndexMetadata(this.settingsText, this.shards, this.replicas);
    } catch (error) {
      this.alerts.error('Malformed settings', error);
      return;
    }

    this.creating = true;
    try {
      const response = await this.api.post<unknown>('create_index/create', { index, metadata });
      this.alerts.success('Index successfully created', response);
    } catch (error) {
      this.alerts.error('Error while creating index', error);
    } finally {
      this.creating = false;
      this.cdr.markForCheck();
    }
  }
}
