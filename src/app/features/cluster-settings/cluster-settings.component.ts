import { ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AlertService } from '../../core/alert.service';
import { ClusterApiService } from '../../core/cluster-api.service';
import { ConnectionService } from '../../core/connection.service';
import { ModalService } from '../../core/modal.service';
import {
  ClusterSettingChanges,
  ClusterSettingsResponse,
  SettingGroup,
  SettingValues,
  buildClusterSettingsPayload,
  groupSettings,
  isDynamicClusterSetting,
  mergeClusterSettings,
} from './cluster-settings.models';

@Component({
  selector: 'cerebro-cluster-settings',
  standalone: true,
  imports: [FormsModule],
  template: `
    <section aria-labelledby="cluster-settings-title">
      <div class="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-4">
        <div>
          <h2 id="cluster-settings-title" class="h4 mb-1">Cluster settings</h2>
          <p class="text-body-secondary mb-0">Effective settings for {{ connection.host() || 'the connected cluster' }}.</p>
        </div>
        <button type="button" class="btn btn-outline-secondary btn-sm" (click)="load()" [disabled]="loading">
          <i class="bi bi-arrow-clockwise me-1" aria-hidden="true"></i>Refresh
        </button>
      </div>

      <div class="row g-3 align-items-center mb-4">
        <div class="col-lg-5 col-md-7">
          <label class="visually-hidden" for="cluster-setting-filter">Filter settings by name</label>
          <input id="cluster-setting-filter" class="form-control" [(ngModel)]="nameFilter"
                 placeholder="Filter settings by name" />
        </div>
        <div class="col-auto">
          <div class="form-check">
            <input id="show-static-cluster-settings" class="form-check-input" type="checkbox" [(ngModel)]="showStatic" />
            <label class="form-check-label" for="show-static-cluster-settings">
              Show static settings <i class="bi bi-lock-fill text-warning" aria-hidden="true"></i>
            </label>
          </div>
        </div>
      </div>

      @if (loading) {
        <p class="text-body-secondary" role="status">Loading cluster settings…</p>
      } @else {
        @for (group of visibleGroups; track group.name) {
          <section class="mb-4" [attr.aria-labelledby]="'cluster-setting-group-' + group.name">
            <h3 class="h6 text-uppercase border-bottom pb-2 mb-3" [id]="'cluster-setting-group-' + group.name">{{ group.name }}</h3>
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
        <aside class="position-sticky bottom-0 bg-body border-top shadow-sm py-3 mt-4" aria-label="Pending cluster setting changes">
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
                    <td>{{ entry.change.value || '(delete override)' }}</td>
                    <td>
                      <button type="button" class="btn btn-link btn-sm p-0" (click)="togglePersistence(entry.name)">
                        {{ entry.change.transient ? 'transient' : 'persistent' }}
                      </button>
                    </td>
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
    </section>
  `,
})
export class ClusterSettingsComponent implements OnInit {
  private readonly api = inject(ClusterApiService);
  private readonly alerts = inject(AlertService);
  private readonly modal = inject(ModalService);
  private readonly cdr = inject(ChangeDetectorRef);
  readonly connection = inject(ConnectionService);

  settings: SettingValues = {};
  form: SettingValues = {};
  changes: ClusterSettingChanges = {};
  groups: SettingGroup[] = [];
  nameFilter = '';
  showStatic = false;
  loading = false;
  saving = false;

  ngOnInit(): void {
    void this.load();
  }

  get visibleGroups(): SettingGroup[] {
    return this.groups
      .map((group) => ({
        ...group,
        settings: group.settings.filter((setting) =>
          setting.name.includes(this.nameFilter) && (!setting.static || this.showStatic)),
      }))
      .filter((group) => group.settings.length > 0);
  }

  get changeEntries(): Array<{ name: string; change: ClusterSettingChanges[string] }> {
    return Object.entries(this.changes).map(([name, change]) => ({ name, change }));
  }

  async load(): Promise<void> {
    this.loading = true;
    try {
      const response = await this.api.post<ClusterSettingsResponse>('cluster_settings');
      this.settings = mergeClusterSettings(response);
      this.form = { ...this.settings };
      this.changes = {};
      this.groups = groupSettings(Object.keys(this.form).map((name) => ({
        name,
        static: !isDynamicClusterSetting(name),
      })));
    } catch (error) {
      this.alerts.error('Error loading cluster settings', error);
    } finally {
      this.loading = false;
      this.cdr.markForCheck();
    }
  }

  set(name: string, value: string): void {
    this.form[name] = value;
    if (value !== this.settings[name]) {
      this.changes = {
        ...this.changes,
        [name]: { value, transient: this.changes[name]?.transient ?? true },
      };
    } else {
      this.removeChange(name);
    }
  }

  togglePersistence(name: string): void {
    const change = this.changes[name];
    if (!change) return;
    this.changes = { ...this.changes, [name]: { ...change, transient: !change.transient } };
  }

  revert(name: string): void {
    this.form[name] = this.settings[name] ?? '';
    this.removeChange(name);
  }

  preview(): void {
    this.modal.showJson('Pending cluster settings', buildClusterSettingsPayload(this.changes));
  }

  async save(): Promise<void> {
    if (!this.changeEntries.length) return;
    this.saving = true;
    try {
      const settings = buildClusterSettingsPayload(this.changes);
      const response = await this.api.post<unknown>('cluster_settings/save', { settings });
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
    return `cluster-setting-${name.replaceAll('.', '-')}`;
  }

  private removeChange(name: string): void {
    const { [name]: _removed, ...remaining } = this.changes;
    this.changes = remaining;
  }
}
