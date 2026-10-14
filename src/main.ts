import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './app/app.component';
import { appConfig } from './app/app.config';
import {
  legacyRouteFromHash,
  normalizeLegacyHashbang,
} from './app/core/legacy-hashbang';

const legacyRoute = legacyRouteFromHash(window.location.hash);
if (legacyRoute) {
  // Fragment-only replace does not reload a document. Rewrite the history
  // entry first, then force one reload so Angular starts from the modern URL.
  normalizeLegacyHashbang(window);
  window.location.reload();
} else {
  bootstrapApplication(AppComponent, appConfig).catch((error: unknown) => {
    console.error('Unable to start Cerebro', error);
  });
}
