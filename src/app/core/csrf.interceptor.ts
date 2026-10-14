import { HttpInterceptorFn } from '@angular/common/http';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function isSameOrigin(url: string): boolean {
  try {
    return new URL(url, document.baseURI).origin === window.location.origin;
  } catch {
    return false;
  }
}

export const csrfInterceptor: HttpInterceptorFn = (request, next) => {
  const token = document
    .querySelector<HTMLMetaElement>('meta[name="csrf-token"]')
    ?.content.trim();

  if (
    token &&
    !SAFE_METHODS.has(request.method.toUpperCase()) &&
    isSameOrigin(request.url)
  ) {
    return next(request.clone({ setHeaders: { 'Csrf-Token': token } }));
  }
  return next(request);
};
