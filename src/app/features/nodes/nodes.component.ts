import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { AlertService } from '../../core/alert.service';
import { ClusterApiService } from '../../core/cluster-api.service';
import { ConnectionService } from '../../core/connection.service';
import { DialogService } from '../../core/dialog.service';
import { failureMessage, readableReason } from '../../core/errors';
import { RefreshService } from '../../core/refresh.service';
import { EmptyStateComponent } from '../../shared/empty-state.component';
import { BytesPipe, DurationPipe, NumberPipe, PluralPipe } from '../../shared/format.pipes';
import { MenuComponent } from '../../shared/menu.component';
import { MeterComponent } from '../../shared/meter.component';
import { SearchInputComponent } from '../../shared/search-input.component';
import { createSort } from '../../shared/sort-state';
import { NodeSortField, NodesFilter, NodesNode } from './nodes.models';
import {
  attributeEntries,
  filterNodes,
  nodeRoles,
  prettyByteString,
  sortNodes,
  summarizeNodes,
} from './nodes.utils';

type RoleKey = 'master' | 'data' | 'ingest' | 'coordinating';

interface RoleFilter {
  readonly key: RoleKey;
  readonly label: string;
}

const ROLE_FILTERS: readonly RoleFilter[] = [
  { key: 'master', label: 'Master' },
  { key: 'data', label: 'Data' },
  { key: 'ingest', label: 'Ingest' },
  { key: 'coordinating', label: 'Coordinating' },
];

@Component({
  selector: 'cerebro-nodes',
  imports: [
    BytesPipe,
    DatePipe,
    DurationPipe,
    EmptyStateComponent,
    MenuComponent,
    MeterComponent,
    NumberPipe,
    PluralPipe,
    SearchInputComponent,
  ],
  templateUrl: './nodes.component.html',
  styleUrl: './nodes.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NodesComponent {
  private readonly api = inject(ClusterApiService);
  private readonly alerts = inject(AlertService);
  private readonly dialogs = inject(DialogService);
  private readonly refreshService = inject(RefreshService);
  private readonly connection = inject(ConnectionService);

  readonly roleFilters = ROLE_FILTERS;
  readonly nodes = signal<readonly NodesNode[] | undefined>(undefined);
  readonly loading = signal(false);
  readonly failed = signal(false);
  /** Sentence explaining the last failed load. */
  readonly loadError = signal<string | undefined>(undefined);
  /** Time of the last successful load, shown while a refresh fails. */
  readonly loadedAt = signal<number | null>(null);
  readonly name = signal('');
  readonly roles = signal<Readonly<Record<RoleKey, boolean>>>({
    master: true,
    data: true,
    ingest: true,
    coordinating: true,
  });
  // Resource columns are most useful with the busiest node first.
  readonly sort = createSort<NodeSortField>('name', { descendingFirst: (field) => field !== 'name' });
  readonly showInternalAttributes = signal(false);

  readonly filter = computed<NodesFilter>(() => ({ name: this.name(), ...this.roles() }));

  readonly visibleNodes = computed(() =>
    sortNodes(
      filterNodes(this.nodes() ?? [], this.filter()),
      this.sort.field(),
      this.sort.reverse(),
    ),
  );

  /** True while the name or role filters hide some nodes. */
  readonly filtered = computed(
    () => this.name().trim() !== '' || Object.values(this.roles()).some((enabled) => !enabled),
  );

  readonly summary = computed(() => summarizeNodes(this.nodes() ?? []));

  readonly roleCounts = computed<Readonly<Record<RoleKey, number>>>(() => {
    const nodes = this.nodes() ?? [];
    return {
      master: nodes.filter((node) => node.master).length,
      data: nodes.filter((node) => node.data).length,
      ingest: nodes.filter((node) => node.ingest).length,
      coordinating: nodes.filter((node) => node.coordinating).length,
    };
  });

  private loadSequence = 0;

  constructor() {
    effect(() => {
      this.refreshService.tick();
      if (this.connection.connected()) {
        void this.load();
      }
    });
  }

  async load(): Promise<void> {
    const sequence = ++this.loadSequence;
    this.loading.set(true);
    try {
      const nodes = await this.api.post<readonly NodesNode[]>('nodes');
      if (sequence === this.loadSequence) {
        this.nodes.set(nodes);
        this.loadedAt.set(Date.now());
        this.failed.set(false);
        this.loadError.set(undefined);
      }
    } catch (error: unknown) {
      if (sequence === this.loadSequence) {
        // A failed refresh keeps the last figures on screen, marked as stale.
        this.failed.set(true);
        this.loadError.set(readableReason(error));
        this.alerts.error(failureMessage('Could not load nodes', error), error);
      }
    } finally {
      if (sequence === this.loadSequence) {
        this.loading.set(false);
      }
    }
  }

  toggleRole(role: RoleKey): void {
    this.roles.update((roles) => ({ ...roles, [role]: !roles[role] }));
  }

  resetFilters(): void {
    this.name.set('');
    this.roles.set({ master: true, data: true, ingest: true, coordinating: true });
  }

  async showStats(node: NodesNode): Promise<void> {
    try {
      const stats = await this.api.post<unknown>('commons/get_node_stats', { node: node.id });
      this.dialogs.showJson(`${node.name} stats`, stats, node.host ?? node.id);
    } catch (error: unknown) {
      this.alerts.error(failureMessage(`Could not load stats for ${node.name}`, error), error);
    }
  }

  readonly roleBadges = nodeRoles;
  readonly bytesString = prettyByteString;

  attributes(node: NodesNode): readonly (readonly [string, string])[] {
    return attributeEntries(node.attributes, this.showInternalAttributes());
  }

  diskUsed(node: NodesNode): number | null {
    return node.disk ? node.disk.total - node.disk.available : null;
  }
}
