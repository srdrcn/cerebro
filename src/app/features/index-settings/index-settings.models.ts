import { sortByName } from '../../core/format';
import { SettingRow, settingValueToString } from '../../shared/settings-editor/settings-editor.models';
import {
  DYNAMIC_INDEX_SETTINGS,
  DYNAMIC_INDEX_SETTING_PATTERNS,
  FINAL_INDEX_SETTINGS,
  FINAL_INDEX_SETTING_PATTERNS,
  INTERNAL_INDEX_SETTINGS,
  INTERNAL_INDEX_SETTING_PATTERNS,
} from './index-settings.catalog';

type IndexSettingValues = Record<string, string>;

export interface IndexSettingsGroupResponse {
  defaults?: Record<string, unknown>;
  settings?: Record<string, unknown>;
}

export type IndexSettingsResponse = Record<string, IndexSettingsGroupResponse>;

/** How a setting of an existing index can be changed. */
export type IndexSettingKind = 'dynamic' | 'static' | 'final' | 'internal';

const HIDDEN_INDEX_METADATA = [
  'index.creation_date',
  'index.provided_name',
  'index.uuid',
  'index.version.created',
] as const;

function normalize(group: Record<string, unknown> | undefined): IndexSettingValues {
  const values: IndexSettingValues = {};
  for (const [name, value] of Object.entries(group ?? {})) {
    if (isVisibleIndexSetting(name)) {
      values[name] = settingValueToString(value);
    }
  }
  return values;
}

export function isVisibleIndexSetting(name: string): boolean {
  return HIDDEN_INDEX_METADATA.every((metadata) => !name.includes(metadata));
}

function matches(name: string, names: ReadonlySet<string>, patterns: readonly RegExp[]): boolean {
  return names.has(name) || patterns.some((pattern) => pattern.test(name));
}

export function isDynamicIndexSetting(name: string): boolean {
  return matches(name, DYNAMIC_INDEX_SETTINGS, DYNAMIC_INDEX_SETTING_PATTERNS);
}

export function indexSettingKind(name: string): IndexSettingKind {
  if (matches(name, INTERNAL_INDEX_SETTINGS, INTERNAL_INDEX_SETTING_PATTERNS)) {
    return 'internal';
  }
  if (matches(name, FINAL_INDEX_SETTINGS, FINAL_INDEX_SETTING_PATTERNS)) {
    return 'final';
  }
  return isDynamicIndexSetting(name) ? 'dynamic' : 'static';
}

export type ResolvedIndexSettings =
  | { readonly kind: 'single'; readonly index: string; readonly group: IndexSettingsGroupResponse }
  | { readonly kind: 'multiple'; readonly indices: readonly string[] }
  | { readonly kind: 'missing' };

/**
 * The endpoint answers with one entry per concrete index; an alias or a
 * wildcard may therefore resolve to several indices.
 */
export function resolveIndexSettings(response: IndexSettingsResponse, index: string): ResolvedIndexSettings {
  const exact = response[index];
  if (exact) {
    return { kind: 'single', index, group: exact };
  }
  const indices = Object.keys(response).sort((left, right) => left.localeCompare(right));
  const [only] = indices;
  if (indices.length === 1 && only !== undefined) {
    return { kind: 'single', index: only, group: response[only] ?? {} };
  }
  return indices.length > 1 ? { kind: 'multiple', indices } : { kind: 'missing' };
}

/** Closed indices carry `index.verified_before_close` (Elasticsearch 7.2+). */
export function isClosedIndex(group: IndexSettingsGroupResponse): boolean {
  return settingValueToString(group.settings?.['index.verified_before_close']) === 'true';
}

export interface IndexMetadata {
  readonly uuid?: string;
  readonly createdAt?: Date;
  readonly closed: boolean;
}

export function indexMetadata(group: IndexSettingsGroupResponse): IndexMetadata {
  const settings = group.settings ?? {};
  const uuid = settingValueToString(settings['index.uuid']);
  const created = Number(settingValueToString(settings['index.creation_date']));
  return {
    ...(uuid ? { uuid } : {}),
    ...(Number.isFinite(created) && created > 0 ? { createdAt: new Date(created) } : {}),
    closed: isClosedIndex(group),
  };
}

const LOCK_REASONS: Readonly<Record<Exclude<IndexSettingKind, 'dynamic'>, { label: string; reason: string }>> = {
  static: {
    label: 'Static',
    reason: 'Static setting: it can only be changed while the index is closed.',
  },
  final: {
    label: 'Fixed',
    reason: 'Fixed when the index is created and cannot be changed afterwards.',
  },
  internal: {
    label: 'Managed',
    reason: 'Managed by Elasticsearch or through a dedicated API.',
  },
};

/**
 * One row per visible setting. Explicitly set values override defaults; on a
 * closed index static settings become editable too.
 */
export function buildIndexSettingRows(group: IndexSettingsGroupResponse, closed = isClosedIndex(group)): SettingRow[] {
  const defaults = normalize(group.defaults);
  const explicit = normalize(group.settings);
  const names = new Set([...Object.keys(defaults), ...Object.keys(explicit)]);
  return [...names]
    .filter((name) => name !== 'index.verified_before_close')
    .sort((left, right) => left.localeCompare(right))
    .map((name): SettingRow => {
      const kind = indexSettingKind(name);
      const editable = kind === 'dynamic' || (closed && kind === 'static');
      const lock = kind === 'dynamic' ? undefined : LOCK_REASONS[kind];
      return {
        name,
        value: explicit[name] ?? defaults[name] ?? '',
        origin: explicit[name] !== undefined ? 'index' : 'default',
        editable,
        ...(!editable && lock ? { lockReason: lock.reason, lockLabel: lock.label } : {}),
      };
    });
}

export interface IndexOptionGroups {
  readonly regular: readonly string[];
  /** Dot-prefixed system and hidden indices, listed last. */
  readonly system: readonly string[];
}

/** Splits the index picker options into regular and dot-prefixed indices. */
export function groupIndexOptions(names: readonly string[]): IndexOptionGroups {
  const sorted = sortByName(names);
  return {
    regular: sorted.filter((name) => !name.startsWith('.')),
    system: sorted.filter((name) => name.startsWith('.')),
  };
}
