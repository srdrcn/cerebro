import { ClusterApiError } from './api-envelope';
import { sentence } from './format';
import { isRecord } from './json';

const MAX_DEPTH = 6;

/**
 * The most specific human readable reason of a failed request, or `null`.
 *
 * Accepts what pages catch: a `ClusterApiError` (reason read from its `body`),
 * an Elasticsearch error body (`{ error: { root_cause, caused_by, reason } }`),
 * a plain string or an `Error`. The root cause is preferred over generic
 * wrappers such as "failed to create repository", and parser positions such
 * as "[1:40] " are removed. HTML error pages (a proxy or a server that is not
 * Elasticsearch) and the generic `ClusterApiError` message are not reasons.
 */
export function elasticsearchReason(error: unknown): string | null {
  return reasonOf(error, 0);
}

/** The reason as a sentence of its own ("No such index [logs]"), for error states. */
export function readableReason(error: unknown): string | undefined {
  const reason = elasticsearchReason(error);
  return reason ? sentence(reason) : undefined;
}

/**
 * Whether a failed request reached an Elasticsearch that does not know the
 * endpoint (an older version): 404/405, "no handler found", "incorrect HTTP
 * method", or a path such as `_data_stream` read as an invalid index name.
 * An unreachable host or a missing privilege is not an unknown endpoint, so
 * pages only add their "needs Elasticsearch x.y" hint when this is true.
 *
 * `endpoints` lists the path segments (`'_data_stream'`) an old cluster
 * rejects as "Invalid index name [_data_stream]".
 */
export function isUnknownEndpoint(error: unknown, endpoints: readonly string[] = []): boolean {
  if (error instanceof ClusterApiError && (error.status === 404 || error.status === 405)) {
    return true;
  }
  const reason = elasticsearchReason(error) ?? '';
  if (/no handler found|incorrect HTTP method/i.test(reason)) {
    return true;
  }
  const lower = reason.toLowerCase();
  return endpoints.some((endpoint) => lower.includes(`index name [${endpoint.toLowerCase()}]`));
}

/** "Could not delete index: no such index [logs]", or just the action. */
export function failureMessage(action: string, error: unknown): string {
  const reason = elasticsearchReason(error);
  return reason ? `${action}: ${reason}` : action;
}

function reasonOf(value: unknown, depth: number): string | null {
  if (depth > MAX_DEPTH || value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'string') {
    const text = value.replace(/^\[\d+:\d+\]\s*/, '').trim();
    return text && !/^<(!doctype|html|head|body)\b/i.test(text) ? text : null;
  }
  if (!isRecord(value) && !(value instanceof Error)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const rootCause = record['root_cause'];
  for (const candidate of [
    Array.isArray(rootCause) ? rootCause[0] : undefined,
    record['caused_by'],
    record['reason'],
    record['error'],
    record['body'],
  ]) {
    const reason = reasonOf(candidate, depth + 1);
    if (reason) {
      return reason;
    }
  }
  return value instanceof Error && !(value instanceof ClusterApiError) && value.message
    ? value.message
    : null;
}
