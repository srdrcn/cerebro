import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive } from '@angular/router';
import { filter, map } from 'rxjs';
import { ClipboardService } from '../../core/clipboard.service';
import { ClusterStatusService } from '../../core/cluster-status.service';
import { ConnectionService } from '../../core/connection.service';
import { healthLabel, healthTone } from '../../core/health';
import { NAVIGATION, navigationItemFor } from '../../core/navigation';
import { readPreference, writePreference } from '../../core/preferences';
import { RefreshService, refreshIntervalLabel } from '../../core/refresh.service';
import { ThemeService } from '../../core/theme.service';
import { CommandPaletteService } from '../command-palette.component';
import { LogoComponent } from '../logo.component';
import { MenuComponent } from '../menu.component';

const COLLAPSED_STORAGE_KEY = 'cerebro.sidebar-collapsed';
/** Below this width the sidebar becomes an off-canvas drawer (see shell.css). */
const DRAWER_MEDIA_QUERY = '(max-width: 900px)';

@Component({
  selector: 'cerebro-shell',
  imports: [RouterLink, RouterLinkActive, LogoComponent, MenuComponent],
  templateUrl: './shell.component.html',
  styleUrl: './shell.component.css',
  host: {
    '(document:keydown.escape)': 'onEscape($event)',
  },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ShellComponent {
  private readonly router = inject(Router);
  private readonly document = inject(DOCUMENT);
  private readonly clipboard = inject(ClipboardService);
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);
  private readonly main = viewChild.required<ElementRef<HTMLElement>>('main');
  private readonly sidebar = viewChild<ElementRef<HTMLElement>>('sidebar');
  private readonly menuButton = viewChild<ElementRef<HTMLButtonElement>>('menuButton');

  /**
   * Shows the sidebar and top bar. AppComponent keeps the shell (and its one
   * `<router-outlet>`) mounted on every route and only turns the chrome off
   * on the connect screen, so pages are never destroyed and recreated when
   * the connection state changes during a deep-link load.
   */
  readonly chrome = input(true);

  readonly connection = inject(ConnectionService);
  readonly status = inject(ClusterStatusService);
  readonly refresh = inject(RefreshService);
  readonly theme = inject(ThemeService);
  readonly palette = inject(CommandPaletteService);

  readonly navigation = NAVIGATION;
  readonly collapsed = signal(readPreference(COLLAPSED_STORAGE_KEY) === 'true');
  readonly drawerOpen = signal(false);
  /** True while the sidebar is rendered as an off-canvas drawer. */
  readonly drawerLayout = signal(false);
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
      return `dot-${healthTone(status)}`;
    }
    return this.status.reachable() ? 'dot-gray dot-pulse' : 'dot-red';
  });

  /** "Yellow", or the connection state while the health is unknown. */
  readonly statusText = computed(() => {
    const status = this.status.status();
    if (status) {
      return healthLabel(status);
    }
    return this.status.reachable() ? 'Connecting' : 'Unreachable';
  });

  /** "Cluster demo, health yellow" for the cluster menu button. */
  readonly clusterMenuLabel = computed(() => {
    const state = this.status.status() ? `health ${this.statusText()}` : this.statusText();
    return `Cluster ${this.status.displayName()}, ${state.toLowerCase()}`;
  });

  readonly healthBadgeClass = computed(() => {
    const status = this.status.status();
    if (status) {
      return `badge-${healthTone(status)}`;
    }
    // An unreachable cluster has no health but deserves the red badge.
    return this.status.reachable() ? '' : 'badge-red';
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
      // The connect screen has no chrome: plain "cerebro" title and favicon.
      const chrome = this.chrome();
      this.status.shellActive.set(chrome);
      this.status.pageTitle.set(chrome ? this.currentPage()?.label : undefined);
    });
    this.destroyRef.onDestroy(() => {
      this.status.shellActive.set(false);
      this.status.pageTitle.set(undefined);
    });
    effect(() => {
      // Close the mobile drawer after every navigation.
      this.url();
      this.drawerOpen.set(false);
    });
    this.watchDrawerLayout();
  }

  toggleCollapsed(): void {
    this.collapsed.update((value) => !value);
    writePreference(COLLAPSED_STORAGE_KEY, String(this.collapsed()));
  }

  focusMain(): void {
    this.main().nativeElement.focus();
  }

  openDrawer(): void {
    this.drawerOpen.set(true);
    this.afterRender(() => {
      const sidebar = this.sidebar()?.nativeElement;
      const target =
        sidebar?.querySelector<HTMLElement>('.nav-link[aria-current="page"]') ??
        sidebar?.querySelector<HTMLElement>('.nav-link');
      target?.focus();
    });
  }

  /** Closes the drawer; `restoreFocus` returns focus to the menu button. */
  closeDrawer(restoreFocus = false): void {
    if (!this.drawerOpen()) {
      return;
    }
    this.drawerOpen.set(false);
    if (restoreFocus) {
      this.afterRender(() => this.menuButton()?.nativeElement.focus());
    }
  }

  /** Navigating from the drawer moves focus to the new page. */
  onNavigate(): void {
    if (this.drawerOpen()) {
      this.closeDrawer();
      this.afterRender(() => this.focusMain());
    }
  }

  onEscape(event: Event): void {
    // A menu or dialog open inside the drawer handles its own Escape first.
    if (!this.drawerOpen() || event.defaultPrevented) {
      return;
    }
    const target = event.target;
    if (target instanceof Element && target.closest('dialog[open], [popover]')) {
      return;
    }
    event.preventDefault();
    this.closeDrawer(true);
  }

  intervalLabel(interval: number): string {
    return refreshIntervalLabel(interval);
  }

  /** Runs `focus` once the inert attributes of the new drawer state are rendered. */
  private afterRender(focus: () => void): void {
    afterNextRender({ write: focus }, { injector: this.injector });
  }

  private watchDrawerLayout(): void {
    const media = this.document.defaultView?.matchMedia?.(DRAWER_MEDIA_QUERY);
    if (!media) {
      return;
    }
    const update = () => {
      this.drawerLayout.set(media.matches);
      if (!media.matches) {
        // Never leave the page inert after resizing past the breakpoint.
        this.drawerOpen.set(false);
      }
    };
    update();
    media.addEventListener('change', update);
    this.destroyRef.onDestroy(() => media.removeEventListener('change', update));
  }

  async copyHost(): Promise<void> {
    const host = this.connection.host();
    if (!host) {
      return;
    }
    await this.clipboard.copyAndNotify(host, 'host address');
  }
}
