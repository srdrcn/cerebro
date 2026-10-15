import { TestBed } from '@angular/core/testing';
import { RouterTestingHarness } from '@angular/router/testing';
import {
  ActivatedRouteSnapshot,
  Router,
  RouterStateSnapshot,
  UrlTree,
  convertToParamMap,
  provideRouter,
} from '@angular/router';
import { Component, signal } from '@angular/core';
import { hostOrParamsChange, requireConnection } from './connection.guard';
import { ConnectionService } from './connection.service';

function run(queryParams: Record<string, string>): boolean | UrlTree {
  const route = { queryParamMap: convertToParamMap(queryParams) } as ActivatedRouteSnapshot;
  return TestBed.runInInjectionContext(
    () => requireConnection(route, {} as RouterStateSnapshot) as boolean | UrlTree,
  );
}

describe('requireConnection', () => {
  const connected = signal(false);
  const host = signal<string | undefined>(undefined);
  const connect = vi.fn((value: string) => {
    connected.set(true);
    host.set(value);
  });
  const followUrlHost = vi.fn((value: string) => host.set(value));

  beforeEach(() => {
    connected.set(false);
    host.set(undefined);
    connect.mockClear();
    followUrlHost.mockClear();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: ConnectionService, useValue: { connected, host, connect, followUrlHost } },
      ],
    });
  });

  it('switches to the host of the URL when it differs from the connected one', () => {
    connect('http://localhost:9200');
    expect(run({ host: 'http://localhost:9201' })).toBe(true);
    expect(followUrlHost).toHaveBeenCalledWith('http://localhost:9201');
  });

  it('keeps the connection when the URL names the same host or none', () => {
    connect('http://localhost:9200');
    expect(run({ host: 'http://localhost:9200' })).toBe(true);
    expect(run({})).toBe(true);
    expect(followUrlHost).not.toHaveBeenCalled();
  });

  it('lets connected sessions through', () => {
    connected.set(true);
    expect(run({})).toBe(true);
  });

  it('connects from a host query parameter', () => {
    expect(run({ host: 'http://localhost:9200' })).toBe(true);
    expect(connect).toHaveBeenCalledWith('http://localhost:9200');
  });

  it('redirects to connect otherwise', () => {
    const result = run({});
    expect(result).toBeInstanceOf(UrlTree);
    expect(TestBed.inject(Router).serializeUrl(result as UrlTree)).toBe('/connect');
  });
});

@Component({ template: '' })
class ViewStub {}

describe('cluster views and the host query parameter', () => {
  const connected = signal(true);
  const host = signal<string | undefined>('http://a:9200');
  const followUrlHost = vi.fn((value: string) => host.set(value));
  let allowLeave = true;

  beforeEach(() => {
    connected.set(true);
    host.set('http://a:9200');
    followUrlHost.mockClear();
    allowLeave = true;
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          {
            path: '',
            canActivateChild: [requireConnection],
            children: [
              { path: 'overview', component: ViewStub, runGuardsAndResolvers: hostOrParamsChange },
              {
                path: 'aliases',
                component: ViewStub,
                runGuardsAndResolvers: hostOrParamsChange,
                canDeactivate: [() => allowLeave],
              },
            ],
          },
        ]),
        {
          provide: ConnectionService,
          useValue: { connected, host, connect: vi.fn(), followUrlHost },
        },
      ],
    });
  });

  it('follows a host change on the same page (Back after switching clusters)', async () => {
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/overview?host=http://a:9200');
    expect(followUrlHost).not.toHaveBeenCalled();

    await router.navigateByUrl('/overview?host=http://b:9200');
    expect(followUrlHost).toHaveBeenCalledWith('http://b:9200');
    expect(host()).toBe('http://b:9200');
  });

  it('follows a host change to another page', async () => {
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/overview?host=http://a:9200');
    await router.navigateByUrl('/aliases?host=http://b:9200');
    expect(followUrlHost).toHaveBeenCalledWith('http://b:9200');
  });

  it('does not re-run the guards for other query parameters', async () => {
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/aliases?host=http://a:9200');
    allowLeave = false;
    await expect(router.navigateByUrl('/aliases?host=http://a:9200&filter=logs')).resolves.toBe(true);
    expect(followUrlHost).not.toHaveBeenCalled();
  });

  it('keeps the cluster when the page declines to drop unsaved edits', async () => {
    // canDeactivate only runs for a component rendered in an outlet.
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/aliases?host=http://a:9200');
    const router = TestBed.inject(Router);
    allowLeave = false;

    await expect(router.navigateByUrl('/aliases?host=http://b:9200')).resolves.toBe(false);
    expect(followUrlHost).not.toHaveBeenCalled();
    expect(host()).toBe('http://a:9200');
  });
});
