import type { RestMethod } from './rest.utils';

/** Payload of the `rest` endpoint, used for path autocompletion and cURL. */
export interface RestIndexData {
  readonly host?: string;
  readonly indices?: readonly string[];
}

/** One entry of `rest/history` (most recent first). */
export interface RestHistoryEntry {
  readonly path: string;
  /** Unvalidated column: older clients may have stored other methods. */
  readonly method: string;
  readonly body: string;
  /** Server formatted as `dd/MM HH:mm:ss`. */
  readonly created_at: string;
}

/** The request being edited; persisted per browser (never credentials). */
export interface RestDraft {
  readonly method: RestMethod;
  readonly path: string;
  readonly body: string;
}

export type BodyState =
  | { readonly kind: 'empty' }
  | { readonly kind: 'json' }
  | { readonly kind: 'ndjson'; readonly lines: number }
  | { readonly kind: 'text'; readonly lines: number }
  | { readonly kind: 'invalid'; readonly message: string };

export type StatusTone = 'green' | 'blue' | 'yellow' | 'red' | 'gray';

/** What the response pane renders for the last executed request. */
export interface RestResponseView {
  /** The request exactly as the editor held it when it was sent. */
  readonly request: RestDraft;
  readonly method: RestMethod;
  readonly path: string;
  /** HTTP status reported by Elasticsearch; `null` when the server was unreachable. */
  readonly status: number | null;
  readonly text: string;
  readonly json: boolean;
  readonly elapsedMs: number;
  readonly bytes: number;
  readonly hint: string | null;
}

export interface QuickStart {
  readonly label: string;
  readonly method: RestMethod;
  readonly path: string;
  readonly body: string;
}
