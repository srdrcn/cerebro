import { describe, expect, it } from 'vitest';
import { unassignedReason } from './shards';

describe('unassignedReason', () => {
  it('labels and explains the reasons Elasticsearch reports', () => {
    expect(unassignedReason('NODE_LEFT')).toEqual({
      label: 'Node left',
      text: 'The node holding this copy left the cluster.',
    });
    expect(unassignedReason('allocation_failed').label).toBe('Allocation failed');
  });

  it('falls back to a readable label for unknown or missing reasons', () => {
    expect(unassignedReason('SOMETHING_NEW')).toEqual({ label: 'Something new', text: '' });
    expect(unassignedReason(undefined)).toEqual({ label: 'Unknown', text: '' });
  });
});
