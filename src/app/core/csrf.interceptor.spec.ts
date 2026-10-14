import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { csrfInterceptor } from './csrf.interceptor';

describe('csrfInterceptor', () => {
  let http: HttpClient;
  let controller: HttpTestingController;
  let meta: HTMLMetaElement;

  beforeEach(() => {
    meta = document.createElement('meta');
    meta.name = 'csrf-token';
    meta.content = 'test-token';
    document.head.appendChild(meta);

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([csrfInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpClient);
    controller = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    controller.verify();
    meta.remove();
  });

  it('adds the token to unsafe same-origin requests', () => {
    http.post('overview', {}).subscribe();
    const request = controller.expectOne('overview');

    expect(request.request.headers.get('Csrf-Token')).toBe('test-token');
    request.flush({});
  });

  it('does not add the token to safe requests', () => {
    http.get('connect/hosts').subscribe();
    const request = controller.expectOne('connect/hosts');

    expect(request.request.headers.has('Csrf-Token')).toBe(false);
    request.flush({});
  });

  it('does not leak the token to another origin', () => {
    http.post('https://example.test/collect', {}).subscribe();
    const request = controller.expectOne('https://example.test/collect');

    expect(request.request.headers.has('Csrf-Token')).toBe(false);
    request.flush({});
  });

  it('does not treat protocol-relative cross-origin URLs as local', () => {
    http.post('//example.test/collect', {}).subscribe();
    const request = controller.expectOne('//example.test/collect');

    expect(request.request.headers.has('Csrf-Token')).toBe(false);
    request.flush({});
  });
});
