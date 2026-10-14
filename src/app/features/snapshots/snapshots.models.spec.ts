import { describe, expect, it } from 'vitest';
import { buildCreateSnapshotPayload, buildRestoreSnapshotPayload, defaultRestoreForm } from './snapshots.models';

describe('snapshot payload builders', () => {
  it('omits indices when none are selected so Elasticsearch defaults to all', () => {
    expect(buildCreateSnapshotPayload({
      repository: 'repo', snapshot: 'nightly', ignoreUnavailable: false, includeGlobalState: true, indices: [],
    })).toEqual({
      repository: 'repo', snapshot: 'nightly', ignoreUnavailable: false, includeGlobalState: true,
    });
  });

  it('includes rename and selected-index restore options', () => {
    const form = defaultRestoreForm();
    form.renamePattern = '(.+)';
    form.renameReplacement = 'restored_$1';
    form.indices = ['logs', 'metrics'];
    expect(buildRestoreSnapshotPayload('repo', 'nightly', form)).toEqual({
      repository: 'repo', snapshot: 'nightly', renamePattern: '(.+)', renameReplacement: 'restored_$1',
      ignoreUnavailable: true, includeAliases: true, includeGlobalState: true, indices: ['logs', 'metrics'],
    });
  });
});
