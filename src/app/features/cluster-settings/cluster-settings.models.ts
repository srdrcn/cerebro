export type SettingValues = Record<string, string>;

export interface ClusterSettingsResponse {
  defaults?: Record<string, unknown>;
  persistent?: Record<string, unknown>;
  transient?: Record<string, unknown>;
}

export interface ClusterSettingChange {
  value: string;
  transient: boolean;
}

export type ClusterSettingChanges = Record<string, ClusterSettingChange>;

export interface ClusterSettingsPayload {
  transient: Record<string, string | null>;
  persistent: Record<string, string | null>;
}

export interface SettingDescriptor {
  name: string;
  static: boolean;
}

export interface SettingGroup {
  name: string;
  settings: SettingDescriptor[];
}

function normalizeGroup(group: Record<string, unknown> | undefined): SettingValues {
  const normalized: SettingValues = {};
  for (const [name, value] of Object.entries(group ?? {})) {
    normalized[name] = value === null || value === undefined ? '' : String(value);
  }
  return normalized;
}

export function mergeClusterSettings(response: ClusterSettingsResponse): SettingValues {
  return {
    ...normalizeGroup(response.defaults),
    ...normalizeGroup(response.persistent),
    ...normalizeGroup(response.transient),
  };
}

export function buildClusterSettingsPayload(changes: ClusterSettingChanges): ClusterSettingsPayload {
  const payload: ClusterSettingsPayload = { transient: {}, persistent: {} };
  for (const [name, change] of Object.entries(changes)) {
    const target = change.transient ? payload.transient : payload.persistent;
    target[name] = change.value.length > 0 ? change.value : null;
  }
  return payload;
}

export function groupSettings(settings: readonly SettingDescriptor[]): SettingGroup[] {
  const groups = new Map<string, SettingDescriptor[]>();
  for (const setting of settings) {
    const group = setting.name.split('.')[1] || setting.name.split('.')[0] || 'other';
    groups.set(group, [...(groups.get(group) ?? []), setting]);
  }
  return [...groups.entries()]
    .map(([name, values]) => ({ name, settings: values.sort((a, b) => a.name.localeCompare(b.name)) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

const DYNAMIC_CLUSTER_SETTINGS = new Set([
  'cluster.blocks.read_only',
  'cluster.blocks.read_only_allow_delete',
  'cluster.indices.close.enable',
  'cluster.info.update.interval',
  'cluster.info.update.timeout',
  'cluster.routing.allocation.allow_rebalance',
  'cluster.routing.allocation.awareness.attributes',
  'cluster.routing.allocation.balance.index',
  'cluster.routing.allocation.balance.shard',
  'cluster.routing.allocation.balance.threshold',
  'cluster.routing.allocation.cluster_concurrent_rebalance',
  'cluster.routing.allocation.disk.include_relocations',
  'cluster.routing.allocation.disk.reroute_interval',
  'cluster.routing.allocation.disk.threshold_enabled',
  'cluster.routing.allocation.disk.watermark.high',
  'cluster.routing.allocation.disk.watermark.low',
  'cluster.routing.allocation.enable',
  'cluster.routing.allocation.node_concurrent_incoming_recoveries',
  'cluster.routing.allocation.node_concurrent_outgoing_recoveries',
  'cluster.routing.allocation.node_concurrent_recoveries',
  'cluster.routing.allocation.node_initial_primaries_recoveries',
  'cluster.routing.allocation.same_shard.host',
  'cluster.routing.allocation.snapshot.relocation_enabled',
  'cluster.routing.allocation.total_shards_per_node',
  'cluster.routing.rebalance.enable',
  'cluster.service.slow_task_logging_threshold',
  'discovery.zen.commit_timeout',
  'discovery.zen.minimum_master_nodes',
  'discovery.zen.no_master_block',
  'discovery.zen.publish_diff.enable',
  'discovery.zen.publish_timeout',
  'gateway.initial_shards',
  'indices.breaker.fielddata.limit',
  'indices.breaker.fielddata.overhead',
  'indices.breaker.request.limit',
  'indices.breaker.request.overhead',
  'indices.breaker.total.limit',
  'indices.mapping.dynamic_timeout',
  'indices.recovery.internal_action_long_timeout',
  'indices.recovery.internal_action_timeout',
  'indices.recovery.max_bytes_per_sec',
  'indices.recovery.recovery_activity_timeout',
  'indices.recovery.retry_delay_network',
  'indices.recovery.retry_delay_state_sync',
  'indices.store.throttle.max_bytes_per_sec',
  'indices.store.throttle.type',
  'indices.ttl.interval',
  'ingest.new_date_format',
  'network.breaker.inflight_requests.limit',
  'network.breaker.inflight_requests.overhead',
  'script.max_compilations_per_minute',
  'search.default_search_timeout',
  'search.low_level_cancellation',
  'transport.tracer.exclude.0',
  'transport.tracer.exclude.1',
  'xpack.ml.node_concurrent_job_allocations',
  'xpack.monitoring.collection.cluster.state.timeout',
  'xpack.monitoring.collection.cluster.stats.timeout',
  'xpack.monitoring.collection.index.recovery.active_only',
  'xpack.monitoring.collection.index.recovery.timeout',
  'xpack.monitoring.collection.index.stats.timeout',
  'xpack.monitoring.collection.interval',
  'xpack.monitoring.collection.ml.job.stats.timeout',
  'xpack.monitoring.history.duration',
  'xpack.security.http.filter.enabled',
  'xpack.security.transport.filter.enabled',
  'xpack.watcher.history.cleaner_service.enabled',
  'action.auto_create_index',
  'action.destructive_requires_name',
  'action.search.shard_count.limit',
]);

export function isDynamicClusterSetting(name: string): boolean {
  return DYNAMIC_CLUSTER_SETTINGS.has(name);
}
