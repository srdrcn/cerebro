import { DYNAMIC_CLUSTER_SETTINGS, DYNAMIC_CLUSTER_SETTING_PATTERNS } from './cluster-settings.catalog';
import { PendingChange, SettingRow, settingValueToString } from '../../shared/settings-editor/settings-editor.models';

type SettingValues = Record<string, string>;

export interface ClusterSettingsResponse {
  defaults?: Record<string, unknown>;
  persistent?: Record<string, unknown>;
  transient?: Record<string, unknown>;
}

export interface ClusterSettingsPayload {
  transient: Record<string, string | null>;
  persistent: Record<string, string | null>;
}

function normalizeGroup(group: Record<string, unknown> | undefined): SettingValues {
  const normalized: SettingValues = {};
  for (const [name, value] of Object.entries(group ?? {})) {
    normalized[name] = settingValueToString(value);
  }
  return normalized;
}

export function isDynamicClusterSetting(name: string): boolean {
  return (
    DYNAMIC_CLUSTER_SETTINGS.has(name) ||
    DYNAMIC_CLUSTER_SETTING_PATTERNS.some((pattern) => pattern.test(name))
  );
}

const STATIC_CLUSTER_SETTING_REASON =
  'Static setting: it can only be set in elasticsearch.yml and needs a node restart.';

/**
 * One row per known setting with its effective value (transient over
 * persistent over default). Settings that are explicitly set are always
 * editable: they could only have been written through the API.
 */
export function buildClusterSettingRows(response: ClusterSettingsResponse): SettingRow[] {
  const defaults = normalizeGroup(response.defaults);
  const persistent = normalizeGroup(response.persistent);
  const transient = normalizeGroup(response.transient);
  const names = new Set([...Object.keys(defaults), ...Object.keys(persistent), ...Object.keys(transient)]);

  return [...names]
    .sort((left, right) => left.localeCompare(right))
    .map((name): SettingRow => {
      const persistentValue = persistent[name];
      const transientValue = transient[name];
      const origin =
        transientValue !== undefined ? 'transient' : persistentValue !== undefined ? 'persistent' : 'default';
      const editable = origin !== 'default' || isDynamicClusterSetting(name);
      return {
        name,
        value: transientValue ?? persistentValue ?? defaults[name] ?? '',
        origin,
        editable,
        ...(editable ? {} : { lockReason: STATIC_CLUSTER_SETTING_REASON, lockLabel: 'Static' }),
        ...(persistentValue !== undefined ? { persistent: persistentValue } : {}),
        ...(transientValue !== undefined ? { transient: transientValue } : {}),
      };
    });
}

/**
 * Body of `PUT _cluster/settings`. A reset (`to: null`) clears the setting
 * from every layer it is explicitly set in, so the default really applies.
 * Saving a transient setting as persistent also clears its transient value,
 * which would otherwise keep taking precedence.
 */
export function buildClusterSavePayload(
  changes: readonly PendingChange[],
  rows: readonly SettingRow[],
): ClusterSettingsPayload {
  const byName = new Map(rows.map((row) => [row.name, row]));
  const payload: ClusterSettingsPayload = { transient: {}, persistent: {} };
  for (const change of changes) {
    if (change.to === null) {
      const row = byName.get(change.name);
      const layers: ('persistent' | 'transient')[] = [];
      if (row?.persistent !== undefined) layers.push('persistent');
      if (row?.transient !== undefined) layers.push('transient');
      for (const layer of layers.length > 0 ? layers : [change.scope]) {
        payload[layer][change.name] = null;
      }
    } else {
      payload[change.scope][change.name] = change.to;
      if (change.scope === 'persistent' && byName.get(change.name)?.transient !== undefined) {
        payload.transient[change.name] = null;
      }
    }
  }
  return payload;
}

export interface OverrideSummary {
  readonly persistent: number;
  readonly transient: number;
}

export function summarizeOverrides(rows: readonly SettingRow[]): OverrideSummary {
  return {
    persistent: rows.filter((row) => row.persistent !== undefined).length,
    transient: rows.filter((row) => row.transient !== undefined).length,
  };
}
