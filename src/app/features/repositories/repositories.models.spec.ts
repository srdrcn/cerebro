import { describe, expect, it } from 'vitest';
import { buildRepositoryPayload } from './repositories.models';

describe('repository payload builder', () => {
  it('keeps typed boolean fields and removes fields from a different repository type', () => {
    expect(buildRepositoryPayload(' backups ', 's3', {
      bucket: 'snapshots',
      compress: false,
      load_defaults: true,
      base_path: '',
    })).toEqual({
      name: 'backups',
      type: 's3',
      settings: { bucket: 'snapshots', compress: false },
    });
  });
});
