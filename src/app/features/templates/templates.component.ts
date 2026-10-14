import { ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AlertService } from '../../core/alert.service';
import { ClusterApiService } from '../../core/cluster-api.service';
import { ConnectionService } from '../../core/connection.service';
import { ModalService } from '../../core/modal.service';
import {
  LEGACY_TEMPLATE_BASE,
  LegacyTemplate,
  filterLegacyTemplates,
  parseTemplateBody,
  templatePattern,
} from './templates.models';

@Component({
  selector: 'cerebro-templates',
  standalone: true,
  imports: [FormsModule],
  template: `
    <section aria-labelledby="templates-title">
      <div class="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-4">
        <div>
          <h2 id="templates-title" class="h4 mb-1">Legacy index templates</h2>
          <p class="text-body-secondary mb-0">Templates on {{ connection.host() || 'the connected cluster' }}.</p>
        </div>
        <button type="button" class="btn btn-outline-secondary btn-sm" (click)="load()" [disabled]="loading">
          <i class="bi bi-arrow-clockwise me-1" aria-hidden="true"></i>Refresh
        </button>
      </div>

      <div class="row g-4">
        <div class="col-xl-6">
          <div class="d-flex align-items-center justify-content-between mb-3">
            <h3 class="h5 mb-0">Existing templates</h3>
            <span class="text-body-secondary small">{{ filtered.length }} templates</span>
          </div>
          <div class="row g-2 mb-3">
            <div class="col-sm-6">
              <label class="visually-hidden" for="template-name-filter">Template name</label>
              <input id="template-name-filter" class="form-control" placeholder="Template name"
                     [(ngModel)]="nameFilter" (ngModelChange)="page = 1" />
            </div>
            <div class="col-sm-6">
              <label class="visually-hidden" for="template-pattern-filter">Template pattern</label>
              <input id="template-pattern-filter" class="form-control" placeholder="Template pattern"
                     [(ngModel)]="patternFilter" (ngModelChange)="page = 1" />
            </div>
          </div>

          @if (loading) {
            <p class="text-body-secondary" role="status">Loading templates…</p>
          } @else if (!filtered.length) {
            <p class="text-body-secondary py-4">No templates match the current filters.</p>
          } @else {
            <div class="table-responsive">
              <table class="table table-hover align-middle">
                <thead><tr><th>Name</th><th>Pattern</th><th class="text-end">Actions</th></tr></thead>
                <tbody>
                  @for (item of pageTemplates; track item.name) {
                    <tr>
                      <td><i class="bi bi-book me-1" aria-hidden="true"></i>{{ item.name }}</td>
                      <td class="text-break">{{ pattern(item) || '—' }}</td>
                      <td class="text-end text-nowrap">
                        <button type="button" class="btn btn-link btn-sm text-body-secondary" (click)="view(item)"
                                [attr.aria-label]="'View template ' + item.name"><i class="bi bi-braces" aria-hidden="true"></i></button>
                        <button type="button" class="btn btn-link btn-sm" (click)="edit(item)"
                                [attr.aria-label]="'Edit template ' + item.name"><i class="bi bi-pencil" aria-hidden="true"></i></button>
                        <button type="button" class="btn btn-link btn-sm text-danger" (click)="remove(item.name)"
                                [attr.aria-label]="'Delete template ' + item.name"><i class="bi bi-trash" aria-hidden="true"></i></button>
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
            @if (pageCount > 1) {
              <nav class="d-flex align-items-center justify-content-end gap-2" aria-label="Template pages">
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
          <div class="d-flex align-items-center justify-content-between mb-3">
            <h3 class="h5 mb-0">{{ editMode ? 'Update template ' + name : 'Create new template' }}</h3>
            @if (editMode) {
              <button type="button" class="btn btn-link btn-sm text-decoration-none" (click)="resetEditor()">New template</button>
            }
          </div>
          <div class="mb-3">
            <label class="form-label" for="template-name">Name</label>
            <input id="template-name" class="form-control" [(ngModel)]="name" placeholder="Template name" />
          </div>
          <div class="mb-3">
            <label class="form-label" for="template-body">Template JSON</label>
            <textarea id="template-body" class="form-control font-monospace" rows="24" spellcheck="false"
                      [(ngModel)]="bodyText"></textarea>
          </div>
          <div class="text-end">
            <button type="button" class="btn" [class.btn-warning]="editMode" [class.btn-success]="!editMode"
                    (click)="save()" [disabled]="saving">
              <i class="bi me-1" [class.bi-floppy]="editMode" [class.bi-file-earmark-plus]="!editMode" aria-hidden="true"></i>
              {{ saving ? 'Saving…' : (editMode ? 'Update' : 'Create') }}
            </button>
          </div>
        </div>
      </div>
    </section>
  `,
})
export class TemplatesComponent implements OnInit {
  private readonly api = inject(ClusterApiService);
  private readonly alerts = inject(AlertService);
  private readonly modal = inject(ModalService);
  private readonly cdr = inject(ChangeDetectorRef);
  readonly connection = inject(ConnectionService);

  templates: LegacyTemplate[] = [];
  nameFilter = '';
  patternFilter = '';
  name = '';
  bodyText = LEGACY_TEMPLATE_BASE;
  page = 1;
  readonly pageSize = 10;
  loading = false;
  saving = false;

  ngOnInit(): void {
    void this.load();
  }

  get editMode(): boolean {
    return this.templates.some((item) => item.name === this.name);
  }

  get filtered(): LegacyTemplate[] {
    return filterLegacyTemplates(this.templates, this.nameFilter, this.patternFilter);
  }

  get pageCount(): number {
    return Math.max(1, Math.ceil(this.filtered.length / this.pageSize));
  }

  get pageTemplates(): LegacyTemplate[] {
    const safePage = Math.min(this.page, this.pageCount);
    return this.filtered.slice((safePage - 1) * this.pageSize, safePage * this.pageSize);
  }

  async load(): Promise<void> {
    this.loading = true;
    try {
      this.templates = await this.api.post<LegacyTemplate[]>('templates');
      this.page = Math.min(this.page, this.pageCount);
    } catch (error) {
      this.alerts.error('Error while loading templates', error);
    } finally {
      this.loading = false;
      this.cdr.markForCheck();
    }
  }

  edit(item: LegacyTemplate): void {
    this.name = item.name;
    this.bodyText = JSON.stringify(item.template, null, 2);
  }

  view(item: LegacyTemplate): void {
    this.modal.showJson(`Template ${item.name}`, item.template);
  }

  resetEditor(): void {
    this.name = '';
    this.bodyText = LEGACY_TEMPLATE_BASE;
  }

  async save(): Promise<void> {
    const name = this.name.trim();
    if (!name) {
      this.alerts.error('You must specify a template name');
      return;
    }

    let template: Record<string, unknown>;
    try {
      template = parseTemplateBody(this.bodyText);
    } catch (error) {
      this.alerts.error('Malformed template', error);
      return;
    }

    const updating = this.editMode;
    this.saving = true;
    try {
      const response = await this.api.post<unknown>('templates/create', { name, template });
      this.alerts.info(updating ? 'Template successfully updated' : 'Template successfully created', response);
      await this.load();
    } catch (error) {
      this.alerts.error(updating ? 'Error updating template' : 'Error creating template', error);
    } finally {
      this.saving = false;
      this.cdr.markForCheck();
    }
  }

  async remove(name: string): Promise<void> {
    if (!(await this.modal.confirm(`Delete template ${name}?`))) return;
    try {
      const response = await this.api.post<unknown>('templates/delete', { name });
      this.alerts.info('Template successfully deleted', response);
      if (this.name === name) this.resetEditor();
      await this.load();
    } catch (error) {
      this.alerts.error('Error deleting template', error);
    }
  }

  pattern(item: LegacyTemplate): string {
    return templatePattern(item);
  }
}
