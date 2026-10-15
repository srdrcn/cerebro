import {
  ApplicationConfig,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from '@angular/core';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  RouteReuseStrategy,
  provideRouter,
  withHashLocation,
  withInMemoryScrolling,
  withRouterConfig,
} from '@angular/router';
import { routes } from './app.routes';
import { ClusterRouteReuseStrategy } from './core/cluster-route-reuse';
import { csrfInterceptor } from './core/csrf.interceptor';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    provideHttpClient(withInterceptors([csrfInterceptor])),
    provideRouter(
      routes,
      withHashLocation(),
      withInMemoryScrolling({ scrollPositionRestoration: 'top' }),
      // A cancelled Back/Forward (e.g. "Keep editing") returns to the entry
      // the user came from instead of rewriting the history.
      withRouterConfig({ canceledNavigationResolution: 'computed' }),
    ),
    // A new ?host= recreates the page instead of reusing it (see the class).
    { provide: RouteReuseStrategy, useClass: ClusterRouteReuseStrategy },
  ],
};
