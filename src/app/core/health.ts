/** Elasticsearch health colours ("green", "YELLOW", …) as badge tones and labels. */

export type HealthTone = 'green' | 'yellow' | 'red' | 'gray';

/** Case-insensitive; anything that is not a known colour is "gray". */
export function healthTone(status: unknown): HealthTone {
  switch (typeof status === 'string' ? status.trim().toLowerCase() : '') {
    case 'green':
      return 'green';
    case 'yellow':
      return 'yellow';
    case 'red':
      return 'red';
    default:
      return 'gray';
  }
}

const HEALTH_LABELS: Readonly<Record<HealthTone, string>> = {
  green: 'Green',
  yellow: 'Yellow',
  red: 'Red',
  gray: 'Unknown',
};

/** "Green", "Yellow", "Red" or "Unknown". */
export function healthLabel(status: unknown): string {
  return HEALTH_LABELS[healthTone(status)];
}

/** A shard copy as far as its health is concerned (`_cat/shards` rows). */
export interface ShardCopyState {
  readonly primary: boolean;
  /** `STARTED`, `RELOCATING`, `INITIALIZING` or `UNASSIGNED` (any case). */
  readonly state: string;
}

/**
 * Index health from its shard copies, by Elasticsearch's rules, for when the
 * index statistics do not say it: red while a primary is not active
 * (unassigned or initializing), yellow while a replica is not, green
 * otherwise (a relocating copy is active). `gray` without copies.
 */
export function healthFromShardCopies(copies: readonly ShardCopyState[]): HealthTone {
  if (copies.length === 0) {
    return 'gray';
  }
  const inactive = (copy: ShardCopyState) => {
    const state = copy.state.trim().toLowerCase();
    return state === 'unassigned' || state === 'initializing';
  };
  if (copies.some((copy) => copy.primary && inactive(copy))) {
    return 'red';
  }
  return copies.some(inactive) ? 'yellow' : 'green';
}
