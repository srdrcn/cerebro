import { elasticsearchReason } from '../../core/errors';
import { humanize, matchesText } from '../../core/format';

/**
 * Pure logic behind <cerebro-settings-editor>, shared by the cluster settings
 * and index settings pages.
 */

/** Where the effective value of a setting comes from. */
export type SettingOrigin = 'default' | 'persistent' | 'transient' | 'index';

/** Cluster settings can be written to either of the two layers. */
export type SettingScope = 'persistent' | 'transient';

export interface SettingRow {
  readonly name: string;
  /** Effective value, flattened to the string shown in the input. */
  readonly value: string;
  readonly origin: SettingOrigin;
  readonly editable: boolean;
  /** Tooltip explaining why a setting cannot be edited. */
  readonly lockReason?: string;
  /** Short label for locked settings ("Static", "Read-only", …). */
  readonly lockLabel?: string;
  /** Explicit cluster level values, used to build reset payloads and hints. */
  readonly persistent?: string;
  readonly transient?: string;
  /** Added by name because Elasticsearch does not list it (see `customSettingRows`). */
  readonly custom?: boolean;
}

export interface SettingDraft {
  readonly value: string;
  readonly scope: SettingScope;
}

export type SettingDrafts = Readonly<Record<string, SettingDraft>>;

/** A save error attached to the value that was rejected. */
export interface SettingError {
  readonly message: string;
  readonly value: string | null;
}

export type SettingErrors = Readonly<Record<string, SettingError>>;

export interface PendingChange {
  readonly name: string;
  /** Effective value before the change. */
  readonly from: string;
  /** New value; `null` resets the setting to its default. */
  readonly to: string | null;
  readonly scope: SettingScope;
}

export interface SettingGroupView {
  /** Stable identifier (the dotted prefix, or `''` for the general group). */
  readonly key: string;
  readonly title: string;
  /** Full dotted prefix shared by every setting of the group (`cluster.routing.`). */
  readonly prefix: string;
  /** Nesting level in the table of contents (sub groups are indented). */
  readonly depth: number;
  /** Title shown in the table of contents (sub groups drop their parent). */
  readonly shortTitle: string;
  /** Subtitle replacing the dotted prefix for curated groups. */
  readonly description?: string;
  readonly rows: readonly SettingRow[];
}

export interface GroupingOptions {
  /** Prefix ignored when grouping (`index.` for index settings). */
  readonly stripPrefix?: string;
  /** Title of the group collecting settings without a family of their own. */
  readonly generalTitle?: string;
  /** Show the general group first (index settings) or last (cluster settings). */
  readonly generalFirst?: boolean;
  /** Frequently changed settings collected in a first group of their own. */
  readonly featured?: readonly string[];
  readonly featuredTitle?: string;
  /** Families with fewer settings are folded into the general group. */
  readonly minGroupSize?: number;
  /** Families with more settings are split by their second segment… */
  readonly splitAbove?: number;
  /** …into sub families of at least this many settings. */
  readonly minSubgroupSize?: number;
}

export interface SettingsFilter {
  readonly query: string;
  readonly showStatic: boolean;
  readonly onlyOverridden: boolean;
}

/** Converts a value returned by Elasticsearch into the editable string. */
export function settingValueToString(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (Array.isArray(value)) {
    return value.map((item) => settingValueToString(item)).join(',');
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
}

export function isOverridden(row: SettingRow): boolean {
  return row.origin !== 'default';
}

const ACRONYMS: Readonly<Record<string, string>> = {
  api: 'API',
  apm: 'APM',
  ccr: 'CCR',
  cors: 'CORS',
  cpu: 'CPU',
  eql: 'EQL',
  esql: 'ES|QL',
  gcs: 'GCS',
  http: 'HTTP',
  id: 'ID',
  idp: 'IdP',
  ilm: 'ILM',
  jwt: 'JWT',
  ml: 'ML',
  oidc: 'OIDC',
  s3: 'S3',
  saml: 'SAML',
  slm: 'SLM',
  ssl: 'SSL',
  tcp: 'TCP',
  tls: 'TLS',
  ui: 'UI',
  url: 'URL',
  xpack: 'X-Pack',
};

/**
 * `humanize` that keeps acronyms readable: `xpack.security` → `X-Pack security`,
 * `http` → `HTTP`, `thread_pool` → `Thread pool`.
 */
export function humanizeSettingKey(key: string): string {
  return humanize(key)
    .split(' ')
    .map((word) => ACRONYMS[word.toLowerCase()] ?? word)
    .join(' ');
}

/** Key of the group holding `GroupingOptions.featured` settings. */
export const FEATURED_GROUP_KEY = '@featured';

function relativeName(name: string, stripPrefix: string): string {
  return stripPrefix && name.startsWith(stripPrefix) ? name.slice(stripPrefix.length) : name;
}

/**
 * Groups settings into families by their dotted prefix. Tiny families are
 * folded into a general group and very large ones are split by their second
 * segment so every card stays scannable.
 */
export function groupSettingRows(
  rows: readonly SettingRow[],
  options: GroupingOptions = {},
): SettingGroupView[] {
  const stripPrefix = options.stripPrefix ?? '';
  const minGroupSize = options.minGroupSize ?? 3;
  const splitAbove = options.splitAbove ?? 30;
  const minSubgroupSize = options.minSubgroupSize ?? 5;

  const featuredNames = new Set(options.featured ?? []);
  const byName = new Map(rows.map((row) => [row.name, row]));
  const featured = [...featuredNames].flatMap((name) => {
    const row = byName.get(name);
    return row ? [row] : [];
  });
  const families = new Map<string, SettingRow[]>();
  for (const row of rows) {
    if (featuredNames.has(row.name)) {
      continue;
    }
    const segments = relativeName(row.name, stripPrefix).split('.');
    const family = segments.length > 1 ? (segments[0] ?? '') : '';
    families.set(family, [...(families.get(family) ?? []), row]);
  }

  const groups = new Map<string, SettingRow[]>();
  const add = (key: string, row: SettingRow) => groups.set(key, [...(groups.get(key) ?? []), row]);

  for (const [family, members] of families) {
    if (family === '' || members.length < minGroupSize) {
      members.forEach((row) => add('', row));
      continue;
    }
    if (members.length <= splitAbove) {
      members.forEach((row) => add(family, row));
      continue;
    }
    const subfamilies = new Map<string, SettingRow[]>();
    for (const row of members) {
      const segments = relativeName(row.name, stripPrefix).split('.');
      const sub = segments.length > 2 ? `${family}.${segments[1]}` : family;
      subfamilies.set(sub, [...(subfamilies.get(sub) ?? []), row]);
    }
    for (const [sub, subMembers] of subfamilies) {
      const key = sub !== family && subMembers.length >= minSubgroupSize ? sub : family;
      subMembers.forEach((row) => add(key, row));
    }
  }

  const generalFirst = options.generalFirst ?? true;
  const parents = new Set([...groups.keys()].filter((key) => key && !key.includes('.')));
  const featuredGroup: SettingGroupView[] =
    featured.length > 0
      ? [
          {
            key: FEATURED_GROUP_KEY,
            title: options.featuredTitle ?? 'Common settings',
            shortTitle: options.featuredTitle ?? 'Common settings',
            description: 'Frequently changed settings',
            prefix: stripPrefix,
            depth: 0,
            rows: featured,
          },
        ]
      : [];
  const grouped = [...groups.entries()]
    .sort(([left], [right]) => {
      if (left === '' || right === '') {
        return (left === '') === generalFirst ? -1 : 1;
      }
      return left.localeCompare(right);
    })
    .map(([key, members]) => {
      const separator = key.indexOf('.');
      const parent = separator > 0 ? key.slice(0, separator) : '';
      const nested = parent !== '' && parents.has(parent);
      const title = key ? humanizeSettingKey(key) : (options.generalTitle ?? 'General');
      return {
        key,
        title,
        shortTitle: nested ? humanizeSettingKey(key.slice(separator + 1)) : title,
        prefix: key ? `${stripPrefix}${key}.` : stripPrefix,
        depth: nested ? 1 : 0,
        rows: [...members].sort((left, right) => left.name.localeCompare(right.name)),
      };
    });
  return [...featuredGroup, ...grouped];
}

/** Key of the group holding settings added by name. */
export const CUSTOM_GROUP_KEY = '@custom';

/**
 * Groups what the editor can show. Only the static toggle shapes the groups
 * (hidden static settings must not keep a family alive), so cards stay put
 * while searching or using the "Only overridden" filter. Settings added by
 * name come first in a group of their own.
 */
export function groupEditorRows(
  rows: readonly SettingRow[],
  showStatic: boolean,
  options: GroupingOptions = {},
): SettingGroupView[] {
  const custom = rows.filter((row) => row.custom);
  const listed = rows.filter((row) => !row.custom && (showStatic || row.editable));
  const groups = groupSettingRows(listed, options);
  if (custom.length === 0) {
    return groups;
  }
  return [
    {
      key: CUSTOM_GROUP_KEY,
      title: 'Added settings',
      shortTitle: 'Added settings',
      description: 'Not listed by Elasticsearch, added by name',
      prefix: '',
      depth: 0,
      rows: custom,
    },
    ...groups,
  ];
}

/**
 * Name of a setting typed in the "Add setting" form. Index settings may be
 * typed without their `index.` prefix.
 */
export function normalizeSettingName(name: string, prefix = ''): string {
  const trimmed = name.trim();
  return prefix && trimmed && !trimmed.startsWith(prefix) ? `${prefix}${trimmed}` : trimmed;
}

const SETTING_NAME = /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)+$/;

/** Why a typed setting name cannot be used, if it cannot. */
export function settingNameError(name: string): string | undefined {
  if (name === '') {
    return 'Enter the name of the setting';
  }
  if (/\s/.test(name)) {
    return 'Setting names cannot contain spaces';
  }
  if (!SETTING_NAME.test(name)) {
    return 'Use a dotted name made of letters, digits, “_” and “-”';
  }
  return undefined;
}

/** Every whitespace separated term must match the setting name. */
export function matchesSettingQuery(name: string, query: string): boolean {
  const terms = query.trim().split(/\s+/).filter((term) => term.length > 0);
  return terms.every((term) => matchesText(name, term));
}

/**
 * Applies the toolbar filters. Settings with pending changes stay visible
 * whatever the toggles say so an edit never disappears from under the user,
 * and settings added by name are always shown.
 */
export function filterSettingRows(
  rows: readonly SettingRow[],
  filter: SettingsFilter,
  pending: ReadonlySet<string> = new Set(),
): SettingRow[] {
  return rows.filter((row) => {
    if (row.custom) {
      return true;
    }
    if (!matchesSettingQuery(row.name, filter.query)) {
      return false;
    }
    if (pending.has(row.name)) {
      return true;
    }
    if (!filter.showStatic && !row.editable) {
      return false;
    }
    return !filter.onlyOverridden || isOverridden(row);
  });
}

/** The scope a new edit starts with: transient only if the value already is. */
export function defaultScope(row: SettingRow): SettingScope {
  return row.origin === 'transient' ? 'transient' : 'persistent';
}

/**
 * Rows for drafts whose setting Elasticsearch does not list (affix settings
 * such as `cluster.routing.allocation.exclude._name`, or specific loggers).
 * They start empty, use their default and can always be edited.
 */
export function customSettingRows(rows: readonly SettingRow[], drafts: SettingDrafts): SettingRow[] {
  const known = new Set(rows.map((row) => row.name));
  return Object.keys(drafts)
    .filter((name) => !known.has(name))
    .sort((left, right) => left.localeCompare(right))
    .map((name) => ({ name, value: '', origin: 'default', editable: true, custom: true }));
}

/**
 * Turns drafts into the list of real changes. A draft equal to the current
 * value is not a change, and neither is an empty draft for a setting that
 * already uses its default. Drafts for settings added by name come last.
 */
export function pendingChanges(
  rows: readonly SettingRow[],
  drafts: SettingDrafts,
): PendingChange[] {
  const changes: PendingChange[] = [];
  for (const row of [...rows, ...customSettingRows(rows, drafts)]) {
    const draft = drafts[row.name];
    if (!draft || !row.editable || isNoopDraft(row, draft)) {
      continue;
    }
    changes.push({
      name: row.name,
      from: row.value,
      to: draft.value.trim() === '' ? null : draft.value,
      scope: draft.scope,
    });
  }
  return changes;
}

/**
 * Saving a transient setting as persistent moves it out of the deprecated
 * transient layer (the transient value is cleared), even when the value
 * itself does not change.
 */
export function movesToPersistent(row: SettingRow, draft: SettingDraft): boolean {
  return row.transient !== undefined && draft.scope === 'persistent' && draft.value.trim() !== '';
}

export function isNoopDraft(row: SettingRow, draft: SettingDraft): boolean {
  if (draft.value.trim() === '') {
    return !isOverridden(row);
  }
  if (movesToPersistent(row, draft)) {
    return false;
  }
  return draft.value === row.value;
}

/**
 * Drops drafts that no longer differ from the (reloaded) values. Drafts for
 * settings added by name stay until they are saved or removed explicitly.
 */
export function pruneDrafts(rows: readonly SettingRow[], drafts: SettingDrafts): SettingDrafts {
  const byName = new Map(rows.map((row) => [row.name, row]));
  const kept: Record<string, SettingDraft> = {};
  let changed = false;
  for (const [name, draft] of Object.entries(drafts)) {
    const row = byName.get(name);
    if (!row || (row.editable && !isNoopDraft(row, draft))) {
      kept[name] = draft;
    } else {
      changed = true;
    }
  }
  return changed ? kept : drafts;
}

/** Index settings payload: `{ name: value | null }`. */
export function buildFlatSettingsPayload(
  changes: readonly PendingChange[],
): Record<string, string | null> {
  const payload: Record<string, string | null> = {};
  for (const change of changes) {
    payload[change.name] = change.to;
  }
  return payload;
}

/** Rewrites the few Java flavoured messages Elasticsearch returns for settings. */
export function friendlyReason(reason: string): string {
  const enumValue = /^No enum constant (?:[\w$]+\.)+([\w$]+)$/.exec(reason.trim());
  if (enumValue) {
    return `[${enumValue[1]?.toLowerCase()}] is not one of the accepted values`;
  }
  return reason;
}

/**
 * Finds which of the submitted settings an Elasticsearch error message is
 * about (`… can't update [cluster.routing.allocation.enable] …`).
 */
export function settingNamedInError(
  message: string,
  names: readonly string[],
): string | undefined {
  const bracketed = [...names]
    .sort((left, right) => right.length - left.length)
    .find((name) => message.includes(`[${name}]`));
  if (bracketed) {
    return bracketed;
  }
  return [...names]
    .sort((left, right) => right.length - left.length)
    .find((name) => message.includes(name));
}

/**
 * Maps a failed save to the setting it is about, so the message can be shown
 * next to the field. Falls back to the only change when there is just one.
 */
export function settingErrorsFor(error: unknown, changes: readonly PendingChange[]): SettingErrors {
  const reason = elasticsearchReason(error);
  if (!reason) {
    return {};
  }
  const message = friendlyReason(reason);
  const name = settingNamedInError(message, changes.map((change) => change.name));
  const change = changes.find((candidate) => candidate.name === name) ?? (changes.length === 1 ? changes[0] : undefined);
  return change ? { [change.name]: { message, value: change.to } } : {};
}

/** Removes the drafts that were saved, keeping ones edited again meanwhile. */
export function withoutSavedDrafts(drafts: SettingDrafts, saved: readonly PendingChange[]): SettingDrafts {
  const next: Record<string, SettingDraft> = { ...drafts };
  for (const change of saved) {
    const draft = next[change.name];
    if (draft && (draft.value.trim() === '' ? null : draft.value) === change.to) {
      delete next[change.name];
    }
  }
  return next;
}
