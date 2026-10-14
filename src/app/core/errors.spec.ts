import { describe, expect, it } from 'vitest';
import { ClusterApiError } from './api-envelope';
import { elasticsearchReason, failureMessage, isUnknownEndpoint, readableReason } from './errors';

describe('elasticsearchReason', () => {
  it('prefers the root cause over the generic top level reason', () => {
    const body = {
      error: {
        type: 'repository_exception',
        reason: '[backups] failed to create repository',
        root_cause: [{ type: 'repository_exception', reason: '[backups] location is not registered' }],
      },
      status: 500,
    };
    expect(elasticsearchReason(new ClusterApiError(500, body))).toBe('[backups] location is not registered');
  });

  it('follows caused_by and strips parser positions', () => {
    expect(
      elasticsearchReason({
        error: { reason: 'failed to parse', caused_by: { reason: '[1:40] unknown field [polcy]' } },
      }),
    ).toBe('unknown field [polcy]');
  });

  it('reads string bodies, plain strings and Error messages', () => {
    expect(elasticsearchReason(new ClusterApiError(404, 'Not Found'))).toBe('Not Found');
    expect(elasticsearchReason({ error: 'index_not_found_exception' })).toBe('index_not_found_exception');
    expect(elasticsearchReason('  boom  ')).toBe('boom');
    expect(elasticsearchReason(new Error('offline'))).toBe('offline');
  });

  it('ignores HTML error pages and the generic request failure message', () => {
    expect(elasticsearchReason(new ClusterApiError(502, '<!DOCTYPE html><html><body>Bad gateway</body></html>'))).toBeNull();
    expect(elasticsearchReason('<html><head></head></html>')).toBeNull();
    expect(elasticsearchReason(new ClusterApiError(500, { status: 500 }))).toBeNull();
    expect(failureMessage('Could not load nodes', new ClusterApiError(500, null))).toBe('Could not load nodes');
  });

  it('returns null when there is nothing readable', () => {
    expect(elasticsearchReason(undefined)).toBeNull();
    expect(elasticsearchReason({ status: 0 })).toBeNull();
    expect(elasticsearchReason(42)).toBeNull();
  });
});

describe('failureMessage', () => {
  it('appends the reason to the action when there is one', () => {
    expect(failureMessage('Could not delete index', { error: { reason: 'no such index [logs]' } })).toBe(
      'Could not delete index: no such index [logs]',
    );
    expect(failureMessage('Could not delete index', null)).toBe('Could not delete index');
  });
});

describe('readableReason', () => {
  it('capitalizes the reason or returns undefined', () => {
    expect(readableReason({ error: { reason: 'no such index [logs]' } })).toBe('No such index [logs]');
    expect(readableReason(null)).toBeUndefined();
  });
});

describe('isUnknownEndpoint', () => {
  it('recognises an Elasticsearch that does not know the endpoint', () => {
    expect(isUnknownEndpoint(new ClusterApiError(404, {}))).toBe(true);
    expect(isUnknownEndpoint(new ClusterApiError(405, 'Method Not Allowed'))).toBe(true);
    expect(isUnknownEndpoint(new ClusterApiError(400, { error: 'no handler found for uri [/_component_template]' }))).toBe(true);
    expect(isUnknownEndpoint(new ClusterApiError(400, { error: 'Incorrect HTTP method for uri [/_data_stream]' }))).toBe(true);
  });

  it('matches the invalid index name answer only for the listed endpoints', () => {
    const oldCluster = new ClusterApiError(400, {
      error: { root_cause: [{ reason: "Invalid index name [_index_template], must not start with '_'." }] },
    });
    expect(isUnknownEndpoint(oldCluster, ['_index_template', '_component_template'])).toBe(true);
    expect(isUnknownEndpoint(oldCluster, ['_data_stream'])).toBe(false);
    expect(isUnknownEndpoint(oldCluster)).toBe(false);
  });

  it('does not blame the version for an unreachable or refusing cluster', () => {
    expect(isUnknownEndpoint(new ClusterApiError(500, { error: 'Connection refused: localhost/127.0.0.1:9299' }))).toBe(false);
    expect(isUnknownEndpoint(new ClusterApiError(403, { error: { reason: 'action is unauthorized' } }))).toBe(false);
    expect(isUnknownEndpoint(new Error('network'))).toBe(false);
  });
});
