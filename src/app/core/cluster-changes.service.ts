import { effect, inject, Injectable } from '@angular/core';
import { AlertService } from './alert.service';
import { ClusterApiService } from './cluster-api.service';
import { ConnectionService } from './connection.service';
import { pluralize } from './format';
import { RefreshService } from './refresh.service';

export interface ClusterSnapshot {
  readonly cluster_name: string;
  readonly indices: readonly string[];
  readonly nodes: readonly string[];
}

export interface ClusterChangeSet {
  readonly joinedNodes: readonly string[];
  readonly leftNodes: readonly string[];
  readonly createdIndices: readonly string[];
  readonly deletedIndices: readonly string[];
}

function difference(
  current: readonly string[],
  previous: readonly string[],
): string[] {
  const previousValues = new Set(previous);
  return current.filter((value) => !previousValues.has(value));
}

export function detectClusterChanges(
  previous: ClusterSnapshot,
  current: ClusterSnapshot,
): ClusterChangeSet {
  return {
    joinedNodes: difference(current.nodes, previous.nodes),
    leftNodes: difference(previous.nodes, current.nodes),
    createdIndices: difference(current.indices, previous.indices),
    deletedIndices: difference(previous.indices, current.indices),
  };
}

@Injectable({ providedIn: 'root' })
export class ClusterChangesService {
  private readonly api = inject(ClusterApiService);
  private readonly alerts = inject(AlertService);
  private readonly connection = inject(ConnectionService);
  private readonly refresh = inject(RefreshService);

  private baseline: ClusterSnapshot | undefined;
  private requestSequence = 0;

  constructor() {
    effect(() => {
      const host = this.connection.host();
      this.refresh.tick();
      if (!host) {
        this.baseline = undefined;
        this.requestSequence += 1;
        return;
      }
      void this.poll(host);
    });
  }

  private async poll(expectedHost: string): Promise<void> {
    const sequence = ++this.requestSequence;
    try {
      const current = await this.api.post<ClusterSnapshot>('cluster_changes');
      if (
        sequence !== this.requestSequence ||
        expectedHost !== this.connection.host()
      ) {
        return;
      }

      const previous = this.baseline;
      this.baseline = current;
      if (!previous || previous.cluster_name !== current.cluster_name) {
        return;
      }

      const changes = detectClusterChanges(previous, current);
      this.notify(changes.joinedNodes, ['node', 'nodes'], 'joined the cluster', 'info');
      this.notify(changes.leftNodes, ['node', 'nodes'], 'left the cluster', 'warn');
      this.notify(changes.createdIndices, ['index', 'indices'], 'created', 'info');
      this.notify(changes.deletedIndices, ['index', 'indices'], 'deleted', 'warn');
    } catch {
      // Cluster-change notifications are best-effort and must not duplicate the
      // primary request error shown by ClusterApiService.
    }
  }

  private notify(
    values: readonly string[],
    [singular, plural]: readonly [string, string],
    what: string,
    level: 'info' | 'warn',
  ): void {
    if (values.length === 0) {
      return;
    }
    this.alerts[level](`${pluralize(values.length, singular, plural)} ${what}`, values.join(',\n'));
  }
}
