export type IndexSettingValues = Record<string, string>;

export interface IndexSettingsGroupResponse {
  defaults?: Record<string, unknown>;
  settings?: Record<string, unknown>;
}

export type IndexSettingsResponse = Record<string, IndexSettingsGroupResponse>;

export interface IndexSettingDescriptor {
  name: string;
  static: boolean;
}

export interface IndexSettingGroup {
  name: string;
  settings: IndexSettingDescriptor[];
}

const HIDDEN_INDEX_METADATA = [
  'index.creation_date',
  'index.provided_name',
  'index.uuid',
  'index.version.created',
] as const;

const DYNAMIC_INDEX_SETTINGS = new Set([
  'index.mapper.dynamic',
  'index.max_refresh_listeners',
  'index.number_of_replicas',
  'index.allocation.max_retries',
  'index.auto_expand_replicas',
  'index.blocks.metadata',
  'index.blocks.read',
  'index.blocks.read_only',
  'index.blocks.read_only_allow_delete',
  'index.blocks.write',
  'index.compound_format',
  'index.gc_deletes',
  'index.indexing.slowlog.level',
  'index.indexing.slowlog.reformat',
  'index.indexing.slowlog.source',
  'index.indexing.slowlog.threshold.index.debug',
  'index.indexing.slowlog.threshold.index.info',
  'index.indexing.slowlog.threshold.index.trace',
  'index.indexing.slowlog.threshold.index.warn',
  'index.mapping.depth.limit',
  'index.mapping.nested_fields.limit',
  'index.mapping.total_fields.limit',
  'index.max_adjacency_matrix_filters',
  'index.max_rescore_window',
  'index.max_result_window',
  'index.max_slices_per_scroll',
  'index.merge.policy.expunge_deletes_allowed',
  'index.merge.policy.floor_segment',
  'index.merge.policy.max_merge_at_once',
  'index.merge.policy.max_merge_at_once_explicit',
  'index.merge.policy.max_merged_segment',
  'index.merge.policy.reclaim_deletes_weight',
  'index.merge.policy.segments_per_tier',
  'index.merge.scheduler.auto_throttle',
  'index.merge.scheduler.max_merge_count',
  'index.merge.scheduler.max_thread_count',
  'index.optimize_auto_generated_id',
  'index.priority',
  'index.recovery.initial_shards',
  'index.refresh_interval',
  'index.requests.cache.enable',
  'index.routing.allocation.enable',
  'index.routing.allocation.total_shards_per_node',
  'index.routing.rebalance.enable',
  'index.search.slowlog.level',
  'index.search.slowlog.threshold.fetch.debug',
  'index.search.slowlog.threshold.fetch.info',
  'index.search.slowlog.threshold.fetch.trace',
  'index.search.slowlog.threshold.fetch.warn',
  'index.search.slowlog.threshold.query.debug',
  'index.search.slowlog.threshold.query.info',
  'index.search.slowlog.threshold.query.trace',
  'index.search.slowlog.threshold.query.warn',
  'index.shared_filesystem.recover_on_any_node',
  'index.store.throttle.max_bytes_per_sec',
  'index.store.throttle.type',
  'index.translog.durability',
  'index.translog.flush_threshold_size',
  'index.ttl.disable_purge',
  'index.unassigned.node_left.delayed_timeout',
  'index.warmer.enabled',
  'index.write.wait_for_active_shards',
]);

function normalize(group: Record<string, unknown> | undefined): IndexSettingValues {
  const values: IndexSettingValues = {};
  for (const [name, value] of Object.entries(group ?? {})) {
    if (isVisibleIndexSetting(name)) {
      values[name] = value === null || value === undefined ? '' : String(value);
    }
  }
  return values;
}

export function isVisibleIndexSetting(name: string): boolean {
  return HIDDEN_INDEX_METADATA.every((metadata) => !name.includes(metadata));
}

export function isDynamicIndexSetting(name: string): boolean {
  return DYNAMIC_INDEX_SETTINGS.has(name);
}

export function mergeIndexSettings(response: IndexSettingsResponse, index: string): IndexSettingValues {
  const groups = response[index] ?? {};
  return { ...normalize(groups.defaults), ...normalize(groups.settings) };
}

export function groupIndexSettings(settings: readonly IndexSettingDescriptor[]): IndexSettingGroup[] {
  const groups = new Map<string, IndexSettingDescriptor[]>();
  for (const setting of settings) {
    const group = setting.name.split('.')[1] || setting.name.split('.')[0] || 'other';
    groups.set(group, [...(groups.get(group) ?? []), setting]);
  }
  return [...groups.entries()]
    .map(([name, values]) => ({ name, settings: values.sort((a, b) => a.name.localeCompare(b.name)) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
