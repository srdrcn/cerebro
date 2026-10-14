import { describe, expect, it } from 'vitest';
import { ClusterApiError } from './api-envelope';
import { elasticsearchReason, failureMessage } from './errors';

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
