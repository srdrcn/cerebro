export interface CerebroEnvelope<T> {
  readonly status: number;
  readonly body: T;
}

export function isSuccessfulEnvelope(
  envelope: CerebroEnvelope<unknown>,
): boolean {
  return envelope.status >= 200 && envelope.status < 300;
}

export class ClusterApiError<T = unknown> extends Error {
  constructor(
    readonly status: number,
    readonly body: T,
  ) {
    super(`Cerebro request failed with status ${status}`);
    this.name = 'ClusterApiError';
  }
}

export class NoClusterConnectionError extends Error {
  constructor() {
    super('No Elasticsearch host is connected');
    this.name = 'NoClusterConnectionError';
  }
}
