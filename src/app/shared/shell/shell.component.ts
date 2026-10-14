import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive } from '@angular/router';
import { filter, map } from 'rxjs';
import { AlertService } from '../../core/alert.service';
import { ClipboardService } from '../../core/clipboard.service';
import { ClusterStatusService } from '../../core/cluster-status.service';
import { ConnectionService } from '../../core/connection.service';
import { NAVIGATION, navigationItemFor } from '../../core/navigation';
import { readPreference, writePreference } from '../../core/preferences';
import { RefreshService, refreshIntervalLabel } from '../../core/refresh.service';
import { ThemeService } from '../../core/theme.service';
import { CommandPaletteService } from '../command-palette.component';
import { LogoComponent } from '../logo.component';
import { MenuComponent } from '../menu.component';

const COLLAPSED_STORAGE_KEY = 'cerebro.sidebar-collapsed';

@Component({
  selector: 'cerebro-shell',
  imports: [RouterLink, RouterLinkActive, LogoComponent, MenuComponent],
  templateUrl: './shell.component.html',
  styleUrl: './shell.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ShellComponent {
  private readonly router = inject(Router);
  private readonly document = inject(DOCUMENT);
  private readonly clipboard = inject(ClipboardService);
  private readonly alerts = inject(AlertService);
  private readonly main = viewChild.required<ElementRef<HTMLElement>>('main');

  readonly connection = inject(ConnectionService);
  readonly status = inject(ClusterStatusService);
  readonly refresh = inject(RefreshService);
  readonly theme = inject(ThemeService);
  readonly palette = inject(CommandPaletteService);

  readonly navigation = NAVIGATION;
  readonly collapsed = signal(readPreference(COLLAPSED_STORAGE_KEY) === 'true');
  readonly drawerOpen = signal(false);
  readonly version =
    this.document.querySelector<HTMLMetaElement>('meta[name="cerebro-version"]')?.content ?? '';
  readonly csrfToken =
    this.document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content.trim() ?? '';
  readonly shortcutKey = /Mac|iPhone|iPad/.test(globalThis.navigator?.platform ?? '') ? '⌘' : 'Ctrl ';

  private readonly url = toSignal(
    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      map((event) => event.urlAfterRedirects),
    ),
    { initialValue: this.router.url },
  );

  readonly currentPage = computed(() => navigationItemFor(this.url()));

  readonly healthDotClass = computed(() => {
    const status = this.status.status();
    if (status) {
      return `dot-${status}`;
    }
    return this.status.reachable() ? 'dot-gray dot-pulse' : 'dot-red';
  });

  readonly healthBadgeClass = computed(() => {
    switch (this.status.status()) {
      case 'green':
        return 'badge-green';
      case 'yellow':
        return 'badge-yellow';
      case 'red':
        return 'badge-red';
      default:
        return this.status.reachable() ? '' : 'badge-red';
    }
  });

  readonly themeLabel = computed(() => {
    switch (this.theme.preference()) {
      case 'light':
        return 'Theme: light (click for dark)';
      case 'dark':
        return 'Theme: dark (click for system)';
      default:
        return 'Theme: system (click for light)';
    }
  });

  readonly themeIcon = computed(() => {
    switch (this.theme.preference()) {
      case 'light':
        return 'bi-sun';
      case 'dark':
        return 'bi-moon-stars';
      default:
        return 'bi-circle-half';
    }
  });

  constructor() {
    effect(() => {
      this.status.pageTitle.set(this.currentPage()?.label);
    });
    effect(() => {
      // Close the mobile drawer after every navigation.
      this.url();
      this.drawerOpen.set(false);
    });
  }

  toggleCollapsed(): void {
    this.collapsed.update((value) => !value);
    writePreference(COLLAPSED_STORAGE_KEY, String(this.collapsed()));
  }

  focusMain(): void {
    this.main().nativeElement.focus();
  }

  closeDrawer(): void {
    this.drawerOpen.set(false);
  }

  intervalLabel(interval: number): string {
    return refreshIntervalLabel(interval);
  }

  async copyHost(): Promise<void> {
    const host = this.connection.host();
    if (!host) {
      return;
    }
    await this.clipboard.copy(
      host,
      () => this.alerts.success('Host address copied'),
      (error) => this.alerts.error('Could not copy to clipboard', error),
    );
  }
}
