import { describe, expect, it } from 'vitest';
import {
  REPOSITORY_FIELDS,
  REPOSITORY_TYPES,
  buildRepositoryPayload,
  describeRepositoryChanges,
  isRepositoryType,
  normalizeRepositorySettings,
  repositoryFields,
  repositorySummary,
  repositoryTypeInfo,
  showsSettingKey,
  validateExtraSettings,
  validateRepositoryName,
} from './repositories.models';

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

  it('adds free-form settings that have no dedicated field', () => {
    expect(
      buildRepositoryPayload('local', 'fs', { location: '/snap/a' }, [
        { key: ' max_number_of_snapshots ', value: ' 500 ' },
        { key: 'location', value: '/ignored' },
        { key: '', value: '' },
        { key: 'empty', value: '  ' },
      ]),
    ).toEqual({
      name: 'local',
      type: 'fs',
      settings: { location: '/snap/a', max_number_of_snapshots: '500' },
    });
  });

  it('keeps plugin repository types and their settings', () => {
    expect(buildRepositoryPayload('src', 'source', { location: 'x' }, [{ key: 'delegate_type', value: 'fs' }])).toEqual({
      name: 'src',
      type: 'source',
      settings: { delegate_type: 'fs' },
    });
  });

  it('rejects missing names and types', () => {
    expect(() => buildRepositoryPayload(' ', 'fs', {})).toThrow(/name/);
    expect(() => buildRepositoryPayload('a', '', {})).toThrow(/type/);
  });
});

describe('repository types', () => {
  it('describes every type that has fields', () => {
    expect(REPOSITORY_TYPES.map((info) => info.type).sort()).toEqual(Object.keys(REPOSITORY_FIELDS).sort());
    expect(repositoryTypeInfo('s3')?.label).toBe('Amazon S3');
    expect(repositoryTypeInfo('source')).toBeUndefined();
  });

  it('shows the setting key when the label differs from it', () => {
    const fields = repositoryFields('fs');
    const byKey = (key: string) => fields.find((field) => field.key === key)!;
    expect(showsSettingKey(byKey('location'))).toBe(false);
    expect(showsSettingKey(byKey('chunk_size'))).toBe(false);
    expect(showsSettingKey(byKey('compress'))).toBe(true);
    expect(showsSettingKey(byKey('max_restore_bytes_per_sec'))).toBe(true);
  });

  it('recognises built-in types only', () => {
    expect(isRepositoryType('fs')).toBe(true);
    expect(isRepositoryType('source')).toBe(false);
    expect(isRepositoryType('toString')).toBe(false);
    expect(repositoryFields('source')).toEqual([]);
  });
});

describe('repository settings', () => {
  it('converts boolean strings and collects unknown settings', () => {
    expect(
      normalizeRepositorySettings('fs', {
        location: '/snap/local',
        compress: 'true',
        readonly: 'maybe',
        max_number_of_snapshots: 500,
        nested: { a: 1 },
      }),
    ).toEqual({
      settings: { location: '/snap/local', compress: true, readonly: 'maybe' },
      extras: [
        { key: 'max_number_of_snapshots', value: '500' },
        { key: 'nested', value: '{"a":1}' },
      ],
    });
  });

  it('summarises where the data lives', () => {
    expect(repositorySummary({ name: 'a', type: 'fs', settings: { location: '/snap/local' } })).toBe('/snap/local');
    expect(repositorySummary({ name: 'b', type: 's3', settings: { bucket: 'backups', base_path: 'prod' } })).toBe(
      'backups/prod',
    );
    expect(repositorySummary({ name: 'c', type: 'hdfs', settings: { uri: 'hdfs://nn:8020/', path: '/snaps' } })).toBe(
      'hdfs://nn:8020/ /snaps',
    );
    expect(repositorySummary({ name: 'd', type: 'source', settings: { location: 'x' } })).toBe('x');
    expect(repositorySummary({ name: 'e', type: 'gcs', settings: {} })).toBe('');
  });
});

describe('repository validation', () => {
  it('validates names like Elasticsearch does', () => {
    expect(validateRepositoryName('backups')).toBeNull();
    expect(validateRepositoryName('Backups-2')).toBeNull();
    expect(validateRepositoryName('')).toMatch(/Enter/);
    expect(validateRepositoryName('my repo')).toMatch(/spaces/);
    expect(validateRepositoryName('_hidden')).toBeNull();
    expect(validateRepositoryName('a#b')).toMatch(/"#"/);
    expect(validateRepositoryName('a/b,c')).toBe('Repository names cannot contain "/", ","');
  });

  it('validates free-form settings', () => {
    expect(validateExtraSettings('fs', [{ key: '', value: '' }])).toBeNull();
    expect(validateExtraSettings('fs', [{ key: 'max_number_of_snapshots', value: '5' }])).toBeNull();
    expect(validateExtraSettings('fs', [{ key: '', value: 'x' }])).toMatch(/needs a name/);
    expect(validateExtraSettings('fs', [{ key: 'location', value: 'x' }])).toMatch(/own field/);
    expect(validateExtraSettings('fs', [{ key: 'a b', value: 'x' }])).toMatch(/spaces/);
    expect(
      validateExtraSettings('fs', [
        { key: 'x', value: '1' },
        { key: 'x', value: '2' },
      ]),
    ).toMatch(/twice/);
  });
});

describe('describeRepositoryChanges', () => {
  const original = { name: 'local', type: 'fs', settings: { location: '/snap/a', compress: 'true', chunk_size: '1g' } };

  it('lists changed, added and removed settings', () => {
    expect(
      describeRepositoryChanges(original, {
        name: 'local',
        type: 'fs',
        settings: { location: '/snap/b', compress: true, readonly: true },
      }),
    ).toEqual(['chunk_size: removed', 'location: /snap/a → /snap/b', 'readonly: set to true']);
  });

  it('reports type changes and masks secrets', () => {
    expect(
      describeRepositoryChanges(
        { name: 'r', type: 's3', settings: { secret_key: 'old' } },
        { name: 'r', type: 'gcs', settings: { secret_key: 'new' } },
        new Set(['secret_key']),
      ),
    ).toEqual(['type: s3 → gcs', 'secret_key: •••• → ••••']);
  });

  it('returns nothing when the settings are unchanged', () => {
    expect(
      describeRepositoryChanges(original, {
        name: 'local',
        type: 'fs',
        settings: { location: '/snap/a', compress: true, chunk_size: '1g' },
      }),
    ).toEqual([]);
  });
});
