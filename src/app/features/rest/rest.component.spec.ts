import { ElementRef, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AlertService } from '../../core/alert.service';
import { ClipboardService } from '../../core/clipboard.service';
import { ClusterApiService } from '../../core/cluster-api.service';
import { ConnectionService } from '../../core/connection.service';
import { DialogService } from '../../core/dialog.service';
import { RestComponent } from './rest.component';

describe('RestComponent', () => {
  const post = vi.fn();
  const rawPost = vi.fn();
  const confirm = vi.fn();
  const copy = vi.fn();
  const alerts = { error: vi.fn(), info: vi.fn(), warn: vi.fn(), success: vi.fn() };
  const host = signal('http://localhost:9200');

  beforeEach(() => {
    for (const mock of [post, rawPost, confirm, copy, ...Object.values(alerts)]) {
      mock.mockReset();
    }
    host.set('http://localhost:9200');
    try {
      localStorage.clear();
    } catch {
      // ignore
    }
    post.mockImplementation(async (path: string) => {
      if (path === 'rest') {
        return { host: 'http://localhost:9200', indices: ['products'] };
      }
      if (path === 'rest/history') {
        return [];
      }
      throw new Error(`Unexpected path ${path}`);
    });
    TestBed.configureTestingModule({
      providers: [
        { provide: ElementRef, useValue: new ElementRef(document.createElement('cerebro-rest')) },
        { provide: ClusterApiService, useValue: { post, rawPost } },
        { provide: AlertService, useValue: alerts },
        { provide: ClipboardService, useValue: { copy } },
        { provide: DialogService, useValue: { confirm } },
        {
          provide: ConnectionService,
          useValue: { host, connected: signal(true) },
        },
      ],
    });
  });

  function component(): RestComponent {
    return TestBed.runInInjectionContext(() => new RestComponent());
  }

  it('sends the request without a body when the editor is empty', async () => {
    rawPost.mockResolvedValue({ status: 200, body: { status: 'green' } });
    const target = component();
    target.path.set('/_cluster/health');
    const before = post.mock.calls.length;

    await target.send();

    expect(rawPost).toHaveBeenCalledWith('rest/request', { method: 'GET', path: '_cluster/health' });
    const response = target.response();
    expect(response?.status).toBe(200);
    expect(response?.json).toBe(true);
    expect(response?.text).toContain('"status": "green"');
    // The stored history is reloaded after a successful request.
    expect(post.mock.calls.slice(before)).toEqual([['rest/history']]);
    expect(target.sending()).toBe(false);
  });

  it('shows Elasticsearch errors with their status and does not record them', async () => {
    rawPost.mockResolvedValue({ status: 404, body: { error: 'index_not_found_exception' } });
    const target = component();
    target.method.set('POST');
    target.path.set('missing/_search');
    target.body.set('{"size":1}');
    const historyLoads = () => post.mock.calls.filter(([path]) => path === 'rest/history').length;
    const before = historyLoads();

    await target.send();

    expect(rawPost).toHaveBeenCalledWith('rest/request', {
      method: 'POST',
      path: 'missing/_search',
      data: { size: 1 },
    });
    expect(target.response()?.status).toBe(404);
    expect(historyLoads()).toBe(before);
  });

  it('refuses an empty path and asks before sending invalid JSON as raw text', async () => {
    const target = component();
    await target.send();
    expect(alerts.warn).toHaveBeenCalledTimes(1);

    target.path.set('_search');
    target.body.set('{oops');
    confirm.mockResolvedValueOnce(false);
    await target.send();
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ confirmLabel: 'Send as raw text' }));
    expect(rawPost).not.toHaveBeenCalled();

    rawPost.mockResolvedValue({ status: 400, body: { error: 'parse' } });
    confirm.mockResolvedValueOnce(true);
    await target.send();
    expect(rawPost).toHaveBeenCalledWith('rest/request', { method: 'GET', path: '_search', data: '{oops' });
  });

  it('retries the failed _cat request, not the edited one, with format=json', async () => {
    rawPost.mockResolvedValueOnce({ status: 500, body: { error: 'Unexpected character' } });
    const target = component();
    target.path.set('_cat/health');
    await target.send();
    expect(target.canUseJsonFormat()).toBe(true);

    target.method.set('POST');
    target.path.set('products/_count');
    rawPost.mockResolvedValueOnce({ status: 200, body: [] });
    await target.useJsonFormat();

    expect(rawPost).toHaveBeenLastCalledWith('rest/request', {
      method: 'GET',
      path: '_cat/health?format=json',
    });
    expect(target.path()).toBe('_cat/health?format=json');
  });

  it('does not ask for confirmation when deleting a wildcard alias', async () => {
    rawPost.mockResolvedValue({ status: 200, body: { acknowledged: true } });
    const target = component();
    target.method.set('DELETE');
    target.path.set('tmp-rest-*/_alias/x');

    await target.send();

    expect(confirm).not.toHaveBeenCalled();
    expect(rawPost).toHaveBeenCalled();
  });

  it('falls back to GET for history entries with an unknown method', () => {
    const target = component();
    target.restore({ method: 'HEAD', path: 'products', body: '{}', created_at: '' });
    expect(target.method()).toBe('GET');
  });

  it('confirms DELETE requests that drop whole indices', async () => {
    confirm.mockResolvedValue(false);
    const target = component();
    target.method.set('DELETE');
    target.path.set('tmp-rest-*');

    await target.send();

    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ tone: 'danger', items: ['tmp-rest-*'] }));
    expect(rawPost).not.toHaveBeenCalled();
  });

  it('reports unreachable servers without a status', async () => {
    rawPost.mockRejectedValue({ message: 'Http failure response for rest/request: 0 Unknown Error' });
    const target = component();
    target.path.set('_cat/indices?format=json');

    await target.send();

    expect(target.response()?.status).toBeNull();
    expect(target.response()?.hint).toContain('could not reach');
    expect(target.sending()).toBe(false);
  });

  it('restores history entries into the editor', () => {
    const target = component();
    target.tab.set('history');
    target.restore({ method: 'POST', path: '_bulk', body: '{"index":{}}\n{"a":1}', created_at: '' });

    expect(target.method()).toBe('POST');
    expect(target.path()).toBe('_bulk');
    expect(target.body()).toBe('{"index":{}}\n{"a":1}\n');
    expect(target.tab()).toBe('body');
  });

  it('copies the request as cURL using the endpoint host', async () => {
    const target = component();
    await target.loadIndex();
    target.path.set('products/_search');
    target.body.set('{"size":1}');

    await target.copyAsCurl();

    expect(copy).toHaveBeenCalledWith(
      expect.stringContaining("--url 'http://localhost:9200/products/_search'"),
      expect.any(Function),
      expect.any(Function),
    );
  });

  it('forgets the previous cluster when the host changes', async () => {
    const target = component();
    TestBed.tick();
    await target.loadIndex();
    expect(target.endpoint()).toBe('http://localhost:9200');
    rawPost.mockResolvedValue({ status: 200, body: {} });
    target.path.set('_cluster/health');
    await target.send();
    expect(target.response()).not.toBeNull();

    post.mockImplementation(async (path: string) => {
      if (path === 'rest') {
        throw new Error('forbidden');
      }
      return [];
    });
    host.set('http://other:9200');
    TestBed.tick();
    await Promise.resolve();

    expect(target.response()).toBeNull();
    expect(target.endpoint()).toBe('');
    expect(target.prefix()).toBe('other:9200/');
  });
});
