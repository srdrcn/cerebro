export interface SnapshotIndex {
  name: string;
  special: boolean;
}

export interface SnapshotRecord {
  snapshot: string;
  uuid?: string;
  start_time?: string;
  state?: string;
  indices?: string[];
  [key: string]: unknown;
}

export interface SnapshotLandingData {
  indices: SnapshotIndex[];
  repositories: string[];
}

export interface CreateSnapshotForm {
  repository: string;
  snapshot: string;
  ignoreUnavailable: boolean;
  includeGlobalState: boolean;
  indices: string[];
}

export interface RestoreSnapshotForm {
  renamePattern: string;
  renameReplacement: string;
  ignoreUnavailable: boolean;
  includeAliases: boolean;
  includeGlobalState: boolean;
  indices: string[];
}

function withSelectedIndices(payload: Record<string, unknown>, indices: readonly string[]): Record<string, unknown> {
  return indices.length ? { ...payload, indices: [...indices] } : payload;
}

export function buildCreateSnapshotPayload(form: CreateSnapshotForm): Record<string, unknown> {
  const repository = form.repository.trim();
  const snapshot = form.snapshot.trim();
  if (!repository) throw new Error('You must select a repository');
  if (!snapshot) throw new Error('You must specify a snapshot name');
  return withSelectedIndices({
    repository,
    snapshot,
    ignoreUnavailable: form.ignoreUnavailable,
    includeGlobalState: form.includeGlobalState,
  }, form.indices);
}

export function buildRestoreSnapshotPayload(
  repository: string,
  snapshot: string,
  form: RestoreSnapshotForm,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    repository,
    snapshot,
    ignoreUnavailable: form.ignoreUnavailable,
    includeAliases: form.includeAliases,
    includeGlobalState: form.includeGlobalState,
  };
  if (form.renamePattern.trim()) payload['renamePattern'] = form.renamePattern.trim();
  if (form.renameReplacement.trim()) payload['renameReplacement'] = form.renameReplacement.trim();
  return withSelectedIndices(payload, form.indices);
}

export function defaultRestoreForm(): RestoreSnapshotForm {
  return {
    renamePattern: '',
    renameReplacement: '',
    ignoreUnavailable: true,
    includeAliases: true,
    includeGlobalState: true,
    indices: [],
  };
}
