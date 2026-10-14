import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ClusterChangesService } from './core/cluster-changes.service';
import { AlertCenterComponent } from './shared/alert-center.component';
import { ModalHostComponent } from './shared/modal-host.component';
import { NavbarComponent } from './shared/navbar.component';

@Component({
  selector: 'cerebro-root',
  imports: [
    RouterOutlet,
    NavbarComponent,
    AlertCenterComponent,
    ModalHostComponent,
  ],
  template: `
    <cerebro-navbar />
    <cerebro-alert-center />
    <div class="app-workspace">
      <router-outlet />
    </div>
    <cerebro-modal-host />
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppComponent {
  // Instantiation activates the refresh-driven, best-effort notification flow.
  private readonly clusterChanges = inject(ClusterChangesService);
}
