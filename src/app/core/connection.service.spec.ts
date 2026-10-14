import { DOCUMENT } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { RefreshService } from './refresh.service';
import { ConnectionService } from './connection.service';

describe('ConnectionService', () => {
  it('restores the host from the hash and keeps credentials in memory', () => {
    const replaceState = vi.fn();
    const navigate = vi.fn().mockResolvedValue(true);
    const refresh = vi.fn();
    const fakeDocument = {
      defaultView: {
        location: {
          hash: '#/connect?host=http%3A%2F%2Flocalhost%3A9200',
          pathname: '/cerebro/',
          search: '',
        },
        history: { replaceState },
      },
    } as unknown as Document;

    TestBed.configureTestingModule({
      providers: [
        { provide: DOCUMENT, useValue: fakeDocument },
        { provide: Router, useValue: { navigate } },
        { provide: RefreshService, useValue: { refresh } },
      ],
    });

    const service = TestBed.inject(ConnectionService);
    expect(service.host()).toBe('http://localhost:9200');
    expect(service.connected()).toBe(true);

    service.connect(' https://example.test:9243 ', 'elastic', 'secret');

    expect(service.snapshot()).toEqual({
      host: 'https://example.test:9243',
      username: 'elastic',
      password: 'secret',
    });
    expect(replaceState).toHaveBeenCalledWith(
      null,
      '',
      '/cerebro/#/connect?host=https%3A%2F%2Fexample.test%3A9243',
    );
    expect(replaceState.mock.calls[0]?.[2]).not.toContain('secret');
    expect(refresh).toHaveBeenCalledOnce();

    service.disconnect();
    expect(service.connected()).toBe(false);
    expect(navigate).toHaveBeenCalledWith(['/connect'], {
      queryParams: { host: 'https://example.test:9243' },
      replaceUrl: true,
    });
  });
});
