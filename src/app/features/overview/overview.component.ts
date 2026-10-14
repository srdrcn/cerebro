import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AlertService } from '../../core/alert.service';
import { ClusterApiService } from '../../core/cluster-api.service';
import { ConnectionService } from '../../core/connection.service';
import { ModalService } from '../../core/modal.service';
import { RefreshService } from '../../core/refresh.service';
import {
  IndexOperation,
  JsonEndpoint,
  OverviewData,
  OverviewIndex,
  OverviewIndexFilter,
  OverviewNode,
  OverviewShard,
} from './overview.models';
import {
  buildBulkIndicesPayload,
  canReceiveShard,
  filterOverviewIndices,
  formatBytes,
  isSameShard,
  matchesOverviewNode,
} from './overview.utils';

interface OperationDefinition {
  readonly path: string;
  readonly singlePrompt: (name: string) => string;
  readonly bulkPrompt: (count: number) => string;
}

const OPERATIONS: Readonly<Record<IndexOperation, OperationDefinition>> = {
  open: {
    path: 'overview/open_indices',
    singlePrompt: (name) => `Open ${name}?`,
    bulkPrompt: (count) => `Open all ${count} selected indices?`,
  },
  close: {
    path: 'overview/close_indices',
    singlePrompt: (name) => `Close ${name}?`,
    bulkPrompt: (count) => `Close all ${count} selected indices?`,
  },
  merge: {
    path: 'overview/force_merge',
    singlePrompt: (name) => `Optimize index ${name}?`,
    bulkPrompt: (count) => `Optimize all ${count} selected indices?`,
  },
  refresh: {
    path: 'overview/refresh_indices',
    singlePrompt: (name) => `Refresh index ${name}?`,
    bulkPrompt: (count) => `Refresh all ${count} selected indices?`,
  },
  flush: {
    path: 'overview/flush_indices',
    singlePrompt: (name) => `Flush index ${name}?`,
    bulkPrompt: (count) => `Flush all ${count} selected indices?`,
  },
  cache: {
    path: 'overview/clear_indices_cache',
    singlePrompt: (name) => `Clear ${name} cache?`,
    bulkPrompt: (count) =>
      `Clear all ${count} selected indices cache?`,
  },
  delete: {
    path: 'overview/delete_indices',
    singlePrompt: (name) => `Delete ${name}?`,
    bulkPrompt: (count) => `Delete all ${count} selected indices?`,
  },
};

@Component({
  selector: 'cerebro-overview',
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './overview.component.html',
  styleUrl: './overview.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OverviewComponent {
  private readonly api = inject(ClusterApiService);
  private readonly alerts = inject(AlertService);
  private readonly modal = inject(ModalService);
  private readonly refreshService = inject(RefreshService);
  readonly connection = inject(ConnectionService);

  readonly data = signal<OverviewData | undefined>(undefined);
  readonly loading = signal(false);
  readonly expandedView = signal(false);
  readonly relocatingShard = signal<OverviewShard | undefined>(undefined);

  readonly indexName = signal('');
  readonly includeClosed = signal(false);
  readonly includeSpecial = signal(false);
  readonly includeHealthy = signal(true);
  readonly ascending = signal(true);
  readonly nodeName = signal('');

  readonly pageNumber = signal(1);
  readonly pageSize = signal(1);

  readonly indexFilter = computed<OverviewIndexFilter>(() => ({
    name: this.indexName(),
    closed: this.includeClosed(),
    special: this.includeSpecial(),
    healthy: this.includeHealthy(),
    ascending: this.ascending(),
  }));

  readonly filteredIndices = computed(() =>
    filterOverviewIndices(this.data()?.indices ?? [], this.indexFilter()),
  );

  readonly pageCount = computed(() =>
    Math.max(Math.ceil(this.filteredIndices().length / this.pageSize()), 1),
  );

  readonly currentPage = computed(() =>
    Math.min(this.pageNumber(), this.pageCount()),
  );

  readonly pageIndices = computed(() => {
    const start = (this.currentPage() - 1) * this.pageSize();
    return this.filteredIndices().slice(start, start + this.pageSize());
  });

  readonly firstVisibleIndex = computed(() =>
    this.filteredIndices().length === 0
      ? 0
      : (this.currentPage() - 1) * this.pageSize() + 1,
  );

  readonly lastVisibleIndex = computed(() =>
    Math.min(
      this.currentPage() * this.pageSize(),
      this.filteredIndices().length,
    ),
  );

  readonly visibleNodes = computed(() => {
    const filter = {
      name: this.nodeName(),
      data: true,
      master: false,
      ingest: false,
      coordinating: false,
    };
    return (this.data()?.nodes ?? [])
      .filter((node) => matchesOverviewNode(node, filter))
      .sort((left, right) => left.name.localeCompare(right.name));
  });

  readonly totalShards = computed(() => {
    const data = this.data();
    return data
      ? data.active_shards +
          data.initializing_shards +
          data.relocating_shards +
          data.unassigned_shards
      : 0;
  });

  private loadSequence = 0;

  constructor() {
    effect(() => {
      this.refreshService.tick();
      if (this.connection.connected()) {
        void this.load();
      } else {
        this.resetData();
      }
    });
    this.updatePageSize();
  }

  @HostListener('window:resize')
  updatePageSize(): void {
    this.pageSize.set(Math.max(Math.round(window.innerWidth / 280), 1));
    this.clampPage();
  }

  async load(): Promise<void> {
    const sequence = ++this.loadSequence;
    this.loading.set(true);
    try {
      const data = await this.api.post<OverviewData>('overview');
      if (sequence !== this.loadSequence) {
        return;
      }
      this.data.set(data);
      if (
        data.unassigned_shards === 0 &&
        data.relocating_shards === 0 &&
        data.initializing_shards === 0
      ) {
        this.includeHealthy.set(true);
      }
      this.clampPage();
    } catch (error: unknown) {
      if (sequence !== this.loadSequence) {
        return;
      }
      this.resetData();
      this.alerts.error('Error while loading data', error);
    } finally {
      if (sequence === this.loadSequence) {
        this.loading.set(false);
      }
    }
  }

  setIndexName(value: string): void {
    this.indexName.set(value);
    this.pageNumber.set(1);
  }

  setIncludeClosed(value: boolean): void {
    this.includeClosed.set(value);
    this.pageNumber.set(1);
  }

  setIncludeSpecial(value: boolean): void {
    this.includeSpecial.set(value);
    this.pageNumber.set(1);
  }

  setIncludeHealthy(value: boolean): void {
    this.includeHealthy.set(value);
    this.pageNumber.set(1);
  }

  toggleSort(): void {
    this.ascending.update((value) => !value);
    this.pageNumber.set(1);
  }

  toggleExpandedView(): void {
    this.expandedView.update((value) => !value);
  }

  requestRefresh(): void {
    this.refreshService.refresh();
  }

  previousPage(): void {
    this.pageNumber.set(Math.max(this.currentPage() - 1, 1));
  }

  nextPage(): void {
    this.pageNumber.set(
      Math.min(this.currentPage() + 1, this.pageCount()),
    );
  }

  async operateOnIndex(
    operation: IndexOperation,
    index: OverviewIndex,
  ): Promise<void> {
    const definition = OPERATIONS[operation];
    if (!(await this.modal.confirm(definition.singlePrompt(index.name)))) {
      return;
    }
    await this.executeOperation(definition.path, { indices: index.name });
  }

  async operateOnFiltered(operation: IndexOperation): Promise<void> {
    const indices = this.data()?.indices ?? [];
    const payload = buildBulkIndicesPayload(indices, this.indexFilter());
    const count = payload.indices ? payload.indices.split(',').length : 0;
    if (count === 0) {
      this.alerts.warn('No indices match the current filter');
      return;
    }
    const definition = OPERATIONS[operation];
    if (!(await this.modal.confirm(definition.bulkPrompt(count)))) {
      return;
    }
    await this.executeOperation(definition.path, payload);
  }

  async disableShardAllocation(kind: string): Promise<void> {
    await this.executeOperation('overview/disable_shard_allocation', { kind });
  }

  async enableShardAllocation(): Promise<void> {
    await this.executeOperation('overview/enable_shard_allocation', {});
  }

  async showShardStats(shard: OverviewShard): Promise<void> {
    if (!shard.node) {
      return;
    }
    await this.showJson(
      `Shard ${shard.index}/${shard.shard} stats`,
      'overview/get_shard_stats',
      { index: shard.index, node: shard.node, shard: shard.shard },
    );
  }

  async showNodeStats(node: OverviewNode): Promise<void> {
    await this.showJson(
      `${node.name} node stats`,
      'commons/get_node_stats',
      { node: node.id },
    );
  }

  async showIndexStats(index: OverviewIndex): Promise<void> {
    await this.showJson(
      `${index.name} stats`,
      'commons/get_index_stats',
      { index: index.name },
    );
  }

  async showIndexSettings(index: OverviewIndex): Promise<void> {
    await this.showJson(
      `${index.name} settings`,
      'commons/get_index_settings',
      { index: index.name },
    );
  }

  async showIndexMapping(index: OverviewIndex): Promise<void> {
    await this.showJson(
      `${index.name} mappings`,
      'commons/get_index_mapping',
      { index: index.name },
    );
  }

  selectShard(shard: OverviewShard): void {
    this.relocatingShard.update((selected) =>
      isSameShard(selected, shard) ? undefined : shard,
    );
  }

  isSelected(shard: OverviewShard): boolean {
    return isSameShard(this.relocatingShard(), shard);
  }

  canReceive(index: OverviewIndex, node: OverviewNode): boolean {
    return canReceiveShard(this.relocatingShard(), index, node.id);
  }

  async relocateShard(node: OverviewNode): Promise<void> {
    const shard = this.relocatingShard();
    if (!shard?.node) {
      return;
    }
    try {
      const response = await this.api.post<unknown>('overview/relocate_shard', {
        shard: shard.shard,
        index: shard.index,
        from: shard.node,
        to: node.id,
      });
      this.relocatingShard.set(undefined);
      this.refreshService.refresh();
      this.alerts.info('Relocation successfully started', response);
    } catch (error: unknown) {
      this.alerts.error('Error while starting relocation', error);
    }
  }

  shardsFor(index: OverviewIndex, nodeId: string): readonly OverviewShard[] {
    return [...(index.shards[nodeId] ?? [])].sort(
      (left, right) => left.shard - right.shard,
    );
  }

  shardStateClass(shard: OverviewShard): string {
    const state = shard.state.toLocaleLowerCase();
    return ['started', 'relocating', 'initializing', 'unassigned'].includes(
      state,
    )
      ? `shard-${state}`
      : 'shard-unknown';
  }

  attributeEntries(
    attributes: Readonly<Record<string, unknown>>,
  ): readonly (readonly [string, string])[] {
    return Object.entries(attributes).map(
      ([name, value]) => [name, String(value)] as const,
    );
  }

  bytes(value: number | null | undefined): string {
    return formatBytes(value);
  }

  percent(value: number): number {
    return Math.max(0, Math.min(value, 100));
  }

  private async executeOperation(
    path: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    try {
      const response = await this.api.post<unknown>(path, payload);
      this.refreshService.refresh();
      this.alerts.success('Operation successfully executed', response);
    } catch (error: unknown) {
      this.alerts.error('Operation failed', error);
    }
  }

  private async showJson(
    title: string,
    path: JsonEndpoint,
    payload: Record<string, unknown>,
  ): Promise<void> {
    try {
      const response = await this.api.post<unknown>(path, payload);
      this.modal.showJson(title, response);
    } catch (error: unknown) {
      this.alerts.error('Operation failed', error);
    }
  }

  private clampPage(): void {
    this.pageNumber.set(Math.min(this.currentPage(), this.pageCount()));
  }

  private resetData(): void {
    this.loadSequence += 1;
    this.data.set(undefined);
    this.relocatingShard.set(undefined);
    this.loading.set(false);
    this.pageNumber.set(1);
  }
}
