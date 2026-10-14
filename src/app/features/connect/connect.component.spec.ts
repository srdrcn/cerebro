import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, UrlTree, convertToParamMap } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AlertService } from '../../core/alert.service';
import { ConnectionService } from '../../core/connection.service';
import { ConnectApiService } from './connect-api.service';
import { ConnectComponent } from './connect.component';

const SECURED = 'http://localhost:9201';

describe('ConnectComponent', () => {
  const testConnection = vi.fn();
  const connect = vi.fn();
  const navigate = vi.fn(async (..._args: unknown[]) => true);
  const navigateByUrl = vi.fn(async (..._args: unknown[]) => true);

  function component(params: Record<string, string>): ConnectComponent {
    TestBed.configureTestingModule({
      providers: [
        { provide: ConnectApiService, useValue: { testConnection, getHosts: async () => [] } },
        { provide: ConnectionService, useValue: { connect, host: () => undefined } },
        { provide: AlertService, useValue: { error: vi.fn() } },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(params) } } },
      ],
    });
    const router = TestBed.inject(Router);
    vi.spyOn(router, 'navigate').mockImplementation(navigate);
    vi.spyOn(router, 'navigateByUrl').mockImplementation(navigateByUrl);
    const target = TestBed.runInInjectionContext(() => new ConnectComponent());
    target.ngOnInit();
    return target;
  }

  async function signIn(params: Record<string, string>): Promise<void> {
    const target = component({ host: SECURED, unauthorized: 'true', ...params });
    target.username.set('elastic');
    target.password.set('changeme');
    await target.authorize();
    expect(connect).toHaveBeenCalledWith(SECURED, 'elastic', 'changeme');
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
    testConnection.mockReset().mockResolvedValue({ status: 200, body: {} });
    connect.mockReset();
    navigate.mockClear();
    navigateByUrl.mockClear();
  });

  it('goes back to the page that asked for credentials, with the connected host', async () => {
    await signIn({ returnUrl: '/cat?api=nodes&host=http%3A%2F%2Fold&unauthorized=true' });

    expect(navigate).not.toHaveBeenCalled();
    const url = TestBed.inject(Router).serializeUrl(navigateByUrl.mock.calls[0]?.[0] as UrlTree);
    expect(url).toBe('/cat?api=nodes&host=http:%2F%2Flocalhost:9201');
  });

  it.each(['//evil.example/x', 'https://evil.example/', '/connect?host=x', 'cat', '/'])(
    'falls back to the overview for returnUrl %s',
    async (returnUrl) => {
      await signIn({ returnUrl });

      expect(navigateByUrl).not.toHaveBeenCalled();
      expect(navigate).toHaveBeenCalledWith(['/overview'], { queryParams: { host: SECURED } });
    },
  );

  it('forgets the page when the user picks another cluster', async () => {
    const target = component({ host: SECURED, unauthorized: 'true', returnUrl: '/nodes' });
    target.cancelAuthorization();
    await target.connectTo('http://localhost:9200');

    expect(navigateByUrl).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenLastCalledWith(['/overview'], { queryParams: { host: 'http://localhost:9200' } });
  });
});
