import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AlertService } from '../../core/alert.service';
import { ClusterApiService } from '../../core/cluster-api.service';
import { ConnectionService } from '../../core/connection.service';
import { DialogService } from '../../core/dialog.service';
import { RefreshService } from '../../core/refresh.service';
import { CodeEditorComponent } from '../../shared/code-editor.component';
import { MenuComponent } from '../../shared/menu.component';
import {
  EXAMPLE_INDEX_BODY,
  IndexMetadata,
  MAX_SHARDS,
  aliasNames,
  analyzeBody,
  bodyOverridesFields,
  buildIndexMetadata,
  cloneIndexMetadata,
  elasticsearchReason,
  shardLayout,
  sortIndexNames,
  validateCount,
  validateIndexName,
} from './create-index.models';

interface CopyInfo {
  readonly index: string;
  readonly removedSettings: readonly string[];
  readonly unwrappedType: string | null;
}

function plural(count: string, singular: string, pluralForm: string): string {
  return `${count} ${count === '1' ? singular : pluralForm}`;
}

@Component({
  selector: 'cerebro-create-index',
  imports: [CodeEditorComponent, FormsModule, MenuComponent, RouterLink],
  templateUrl: './create-index.component.html',
  styleUrl: './create-index.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CreateIndexComponent {
  private readonly api = inject(ClusterApiService);
  private readonly alerts = inject(AlertService);
  private readonly dialogs = inject(DialogService);
  private readonly router = inject(Router);
  private readonly refreshService = inject(RefreshService);
  readonly connection = inject(ConnectionService);

  private readonly editor = viewChild(CodeEditorComponent);
  private readonly nameInput = viewChild<ElementRef<HTMLInputElement>>('nameInput');

  readonly name = signal('');
  readonly nameTouched = signal(false);
  readonly shards = signal('');
  readonly replicas = signal('');
  readonly body = signal('');
  readonly sourceIndex = signal('');

  readonly indices = signal<readonly string[] | undefined>(undefined);
  readonly indicesFailed = signal(false);
  /** Alias names, best effort: Elasticsearch still rejects a clash on creation. */
  readonly aliases = signal<readonly string[]>([]);
  readonly copying = signal(false);
  readonly copyInfo = signal<CopyInfo | null>(null);
  readonly creating = signal(false);

  readonly indexGroups = computed(() => sortIndexNames(this.indices() ?? []));

  readonly nameCheck = computed(() =>
    validateIndexName(this.name(), this.indices() ?? [], this.aliases()),
  );
  readonly nameError = computed(() => {
    const error = this.nameCheck().error;
    return error && (this.name() !== '' || this.nameTouched()) ? error : null;
  });

  readonly bodyState = computed(() => analyzeBody(this.body()));
  readonly usesBody = computed(() => bodyOverridesFields(this.bodyState()));
  /** The shard and replica fields are inactive while a body is being written. */
  readonly fieldsLocked = computed(() => this.usesBody() || this.bodyState().kind === 'invalid');
  readonly bodyLayout = computed(() => {
    const state = this.bodyState();
    return state.kind === 'object' ? shardLayout(state.value) : { shards: null, replicas: null };
  });
  readonly bodyError = computed(() => {
    const state = this.bodyState();
    return state.kind === 'invalid' ? state.message : null;
  });
  readonly bodyLines = computed(() => (this.body().trim() ? this.body().split('\n').length : 0));
  readonly bodyLinesLabel = computed(() => plural(String(this.bodyLines()), 'line', 'lines'));

  readonly shardsError = computed(() =>
    this.fieldsLocked() ? null : validateCount(this.shards(), 1, MAX_SHARDS),
  );
  readonly replicasError = computed(() =>
    this.fieldsLocked() ? null : validateCount(this.replicas(), 0),
  );

  /** Placeholders of the shard and replica inputs. */
  readonly countPlaceholders = computed(() => {
    if (!this.fieldsLocked()) {
      return { shards: '1', replicas: '1' };
    }
    if (this.bodyState().kind === 'invalid') {
      return { shards: '—', replicas: '—' };
    }
    // A value the body leaves out falls back to the cluster default.
    return { shards: 'Default', replicas: 'Default' };
  });

  /** Why the index cannot be created yet, or null when it can. */
  readonly blocker = computed<string | null>(() => {
    const nameError = this.nameCheck().error;
    if (nameError) {
      return nameError;
    }
    if (this.shardsError()) {
      return 'Fix the number of shards';
    }
    if (this.replicasError()) {
      return 'Fix the number of replicas';
    }
    const body = this.bodyState();
    if (body.kind === 'invalid') {
      return 'Fix the JSON body';
    }
    if (this.copying()) {
      return 'Loading settings and mappings…';
    }
    return null;
  });

  readonly canCreate = computed(() => this.blocker() === null && !this.creating());

  readonly summary = computed(() => {
    if (this.bodyState().kind === 'invalid') {
      return 'JSON body has errors';
    }
    if (this.shardsError() || this.replicasError()) {
      return 'Fix the shard layout';
    }
    const layout = this.usesBody()
      ? this.bodyLayout()
      : { shards: this.shards().trim() || null, replicas: this.replicas().trim() || null };
    const shards = layout.shards ? plural(layout.shards, 'shard', 'shards') : 'default shards';
    const replicas = layout.replicas ? plural(layout.replicas, 'replica', 'replicas') : 'default replicas';
    return `${shards} · ${replicas}`;
  });

  private indicesSequence = 0;
  private aliasesSequence = 0;
  private copySequence = 0;
  /** Editor content produced by the last copy, to detect user edits. */
  private copiedBody = '';

  constructor() {
    effect(() => {
      this.refreshService.tick();
      if (this.connection.connected()) {
        void this.loadIndices();
        void this.loadAliases();
      }
    });
  }

  async loadIndices(): Promise<void> {
    const sequence = ++this.indicesSequence;
    try {
      const indices = await this.api.post<readonly string[]>('commons/indices');
      if (sequence === this.indicesSequence) {
        this.indices.set(indices);
        this.indicesFailed.set(false);
      }
    } catch (error: unknown) {
      if (sequence === this.indicesSequence && this.indices() === undefined) {
        this.indicesFailed.set(true);
        this.alerts.error('Could not load the list of indices', error);
      }
    }
  }

  async loadAliases(): Promise<void> {
    const sequence = ++this.aliasesSequence;
    try {
      const rows = await this.api.post<unknown>('cat', { api: 'aliases' });
      if (sequence === this.aliasesSequence) {
        this.aliases.set(aliasNames(rows));
      }
    } catch {
      // Only used to warn early; keep the last known names.
    }
  }

  setShards(value: string): void {
    this.shards.set(value);
  }

  setReplicas(value: string): void {
    this.replicas.set(value);
  }

  onBodyChange(value: string): void {
    this.body.set(value);
    if (!value.trim()) {
      // Replacing the whole text (select all + paste) passes through an
      // empty document: only forget the copy if the editor stays empty.
      queueMicrotask(() => {
        if (!this.body().trim() && !this.copying()) {
          this.sourceIndex.set('');
          this.copyInfo.set(null);
          this.copiedBody = '';
        }
      });
    }
  }

  async copyFrom(select: HTMLSelectElement): Promise<void> {
    const index = select.value;
    const previous = this.sourceIndex();
    if (!index) {
      // "Don't copy" undoes the copy, after asking if the JSON was edited.
      if (!(await this.clearCopy())) {
        select.value = previous;
      }
      return;
    }

    const current = this.body();
    if (current.trim() && current !== this.copiedBody) {
      const replace = await this.dialogs.confirm({
        title: 'Replace the JSON body?',
        message: `The settings and mappings of ${index} will replace the JSON you entered.`,
        confirmLabel: 'Replace JSON',
        tone: 'danger',
      });
      if (!replace) {
        select.value = previous;
        return;
      }
    }

    this.sourceIndex.set(index);
    const sequence = ++this.copySequence;
    this.copying.set(true);
    try {
      const metadata = await this.api.post<IndexMetadata>('create_index/get_index_metadata', {
        index,
      });
      if (sequence !== this.copySequence) {
        return;
      }
      const cloned = cloneIndexMetadata(metadata);
      const text = JSON.stringify(cloned.metadata, null, 2);
      this.copiedBody = text;
      this.body.set(text);
      this.copyInfo.set({
        index,
        removedSettings: cloned.removedSettings,
        unwrappedType: cloned.unwrappedType,
      });
    } catch (error: unknown) {
      if (sequence === this.copySequence) {
        this.sourceIndex.set(previous);
        select.value = previous;
        this.alerts.error(`Could not load the settings and mappings of ${index}`, error);
      }
    } finally {
      if (sequence === this.copySequence) {
        this.copying.set(false);
      }
    }
  }

  /**
   * Empties the JSON body and forgets the copy. Asks first when the body holds
   * JSON the user typed or edited (clearing also resets the editor's undo
   * history). Resolves to false when the user keeps the body.
   */
  async clearCopy(): Promise<boolean> {
    const current = this.body();
    if (current.trim() && current !== this.copiedBody) {
      const clear = await this.dialogs.confirm({
        title: 'Clear the JSON body?',
        message: 'The settings and mappings you entered will be removed. This cannot be undone.',
        confirmLabel: 'Clear JSON',
        cancelLabel: 'Keep JSON',
        tone: 'danger',
      });
      if (!clear) {
        return false;
      }
    }
    this.copySequence++;
    this.copying.set(false);
    this.sourceIndex.set('');
    this.copyInfo.set(null);
    this.copiedBody = '';
    this.body.set('');
    return true;
  }

  format(): void {
    const editor = this.editor();
    if (!editor) {
      return;
    }
    if (editor.format()) {
      editor.focus();
    } else {
      const state = this.bodyState();
      this.alerts.warn(
        'Fix the JSON syntax before formatting',
        state.kind === 'invalid' ? state.message : undefined,
      );
    }
  }

  insertExample(): void {
    this.body.set(EXAMPLE_INDEX_BODY);
    this.editor()?.focus();
  }

  async clearBody(): Promise<void> {
    if (await this.clearCopy()) {
      this.editor()?.focus();
    }
  }

  preview(): void {
    try {
      const metadata = buildIndexMetadata(this.body(), this.shards(), this.replicas());
      const name = this.name().trim() || '<index>';
      this.dialogs.showJson('Request body', metadata, `PUT /${name}`);
    } catch (error: unknown) {
      this.alerts.error('The JSON body is not valid', error instanceof Error ? error.message : error);
    }
  }

  async create(): Promise<void> {
    if (this.creating()) {
      return;
    }
    if (!this.canCreate()) {
      this.nameTouched.set(true);
      if (this.nameCheck().error) {
        this.nameInput()?.nativeElement.focus();
      }
      return;
    }

    const index = this.name();
    let metadata: Record<string, unknown>;
    try {
      metadata = buildIndexMetadata(this.body(), this.shards(), this.replicas());
    } catch (error: unknown) {
      this.alerts.error('The JSON body is not valid', error instanceof Error ? error.message : error);
      return;
    }

    this.creating.set(true);
    try {
      const response = await this.api.post<unknown>('create_index/create', { index, metadata });
      this.alerts.success(`Index ${index} created`, response);
      await this.router.navigate(['/overview'], {
        queryParams: { ...this.connection.hostQuery(), filter: index },
      });
    } catch (error: unknown) {
      const reason = elasticsearchReason(error);
      this.alerts.error(`Could not create index ${index}${reason ? `: ${reason}` : ''}`, error);
    } finally {
      this.creating.set(false);
    }
  }
}
