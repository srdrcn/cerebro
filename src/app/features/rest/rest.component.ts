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
import {
  readJsonPreference,
  readPreference,
  writeJsonPreference,
  writePreference,
} from '../../core/preferences';
import { CodeEditorComponent } from '../../shared/code-editor.component';
import { EmptyStateComponent } from '../../shared/empty-state.component';
import { BytesPipe } from '../../shared/format.pipes';
import { MenuComponent } from '../../shared/menu.component';
import { SearchInputComponent } from '../../shared/search-input.component';
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

type PaneTab = 'body' | 'history';

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

function isMacPlatform(): boolean {
  const platform = globalThis.navigator?.platform ?? '';
  return /mac|iphone|ipad/i.test(platform);
}

@Component({
  selector: 'cerebro-rest',
  imports: [BytesPipe, CodeEditorComponent, EmptyStateComponent, MenuComponent, SearchInputComponent],
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

  readonly modKey = isMacPlatform() ? '⌘' : 'Ctrl';
  readonly methodOptions: readonly MethodOption[] = REST_METHODS.map((method) => ({
    method,
    description: METHOD_DESCRIPTIONS[method],
  }));
  readonly quickStarts = QUICK_STARTS;

  // ---- Request being edited (persisted per browser) ----
  private readonly initialDraft =
    parseStoredDraft(readJsonPreference<unknown>(DRAFT_KEY, null)) ?? DEFAULT_DRAFT;
  readonly method = signal<RestMethod>(this.initialDraft.method);
  readonly path = signal(this.initialDraft.path);
  readonly body = signal(this.initialDraft.body);
  readonly tab = signal<PaneTab>('body');

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
    return `${state.lines} NDJSON ${state.lines === 1 ? 'line' : 'lines'}`;
  });
  readonly textLines = computed(() => {
    const state = this.bodyState();
    if (state.kind !== 'text') {
      return '';
    }
    return `${state.lines} ${state.lines === 1 ? 'line' : 'lines'} of plain text`;
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

    this.destroyRef.onDestroy(() => {
      element.removeEventListener('scroll', resetAceScroll, true);
      element.removeEventListener('keydown', formatShortcut, true);
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
        this.alerts.error('Error while loading indices for autocompletion', error);
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
        this.alerts.error('Error while loading the request history', error);
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
        // offer to send the text verbatim, as the previous console did.
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
        this.ndjson() ? 'The NDJSON body cannot be formatted' : 'The body is not valid JSON',
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
      (error) => this.alerts.error('Error while copying the request body', error),
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
      (error) => this.alerts.error('Error while copying the cURL command', error),
    );
  }

  restore(entry: RestHistoryEntry): void {
    this.method.set(isRestMethod(entry.method) ? entry.method : 'GET');
    this.path.set(entry.path);
    this.body.set(restoredBody(entry));
    this.tab.set('body');
    this.bodyEditor()?.focus();
  }

  useExample(example: QuickStart): void {
    this.method.set(example.method);
    this.path.set(example.path);
    this.body.set(example.body);
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
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.defaultPrevented) {
      event.preventDefault();
      void this.send();
    }
  }

  onTabKeydown(event: KeyboardEvent): void {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
      return;
    }
    event.preventDefault();
    const next: PaneTab = this.tab() === 'body' ? 'history' : 'body';
    this.tab.set(next);
    const tablist = (event.currentTarget as HTMLElement | null)?.parentElement;
    tablist?.querySelector<HTMLElement>(`#rest-tab-${next}`)?.focus();
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
      (error) => this.alerts.error('Error while copying the response', error),
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
