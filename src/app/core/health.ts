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
