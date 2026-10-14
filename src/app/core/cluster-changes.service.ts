import { DestroyRef, effect, inject, Injectable } from '@angular/core';
import { AlertService } from './alert.service';
import { ClusterApiService } from './cluster-api.service';
import { ConnectionService } from './connection.service';
import { pluralize } from './format';
import { stringList } from './json';
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

/** Changes the user is making in this app, left out of the notifications. */
export interface ExpectedChanges {
  readonly created?: readonly string[];
  readonly deleted?: readonly string[];
  /** Indices are being created under names not known in advance (snapshot restore). */
  readonly createdUnknown?: boolean;
}

/** How long a named expectation waits for the change to show up. */
const EXPECTED_CHANGE_TTL_MS = 120_000;
/** How long index creations are not reported after a restore started. */
const UNKNOWN_CREATIONS_TTL_MS = 30_000;

function indexNames(value: unknown): string[] {
  return stringList(value)
    .flatMap((names) => names.split(','))
    .map((name) => name.trim())
    .filter(Boolean);
}

/** The index changes a successful Play endpoint call makes, if any. */
export function expectedChangesFor(
  path: string,
  data: Readonly<Record<string, unknown>>,
): ExpectedChanges | undefined {
  switch (path) {
    case 'overview/delete_indices':
      return { deleted: indexNames(data['indices']) };
    case 'create_index/create':
      return { created: indexNames(data['index']) };
    case 'snapshots/restore':
      return { createdUnknown: true };
    default:
      return undefined;
  }
}

/**
 * Remembers the user's own index creations and deletions until the change
 * detection sees them, so they are not announced a second time.
 */
export class ExpectedChangeLedger {
  private readonly created = new Map<string, number>();
  private readonly deleted = new Map<string, number>();
  private unknownCreationsUntil = 0;

  constructor(private readonly now: () => number = Date.now) {}

  expect(changes: ExpectedChanges): void {
    const now = this.now();
    for (const name of changes.created ?? []) {
      this.created.set(name, now + EXPECTED_CHANGE_TTL_MS);
    }
    for (const name of changes.deleted ?? []) {
      this.deleted.set(name, now + EXPECTED_CHANGE_TTL_MS);
    }
    if (changes.createdUnknown) {
      this.unknownCreationsUntil = now + UNKNOWN_CREATIONS_TTL_MS;
    }
  }

  /** The change set without the expected changes (which are then forgotten). */
  filter(changes: ClusterChangeSet): ClusterChangeSet {
    const now = this.now();
    this.prune(this.created, now);
    this.prune(this.deleted, now);
    const createdIndices =
      this.unknownCreationsUntil > now
        ? []
        : changes.createdIndices.filter((name) => !this.created.delete(name));
    const deletedIndices = changes.deletedIndices.filter((name) => !this.deleted.delete(name));
    return { ...changes, createdIndices, deletedIndices };
  }

  clear(): void {
    this.created.clear();
    this.deleted.clear();
    this.unknownCreationsUntil = 0;
  }

  private prune(expectations: Map<string, number>, now: number): void {
    for (const [name, expiry] of expectations) {
      if (expiry <= now) {
        expectations.delete(name);
      }
    }
  }
}

/**
 * Compares the cluster on every refresh tick and announces nodes that joined
 * or left and indices created or deleted outside this app. Index changes made
 * through the app (see `expectedChangesFor`, or `expect()` for others) are
 * already confirmed by the page and are not announced again.
 */
@Injectable({ providedIn: 'root' })
export class ClusterChangesService {
  private readonly api = inject(ClusterApiService);
  private readonly alerts = inject(AlertService);
  private readonly connection = inject(ConnectionService);
  private readonly refresh = inject(RefreshService);

  private readonly ownChanges = new ExpectedChangeLedger();

  private baseline: ClusterSnapshot | undefined;
  private requestSequence = 0;

  constructor() {
    effect(() => {
      const host = this.connection.host();
      this.refresh.tick();
      if (!host) {
        this.baseline = undefined;
        this.ownChanges.clear();
        this.requestSequence += 1;
        return;
      }
      void this.poll(host);
    });

    const stopListening = this.api.onSuccess(({ path, data }) => {
      const changes = expectedChangesFor(path, data);
      if (changes) {
        this.expect(changes);
      }
    });
    inject(DestroyRef).onDestroy(stopListening);
  }

  /** Leaves the user's own index changes out of the next notifications. */
  expect(changes: ExpectedChanges): void {
    this.ownChanges.expect(changes);
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

      const changes = this.ownChanges.filter(detectClusterChanges(previous, current));
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
