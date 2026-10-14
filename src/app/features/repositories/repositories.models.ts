export type RepositoryType = 'fs' | 'url' | 's3' | 'gcs' | 'hdfs' | 'azure';
export type RepositorySettingValue = string | boolean;
export type RepositorySettings = Partial<Record<string, RepositorySettingValue>>;

export interface RepositoryRecord {
  name: string;
  type: RepositoryType;
  settings: RepositorySettings;
}

export interface RepositoryField {
  key: string;
  label: string;
  placeholder: string;
  boolean?: boolean;
  wide?: boolean;
  secret?: boolean;
}

const sharedRateFields: RepositoryField[] = [
  { key: 'max_restore_bytes_per_sec', label: 'max_restore_bytes_per_sec', placeholder: 'Restore throttle per node (for example 20mb)' },
  { key: 'max_snapshot_bytes_per_sec', label: 'max_snapshot_bytes_per_sec', placeholder: 'Snapshot throttle per node (for example 20mb)' },
];

export const REPOSITORY_FIELDS: Record<RepositoryType, RepositoryField[]> = {
  fs: [
    { key: 'location', label: 'Location', placeholder: 'Location of the snapshots', wide: true },
    ...sharedRateFields,
    { key: 'chunk_size', label: 'Chunk size', placeholder: '1g, 10m, 5k' },
    { key: 'compress', label: 'Compress snapshot files', placeholder: '', boolean: true },
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

export function buildRepositoryPayload(
  name: string,
  type: RepositoryType | '',
  settings: RepositorySettings,
): { name: string; type: RepositoryType; settings: RepositorySettings } {
  const cleanName = name.trim();
  if (!cleanName) throw new Error('You must specify a repository name');
  if (!type) throw new Error('You must select a repository type');
  const keys = new Set(REPOSITORY_FIELDS[type].map((field) => field.key));
  const cleanSettings = Object.fromEntries(
    Object.entries(settings).filter(([key, value]) => keys.has(key) && value !== ''),
  ) as RepositorySettings;
  return { name: cleanName, type, settings: cleanSettings };
}
