import { describe, expect, it } from 'vitest';
import { mergeIndexSettings } from './index-settings.models';

describe('index settings merge', () => {
  it('lets explicit index settings override defaults and hides metadata fields', () => {
    const response = {
      logs: {
        defaults: {
          'index.number_of_replicas': '1',
          'index.refresh_interval': '1s',
          'index.creation_date': '1720000000000',
          'index.version.created': '9000000',
        },
        settings: {
          'index.refresh_interval': '30s',
          'index.uuid': 'secret-internal-id',
        },
      },
    };
    expect(mergeIndexSettings(response, 'logs')).toEqual({
      'index.number_of_replicas': '1',
      'index.refresh_interval': '30s',
    });
  });
});
