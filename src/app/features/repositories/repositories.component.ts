import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AlertService } from '../../core/alert.service';
import { ClusterApiService } from '../../core/cluster-api.service';
import { ConnectionService } from '../../core/connection.service';
import { DialogService } from '../../core/dialog.service';
import { elasticsearchReason, failureMessage, readableReason } from '../../core/errors';
import { matchesText } from '../../core/format';
import { RefreshService } from '../../core/refresh.service';
import { EmptyStateComponent } from '../../shared/empty-state.component';
import { NumberPipe, PluralPipe } from '../../shared/format.pipes';
import { MenuComponent } from '../../shared/menu.component';
import { SearchInputComponent } from '../../shared/search-input.component';
import {
  REPOSITORY_TYPES,
  RepositoryExtraSetting,
  RepositoryField,
  RepositoryPayload,
  RepositoryRecord,
  RepositorySettingValue,
  RepositorySettings,
  buildRepositoryPayload,
  describeRepositoryChanges,
  normalizeRepositorySettings,
  repositoryFields,
  repositorySummary,
  repositoryTypeInfo,
  showsSettingKey,
  validateExtraSettings,
  validateRepositoryName,
} from './repositories.models';

interface ExtraRow extends RepositoryExtraSetting {
  readonly id: number;
}

interface TypeOption {
  readonly type: string;
  readonly label: string;
  readonly description: string;
  readonly icon: string;
}

interface RepositoryView {
  readonly record: RepositoryRecord;
  readonly icon: string;
  readonly summary: string;
  /** Query params of the "Browse snapshots" link. */
  readonly snapshotsQuery: Record<string, string | null>;
}

/** Lists with more entries than this get a filter field. */
const FILTER_THRESHOLD = 6;

@Component({
  selector: 'cerebro-repositories',
  imports: [EmptyStateComponent, FormsModule, MenuComponent, NumberPipe, PluralPipe, RouterLink, SearchInputComponent],
  templateUrl: './repositories.component.html',
  styleUrl: './repositories.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RepositoriesComponent {
  private readonly api = inject(ClusterApiService);
  private readonly alerts = inject(AlertService);
  private readonly dialogs = inject(DialogService);
  private readonly refreshService = inject(RefreshService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly connection = inject(ConnectionService);

  readonly filterThreshold = FILTER_THRESHOLD;
  readonly showsSettingKey = showsSettingKey;

  readonly repositories = signal<readonly RepositoryRecord[] | undefined>(undefined);
  readonly failed = signal(false);
  /** Why the repositories could not be loaded, as Elasticsearch put it. */
  readonly loadError = signal<string | undefined>(undefined);
  readonly query = signal('');
  readonly deleting = signal<ReadonlySet<string>>(new Set());

  /** Name of the repository loaded into the form, if any. */
  readonly editing = signal<string | null>(null);
  readonly name = signal('');
  readonly type = signal('');
  readonly settings = signal<RepositorySettings>({});
  readonly extras = signal<readonly ExtraRow[]>([]);
  readonly revealed = signal<ReadonlySet<string>>(new Set());
  readonly submitted = signal(false);
  readonly saving = signal(false);
  /** Why Elasticsearch rejected the last save, shown next to the form. */
  readonly saveError = signal<string | null>(null);

  readonly views = computed<RepositoryView[]>(() =>
    (this.repositories() ?? [])
      .filter((repository) => matchesText(repository.name, this.query()))
      .map((record) => ({
        record,
        icon: repositoryTypeInfo(record.type)?.icon ?? 'bi-database',
        summary: repositorySummary(record),
        snapshotsQuery: { ...this.connection.hostQuery(), repository: record.name },
      })),
  );

  readonly typeOptions = computed<TypeOption[]>(() => {
    const options: TypeOption[] = REPOSITORY_TYPES.map((info) => ({ ...info }));
    const current = this.type();
    if (current && !repositoryTypeInfo(current)) {
      options.push({ type: current, label: current, description: 'Plugin repository type', icon: 'bi-puzzle' });
    }
    return options;
  });

  readonly typeInfo = computed(() => repositoryTypeInfo(this.type()));
  readonly fields = computed(() => repositoryFields(this.type()));

  /** The existing repository the form would overwrite. */
  readonly original = computed(() =>
    (this.repositories() ?? []).find((repository) => repository.name === this.name().trim()),
  );
  readonly updateMode = computed(() => this.original() !== undefined);
  /** The form is already an empty "Register repository" form. */
  readonly blankForm = computed(
    () => this.editing() === null && !this.name() && !this.type() && this.extras().length === 0,
  );

  readonly nameError = computed(() => validateRepositoryName(this.name()));
  /** Name errors show once submitted, or live once something was typed. */
  readonly showNameError = computed(() => (this.submitted() || this.name() !== '') && !!this.nameError());
  readonly typeError = computed(() => (this.type() ? null : 'Choose where the snapshots are stored'));
  readonly extrasError = computed(() => validateExtraSettings(this.type(), this.extras()));
  /** The first additional setting that makes the list invalid. */
  readonly invalidExtraId = computed(() => {
    if (!this.extrasError()) {
      return null;
    }
    const extras = this.extras();
    const type = this.type();
    return extras.find((_, index) => validateExtraSettings(type, extras.slice(0, index + 1)) !== null)?.id ?? null;
  });
  readonly valid = computed(() => !this.nameError() && !this.typeError() && !this.extrasError());

  readonly payload = computed<RepositoryPayload | null>(() => {
    if (!this.valid()) {
      return null;
    }
    return buildRepositoryPayload(this.name(), this.type(), this.settings(), this.extras());
  });

  private readonly secretKeys = computed(
    () => new Set(this.fields().filter((field) => field.secret).map((field) => field.key)),
  );

  readonly changes = computed(() => {
    const original = this.original();
    const payload = this.payload();
    return original && payload ? describeRepositoryChanges(original, payload, this.secretKeys()) : [];
  });

  readonly preview = computed(() => {
    const payload = this.payload();
    if (!payload) {
      return '';
    }
    const body = { type: payload.type, settings: this.maskSecrets(payload.settings) };
    return `PUT _snapshot/${payload.name}\n${JSON.stringify(body, null, 2)}`;
  });

  private loadSequence = 0;
  private nextExtraId = 0;
  /** `?repository=` from the Snapshots page, opened once it is loaded. */
  private requested = this.route.snapshot.queryParamMap.get('repository') ?? '';

  constructor() {
    effect(() => {
      this.refreshService.tick();
      if (this.connection.connected()) {
        untracked(() => void this.load());
      }
    });
  }

  async load(): Promise<void> {
    const sequence = ++this.loadSequence;
    try {
      const repositories = await this.api.post<RepositoryRecord[]>('repositories');
      if (sequence !== this.loadSequence) {
        return;
      }
      const sorted = [...(Array.isArray(repositories) ? repositories : [])].sort((left, right) =>
        left.name.localeCompare(right.name),
      );
      this.repositories.set(sorted);
      this.failed.set(false);
      const name = this.requested;
      this.requested = '';
      const requested = sorted.find((repository) => repository.name === name);
      if (requested) {
        this.edit(requested);
      } else if (name) {
        this.alerts.warn(`Repository ${name} does not exist`);
        void this.router.navigate([], {
          relativeTo: this.route,
          queryParams: { repository: null },
          queryParamsHandling: 'merge',
          replaceUrl: true,
        });
      }
    } catch (error: unknown) {
      if (sequence === this.loadSequence) {
        this.loadError.set(readableReason(error));
        this.failed.set(true);
        this.alerts.error(failureMessage('Could not load snapshot repositories', error), error);
      }
    }
  }

  // ---- Form ----

  edit(repository: RepositoryRecord): void {
    const normalized = normalizeRepositorySettings(repository.type, repository.settings);
    this.editing.set(repository.name);
    this.name.set(repository.name);
    this.type.set(repository.type);
    this.settings.set(normalized.settings);
    this.extras.set(normalized.extras.map((extra) => ({ ...extra, id: this.nextExtraId++ })));
    this.revealed.set(new Set());
    this.submitted.set(false);
    this.saveError.set(null);
  }

  newRepository(focus = true): void {
    this.editing.set(null);
    this.name.set('');
    this.type.set('');
    this.settings.set({});
    this.extras.set([]);
    this.revealed.set(new Set());
    this.submitted.set(false);
    this.saveError.set(null);
    if (focus) {
      setTimeout(() => document.getElementById('repository-name')?.focus());
    }
  }

  /** Restores the form to the saved repository, or clears it. */
  reset(): void {
    const original = (this.repositories() ?? []).find((repository) => repository.name === this.editing());
    if (original) {
      this.edit(original);
    } else {
      this.newRepository();
    }
  }

  setName(name: string): void {
    this.name.set(name);
  }

  setType(type: string): void {
    if (type === this.type()) {
      return;
    }
    // Keep the values that the new type understands as well (e.g. chunk_size).
    const keys = new Set(repositoryFields(type).map((field) => field.key));
    this.settings.update((settings) =>
      Object.fromEntries(Object.entries(settings).filter(([key]) => keys.has(key))) as RepositorySettings,
    );
    this.type.set(type);
  }

  textValue(key: string): string {
    const value = this.settings()[key];
    return typeof value === 'string' ? value : value === undefined ? '' : String(value);
  }

  booleanValue(key: string): '' | 'true' | 'false' {
    const value = this.settings()[key];
    if (value === true || value === 'true') {
      return 'true';
    }
    return value === false || value === 'false' ? 'false' : '';
  }

  setText(key: string, value: string): void {
    this.setField(key, value);
  }

  setBoolean(key: string, value: string): void {
    this.setField(key, value === 'true' ? true : value === 'false' ? false : '');
  }

  toggleReveal(key: string): void {
    this.revealed.update((keys) => {
      const next = new Set(keys);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  fieldId(field: RepositoryField): string {
    return `repository-${field.key.replaceAll('_', '-')}`;
  }

  addExtra(): void {
    const id = this.nextExtraId++;
    this.extras.update((extras) => [...extras, { id, key: '', value: '' }]);
    setTimeout(() => document.getElementById(`repository-extra-key-${id}`)?.focus());
  }

  updateExtra(id: number, change: Partial<RepositoryExtraSetting>): void {
    this.extras.update((extras) => extras.map((extra) => (extra.id === id ? { ...extra, ...change } : extra)));
  }

  removeExtra(id: number): void {
    this.extras.update((extras) => extras.filter((extra) => extra.id !== id));
  }

  async save(): Promise<void> {
    this.submitted.set(true);
    if (this.saving()) {
      return;
    }
    const payload = this.payload();
    if (!payload) {
      this.focusFirstInvalid();
      return;
    }
    const updating = this.updateMode();
    if (updating) {
      const changes = this.changes();
      const confirmed = await this.dialogs.confirm({
        title: `Update repository ${payload.name}?`,
        message:
          changes.length > 0
            ? 'Elasticsearch re-registers the repository with these changes and verifies it on every node. Snapshots running against it may fail.'
            : 'Nothing changed. Elasticsearch re-registers the repository with the same settings and verifies it again.',
        items: changes,
        confirmLabel: 'Update repository',
        tone: 'warning',
      });
      if (!confirmed) {
        return;
      }
    }
    this.saving.set(true);
    this.saveError.set(null);
    try {
      const response = await this.api.post<unknown>('repositories/create', { ...payload });
      this.alerts.success(
        updating ? `Repository ${payload.name} updated` : `Repository ${payload.name} registered`,
        response,
      );
      await this.load();
      const saved = (this.repositories() ?? []).find((repository) => repository.name === payload.name);
      if (saved) {
        this.edit(saved);
      }
    } catch (error: unknown) {
      this.saveError.set(elasticsearchReason(error) ?? 'Elasticsearch rejected the request.');
      const action = updating ? 'update' : 'register';
      this.alerts.error(failureMessage(`Could not ${action} repository ${payload.name}`, error), error);
    } finally {
      this.saving.set(false);
    }
  }

  // ---- List actions ----

  showJson(repository: RepositoryRecord): void {
    this.dialogs.showJson(repository.name, repository, `${repository.type} repository`);
  }

  async remove(repository: RepositoryRecord): Promise<void> {
    const name = repository.name;
    const confirmed = await this.dialogs.confirm({
      title: `Delete repository ${name}?`,
      message:
        'Elasticsearch unregisters the repository. Snapshot files are kept in the storage location, so the repository can be registered again later.',
      confirmLabel: 'Delete repository',
      tone: 'danger',
    });
    if (!confirmed) {
      return;
    }
    this.deleting.update((names) => new Set(names).add(name));
    try {
      const response = await this.api.post<unknown>('repositories/delete', { name });
      this.alerts.success(`Repository ${name} deleted`, response);
      if (this.editing() === name) {
        this.newRepository(false);
      }
      await this.load();
    } catch (error: unknown) {
      this.alerts.error(failureMessage(`Could not delete repository ${name}`, error), error);
    } finally {
      this.deleting.update((names) => {
        const next = new Set(names);
        next.delete(name);
        return next;
      });
    }
  }

  private focusFirstInvalid(): void {
    if (this.nameError()) {
      document.getElementById('repository-name')?.focus();
      return;
    }
    if (this.typeError()) {
      document.querySelector<HTMLInputElement>('input[name="repository-type"]')?.focus();
      return;
    }
    const culprit = this.invalidExtraId();
    if (culprit !== null) {
      document.getElementById(`repository-extra-key-${culprit}`)?.focus();
    }
  }

  private setField(key: string, value: RepositorySettingValue): void {
    this.settings.update((settings) => ({ ...settings, [key]: value }));
  }

  private maskSecrets(settings: RepositorySettings): RepositorySettings {
    const secrets = this.secretKeys();
    return Object.fromEntries(
      Object.entries(settings).map(([key, value]) => [key, secrets.has(key) ? '••••' : value]),
    ) as RepositorySettings;
  }
}
