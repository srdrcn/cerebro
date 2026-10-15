import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AlertService } from '../../core/alert.service';
import { ClusterApiService } from '../../core/cluster-api.service';
import { ConnectionService } from '../../core/connection.service';
import { DialogService } from '../../core/dialog.service';
import { failureMessage } from '../../core/errors';
import { pluralize } from '../../core/format';
import { INVALID_INDEX_NAME_CHARACTERS } from '../../core/names';
import { PendingChangesAware } from '../../core/pending-changes.guard';
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
  linkPrefill,
  shardLayout,
  sortIndexNames,
  validateCount,
  validateIndexName,
} from './create-index.models';

interface CopyInfo {
  readonly index: string;
  readonly removedSettings: readonly string[];
  readonly unwrappedType: string | null;
  readonly removedMappings: readonly string[];
}

/** "2 shards"; a value the JSON body sets to something else is shown as written. */
function layoutCount(value: string, noun: string): string {
  const count = Number(value);
  return Number.isFinite(count) ? pluralize(count, noun) : `${value} ${noun}s`;
}

@Component({
  selector: 'cerebro-create-index',
  imports: [CodeEditorComponent, FormsModule, MenuComponent, RouterLink],
  host: { '(window:beforeunload)': 'onBeforeUnload($event)' },
  templateUrl: './create-index.component.html',
  styleUrl: './create-index.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CreateIndexComponent implements PendingChangesAware {
  private readonly api = inject(ClusterApiService);
  private readonly alerts = inject(AlertService);
  private readonly dialogs = inject(DialogService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly injector = inject(Injector);
  private readonly refreshService = inject(RefreshService);
  readonly connection = inject(ConnectionService);

  private readonly editor = viewChild(CodeEditorComponent);
  private readonly nameInput = viewChild<ElementRef<HTMLInputElement>>('nameInput');
  private readonly shardsInput = viewChild<ElementRef<HTMLInputElement>>('shardsInput');
  private readonly replicasInput = viewChild<ElementRef<HTMLInputElement>>('replicasInput');

  readonly name = signal('');
  /** Set by the first create attempt: field errors show from then on. */
  readonly submitted = signal(false);
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
  /** Set once the index exists: leaving for the overview drops nothing. */
  readonly created = signal(false);

  readonly indexGroups = computed(() => sortIndexNames(this.indices() ?? []));

  readonly nameCheck = computed(() =>
    validateIndexName(this.name(), this.indices() ?? [], this.aliases()),
  );
  readonly nameError = computed(() => {
    const error = this.nameCheck().error;
    return error && (this.name() !== '' || this.submitted()) ? error : null;
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
  readonly bodyLinesLabel = computed(() => pluralize(this.bodyLines(), 'line'));
  /** Announced to screen readers: changes on transitions only, not per keystroke. */
  readonly bodyStatus = computed(() => {
    const kind = this.bodyState().kind;
    return kind === 'invalid' ? 'Invalid JSON' : this.usesBody() ? 'Valid JSON' : 'Empty body';
  });

  /** Anything typed or copied that a navigation would drop. */
  readonly dirty = computed(
    () =>
      !this.created() &&
      !this.creating() &&
      (this.name() !== '' ||
        this.shards() !== '' ||
        this.replicas() !== '' ||
        this.body().trim() !== '' ||
        this.sourceIndex() !== ''),
  );

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
    const shards = layout.shards ? layoutCount(layout.shards, 'shard') : 'default shards';
    const replicas = layout.replicas ? layoutCount(layout.replicas, 'replica') : 'default replicas';
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
    this.applyLinkParams();
  }

  /**
   * `?name=` prefills the index name and `?from=` copies the settings and
   * mappings of an index (Index operations links here so a reindex
   * destination can be created first). Applied once on load; the parameters
   * then leave the URL, so a reload or a shared link does not copy again.
   */
  private applyLinkParams(): void {
    const params = this.route.snapshot.queryParamMap;
    const prefill = linkPrefill(params.get('name'), params.get('from'));
    if (!prefill) {
      return;
    }
    if (prefill.name) {
      this.name.set(prefill.name);
    }
    if (prefill.from) {
      void this.copyIndex(prefill.from);
    }
    // After the navigation that created the page has ended.
    afterNextRender(
      () =>
        void this.router.navigate([], {
          relativeTo: this.route,
          queryParams: { name: null, from: null },
          queryParamsHandling: 'merge',
          replaceUrl: true,
        }),
      { injector: this.injector },
    );
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
        this.alerts.error(failureMessage('Could not load the index list', error), error);
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

  /** Asks the browser to confirm closing the tab while the form holds edits. */
  onBeforeUnload(event: BeforeUnloadEvent): void {
    if (this.dirty()) {
      event.preventDefault();
    }
  }

  /**
   * Resolves `true` when the form holds nothing or the user agreed to drop
   * it. Used by the route guard.
   */
  async confirmDiscard(): Promise<boolean> {
    if (!this.dirty()) {
      return true;
    }
    const name = this.name().trim();
    return this.dialogs.confirm({
      title: 'Discard the new index?',
      message: name
        ? `Index ${name} has not been created. Its name, shard layout and JSON body will be lost.`
        : 'The index has not been created. Its name, shard layout and JSON body will be lost.',
      confirmLabel: 'Discard changes',
      cancelLabel: 'Keep editing',
      tone: 'danger',
    });
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
    if (!(await this.copyIndex(index))) {
      select.value = this.sourceIndex();
    }
  }

  /**
   * Puts the settings and mappings of `index` into the JSON body, after
   * asking when that replaces JSON the user wrote. Resolves to false when the
   * user kept the body or the index could not be read.
   */
  async copyIndex(index: string): Promise<boolean> {
    const previous = this.sourceIndex();
    const current = this.body();
    if (current.trim() && current !== this.copiedBody) {
      const replace = await this.dialogs.confirm({
        title: 'Replace the JSON body?',
        message: `The settings and mappings of ${index} will replace the JSON you entered.`,
        confirmLabel: 'Replace JSON',
        tone: 'danger',
      });
      if (!replace) {
        return false;
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
        return true;
      }
      const cloned = cloneIndexMetadata(metadata);
      const text = JSON.stringify(cloned.metadata, null, 2);
      this.copiedBody = text;
      this.body.set(text);
      this.copyInfo.set({
        index,
        removedSettings: cloned.removedSettings,
        unwrappedType: cloned.unwrappedType,
        removedMappings: cloned.removedMappings,
      });
      return true;
    } catch (error: unknown) {
      if (sequence !== this.copySequence) {
        return true;
      }
      this.sourceIndex.set(previous);
      this.alerts.error(failureMessage(`Could not load the settings and mappings of ${index}`, error), error);
      return false;
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

  readonly pluralize = pluralize;
  readonly invalidNameCharacters = INVALID_INDEX_NAME_CHARACTERS.join(' ');

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
      this.alerts.warn('Fix the JSON body before previewing it', error instanceof Error ? error.message : undefined);
      this.editor()?.focus();
    }
  }

  /** Validates on submit: the first invalid field gets the focus. */
  async create(): Promise<void> {
    if (this.creating()) {
      return;
    }
    this.submitted.set(true);
    if (this.nameCheck().error) {
      this.nameInput()?.nativeElement.focus();
      return;
    }
    if (this.shardsError()) {
      this.shardsInput()?.nativeElement.focus();
      return;
    }
    if (this.replicasError()) {
      this.replicasInput()?.nativeElement.focus();
      return;
    }
    if (this.bodyError()) {
      this.editor()?.focus();
      return;
    }
    if (this.copying()) {
      this.alerts.info(`Still loading the settings and mappings of ${this.sourceIndex()}`);
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
      this.created.set(true);
      await this.router.navigate(['/overview'], {
        queryParams: { ...this.connection.hostQuery(), filter: index },
      });
    } catch (error: unknown) {
      this.alerts.error(failureMessage(`Could not create index ${index}`, error), error);
    } finally {
      this.creating.set(false);
    }
  }
}
