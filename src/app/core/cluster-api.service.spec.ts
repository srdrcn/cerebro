import { DOCUMENT } from '@angular/common';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { AlertService, isErrorReported } from './alert.service';
import { ClusterApiService } from './cluster-api.service';
import { ConnectionService } from './connection.service';

describe('ClusterApiService', () => {
  let http: HttpTestingController;
  let service: ClusterApiService;
  const host = signal<string | undefined>('http://localhost:9200');
  const navigate = vi.fn().mockResolvedValue(true);
  const router = {
    navigate,
    url: '/cat?api=nodes&host=http%3A%2F%2Flocalhost%3A9200',
    currentNavigation: signal<{ finalUrl?: string; extractedUrl?: string } | null>(null),
    serializeUrl: (url: string) => url,
  };
  const assign = vi.fn();
  const alertError = vi.fn();

  beforeEach(() => {
    navigate.mockReset();
    navigate.mockResolvedValue(true);
    router.url = '/cat?api=nodes&host=http%3A%2F%2Flocalhost%3A9200';
    router.currentNavigation.set(null);
    assign.mockClear();
    alertError.mockClear();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: ConnectionService,
          useValue: {
            host: host.asReadonly(),
            snapshot: () => ({
              host: host() ?? '',
              username: 'elastic',
              password: 'secret',
            }),
          },
        },
        { provide: AlertService, useValue: { error: alertError } },
        { provide: Router, useValue: router },
        {
          provide: DOCUMENT,
          useValue: {
            defaultView: { location: { assign } },
          } as unknown as Document,
        },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    service = TestBed.inject(ClusterApiService);
  });

  afterEach(() => http.verify());

  it('merges connection data and unwraps a successful inner envelope', async () => {
    const result = service.post<{ cluster_name: string }>('/navbar', {
      detail: true,
      host: 'must-not-win',
    });

    const request = http.expectOne('navbar');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({
      detail: true,
      host: 'http://localhost:9200',
      username: 'elastic',
      password: 'secret',
    });
    request.flush({ status: 200, body: { cluster_name: 'local' } });

    await expect(result).resolves.toEqual({ cluster_name: 'local' });
  });

  it('preserves a non-successful inner status in rawPost', async () => {
    const result = service.rawPost<{ error: string }>('overview');
    http.expectOne('overview').flush({
      status: 403,
      body: { error: 'forbidden' },
    });

    await expect(result).resolves.toEqual({
      status: 403,
      body: { error: 'forbidden' },
    });
  });

  it('throws ClusterApiError when post receives an inner error', async () => {
    const result = service.post('overview');
    http.expectOne('overview').flush({ status: 500, body: { error: 'boom' } });

    await expect(result).rejects.toMatchObject({
      status: 500,
      body: { error: 'boom' },
    });
  });

  it('routes ES 401 to Connect, replacing the entry and remembering the page', async () => {
    const result = service.rawPost('nodes');
    http.expectOne('nodes').flush({ status: 401, body: {} });

    await result;
    expect(navigate).toHaveBeenCalledWith(['/connect'], {
      queryParams: {
        host: 'http://localhost:9200',
        unauthorized: true,
        returnUrl: '/cat?api=nodes&host=http%3A%2F%2Flocalhost%3A9200',
      },
      replaceUrl: true,
    });
  });

  it('marks a 401 failure as reported so pages do not toast it', async () => {
    const result = service.post('overview');
    http.expectOne('overview').flush({ status: 401, body: { error: 'unauthorized' } });

    const error = await result.catch((caught: unknown) => caught);
    expect(error).toMatchObject({ status: 401 });
    expect(isErrorReported(error)).toBe(true);
  });

  it('leaves other failures for the page to report', async () => {
    const result = service.post('overview');
    http.expectOne('overview').flush({ status: 403, body: { error: 'forbidden' } });

    expect(isErrorReported(await result.catch((caught: unknown) => caught))).toBe(false);
  });

  it('returns to the deep link that is still loading', async () => {
    router.url = '/';
    router.currentNavigation.set({ finalUrl: '/nodes?host=x' });
    const result = service.rawPost('nodes');
    http.expectOne('nodes').flush({ status: 401, body: {} });

    await result;
    expect(navigate.mock.calls[0][1].queryParams.returnUrl).toBe('/nodes?host=x');
  });

  it('omits returnUrl when there is no page to return to', async () => {
    router.url = '/';
    const result = service.rawPost('nodes');
    http.expectOne('nodes').flush({ status: 401, body: {} });

    await result;
    expect(navigate.mock.calls[0][1].queryParams.returnUrl).toBeNull();
  });

  it('redirects once for concurrent 401s', async () => {
    let finish: (value: boolean) => void = () => undefined;
    navigate.mockReturnValueOnce(new Promise<boolean>((resolve) => (finish = resolve)));
    const first = service.rawPost('navbar');
    const second = service.rawPost('overview');
    http.expectOne('navbar').flush({ status: 401, body: {} });
    http.expectOne('overview').flush({ status: 401, body: {} });
    await Promise.resolve();
    await Promise.resolve();
    finish(true);

    await Promise.all([first, second]);
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it('does not redirect while the user is already on Connect', async () => {
    router.url = '/connect?host=http%3A%2F%2Flocalhost%3A9200&unauthorized=true&returnUrl=%2Fcat';
    const result = service.rawPost('navbar');
    http.expectOne('navbar').flush({ status: 401, body: {} });

    await expect(result).resolves.toEqual({ status: 401, body: {} });
    expect(navigate).not.toHaveBeenCalled();
  });

  it('does not redirect while a navigation to Connect is under way', async () => {
    router.currentNavigation.set({ finalUrl: '/connect?host=x' });
    const result = service.rawPost('navbar');
    http.expectOne('navbar').flush({ status: 401, body: {} });

    await result;
    expect(navigate).not.toHaveBeenCalled();
  });

  it('reports a network failure once and marks the error as reported', async () => {
    const result = service.post('nodes');
    http.expectOne('nodes').error(new ProgressEvent('error'));

    const error = await result.catch((caught: unknown) => caught);
    expect(alertError).toHaveBeenCalledTimes(1);
    expect(alertError).toHaveBeenCalledWith('Error connecting to the server', expect.anything());
    expect(isErrorReported(error)).toBe(true);
  });

  it('performs a full relative login redirect for inner 303', async () => {
    const result = service.rawPost('navbar');
    http.expectOne('navbar').flush({ status: 303, body: null });

    await result;
    expect(assign).toHaveBeenCalledWith('./login');
  });
});
