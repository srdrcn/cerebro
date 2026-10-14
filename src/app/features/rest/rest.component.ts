import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { AlertService } from '../../core/alert.service';
import { ClusterApiError } from '../../core/api-envelope';
import { ClipboardService } from '../../core/clipboard.service';
import { ClusterApiService } from '../../core/cluster-api.service';
import { ConnectionService } from '../../core/connection.service';
import { DialogService } from '../../core/dialog.service';
import { failureMessage } from '../../core/errors';
import { pluralize } from '../../core/format';
import {
  readJsonPreference,
  readPreference,
  writeJsonPreference,
  writePreference,
} from '../../core/preferences';
import { CodeEditorComponent } from '../../shared/code-editor.component';
import { EmptyStateComponent } from '../../shared/empty-state.component';
import { BytesPipe, NumberPipe, PluralPipe } from '../../shared/format.pipes';
import { MenuComponent } from '../../shared/menu.component';
import { SearchInputComponent } from '../../shared/search-input.component';
import { RestImportDialogComponent } from './rest-import-dialog.component';
import {
  NameDialogMode,
  NameDialogResult,
  RestNameDialogComponent,
} from './rest-name-dialog.component';
import type { ImportPlan, ImportStrategy, SavedRequest } from './rest-saved.models';
import { RestSavedComponent } from './rest-saved.component';
import { RestSavedStore } from './rest-saved.store';
import {
  bodyTooLarge,
  bodyTooLargeText,
  exportDocument,
  exportFileName,
  importSummary,
  parseImportFile,
  planImport,
  sameName,
  sameRequest,
  suggestName,
  uniqueName,
} from './rest-saved.utils';
import type {
  QuickStart,
  RestDraft,
  RestHistoryEntry,
  RestIndexData,
  RestResponseView,
  StatusTone,
} from './rest.models';
import {
  REST_METHODS,
  RestMethod,
  SuggestionParts,
  bodyPreview,
  buildCurlCommand,
  buildRequestPayload,
  describeBody,
  destructiveDeleteTarget,
  draftForStorage,
  formatEditorBody,
  formatElapsed,
  getPathSuggestions,
  historyBody,
  historyTimestamp,
  hostPrefix,
  isNdjsonPath,
  isRawTextPath,
  isRestMethod,
  isStringBodyPath,
  isTextCatPath,
  matchesHistoryEntry,
  networkErrorText,
  parseStoredDraft,
  prependHistoryEntry,
  QUICK_STARTS,
  requestPath,
  responseHint,
  responseSize,
  responseText,
  restoredBody,
  statusText,
  statusTone,
  suggestionParts,
  withJsonFormat,
  wrapIndex,
} from './rest.utils';

const DRAFT_KEY = 'cerebro.rest.draft';
const WRAP_KEY = 'cerebro.rest.wrap';
const DEFAULT_DRAFT: RestDraft = { method: 'GET', path: '', body: '' };

type PaneTab = 'body' | 'history' | 'saved';

const PANE_TABS: readonly PaneTab[] = ['body', 'history', 'saved'];

/** Imported files larger than this are refused (saved requests are small). */
const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

interface NameDialogState {
  readonly mode: NameDialogMode;
  readonly initialName: string;
  /** Rename: the current name. */
  readonly renaming: string;
  readonly request: RestDraft;
}

interface ImportState {
  readonly plan: ImportPlan;
  readonly fileName: string;
}

interface MethodOption {
  readonly method: RestMethod;
  readonly description: string;
}

const METHOD_DESCRIPTIONS: Readonly<Record<RestMethod, string>> = {
  GET: 'Read or search',
  POST: 'Create, query or run an action',
  PUT: 'Create or replace',
  DELETE: 'Remove',
};

const TONE_CLASSES: Readonly<Record<StatusTone, string>> = {
  green: 'badge-green',
  blue: 'badge-blue',
  yellow: 'badge-yellow',
  red: 'badge-red',
  gray: '',
};

/** Offers `text` as a file download. */
function downloadText(fileName: string, text: string): void {
  const doc = globalThis.document;
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  try {
    const link = doc.createElement('a');
    link.href = url;
    link.download = fileName;
    link.rel = 'noopener';
    link.style.display = 'none';
    doc.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    // Give the browser a moment to start the download.
    setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }
}

function isMacPlatform(): boolean {
  const platform = globalThis.navigator?.platform ?? '';
  return /mac|iphone|ipad/i.test(platform);
}

@Component({
  selector: 'cerebro-rest',
  imports: [
    BytesPipe,
    CodeEditorComponent,
    EmptyStateComponent,
    MenuComponent,
    NumberPipe,
    PluralPipe,
    RestImportDialogComponent,
    RestNameDialogComponent,
    RestSavedComponent,
    SearchInputComponent,
  ],
  providers: [RestSavedStore],
  templateUrl: './rest.component.html',
  styleUrl: './rest.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RestComponent {
  private readonly api = inject(ClusterApiService);
  private readonly alerts = inject(AlertService);
  private readonly dialogs = inject(DialogService);
  private readonly clipboard = inject(ClipboardService);
  private readonly connection = inject(ConnectionService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  private readonly pathInput = viewChild<ElementRef<HTMLInputElement>>('pathInput');
  private readonly bodyEditor = viewChild<CodeEditorComponent>('bodyEditor');
  private readonly sendButton = viewChild<ElementRef<HTMLButtonElement>>('sendButton');
  private readonly responsePane = viewChild<ElementRef<HTMLElement>>('responsePane');
  private readonly importInput = viewChild<ElementRef<HTMLInputElement>>('importInput');
  readonly saved = inject(RestSavedStore);

  readonly modKey = isMacPlatform() ? '⌘' : 'Ctrl';
  readonly methodOptions: readonly MethodOption[] = REST_METHODS.map((method) => ({
    method,
    description: METHOD_DESCRIPTIONS[method],
  }));
  readonly quickStarts = QUICK_STARTS;
  readonly pluralize = pluralize;

  // ---- Request being edited (persisted per browser) ----
  private readonly initialDraft =
    parseStoredDraft(readJsonPreference<unknown>(DRAFT_KEY, null)) ?? DEFAULT_DRAFT;
  readonly method = signal<RestMethod>(this.initialDraft.method);
  readonly path = signal(this.initialDraft.path);
  readonly body = signal(this.initialDraft.body);
  readonly tab = signal<PaneTab>('body');
  readonly draft = computed<RestDraft>(() => ({
    method: this.method(),
    path: this.path(),
    body: this.body(),
  }));

  readonly bodyState = computed(() => describeBody(this.path(), this.body()));
  readonly ndjson = computed(() => isNdjsonPath(this.path()));
  readonly rawText = computed(() => isRawTextPath(this.path()));
  readonly invalidMessage = computed(() => {
    const state = this.bodyState();
    return state.kind === 'invalid' ? state.message : '';
  });
  readonly ndjsonLines = computed(() => {
    const state = this.bodyState();
    if (state.kind !== 'ndjson') {
      return '';
    }
    return pluralize(state.lines, 'NDJSON line');
  });
  readonly textLines = computed(() => {
    const state = this.bodyState();
    if (state.kind !== 'text') {
      return '';
    }
    return `${pluralize(state.lines, 'line')} of plain text`;
  });
  readonly bodyPlaceholder = computed(() => {
    if (this.ndjson()) {
      return '{ "index": { "_index": "my-index" } }\n{ "field": "value" }';
    }
    return this.rawText()
      ? 'The text to analyse, for example CSV or log lines'
      : 'Optional JSON body, for example { "query": { "match_all": {} } }';
  });

  // ---- Autocomplete (rest endpoint) ----
  readonly indices = signal<readonly string[]>([]);
  readonly endpoint = signal('');
  readonly prefix = computed(() => hostPrefix(this.endpoint() || this.connection.host() || ''));
  readonly suggestOpen = signal(false);
  readonly activeSuggestion = signal(-1);
  readonly suggestions = computed(() => getPathSuggestions(this.indices(), this.path()));
  readonly showSuggestions = computed(() => this.suggestOpen() && this.suggestions().length > 0);
  readonly activeOptionId = computed(() => {
    const index = this.activeSuggestion();
    return this.showSuggestions() && index >= 0 ? `rest-path-option-${index}` : null;
  });

  // ---- History ----
  readonly history = signal<readonly RestHistoryEntry[] | undefined>(undefined);
  readonly historyLoading = signal(false);
  readonly historyFailed = signal(false);
  readonly historyQuery = signal('');
  readonly visibleHistory = computed(() => {
    const query = this.historyQuery().trim();
    const history = this.history() ?? [];
    return query ? history.filter((entry) => matchesHistoryEntry(entry, query)) : history;
  });

  // ---- Saved requests ----
  /** The saved request the editor was loaded from (or last saved as). */
  readonly linked = this.saved.linked;
  /** The editor no longer matches the linked saved request. */
  readonly linkedDirty = computed(() => {
    const linked = this.linked();
    return linked !== null && !sameRequest(linked, this.draft());
  });
  readonly saveTitle = computed(() => {
    const linked = this.linked();
    return linked === null
      ? `Save this request (${this.modKey}+S)`
      : `Save as a new request (${this.modKey}+S updates “${linked.name}”)`;
  });
  readonly nameDialog = signal<NameDialogState | null>(null);
  readonly importState = signal<ImportState | null>(null);
  readonly importing = signal(false);

  // ---- Response ----
  readonly sending = signal(false);
  readonly response = signal<RestResponseView | null>(null);
  readonly wrapResponse = signal(readPreference(WRAP_KEY) === 'true');

  private historySequence = 0;
  private indexSequence = 0;
  private sendSequence = 0;
  private sendPending = false;
  private persistTimer: ReturnType<typeof setTimeout> | undefined;
  private loadedHost: string | null | undefined;

  constructor() {
    effect(() => {
      const host = this.connection.host();
      const connected = this.connection.connected();
      untracked(() => {
        if (this.loadedHost !== undefined && host !== this.loadedHost) {
          // A response (or a reply still in flight) belongs to the previous cluster.
          this.sendSequence++;
          this.sending.set(false);
          this.response.set(null);
          this.endpoint.set('');
          this.indices.set([]);
        }
        this.loadedHost = host;
        if (connected) {
          void this.loadIndex();
          void this.loadHistory();
        }
      });
    });

    // Persist the draft (debounced) so it survives reloads. Never credentials.
    effect(() => {
      const draft: RestDraft = { method: this.method(), path: this.path(), body: this.body() };
      clearTimeout(this.persistTimer);
      this.persistTimer = setTimeout(() => this.persist(draft), 400);
    });

    // Ace positions its hidden textarea at the cursor; when it gets focus the
    // browser scrolls Ace's overflow:hidden scroller to reveal it, which
    // shifts the text against the gutter. Ace never scrolls that element
    // natively (it uses transforms), so undo any such scroll right away.
    const element = this.host.nativeElement;
    const resetAceScroll = (event: Event) => {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.classList.contains('ace_scroller') &&
        (target.scrollTop !== 0 || target.scrollLeft !== 0)
      ) {
        target.scrollTop = 0;
        target.scrollLeft = 0;
      }
    };
    element.addEventListener('scroll', resetAceScroll, true);

    // The shared editor's Ctrl/⌘+Shift+F only knows JSON: it would pretty-print
    // a one-line NDJSON body over several lines (breaking it) and ignore
    // multi-line ones. Capture the shortcut before Ace sees it.
    const formatShortcut = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        (event.ctrlKey || event.metaKey) &&
        event.shiftKey &&
        !event.altKey &&
        event.key.toLowerCase() === 'f' &&
        target instanceof Element &&
        target.closest('[data-rest-body-editor]') !== null &&
        isStringBodyPath(this.path())
      ) {
        event.preventDefault();
        event.stopPropagation();
        if (this.ndjson() && this.bodyState().kind !== 'empty') {
          this.formatBody();
        }
      }
    };
    element.addEventListener('keydown', formatShortcut, true);

    // Ctrl/⌘+S saves the request instead of the browser saving the page.
    const doc = globalThis.document;
    const saveShortcut = (event: KeyboardEvent) => {
      if (
        !(event.ctrlKey || event.metaKey) ||
        event.shiftKey ||
        event.altKey ||
        // `code` too: with Cyrillic, Greek … layouts the key is not "s".
        (event.key.toLowerCase() !== 's' && event.code !== 'KeyS')
      ) {
        return;
      }
      event.preventDefault();
      // Not while a dialog (ours or a confirmation) is open.
      if (event.repeat || doc?.querySelector('dialog[open]')) {
        return;
      }
      event.stopPropagation();
      this.onSaveShortcut();
    };
    doc?.addEventListener('keydown', saveShortcut, true);

    this.destroyRef.onDestroy(() => {
      element.removeEventListener('scroll', resetAceScroll, true);
      element.removeEventListener('keydown', formatShortcut, true);
      doc?.removeEventListener('keydown', saveShortcut, true);
      clearTimeout(this.persistTimer);
      this.persist({ method: this.method(), path: this.path(), body: this.body() });
    });
  }

  // ------------------------------------------------------------------
  // Loading
  // ------------------------------------------------------------------

  async loadIndex(): Promise<void> {
    const sequence = ++this.indexSequence;
    // Until the new answer arrives, fall back to the connection's own host.
    this.endpoint.set('');
    try {
      const data = await this.api.post<RestIndexData>('rest');
      if (sequence === this.indexSequence) {
        this.indices.set(data.indices ?? []);
        this.endpoint.set(data.host ?? '');
      }
    } catch (error: unknown) {
      if (sequence === this.indexSequence) {
        this.indices.set([]);
        this.endpoint.set('');
        this.alerts.error(failureMessage('Could not load indices for autocompletion', error), error);
      }
    }
  }

  async loadHistory(): Promise<void> {
    const sequence = ++this.historySequence;
    this.historyLoading.set(true);
    try {
      const history = await this.api.post<readonly RestHistoryEntry[]>('rest/history');
      if (sequence === this.historySequence) {
        this.history.set(history);
        this.historyFailed.set(false);
      }
    } catch (error: unknown) {
      if (sequence === this.historySequence) {
        this.historyFailed.set(true);
        this.alerts.error(failureMessage('Could not load the request history', error), error);
      }
    } finally {
      if (sequence === this.historySequence) {
        this.historyLoading.set(false);
      }
    }
  }

  // ------------------------------------------------------------------
  // Sending
  // ------------------------------------------------------------------

  async send(): Promise<void> {
    if (this.sendPending || this.sending()) {
      return;
    }
    const draft: RestDraft = { method: this.method(), path: this.path(), body: this.body() };
    if (requestPath(draft.path) === '') {
      this.alerts.warn('Enter a request path first, for example _cluster/health');
      this.focusPath();
      return;
    }
    const state = describeBody(draft.path, draft.body);

    this.sendPending = true;
    try {
      if (state.kind === 'invalid') {
        // Some APIs take bodies that are neither JSON nor recognised NDJSON:
        // offer to send the text verbatim.
        this.tab.set('body');
        const raw = await this.dialogs.confirm({
          title: 'Send the body as raw text?',
          message: `${
            isNdjsonPath(draft.path) ? 'The NDJSON body is not valid' : 'The body is not valid JSON'
          }: ${state.message}. Cerebro can send it exactly as typed, with the application/x-ndjson content type.`,
          confirmLabel: 'Send as raw text',
          cancelLabel: 'Keep editing',
        });
        if (!raw) {
          this.bodyEditor()?.focus();
          return;
        }
      }
      const target = destructiveDeleteTarget(draft.method, draft.path);
      if (target !== null) {
        const confirmed = await this.dialogs.confirm({
          title: `Delete ${target}?`,
          message:
            'This DELETE request removes every matching index together with all of its documents. It cannot be undone.',
          items: [target],
          confirmLabel: 'Send DELETE request',
          tone: 'danger',
        });
        if (!confirmed) {
          return;
        }
      }
      this.suggestOpen.set(false);
      await this.execute(draft);
    } finally {
      this.sendPending = false;
    }
  }

  private async execute(draft: RestDraft): Promise<void> {
    const payload = buildRequestPayload(draft);
    const sequence = ++this.sendSequence;
    this.sending.set(true);
    const started = performance.now();

    let status: number | null;
    let value: unknown;
    let json: boolean;
    try {
      const envelope = await this.api.rawPost<unknown>('rest/request', payload);
      status = envelope.status;
      value = envelope.body;
      json = typeof value !== 'string';
    } catch (error: unknown) {
      // rawPost only throws when Cerebro's own server could not be reached
      // (and already reports that with a toast).
      status = error instanceof ClusterApiError ? error.status : null;
      value = error instanceof ClusterApiError ? error.body : networkErrorText(error);
      json = typeof value !== 'string';
    }
    if (sequence !== this.sendSequence) {
      return;
    }

    const elapsedMs = performance.now() - started;
    this.response.set({
      request: draft,
      method: payload.method,
      path: payload.path,
      status,
      text: responseText(value),
      json,
      elapsedMs,
      bytes: responseSize(value),
      hint: responseHint(payload.path, status, value),
    });
    this.sending.set(false);
    this.revealResponse();

    if (status !== null && status >= 200 && status < 300) {
      // The server only stores successful requests; show it right away and
      // then reconcile with the stored history.
      const entry: RestHistoryEntry = {
        method: payload.method,
        path: payload.path,
        body: historyBody(payload),
        created_at: historyTimestamp(new Date()),
      };
      this.history.update((history) => prependHistoryEntry(history ?? [], entry));
      void this.loadHistory();
    }
  }

  // ------------------------------------------------------------------
  // Request editing
  // ------------------------------------------------------------------

  setMethod(method: RestMethod): void {
    this.method.set(method);
  }

  formatBody(): void {
    const state = this.bodyState();
    if (state.kind === 'invalid') {
      this.alerts.warn(
        this.ndjson() ? 'Could not format the NDJSON body' : 'The body is not valid JSON',
        state.message,
      );
      return;
    }
    this.body.set(formatEditorBody(this.path(), this.body()));
  }

  clearBody(): void {
    this.body.set('');
    this.bodyEditor()?.focus();
  }

  async copyBody(): Promise<void> {
    await this.clipboard.copy(
      this.body(),
      () => this.alerts.success('Request body copied to the clipboard'),
      (error) => this.alerts.error(failureMessage('Could not copy the request body', error), error),
    );
  }

  async copyAsCurl(): Promise<void> {
    const host = this.endpoint() || this.connection.host() || '';
    if (host.trim() === '') {
      this.alerts.error('No connected Elasticsearch host is available');
      return;
    }
    if (requestPath(this.path()) === '') {
      this.alerts.warn('Enter a request path first');
      this.focusPath();
      return;
    }

    let command: string;
    try {
      command = buildCurlCommand({
        method: this.method(),
        host,
        path: requestPath(this.path()),
        body: this.body(),
      });
    } catch (error: unknown) {
      this.alerts.error('The body must be valid JSON to build a cURL command', error);
      return;
    }

    await this.clipboard.copy(
      command,
      () => this.alerts.success('cURL command copied to the clipboard'),
      (error) => this.alerts.error(failureMessage('Could not copy the cURL command', error), error),
    );
  }

  restore(entry: RestHistoryEntry): void {
    this.method.set(isRestMethod(entry.method) ? entry.method : 'GET');
    this.path.set(entry.path);
    this.body.set(restoredBody(entry));
    this.unlinkUnlessSame();
    this.tab.set('body');
    this.bodyEditor()?.focus();
  }

  useExample(example: QuickStart): void {
    this.method.set(example.method);
    this.path.set(example.path);
    this.body.set(example.body);
    this.unlinkUnlessSame();
    this.tab.set('body');
    this.sendButton()?.nativeElement.focus();
  }

  previewOf(entry: RestHistoryEntry): string {
    return bodyPreview(entry.body);
  }

  // ------------------------------------------------------------------
  // Path autocomplete (combobox)
  // ------------------------------------------------------------------

  onPathInput(value: string): void {
    this.path.set(value);
    this.suggestOpen.set(true);
    this.activeSuggestion.set(-1);
  }

  openSuggestions(): void {
    this.suggestOpen.set(true);
  }

  closeSuggestions(): void {
    this.suggestOpen.set(false);
    this.activeSuggestion.set(-1);
  }

  acceptSuggestion(option: string): void {
    this.path.set(option);
    this.activeSuggestion.set(-1);
    // Keep suggesting while the path can still be extended ("products/…").
    this.suggestOpen.set(true);
    this.focusPath();
  }

  clearPath(input: HTMLInputElement): void {
    this.path.set('');
    this.activeSuggestion.set(-1);
    input.focus();
  }

  onPathKeydown(event: KeyboardEvent): void {
    const options = this.suggestions();
    const open = this.showSuggestions();
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        event.preventDefault();
        if (!this.suggestOpen()) {
          this.suggestOpen.set(true);
        }
        this.activeSuggestion.set(
          wrapIndex(this.activeSuggestion(), event.key === 'ArrowDown' ? 1 : -1, options.length),
        );
        this.scrollActiveIntoView();
        break;
      }
      case 'Enter': {
        if (event.ctrlKey || event.metaKey) {
          return; // handled by the page shortcut
        }
        const option = open ? options[this.activeSuggestion()] : undefined;
        if (option !== undefined) {
          event.preventDefault();
          this.acceptSuggestion(option);
        }
        // Otherwise the form submits and sends the request.
        break;
      }
      case 'Tab': {
        const option = open ? options[this.activeSuggestion()] : undefined;
        if (option !== undefined && !event.shiftKey) {
          event.preventDefault();
          this.acceptSuggestion(option);
        } else {
          this.closeSuggestions();
        }
        break;
      }
      case 'Escape': {
        if (open) {
          event.preventDefault();
          event.stopPropagation();
          this.closeSuggestions();
        }
        break;
      }
    }
  }

  splitSuggestion(option: string): SuggestionParts {
    return suggestionParts(option, this.path());
  }

  suggestionIcon(option: string): string {
    const segments = option.replace(/^\/+/, '').split(/[/?]/);
    if (segments.includes('_cat')) {
      return 'bi-table';
    }
    return segments.some((segment) => segment.startsWith('_')) ? 'bi-braces' : 'bi-layers';
  }

  // ------------------------------------------------------------------
  // Keyboard
  // ------------------------------------------------------------------

  onPageKeydown(event: KeyboardEvent): void {
    // The save and import dialogs live inside the page: Ctrl+Enter there must not send.
    const target = event.target;
    if (target instanceof Element && target.closest('dialog') !== null) {
      return;
    }
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.defaultPrevented) {
      event.preventDefault();
      void this.send();
    }
  }

  onTabKeydown(event: KeyboardEvent): void {
    const current = PANE_TABS.indexOf(this.tab());
    let index: number;
    switch (event.key) {
      case 'ArrowLeft':
      case 'ArrowRight':
        index = wrapIndex(current, event.key === 'ArrowRight' ? 1 : -1, PANE_TABS.length);
        break;
      case 'Home':
        index = 0;
        break;
      case 'End':
        index = PANE_TABS.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    const next = PANE_TABS[index] ?? 'body';
    this.tab.set(next);
    const tablist = (event.currentTarget as HTMLElement | null)?.parentElement;
    tablist?.querySelector<HTMLElement>(`#rest-tab-${next}`)?.focus();
  }

  // ------------------------------------------------------------------
  // Saved requests
  // ------------------------------------------------------------------

  /** Ctrl/⌘+S: update the linked saved request, or save under a new name. */
  onSaveShortcut(): void {
    const linked = this.linked();
    if (linked !== null && this.linkedDirty()) {
      this.updateLinked();
    } else if (linked !== null && sameRequest(linked, this.draft())) {
      this.alerts.info(`“${linked.name}” has no unsaved changes`);
    } else {
      this.openSaveDialog();
    }
  }

  openSaveDialog(): void {
    if (!this.canSaveDraft()) {
      return;
    }
    const draft = this.draft();
    this.suggestOpen.set(false);
    this.nameDialog.set({
      mode: 'save',
      initialName: uniqueName(suggestName(draft), this.saved.requests()),
      renaming: '',
      request: draft,
    });
  }

  openRenameDialog(request: SavedRequest): void {
    this.nameDialog.set({
      mode: 'rename',
      initialName: request.name,
      renaming: request.name,
      request: { method: request.method, path: request.path, body: request.body },
    });
  }

  onNameSubmitted(dialog: NameDialogState, result: NameDialogResult): void {
    if (dialog.mode === 'rename') {
      if (result.name === dialog.renaming) {
        return;
      }
      const stored = this.saved.rename(dialog.renaming, result.name);
      this.reportStored(stored, `Renamed to “${result.name}”`);
      return;
    }
    const { saved, stored } = this.saved.save(result.name, dialog.request);
    this.reportStored(stored, result.overwrite ? `Replaced “${saved.name}”` : `Saved “${saved.name}”`);
  }

  updateLinked(): void {
    const linked = this.linked();
    if (linked === null) {
      return;
    }
    if (!this.canSaveDraft()) {
      return;
    }
    const { stored } = this.saved.save(linked.name, this.draft());
    this.reportStored(stored, `Updated “${linked.name}”`);
  }

  /**
   * Whether the editor's request can be saved; explains why not otherwise.
   * Bodies longer than what storage keeps are refused here rather than
   * reported as saved and dropped on the next reload.
   */
  private canSaveDraft(): boolean {
    if (requestPath(this.path()) === '') {
      this.alerts.warn('Enter a request path before saving the request');
      this.focusPath();
      return false;
    }
    const body = this.body();
    if (bodyTooLarge(body)) {
      this.alerts.warn('The body is too large to save', bodyTooLargeText(body));
      return false;
    }
    return true;
  }

  /** Puts the linked saved request back into the editor. */
  revertLinked(): void {
    const linked = this.linked();
    if (linked !== null) {
      this.applyRequest(linked);
    }
  }

  unlink(): void {
    this.saved.link(null);
  }

  async loadSaved(request: SavedRequest): Promise<void> {
    const linked = this.linked();
    if (linked !== null && this.linkedDirty()) {
      const same = sameName(linked.name, request.name);
      const discard = await this.dialogs.confirm({
        title: `Discard the changes to “${linked.name}”?`,
        message: same
          ? `The editor holds changes that are not saved yet. Loading “${linked.name}” again puts the saved version back.`
          : `The editor holds changes that are not saved yet. Loading “${request.name}” replaces them.`,
        confirmLabel: same ? 'Discard changes' : 'Discard and load',
        cancelLabel: 'Keep editing',
        tone: 'warning',
      });
      if (!discard) {
        return;
      }
    }
    // The list may have changed while the confirmation was open.
    const current = this.saved.find(request.name);
    if (!current) {
      return;
    }
    this.applyRequest(current);
    this.saved.link(current.name);
    this.saved.markUsed(current.name);
    this.tab.set('body');
    this.sendButton()?.nativeElement.focus();
  }

  exportSaved(): void {
    const requests = this.saved.requests();
    if (requests.length === 0) {
      this.alerts.info('There are no saved requests to export yet');
      return;
    }
    const now = new Date();
    const name = exportFileName(now);
    const text = `${JSON.stringify(exportDocument(requests, now), null, 2)}\n`;
    try {
      downloadText(name, text);
      this.alerts.success(`Exported ${pluralize(requests.length, 'saved request')}`, name);
    } catch (error: unknown) {
      this.alerts.error(failureMessage('Could not export the saved requests', error), error);
    }
  }

  chooseImportFile(): void {
    this.importInput()?.nativeElement.click();
  }

  async onImportFile(input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    // Allow picking the same file again later.
    input.value = '';
    if (!file || this.importing()) {
      return;
    }
    if (file.size > MAX_IMPORT_BYTES) {
      this.alerts.error(
        `“${file.name}” is too large to be a saved requests file`,
        'Exported saved requests files are at most a few hundred kilobytes.',
      );
      return;
    }
    this.importing.set(true);
    let text: string;
    try {
      text = await file.text();
    } catch (error: unknown) {
      this.alerts.error(failureMessage(`Could not read “${file.name}”`, error), error);
      return;
    } finally {
      this.importing.set(false);
    }
    const parsed = parseImportFile(text, Date.now());
    if (!parsed.ok) {
      this.alerts.error(`Could not import “${file.name}”`, parsed.message);
      return;
    }
    const plan = planImport(this.saved.requests(), parsed.requests, parsed.invalid);
    if (plan.conflicts.length > 0) {
      this.importState.set({ plan, fileName: file.name });
      return;
    }
    this.applyImport(plan, 'skip');
  }

  onImportConfirmed(state: ImportState, strategy: ImportStrategy): void {
    this.applyImport(state.plan, strategy);
  }

  private applyImport(plan: ImportPlan, strategy: ImportStrategy): void {
    const { outcome, stored } = this.saved.import(plan.incoming, strategy);
    const summary = importSummary(outcome, plan.invalid);
    if (!stored) {
      this.alerts.warn(`${summary.message}, but the browser did not store them`, this.saved.notStoredDetail());
    } else if (outcome.added + outcome.overwritten === 0) {
      this.alerts.info(summary.message, summary.details || undefined);
    } else {
      this.alerts.success(summary.message, summary.details || undefined);
    }
    this.tab.set('saved');
  }

  private applyRequest(request: Pick<RestDraft, 'method' | 'path' | 'body'>): void {
    this.method.set(request.method);
    this.path.set(request.path);
    this.body.set(request.body);
    this.suggestOpen.set(false);
  }

  /** Loading something else into the editor ends the link to a saved request. */
  private unlinkUnlessSame(): void {
    const linked = this.linked();
    if (linked !== null && !sameRequest(linked, this.draft())) {
      this.saved.link(null);
    }
  }

  private reportStored(stored: boolean, message: string): void {
    if (stored) {
      this.alerts.success(message);
    } else {
      this.alerts.warn(`${message}, but the browser did not store it`, this.saved.notStoredDetail());
    }
  }

  // ------------------------------------------------------------------
  // Response
  // ------------------------------------------------------------------

  toggleWrap(): void {
    const wrap = !this.wrapResponse();
    this.wrapResponse.set(wrap);
    writePreference(WRAP_KEY, String(wrap));
  }

  async copyResponse(): Promise<void> {
    const response = this.response();
    if (!response) {
      return;
    }
    await this.clipboard.copy(
      response.text,
      () => this.alerts.success('Response copied to the clipboard'),
      (error) => this.alerts.error(failureMessage('Could not copy the response', error), error),
    );
  }

  statusToneOf(status: number | null): StatusTone {
    return statusTone(status);
  }

  toneClass(status: number | null): string {
    return TONE_CLASSES[statusTone(status)];
  }

  statusLabel(status: number | null): string {
    return statusText(status);
  }

  elapsedLabel(milliseconds: number): string {
    return formatElapsed(milliseconds);
  }

  /** True when the last response failed because _cat answered with text. */
  readonly canUseJsonFormat = computed(() => {
    const response = this.response();
    return (
      response !== null &&
      response.status !== null &&
      response.status >= 500 &&
      isTextCatPath(response.path)
    );
  });

  /** Retries the failed _cat request (not whatever is edited now) with ?format=json. */
  async useJsonFormat(): Promise<void> {
    const failed = this.response();
    if (!failed) {
      return;
    }
    this.method.set(failed.request.method);
    this.path.set(withJsonFormat(failed.request.path));
    this.body.set(failed.request.body);
    await this.send();
  }

  // ------------------------------------------------------------------

  /** In the stacked layout the response is below the fold: bring it into view. */
  private revealResponse(): void {
    const pane = this.responsePane()?.nativeElement;
    const view = globalThis.window;
    if (!pane || !view?.matchMedia?.('(max-width: 1180px)').matches) {
      return;
    }
    const rect = pane.getBoundingClientRect();
    if (rect.top > view.innerHeight * 0.6) {
      pane.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  private focusPath(): void {
    this.pathInput()?.nativeElement.focus();
  }

  private scrollActiveIntoView(): void {
    const index = this.activeSuggestion();
    queueMicrotask(() => {
      globalThis.document
        ?.getElementById(`rest-path-option-${index}`)
        ?.scrollIntoView({ block: 'nearest' });
    });
  }

  private persist(draft: RestDraft): void {
    writeJsonPreference(DRAFT_KEY, draftForStorage(draft));
  }
}
