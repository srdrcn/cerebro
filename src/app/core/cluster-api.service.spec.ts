import { DOCUMENT } from '@angular/common';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { AlertService } from './alert.service';
import { ClusterApiService } from './cluster-api.service';
import { ConnectionService } from './connection.service';

describe('ClusterApiService', () => {
  let http: HttpTestingController;
  let service: ClusterApiService;
  const host = signal<string | undefined>('http://localhost:9200');
  const navigate = vi.fn().mockResolvedValue(true);
  const assign = vi.fn();
  const alertError = vi.fn();

  beforeEach(() => {
    navigate.mockClear();
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
        { provide: Router, useValue: { navigate } },
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

  it('routes ES 401 to Connect with the host retained', async () => {
    const result = service.rawPost('nodes');
    http.expectOne('nodes').flush({ status: 401, body: {} });

    await result;
    expect(navigate).toHaveBeenCalledWith(['/connect'], {
      queryParams: {
        host: 'http://localhost:9200',
        unauthorized: true,
      },
    });
  });

  it('performs a full relative login redirect for inner 303', async () => {
    const result = service.rawPost('navbar');
    http.expectOne('navbar').flush({ status: 303, body: null });

    await result;
    expect(assign).toHaveBeenCalledWith('./login');
  });
});
