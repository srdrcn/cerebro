import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AlertService } from '../../core/alert.service';
import { ClusterApiService } from '../../core/cluster-api.service';
import { ConnectionService } from '../../core/connection.service';
import { RefreshService } from '../../core/refresh.service';
import { NodeSortField, NodesFilter, NodesNode } from './nodes.models';
import {
  formatNodeBytes,
  formatUptime,
  matchesNode,
  sortNodes,
} from './nodes.utils';

@Component({
  selector: 'cerebro-nodes',
  imports: [CommonModule, FormsModule],
  templateUrl: './nodes.component.html',
  styleUrl: './nodes.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NodesComponent {
  private readonly api = inject(ClusterApiService);
  private readonly alerts = inject(AlertService);
  private readonly refreshService = inject(RefreshService);
  private readonly connection = inject(ConnectionService);

  readonly nodes = signal<readonly NodesNode[] | undefined>(undefined);
  readonly loading = signal(false);
  readonly name = signal('');
  readonly master = signal(true);
  readonly data = signal(true);
  readonly ingest = signal(true);
  readonly coordinating = signal(true);
  readonly sortField = signal<NodeSortField>('name');
  readonly reverse = signal(false);

  readonly filter = computed<NodesFilter>(() => ({
    name: this.name(),
    master: this.master(),
    data: this.data(),
    ingest: this.ingest(),
    coordinating: this.coordinating(),
  }));

  readonly visibleNodes = computed(() =>
    sortNodes(
      (this.nodes() ?? []).filter((node) => matchesNode(node, this.filter())),
      this.sortField(),
      this.reverse(),
    ),
  );

  private loadSequence = 0;

  constructor() {
    effect(() => {
      this.refreshService.tick();
      if (this.connection.connected()) {
        void this.load();
      } else {
        this.reset();
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
      }
    } catch (error: unknown) {
      if (sequence === this.loadSequence) {
        this.nodes.set(undefined);
        this.alerts.error('Error while loading nodes data', error);
      }
    } finally {
      if (sequence === this.loadSequence) {
        this.loading.set(false);
      }
    }
  }

  setSortBy(field: NodeSortField): void {
    if (this.sortField() === field) {
      this.reverse.update((value) => !value);
    }
    this.sortField.set(field);
  }

  ariaSort(field: NodeSortField): 'ascending' | 'descending' | 'none' {
    if (this.sortField() !== field) {
      return 'none';
    }
    return this.reverse() ? 'descending' : 'ascending';
  }

  requestRefresh(): void {
    this.refreshService.refresh();
  }

  uptime(value: number): string {
    return formatUptime(value);
  }

  bytes(value: number): string {
    return formatNodeBytes(value);
  }

  attributeEntries(
    attributes: Readonly<Record<string, unknown>>,
  ): readonly (readonly [string, string])[] {
    return Object.entries(attributes).map(
      ([name, value]) => [name, String(value)] as const,
    );
  }

  private reset(): void {
    this.loadSequence += 1;
    this.nodes.set(undefined);
    this.loading.set(false);
  }
}
