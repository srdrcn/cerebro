import { humanize } from './format';

/** Why a shard copy is unassigned (`unassigned.reason`), in words. */
export interface UnassignedReason {
  readonly label: string;
  readonly text: string;
}

const UNASSIGNED_REASONS: Readonly<Record<string, UnassignedReason>> = {
  INDEX_CREATED: { label: 'Index created', text: 'The index was just created and this copy has not been allocated yet.' },
  CLUSTER_RECOVERED: { label: 'Cluster recovered', text: 'The cluster restarted (full cluster recovery) and this copy has not been allocated since.' },
  INDEX_REOPENED: { label: 'Index reopened', text: 'The index was reopened after being closed.' },
  DANGLING_INDEX_IMPORTED: { label: 'Dangling index imported', text: 'A dangling index was imported into the cluster.' },
  NEW_INDEX_RESTORED: { label: 'Restored into a new index', text: 'A snapshot was restored into a new index.' },
  EXISTING_INDEX_RESTORED: { label: 'Restored into an existing index', text: 'A snapshot was restored into a closed index.' },
  REPLICA_ADDED: { label: 'Replica added', text: 'The number of replicas was increased.' },
  ALLOCATION_FAILED: { label: 'Allocation failed', text: 'A previous attempt to allocate this copy failed.' },
  NODE_LEFT: { label: 'Node left', text: 'The node holding this copy left the cluster.' },
  NODE_RESTARTING: { label: 'Node restarting', text: 'The node holding this copy is restarting (registered with the node shutdown API).' },
  REROUTE_CANCELLED: { label: 'Reroute cancelled', text: 'A reroute command explicitly cancelled this copy.' },
  REINITIALIZED: { label: 'Reinitialized', text: 'The copy went back from started to initializing.' },
  REALLOCATED_REPLICA: { label: 'Replica reallocated', text: 'A better location was found, so the existing replica allocation was cancelled.' },
  PRIMARY_FAILED: { label: 'Primary failed', text: 'The primary failed while this replica was initializing.' },
  FORCED_EMPTY_PRIMARY: { label: 'Forced empty primary', text: 'An empty primary was forcibly allocated.' },
  MANUAL_ALLOCATION: { label: 'Manual allocation', text: 'The copy was allocated manually with the reroute API.' },
  INDEX_CLOSED: { label: 'Index closed', text: 'The index was closed.' },
};

export function unassignedReason(reason: string | null | undefined): UnassignedReason {
  const key = (reason ?? '').toUpperCase();
  return UNASSIGNED_REASONS[key] ?? { label: humanize(key) || 'Unknown', text: '' };
}
