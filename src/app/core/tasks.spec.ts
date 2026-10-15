import { describe, expect, it } from 'vitest';
import { cancelFailure } from './tasks';

describe('cancelFailure', () => {
  it('is null when the task was cancelled', () => {
    expect(cancelFailure({ nodes: {} })).toBeNull();
    expect(cancelFailure({ node_failures: [], task_failures: [] })).toBeNull();
    expect(cancelFailure('nope')).toBeNull();
  });

  it('reads the reason of a 200 answer that cancelled nothing', () => {
    expect(
      cancelFailure({ task_failures: [{ task_id: 9, reason: { type: 'illegal_argument_exception', reason: 'task is not cancellable' } }] }),
    ).toBe('Task is not cancellable');
    // What Elasticsearch 8 answers (HTTP 200) for a task that no longer runs.
    expect(
      cancelFailure({
        node_failures: [
          {
            type: 'failed_node_exception',
            reason: 'Failed node [I7MELLk0RvSiAPhRW6211Q]',
            node_id: 'I7MELLk0RvSiAPhRW6211Q',
            caused_by: { type: 'resource_not_found_exception', reason: 'task [I7MELLk0RvSiAPhRW6211Q:999999999] is not found' },
          },
        ],
        nodes: {},
      }),
    ).toBe('Task [I7MELLk0RvSiAPhRW6211Q:999999999] is not found');
    expect(cancelFailure({ node_failures: [{ type: 'failed_node_exception', caused_by: { reason: 'node left' } }] })).toBe('Node left');
    expect(cancelFailure({ node_failures: [{}] })).toBe('Elasticsearch reported a failure while cancelling the task.');
  });
});
