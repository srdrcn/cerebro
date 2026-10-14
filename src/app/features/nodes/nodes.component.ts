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
import { pluralize } from '../../core/format';
import { RefreshService } from '../../core/refresh.service';
import { EmptyStateComponent } from '../../shared/empty-state.component';
import { BytesPipe, DurationPipe } from '../../shared/format.pipes';
import { MenuComponent } from '../../shared/menu.component';
import { MeterComponent } from '../../shared/meter.component';
import { SearchInputComponent } from '../../shared/search-input.component';
import { createSort } from '../../shared/sort-state';
import { NodeSortField, NodesFilter, NodesNode } from './nodes.models';
import {
  attributeEntries,
  matchesNode,
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
    DurationPipe,
    EmptyStateComponent,
    MenuComponent,
    MeterComponent,
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
      (this.nodes() ?? []).filter((node) => matchesNode(node, this.filter())),
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
        this.failed.set(false);
      }
    } catch (error: unknown) {
      if (sequence === this.loadSequence) {
        this.failed.set(true);
        this.alerts.error('Could not load nodes', error);
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
      this.alerts.error(`Could not load stats for ${node.name}`, error);
    }
  }

  readonly roleBadges = nodeRoles;
  readonly bytesString = prettyByteString;
  readonly pluralize = pluralize;

  attributes(node: NodesNode): readonly (readonly [string, string])[] {
    return attributeEntries(node.attributes, this.showInternalAttributes());
  }

  diskUsed(node: NodesNode): number | null {
    return node.disk ? node.disk.total - node.disk.available : null;
  }
}
