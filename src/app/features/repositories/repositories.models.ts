import { invalidCharacters } from '../../core/names';

export type RepositoryType = 'fs' | 'url' | 's3' | 'gcs' | 'hdfs' | 'azure';
export type RepositorySettingValue = string | boolean;
export type RepositorySettings = Partial<Record<string, RepositorySettingValue>>;

export interface RepositoryRecord {
  name: string;
  /** One of the built-in types, or any type added by a plugin. */
  type: RepositoryType | string;
  settings: Record<string, unknown>;
}

export interface RepositoryField {
  key: string;
  label: string;
  placeholder: string;
  boolean?: boolean;
  wide?: boolean;
  secret?: boolean;
}

/** A free-form setting that has no dedicated field. */
export interface RepositoryExtraSetting {
  key: string;
  value: string;
}

export interface RepositoryPayload {
  name: string;
  type: string;
  settings: RepositorySettings;
}

const sharedRateFields: RepositoryField[] = [
  { key: 'max_restore_bytes_per_sec', label: 'Restore rate limit', placeholder: 'Per node, for example 20mb' },
  { key: 'max_snapshot_bytes_per_sec', label: 'Snapshot rate limit', placeholder: 'Per node, for example 20mb' },
];

export const REPOSITORY_FIELDS: Record<RepositoryType, RepositoryField[]> = {
  fs: [
    { key: 'location', label: 'Location', placeholder: 'Location of the snapshots', wide: true },
    ...sharedRateFields,
    { key: 'chunk_size', label: 'Chunk size', placeholder: '1g, 10m, 5k' },
    { key: 'compress', label: 'Compress snapshot files', placeholder: '', boolean: true },
    { key: 'readonly', label: 'Read-only repository', placeholder: '', boolean: true },
  ],
  url: [
    { key: 'url', label: 'Location', placeholder: 'URL location of snapshots', wide: true },
  ],
  s3: [
    { key: 'region', label: 'Region', placeholder: 'Bucket region' },
    { key: 'bucket', label: 'Bucket', placeholder: 'Snapshot bucket name' },
    { key: 'base_path', label: 'Base path', placeholder: 'Path within the bucket', wide: true },
    { key: 'access_key', label: 'Access key', placeholder: 'Authentication access key' },
    { key: 'secret_key', label: 'Secret key', placeholder: 'Authentication secret key', secret: true },
    { key: 'chunk_size', label: 'Chunk size', placeholder: '1g, 10m, 5k' },
    { key: 'max_retries', label: 'Max retries', placeholder: 'Defaults to 3' },
    ...sharedRateFields,
    { key: 'compress', label: 'Compress snapshot files', placeholder: '', boolean: true },
    { key: 'server_side_encryption', label: 'Server-side encryption', placeholder: '', boolean: true },
  ],
  gcs: [
    { key: 'bucket', label: 'Bucket', placeholder: 'Snapshot bucket name' },
    { key: 'client', label: 'Client', placeholder: 'Defaults to default' },
    { key: 'base_path', label: 'Base path', placeholder: 'Path within the bucket', wide: true },
    { key: 'chunk_size', label: 'Chunk size', placeholder: '1g, 10m, 5k' },
    ...sharedRateFields,
    { key: 'application_name', label: 'Application name', placeholder: 'Google Cloud client application name' },
    { key: 'compress', label: 'Compress snapshot files', placeholder: '', boolean: true },
    { key: 'readonly', label: 'Read-only repository', placeholder: '', boolean: true },
  ],
  azure: [
    { key: 'container', label: 'Container', placeholder: 'Defaults to elasticsearch-snapshots' },
    { key: 'base_path', label: 'Base path', placeholder: 'Path within the container' },
    { key: 'concurrent_streams', label: 'Concurrent streams', placeholder: 'Defaults to 5' },
    { key: 'chunk_size', label: 'Chunk size', placeholder: 'Defaults to 64m' },
    { key: 'compress', label: 'Compress data', placeholder: '', boolean: true },
  ],
  hdfs: [
    { key: 'path', label: 'Path', placeholder: 'Filesystem path', wide: true },
    { key: 'uri', label: 'URI', placeholder: 'hdfs://host:port/' },
    { key: 'conf_location', label: 'Configuration location', placeholder: 'Comma-separated Hadoop XML config' },
    { key: 'concurrent_streams', label: 'Concurrent streams', placeholder: 'Defaults to 5' },
    { key: 'chunk_size', label: 'Chunk size', placeholder: '10mb, 1gb' },
    { key: 'compress', label: 'Compress data', placeholder: '', boolean: true },
    { key: 'load_defaults', label: 'Load default Hadoop configuration', placeholder: '', boolean: true },
  ],
};

export interface RepositoryTypeInfo {
  readonly type: RepositoryType;
  readonly label: string;
  readonly description: string;
  readonly icon: string;
  /** Short guidance shown above the settings of this type. */
  readonly note: string;
  /** Settings that identify where the data lives, most specific last. */
  readonly summaryKeys: readonly string[];
}

export const REPOSITORY_TYPES: readonly RepositoryTypeInfo[] = [
  {
    type: 'fs',
    label: 'Shared file system',
    description: 'Directory mounted on every node',
    icon: 'bi-hdd-network',
    note: 'The location must be listed in path.repo on every master and data node.',
    summaryKeys: ['location'],
  },
  {
    type: 'url',
    label: 'URL',
    description: 'Read-only access over a URL',
    icon: 'bi-link-45deg',
    note: 'URL repositories are read-only: snapshots can be listed and restored but not created.',
    summaryKeys: ['url'],
  },
  {
    type: 's3',
    label: 'Amazon S3',
    description: 'S3 or a compatible object store',
    icon: 'bi-bucket',
    note: 'Prefer client credentials in the Elasticsearch keystore over keys in the repository settings.',
    summaryKeys: ['bucket', 'base_path'],
  },
  {
    type: 'gcs',
    label: 'Google Cloud Storage',
    description: 'Bucket in Google Cloud Storage',
    icon: 'bi-cloud',
    note: 'Credentials are read from the gcs.client.<client>.credentials_file keystore setting.',
    summaryKeys: ['bucket', 'base_path'],
  },
  {
    type: 'azure',
    label: 'Azure Blob Storage',
    description: 'Container in a storage account',
    icon: 'bi-cloudy',
    note: 'Account name and key are read from the azure.client.default.* keystore settings.',
    summaryKeys: ['container', 'base_path'],
  },
  {
    type: 'hdfs',
    label: 'Hadoop HDFS',
    description: 'Requires the repository-hdfs plugin',
    icon: 'bi-diagram-3',
    note: 'Install the repository-hdfs plugin on every node before registering the repository.',
    summaryKeys: ['uri', 'path'],
  },
];

export function isRepositoryType(type: string): type is RepositoryType {
  return Object.hasOwn(REPOSITORY_FIELDS, type);
}

export function repositoryTypeInfo(type: string): RepositoryTypeInfo | undefined {
  return REPOSITORY_TYPES.find((info) => info.type === type);
}

/** Whether the label does not already spell out the setting key. */
export function showsSettingKey(field: RepositoryField): boolean {
  return field.label.toLowerCase().replace(/[\s-]+/g, '_') !== field.key;
}

export function repositoryFields(type: string): readonly RepositoryField[] {
  return isRepositoryType(type) ? REPOSITORY_FIELDS[type] : [];
}

function settingText(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

/** Where the repository stores its data, e.g. `/snap/local` or `bucket/path`. */
export function repositorySummary(repository: RepositoryRecord): string {
  const keys = repositoryTypeInfo(repository.type)?.summaryKeys ?? ['location', 'path', 'url'];
  return keys
    .map((key) => settingText(repository.settings[key]))
    .filter(Boolean)
    .join(keys.includes('bucket') || keys.includes('container') ? '/' : ' ');
}

/**
 * Splits settings returned by Elasticsearch (where every value is a string)
 * into form values: boolean fields become booleans and settings without a
 * dedicated field are returned as free-form extras.
 */
export function normalizeRepositorySettings(
  type: string,
  settings: Record<string, unknown>,
): { settings: RepositorySettings; extras: RepositoryExtraSetting[] } {
  const fields = new Map(repositoryFields(type).map((field) => [field.key, field]));
  const known: RepositorySettings = {};
  const extras: RepositoryExtraSetting[] = [];
  for (const [key, raw] of Object.entries(settings ?? {})) {
    const field = fields.get(key);
    const text = settingText(raw);
    if (!field) {
      extras.push({ key, value: text });
    } else if (field.boolean && (text === 'true' || text === 'false')) {
      known[key] = text === 'true';
    } else {
      known[key] = text;
    }
  }
  return { settings: known, extras: extras.sort((left, right) => left.key.localeCompare(right.key)) };
}

/**
 * Mirrors the repository name rules of Elasticsearch: the shared invalid
 * characters, but unlike index or snapshot names upper case is allowed.
 */
export function validateRepositoryName(value: string): string | null {
  const name = value.trim();
  if (!name) {
    return 'Enter a name for the repository';
  }
  if (/\s/.test(name)) {
    return 'Repository names cannot contain spaces';
  }
  if (name.startsWith('_')) {
    return 'Repository names cannot start with "_"';
  }
  const invalid = invalidCharacters(name);
  return invalid.length > 0
    ? `Repository names cannot contain ${invalid.map((character) => `"${character}"`).join(', ')}`
    : null;
}

/** Returns an error for the first problematic free-form setting, if any. */
export function validateExtraSettings(
  type: string,
  extras: readonly RepositoryExtraSetting[],
): string | null {
  const reserved = new Set(repositoryFields(type).map((field) => field.key));
  const seen = new Set<string>();
  for (const extra of extras) {
    const key = extra.key.trim();
    if (!key) {
      if (extra.value.trim()) {
        return 'Every additional setting needs a name';
      }
      continue;
    }
    if (/\s/.test(key)) {
      return `Setting names cannot contain spaces ("${key}")`;
    }
    if (reserved.has(key)) {
      return `"${key}" has its own field above`;
    }
    if (seen.has(key)) {
      return `"${key}" is defined twice`;
    }
    seen.add(key);
  }
  return null;
}

export function buildRepositoryPayload(
  name: string,
  type: RepositoryType | string,
  settings: RepositorySettings,
  extras: readonly RepositoryExtraSetting[] = [],
): RepositoryPayload {
  const cleanName = name.trim();
  if (!cleanName) throw new Error('You must specify a repository name');
  if (!type) throw new Error('You must select a repository type');
  const keys = new Set(repositoryFields(type).map((field) => field.key));
  const cleanSettings = Object.fromEntries(
    Object.entries(settings).filter(([key, value]) => keys.has(key) && value !== '' && value !== undefined),
  ) as RepositorySettings;
  for (const extra of extras) {
    const key = extra.key.trim();
    if (key && !keys.has(key) && extra.value.trim() !== '') {
      cleanSettings[key] = extra.value.trim();
    }
  }
  return { name: cleanName, type, settings: cleanSettings };
}

/**
 * Human readable list of what saving the payload changes on an existing
 * repository, e.g. `location: /a → /b`. Values are compared as strings
 * because Elasticsearch returns every setting as a string.
 */
export function describeRepositoryChanges(
  original: RepositoryRecord,
  payload: RepositoryPayload,
  secretKeys: ReadonlySet<string> = new Set(),
): string[] {
  const changes: string[] = [];
  if (original.type !== payload.type) {
    changes.push(`type: ${original.type} → ${payload.type}`);
  }
  const keys = [...new Set([...Object.keys(original.settings), ...Object.keys(payload.settings)])].sort();
  for (const key of keys) {
    const before = settingText(original.settings[key]);
    const after = settingText(payload.settings[key]);
    if (before === after) {
      continue;
    }
    const show = (value: string) => (secretKeys.has(key) ? '••••' : value);
    if (!before) {
      changes.push(`${key}: set to ${show(after)}`);
    } else if (!after) {
      changes.push(`${key}: removed`);
    } else {
      changes.push(`${key}: ${show(before)} → ${show(after)}`);
    }
  }
  return changes;
}
