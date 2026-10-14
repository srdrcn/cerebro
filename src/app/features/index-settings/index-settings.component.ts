import { ChangeDetectorRef, Component, DestroyRef, OnInit, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { AlertService } from '../../core/alert.service';
import { ClusterApiService } from '../../core/cluster-api.service';
import { ConnectionService } from '../../core/connection.service';
import { ModalService } from '../../core/modal.service';
import {
  IndexSettingGroup,
  IndexSettingValues,
  IndexSettingsResponse,
  groupIndexSettings,
  isDynamicIndexSetting,
  mergeIndexSettings,
} from './index-settings.models';

@Component({
  selector: 'cerebro-index-settings',
  standalone: true,
  imports: [FormsModule],
  template: `
    <section aria-labelledby="index-settings-title">
      <div class="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-4">
        <div>
          <h2 id="index-settings-title" class="h4 mb-1">Index settings</h2>
          <p class="text-body-secondary mb-0">
            {{ index || 'No index selected' }} · {{ connection.host() || 'connected cluster' }}
          </p>
        </div>
        <button type="button" class="btn btn-outline-secondary btn-sm" (click)="load()"
                [disabled]="loading || !index">
          <i class="bi bi-arrow-clockwise me-1" aria-hidden="true"></i>Refresh
        </button>
      </div>

      @if (!index) {
        <div class="alert alert-warning">Open index settings from an index action so the <code>index</code> query parameter is available.</div>
      } @else {
        <div class="row g-3 align-items-center mb-4">
          <div class="col-lg-5 col-md-7">
            <label class="visually-hidden" for="index-setting-filter">Filter settings by name</label>
            <input id="index-setting-filter" class="form-control" [(ngModel)]="nameFilter"
                   placeholder="Filter settings by name" />
          </div>
          <div class="col-auto">
            <div class="form-check">
              <input id="show-static-index-settings" class="form-check-input" type="checkbox" [(ngModel)]="showStatic" />
              <label class="form-check-label" for="show-static-index-settings">
                Show static settings <i class="bi bi-lock-fill text-warning" aria-hidden="true"></i>
              </label>
            </div>
          </div>
        </div>

        @if (loading) {
          <p class="text-body-secondary" role="status">Loading index settings…</p>
        } @else {
          @for (group of visibleGroups; track group.name) {
            <section class="mb-4" [attr.aria-labelledby]="'index-setting-group-' + group.name">
              <h3 class="h6 text-uppercase border-bottom pb-2 mb-3" [id]="'index-setting-group-' + group.name">{{ group.name }}</h3>
              <div class="row g-3">
                @for (setting of group.settings; track setting.name) {
                  <div class="col-xl-4 col-md-6">
                    <label class="form-label small text-break" [for]="settingId(setting.name)">
                      {{ setting.name }}
                      @if (setting.static) { <i class="bi bi-lock-fill text-warning ms-1" title="Static setting" aria-hidden="true"></i> }
                    </label>
                    <input class="form-control" [id]="settingId(setting.name)" [disabled]="setting.static"
                           [ngModel]="form[setting.name]" (ngModelChange)="set(setting.name, $event)" />
                  </div>
                }
              </div>
            </section>
          } @empty {
            <p class="text-body-secondary py-4">No settings match the current filter.</p>
          }
        }

        @if (changeEntries.length) {
          <aside class="position-sticky bottom-0 bg-body border-top shadow-sm py-3 mt-4" aria-label="Pending index setting changes">
            <div class="d-flex flex-wrap align-items-center justify-content-between gap-3 mb-2">
              <strong>{{ changeEntries.length }} pending changes</strong>
              <div class="d-flex gap-2">
                <button type="button" class="btn btn-outline-secondary btn-sm" (click)="preview()">Preview</button>
                <button type="button" class="btn btn-success btn-sm" (click)="save()" [disabled]="saving">
                  {{ saving ? 'Saving…' : 'Save' }}
                </button>
              </div>
            </div>
            <div class="table-responsive" style="max-height: 14rem">
              <table class="table table-sm align-middle mb-0">
                <tbody>
                  @for (entry of changeEntries; track entry.name) {
                    <tr>
                      <td class="text-break"><i class="bi bi-gear me-1" aria-hidden="true"></i>{{ entry.name }}</td>
                      <td>{{ entry.value }}</td>
                      <td class="text-end">
                        <button type="button" class="btn btn-link btn-sm text-body-secondary" (click)="revert(entry.name)"
                                aria-label="Revert setting"><i class="bi bi-arrow-counterclockwise" aria-hidden="true"></i></button>
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </aside>
        }
      }
    </section>
  `,
})
export class IndexSettingsComponent implements OnInit {
  private readonly api = inject(ClusterApiService);
  private readonly alerts = inject(AlertService);
  private readonly modal = inject(ModalService);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private readonly cdr = inject(ChangeDetectorRef);
  readonly connection = inject(ConnectionService);

  index = '';
  settings: IndexSettingValues = {};
  form: IndexSettingValues = {};
  changes: IndexSettingValues = {};
  groups: IndexSettingGroup[] = [];
  nameFilter = '';
  showStatic = false;
  loading = false;
  saving = false;

  ngOnInit(): void {
    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const index = params.get('index') ?? '';
      if (index === this.index) return;
      this.index = index;
      this.settings = {};
      this.form = {};
      this.changes = {};
      this.groups = [];
      if (index) void this.load();
      this.cdr.markForCheck();
    });
  }

  get visibleGroups(): IndexSettingGroup[] {
    return this.groups
      .map((group) => ({
        ...group,
        settings: group.settings.filter((setting) =>
          setting.name.includes(this.nameFilter) && (!setting.static || this.showStatic)),
      }))
      .filter((group) => group.settings.length > 0);
  }

  get changeEntries(): Array<{ name: string; value: string }> {
    return Object.entries(this.changes).map(([name, value]) => ({ name, value }));
  }

  async load(): Promise<void> {
    const index = this.index;
    if (!index) return;
    this.loading = true;
    try {
      const response = await this.api.post<IndexSettingsResponse>('index_settings', { index });
      if (index !== this.index) return;
      this.settings = mergeIndexSettings(response, index);
      this.form = { ...this.settings };
      this.changes = {};
      this.groups = groupIndexSettings(Object.keys(this.form).map((name) => ({
        name,
        static: !isDynamicIndexSetting(name),
      })));
    } catch (error) {
      this.alerts.error('Error loading index settings', error);
    } finally {
      this.loading = false;
      this.cdr.markForCheck();
    }
  }

  set(name: string, value: string): void {
    this.form[name] = value;
    if (value !== this.settings[name]) {
      this.changes = { ...this.changes, [name]: value };
    } else {
      this.removeChange(name);
    }
  }

  revert(name: string): void {
    this.form[name] = this.settings[name] ?? '';
    this.removeChange(name);
  }

  preview(): void {
    this.modal.showJson(`Pending settings for ${this.index}`, this.changes);
  }

  async save(): Promise<void> {
    if (!this.index || !this.changeEntries.length) return;
    this.saving = true;
    try {
      const response = await this.api.post<unknown>('index_settings/update', {
        index: this.index,
        settings: this.changes,
      });
      this.alerts.info('Settings successfully saved', response);
      await this.load();
    } catch (error) {
      this.alerts.error('Error while saving settings', error);
    } finally {
      this.saving = false;
      this.cdr.markForCheck();
    }
  }

  settingId(name: string): string {
    return `index-setting-${name.replaceAll('.', '-')}`;
  }

  private removeChange(name: string): void {
    const { [name]: _removed, ...remaining } = this.changes;
    this.changes = remaining;
  }
}
