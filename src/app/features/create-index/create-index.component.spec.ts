import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AlertService } from '../../core/alert.service';
import { ClusterApiError } from '../../core/api-envelope';
import { ClusterApiService } from '../../core/cluster-api.service';
import { ConnectionService } from '../../core/connection.service';
import { DialogService } from '../../core/dialog.service';
import { CreateIndexComponent } from './create-index.component';

/** `create_index/get_index_metadata` of logs-2026.10.13, trimmed. */
const LOGS_METADATA = {
  settings: {
    index: {
      number_of_shards: '3',
      number_of_replicas: '1',
      uuid: 'OmGS-VGIS--ZRF55In4gEQ',
      creation_date: '1792000000000',
      provided_name: 'logs-2026.10.13',
      version: { created: '8512000' },
    },
  },
  mappings: { properties: { message: { type: 'text' }, '@timestamp': { type: 'date' } } },
};

describe('CreateIndexComponent', () => {
  const post = vi.fn();
  const alerts = { error: vi.fn(), success: vi.fn(), info: vi.fn(), warn: vi.fn() };
  const dialogs = { confirm: vi.fn(), showJson: vi.fn() };
  let navigate: ReturnType<typeof vi.fn>;

  function setUp(params: Record<string, string>): void {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: ClusterApiService, useValue: { post } },
        { provide: AlertService, useValue: alerts },
        { provide: DialogService, useValue: dialogs },
        { provide: ConnectionService, useValue: { connected: () => false, hostQuery: () => ({ host: 'http://localhost:9200' }) } },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(params) } } },
      ],
    });
    navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true) as unknown as ReturnType<typeof vi.fn>;
  }

  function component(): CreateIndexComponent {
    return TestBed.runInInjectionContext(() => new CreateIndexComponent());
  }

  /** Lets afterNextRender callbacks run. */
  async function render(): Promise<void> {
    TestBed.inject(ApplicationRef).tick();
    await Promise.resolve();
  }

  beforeEach(() => {
    post.mockReset();
    Object.values(alerts).forEach((mock) => mock.mockReset());
    dialogs.confirm.mockReset();
  });

  afterEach(() => TestBed.resetTestingModule());

  it('prefills the name and copies the index of a link, then cleans the URL', async () => {
    post.mockResolvedValue(LOGS_METADATA);
    setUp({ host: 'http://localhost:9200', name: 'tmp-index-ops-dst', from: 'logs-2026.10.13' });
    const target = component();
    expect(target.name()).toBe('tmp-index-ops-dst');
    expect(target.sourceIndex()).toBe('logs-2026.10.13');
    expect(target.copying()).toBe(true);
    await vi.waitFor(() => expect(target.copying()).toBe(false));

    expect(post).toHaveBeenCalledWith('create_index/get_index_metadata', { index: 'logs-2026.10.13' });
    expect(JSON.parse(target.body())).toEqual({
      settings: { index: { number_of_shards: '3', number_of_replicas: '1' } },
      mappings: LOGS_METADATA.mappings,
    });
    expect(target.copyInfo()?.index).toBe('logs-2026.10.13');
    // Nobody confirmed anything: the body was empty.
    expect(dialogs.confirm).not.toHaveBeenCalled();

    await render();
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate.mock.calls[0]?.[1]).toMatchObject({
      queryParams: { name: null, from: null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  });

  it('prefills the name alone', async () => {
    setUp({ name: 'logs-copy' });
    const target = component();
    expect(target.name()).toBe('logs-copy');
    expect(target.sourceIndex()).toBe('');
    expect(post).not.toHaveBeenCalledWith('create_index/get_index_metadata', expect.anything());
    // Edits from a link count as pending changes.
    expect(target.dirty()).toBe(true);
    await render();
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it('reports an index that cannot be copied and keeps the form usable', async () => {
    post.mockRejectedValue(new ClusterApiError(404, { error: { type: 'index_not_found_exception', reason: 'no such index [gone]' } }));
    setUp({ from: 'gone' });
    const target = component();
    await vi.waitFor(() => expect(target.copying()).toBe(false));
    expect(target.sourceIndex()).toBe('');
    expect(target.body()).toBe('');
    expect(alerts.error).toHaveBeenCalledWith('Could not load the settings and mappings of gone: no such index [gone]', expect.anything());
  });

  it('leaves a plain visit and its URL alone', async () => {
    setUp({ host: 'http://localhost:9200' });
    const target = component();
    await render();
    expect(target.name()).toBe('');
    expect(target.dirty()).toBe(false);
    expect(post).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });
});
