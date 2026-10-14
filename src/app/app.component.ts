import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs';
import { ClusterChangesService } from './core/cluster-changes.service';
import { ClusterStatusService } from './core/cluster-status.service';
import { ConnectionService } from './core/connection.service';
import { ThemeService } from './core/theme.service';
import { CommandPaletteComponent } from './shared/command-palette.component';
import { DialogHostComponent } from './shared/dialog-host.component';
import { ShellComponent } from './shared/shell/shell.component';
import { ToastCenterComponent } from './shared/toast-center.component';

@Component({
  selector: 'cerebro-root',
  imports: [
    RouterOutlet,
    ShellComponent,
    ToastCenterComponent,
    DialogHostComponent,
    CommandPaletteComponent,
  ],
  template: `
    @if (showShell()) {
      <cerebro-shell>
        <router-outlet />
      </cerebro-shell>
    } @else {
      <router-outlet />
    }
    <cerebro-toast-center />
    <cerebro-dialog-host />
    <cerebro-command-palette />
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppComponent {
  private readonly router = inject(Router);
  private readonly connection = inject(ConnectionService);
  // Instantiated eagerly: theme application, health polling (title/favicon)
  // and best-effort cluster change notifications.
  private readonly theme = inject(ThemeService);
  private readonly status = inject(ClusterStatusService);
  private readonly clusterChanges = inject(ClusterChangesService);

  private readonly url = toSignal(
    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      map((event) => event.urlAfterRedirects),
    ),
    { initialValue: '' },
  );

  readonly showShell = computed(() => {
    const url = this.url();
    return this.connection.connected() && url !== '' && !url.startsWith('/connect');
  });
}
