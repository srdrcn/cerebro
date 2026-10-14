import { TestBed } from '@angular/core/testing';
import {
  ActivatedRouteSnapshot,
  Router,
  RouterStateSnapshot,
  UrlTree,
  convertToParamMap,
  provideRouter,
} from '@angular/router';
import { signal } from '@angular/core';
import { requireConnection } from './connection.guard';
import { ConnectionService } from './connection.service';

function run(queryParams: Record<string, string>): boolean | UrlTree {
  const route = { queryParamMap: convertToParamMap(queryParams) } as ActivatedRouteSnapshot;
  return TestBed.runInInjectionContext(
    () => requireConnection(route, {} as RouterStateSnapshot) as boolean | UrlTree,
  );
}

describe('requireConnection', () => {
  const connected = signal(false);
  const connect = vi.fn(() => connected.set(true));

  beforeEach(() => {
    connected.set(false);
    connect.mockClear();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: ConnectionService, useValue: { connected, connect } },
      ],
    });
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
