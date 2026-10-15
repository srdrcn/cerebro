import { elasticsearchReason } from '../../core/errors';
import { textMatcher } from '../../core/format';
import { isRecord } from '../../core/json';
import type {
  BodyState,
  QuickStart,
  RestDraft,
  RestHistoryEntry,
  StatusTone,
} from './rest.models';

export const REST_METHODS = ['GET', 'POST', 'PUT', 'DELETE'] as const;

export type RestMethod = (typeof REST_METHODS)[number];

export interface CurlRequest {
  readonly method: RestMethod;
  readonly host: string;
  readonly path: string;
  readonly body: string;
}

function pathname(path: string): string {
  return path.trim().split(/[?#]/, 1)[0]?.replace(/^\/+|\/+$/g, '') ?? '';
}

/**
 * APIs whose body is newline-delimited JSON: bulk and multi-search (also the
 * monitoring and fleet variants) and the ML anomaly detector data feed.
 * Query parameters are ignored while deciding the content type.
 */
export function isNdjsonPath(path: string): boolean {
  const name = pathname(path);
  return (
    /(?:^|\/)_(?:bulk|msearch(?:\/template)?)$/.test(name) ||
    /^_monitoring\/bulk$/.test(name) ||
    /(?:^|\/)_fleet\/_fleet_msearch$/.test(name) ||
    /^_ml\/anomaly_detectors\/[^/]+\/_data$/.test(name)
  );
}

/**
 * APIs that analyse arbitrary text (CSV, logs …): the body is sent verbatim
 * and is never validated or formatted.
 */
export function isRawTextPath(path: string): boolean {
  return /^_(?:text_structure\/find_structure|ml\/find_file_structure)$/.test(pathname(path));
}

/** Bodies sent as strings (NDJSON or plain text) rather than as a JSON value. */
export function isStringBodyPath(path: string): boolean {
  return isNdjsonPath(path) || isRawTextPath(path);
}

/**
 * Preserve NDJSON, plain text and malformed input as strings (the server then
 * forwards them verbatim as x-ndjson). Regular, valid JSON is sent as a JSON
 * value so the Play endpoint keeps its existing request contract.
 */
export function parseEditorBody(path: string, source: string): unknown {
  if (isStringBodyPath(path)) {
    return source;
  }

  try {
    return JSON.parse(source) as unknown;
  } catch {
    return source;
  }
}

export function formatNdjson(source: string): string {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');

  while (lines.at(-1)?.trim() === '') {
    lines.pop();
  }

  if (lines.length === 0) {
    return '';
  }

  const formatted = lines.map((line, index) => {
    if (line.trim() === '') {
      throw new SyntaxError(`Invalid blank NDJSON line ${index + 1}`);
    }
    try {
      return JSON.stringify(JSON.parse(line) as unknown);
    } catch {
      throw new SyntaxError(`Invalid JSON on NDJSON line ${index + 1}`);
    }
  });

  // Elasticsearch requires the final newline for bulk-style request bodies.
  return `${formatted.join('\n')}\n`;
}

export function formatEditorBody(path: string, source: string): string {
  if (isRawTextPath(path)) {
    return source;
  }
  try {
    if (isNdjsonPath(path)) {
      return formatNdjson(source);
    }
    return JSON.stringify(JSON.parse(source) as unknown, null, 2);
  } catch {
    return source;
  }
}

/** Quote one argument for a POSIX-compatible shell. */
export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function requestUrl(host: string, path: string): string {
  const normalizedHost = host.trim().replace(/\/+$/, '');
  const normalizedPath = path.trim().startsWith('/')
    ? path.trim()
    : `/${path.trim()}`;
  return `${normalizedHost}${encodeURI(normalizedPath)}`;
}

export function buildCurlCommand(request: CurlRequest): string {
  const ndjson = isNdjsonPath(request.path);
  const raw = isRawTextPath(request.path);
  const contentType = ndjson || raw
    ? 'application/x-ndjson'
    : 'application/json';
  const args = [
    'curl',
    '--request',
    request.method,
    '--header',
    shellQuote(`Content-Type: ${contentType}`),
    '--url',
    shellQuote(requestUrl(request.host, request.path)),
  ];

  if (isBlankBody(request.body)) {
    return args.join(' ');
  }

  let body: string;
  if (raw) {
    body = request.body;
  } else if (ndjson) {
    body = formatNdjson(request.body);
  } else {
    body = JSON.stringify(JSON.parse(request.body) as unknown, null, 2);
  }
  // GET and DELETE bodies are supported by Elasticsearch and must not be lost
  // when copying the request (notably GET /_search).
  args.push('--data-raw', shellQuote(body));

  return args.join(' ');
}

const CAT_APIS = [
  'aliases',
  'allocation',
  'count',
  'health',
  'indices',
  'master',
  'nodes',
  'pending_tasks',
  'plugins',
  'recovery',
  'shards',
  'snapshots',
  'tasks',
  'templates',
  'thread_pool',
] as const;

const AUTOCOMPLETE_PATHS: readonly string[] = [
  // The Play endpoint parses every response as JSON, so _cat needs format=json.
  ...CAT_APIS.map((api) => `_cat/${api}?format=json`),
  '_cluster/health',
  '_cluster/settings',
  '_cluster/state',
  '_cluster/stats',
  '_cluster/pending_tasks',
  '_cluster/allocation/explain',
  '_nodes',
  // _nodes/hot_threads is left out: it only answers with plain text.
  '_nodes/stats',
  '_aliases',
  '_analyze',
  '_bulk',
  '_count',
  '_index_template',
  '_mapping',
  '_reindex',
  '_snapshot',
  '_stats',
  '_tasks',
  '_template',
  '{index}/_alias',
  '{index}/_analyze',
  '{index}/_bulk',
  '{index}/_count',
  '{index}/_doc',
  '{index}/_mapping',
  '{index}/_refresh',
  '{index}/_stats',
  '{index}/_delete_by_query',
  '{index}/_update_by_query',
  '_msearch',
  '{index}/_msearch',
  '_msearch/template',
  '{index}/_msearch/template',
  '_search',
  '{index}/_search',
  '_search/template',
  '{index}/_search/template',
] as const;

function autocompleteCandidates(indices: readonly string[], path: string): string[] {
  const leadingSlash = path.startsWith('/');
  const value = leadingSlash ? path.slice(1) : path;
  const pathTokens = value.split('/');
  const tokenIndex = pathTokens.length - 1;
  const alternatives = new Set<string>();

  for (const definition of AUTOCOMPLETE_PATHS) {
    const suggestionTokens = definition.split('/');
    if (suggestionTokens.length <= tokenIndex) {
      continue;
    }

    const previousTokensMatch = pathTokens
      .slice(0, -1)
      .every((token, index) =>
        suggestionTokens[index] === '{index}'
          ? indices.includes(token)
          : suggestionTokens[index] === token,
      );
    if (!previousTokensMatch) {
      continue;
    }

    const token = suggestionTokens[tokenIndex];
    const suggestedTokens = token === '{index}' ? indices : [token];
    const prefix = pathTokens.slice(0, -1).join('/');
    for (const suggestedToken of suggestedTokens) {
      const candidate = `${prefix ? `${prefix}/` : ''}${suggestedToken}`;
      alternatives.add(leadingSlash ? `/${candidate}` : candidate);
    }
  }

  return [...alternatives].sort((left, right) => left.localeCompare(right));
}

/** The first ten candidates that start with what was typed. */
export function getAutocompleteOptions(
  indices: readonly string[],
  path: string,
): string[] {
  return autocompleteCandidates(indices, path)
    .filter((candidate) => candidate.startsWith(path))
    .slice(0, 10);
}

/** Size of the suggestion list while the first path segment is typed. */
const FIRST_SEGMENT_LIMIT = 12;
/** Indices kept in that list even when many API roots match. */
const FIRST_SEGMENT_INDICES = 6;

/**
 * Suggestions shown under the path input.
 *
 * - While the first segment is typed, API roots and index names share the
 *   list, so index names are offered even on an empty path.
 * - Once the path equals a suggestion (e.g. right after accepting
 *   `products` or `_cluster`), the next level is offered (`products/_search`)
 *   instead of an empty list.
 */
export function getPathSuggestions(indices: readonly string[], path: string): string[] {
  const value = path.startsWith('/') ? path.slice(1) : path;
  let options: string[];
  if (!value.includes('/')) {
    const all = autocompleteCandidates(indices, path).filter(
      (candidate) => candidate.startsWith(path) && candidate !== path,
    );
    const isApi = (candidate: string) => candidate.replace(/^\//, '').startsWith('_');
    const apis = all.filter(isApi);
    const names = all.filter((candidate) => !isApi(candidate));
    const nameCount = Math.min(
      names.length,
      Math.max(FIRST_SEGMENT_INDICES, FIRST_SEGMENT_LIMIT - apis.length),
    );
    options = [...apis.slice(0, FIRST_SEGMENT_LIMIT - nameCount), ...names.slice(0, nameCount)];
  } else {
    options = getAutocompleteOptions(indices, path).filter((option) => option !== path);
  }
  if (options.length === 0 && value !== '' && !path.endsWith('/')) {
    return getAutocompleteOptions(indices, `${path}/`);
  }
  return options;
}

export function responseText(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

function errorResponse(error: unknown): unknown {
  if (isRecord(error)) {
    if ('error' in error) {
      return error['error'];
    }
    if ('body' in error) {
      return error['body'];
    }
  }
  return error;
}

export function isBlankBody(source: string): boolean {
  return source.trim() === '';
}

/** Elasticsearch paths are sent without leading slashes (Play adds one). */
export function requestPath(path: string): string {
  return path.trim().replace(/^\/+/, '');
}

export interface RestRequestPayload {
  readonly method: RestMethod;
  readonly path: string;
  readonly data?: unknown;
  readonly [key: string]: unknown;
}

/**
 * Payload of `rest/request`. An empty editor sends no body at all, because
 * many GET APIs (_cat, _cluster/health …) reject requests that carry one.
 */
export function buildRequestPayload(draft: RestDraft): RestRequestPayload {
  const path = requestPath(draft.path);
  if (isBlankBody(draft.body)) {
    return { method: draft.method, path };
  }
  return { method: draft.method, path, data: parseEditorBody(path, draft.body) };
}

/** Describes the editor content: shown next to the body toolbar. */
export function describeBody(path: string, source: string): BodyState {
  if (isBlankBody(source)) {
    return { kind: 'empty' };
  }
  if (isRawTextPath(path)) {
    return { kind: 'text', lines: source.replace(/\r\n?/g, '\n').replace(/\n+$/, '').split('\n').length };
  }
  if (isNdjsonPath(path)) {
    try {
      const formatted = formatNdjson(source);
      return { kind: 'ndjson', lines: formatted.split('\n').length - 1 };
    } catch (error: unknown) {
      return { kind: 'invalid', message: parseErrorMessage(error) };
    }
  }
  try {
    JSON.parse(source);
    return { kind: 'json' };
  } catch (error: unknown) {
    return { kind: 'invalid', message: parseErrorMessage(error) };
  }
}

function parseErrorMessage(error: unknown): string {
  return elasticsearchReason(error) ?? String(error);
}

export function isRestMethod(value: unknown): value is RestMethod {
  return typeof value === 'string' && (REST_METHODS as readonly string[]).includes(value);
}

/** Validates a draft read back from localStorage. */
export function parseStoredDraft(candidate: unknown): RestDraft | null {
  if (
    !isRecord(candidate) ||
    !isRestMethod(candidate['method']) ||
    typeof candidate['path'] !== 'string' ||
    typeof candidate['body'] !== 'string'
  ) {
    return null;
  }
  return { method: candidate['method'], path: candidate['path'], body: candidate['body'] };
}

/** Very large bodies are not worth persisting (localStorage quota). */
export const MAX_STORED_BODY_LENGTH = 200_000;

export function draftForStorage(draft: RestDraft): RestDraft {
  return draft.body.length > MAX_STORED_BODY_LENGTH ? { ...draft, body: '' } : draft;
}

const STATUS_TEXT: Readonly<Record<number, string>> = {
  200: 'OK',
  201: 'Created',
  202: 'Accepted',
  204: 'No Content',
  301: 'Moved Permanently',
  302: 'Found',
  304: 'Not Modified',
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  406: 'Not Acceptable',
  408: 'Request Timeout',
  409: 'Conflict',
  413: 'Payload Too Large',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
  504: 'Gateway Timeout',
};

export function statusText(status: number | null): string {
  if (status === null) {
    return 'No response';
  }
  return STATUS_TEXT[status] ?? '';
}

export function statusTone(status: number | null): StatusTone {
  if (status === null) {
    return 'gray';
  }
  if (status >= 500) {
    return 'red';
  }
  if (status >= 400) {
    return 'yellow';
  }
  if (status >= 300) {
    return 'blue';
  }
  return status >= 200 ? 'green' : 'gray';
}

/** UTF-8 size of the (compact) response, close to what went over the wire. */
export function responseSize(value: unknown): number {
  let text: string;
  if (typeof value === 'string') {
    text = value;
  } else {
    try {
      text = JSON.stringify(value) ?? '';
    } catch {
      text = String(value);
    }
  }
  return new TextEncoder().encode(text).length;
}

/** True for the error Cerebro's server reports when a 2xx body is not JSON. */
function isPlainTextParseError(body: unknown): boolean {
  const error = isRecord(body) ? body['error'] : undefined;
  return typeof error === 'string' && /^(?:Unexpected character|Unrecognized token)/.test(error);
}

/** True when the path is a _cat request without `format=json`. */
export function isTextCatPath(path: string): boolean {
  const normalized = requestPath(path);
  return /^_cat(?:\/|$|\?)/.test(normalized) && !/[?&]format=json(?:&|$)/.test(normalized);
}

/** Explains common failures that are not obvious from the raw error. */
export function responseHint(path: string, status: number | null, body?: unknown): string | null {
  if (status === null) {
    return 'Cerebro could not reach its server. Check the connection and try again.';
  }
  if (status >= 500 && isTextCatPath(path)) {
    return 'The _cat APIs answer with plain text by default. Add ?format=json to the path.';
  }
  if (status >= 500 && isPlainTextParseError(body)) {
    return 'This API answered with plain text, which Cerebro cannot display. Use its format=json option if it has one.';
  }
  return null;
}

/** Bodies of history entries: `{}` is what the server stores for "no body". */
export function restoredBody(entry: Pick<RestHistoryEntry, 'path' | 'body'>): string {
  if (entry.body.trim() === '{}' || isBlankBody(entry.body)) {
    return '';
  }
  return formatEditorBody(entry.path, entry.body);
}

/** One line preview of a history body, or an empty string when there is none. */
export function bodyPreview(body: string, max = 90): string {
  const compact = body.replace(/\s+/g, ' ').trim();
  if (compact === '' || compact === '{}') {
    return '';
  }
  return compact.length > max ? `${compact.slice(0, max - 1)}…` : compact;
}

/** Compiles the history filter once into a test for many entries. */
export function historyMatcher(query: string): (entry: RestHistoryEntry) => boolean {
  const matches = textMatcher(query);
  return (entry) => matches(`${entry.method} ${entry.path} ${entry.body}`);
}

function sameRequest(left: RestHistoryEntry, right: RestHistoryEntry): boolean {
  return left.method === right.method && left.path === right.path && left.body === right.body;
}

/**
 * Adds a just-executed request on top of the history, removing an older
 * identical entry (the server de-duplicates the same way).
 */
export function prependHistoryEntry(
  history: readonly RestHistoryEntry[],
  entry: RestHistoryEntry,
): RestHistoryEntry[] {
  return [entry, ...history.filter((item) => !sameRequest(item, entry))];
}

/** The body as the server stores it in the history. */
export function historyBody(payload: RestRequestPayload): string {
  if (!('data' in payload) || payload.data === undefined) {
    return '{}';
  }
  return typeof payload.data === 'string' ? payload.data : JSON.stringify(payload.data);
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** Same `dd/MM HH:mm:ss` format as the server side history. */
export function historyTimestamp(date: Date): string {
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)} ${pad(date.getHours())}:${pad(
    date.getMinutes(),
  )}:${pad(date.getSeconds())}`;
}

/**
 * DELETE requests that drop whole indices (or match them by pattern) are
 * confirmed before they are sent. Returns the target, or null when the
 * request can be sent right away.
 */
export function destructiveDeleteTarget(method: RestMethod, path: string): string | null {
  if (method !== 'DELETE') {
    return null;
  }
  const pathname = requestPath(path).split(/[?#]/, 1)[0] ?? '';
  const segments = pathname.split('/').filter((segment) => segment !== '');
  const first = segments[0];
  // Only `DELETE <index pattern>` drops indices; sub-resources such as
  // `logs-*/_alias/x` or `logs-*/_doc/1` remove far less.
  if (first === undefined || segments.length !== 1) {
    return null;
  }
  return first === '_all' || !first.startsWith('_') ? first : null;
}

export const QUICK_STARTS: readonly QuickStart[] = [
  { label: 'Cluster health', method: 'GET', path: '_cluster/health', body: '' },
  {
    label: 'List indices',
    method: 'GET',
    path: '_cat/indices?format=json&bytes=b',
    body: '',
  },
  {
    label: 'Search everything',
    method: 'GET',
    path: '_search',
    body: '{\n  "query": {\n    "match_all": {}\n  },\n  "size": 10\n}',
  },
  { label: 'Node stats', method: 'GET', path: '_nodes/stats/jvm,os', body: '' },
];

/** "184 ms", "1.24 s", "1m 05s" — elapsed time of a request. */
export function formatElapsed(milliseconds: number): string {
  const ms = Math.max(0, Math.round(milliseconds));
  if (ms < 1000) {
    return `${ms} ms`;
  }
  if (ms < 60_000) {
    return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;
  }
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1000);
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}

export interface SuggestionParts {
  /** The part the user already typed. */
  readonly typed: string;
  /** The completion that would be inserted. */
  readonly completion: string;
}

/** Splits an autocomplete option into the typed prefix and its completion. */
export function suggestionParts(option: string, typed: string): SuggestionParts {
  if (option.startsWith(typed)) {
    return { typed, completion: option.slice(typed.length) };
  }
  return { typed: '', completion: option };
}

/** Moves a keyboard highlight through `length` options, wrapping around. */
export function wrapIndex(current: number, delta: number, length: number): number {
  if (length <= 0) {
    return -1;
  }
  if (current < 0) {
    return delta >= 0 ? 0 : length - 1;
  }
  return (((current + delta) % length) + length) % length;
}

/** Text shown in the response pane when Cerebro's server could not be reached. */
export function networkErrorText(error: unknown): string {
  if (isRecord(error) && error['status'] === 0) {
    return "The request did not reach Cerebro's server (network error).";
  }
  if (isRecord(error)) {
    const details = 'error' in error || 'body' in error ? errorResponse(error) : undefined;
    if (typeof details === 'string' && details.trim() !== '') {
      return details;
    }
    if (typeof details === 'object' && details !== null && !(details instanceof Event)) {
      const text = responseText(details);
      if (text !== '{}') {
        return text;
      }
    }
    if (typeof error['message'] === 'string') {
      return error['message'];
    }
  }
  return typeof error === 'string' && error !== '' ? error : 'The request could not be sent.';
}

/** The host as shown in front of the path input ("localhost:9200/"). */
export function hostPrefix(host: string): string {
  const trimmed = host.trim().replace(/\/+$/, '');
  if (trimmed === '') {
    return '';
  }
  return `${trimmed.replace(/^https?:\/\//, '')}/`;
}

/** Adds `format=json` to a path's query string (used to fix _cat requests). */
export function withJsonFormat(path: string): string {
  const trimmed = path.trim();
  if (/[?&]format=json(?:&|$)/.test(trimmed)) {
    return trimmed;
  }
  if (/[?&]format=[^&]*/.test(trimmed)) {
    return trimmed.replace(/([?&])format=[^&]*/, '$1format=json');
  }
  if (!trimmed.includes('?')) {
    return `${trimmed}?format=json`;
  }
  return trimmed.endsWith('?') || trimmed.endsWith('&')
    ? `${trimmed}format=json`
    : `${trimmed}&format=json`;
}
