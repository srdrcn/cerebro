import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { ClusterApiService } from '../core/cluster-api.service';
import { ConnectionService } from '../core/connection.service';
import {
  REFRESH_INTERVALS,
  RefreshService,
} from '../core/refresh.service';

interface NavbarData {
  readonly status: string;
  readonly cluster_name: string;
  readonly username?: string;
}

interface NavigationItem {
  readonly label: string;
  readonly route: string;
  readonly icon: string;
}

const PRIMARY_NAVIGATION: readonly NavigationItem[] = [
  { label: 'overview', route: '/overview', icon: 'bi-diagram-3' },
  { label: 'nodes', route: '/nodes', icon: 'bi-hdd-rack' },
  { label: 'rest', route: '/rest', icon: 'bi-code-square' },
];

const MORE_NAVIGATION: readonly NavigationItem[] = [
  { label: 'create index', route: '/create', icon: 'bi-file-earmark-plus' },
  { label: 'cluster settings', route: '/cluster_settings', icon: 'bi-sliders' },
  { label: 'aliases', route: '/aliases', icon: 'bi-tags' },
  { label: 'analysis', route: '/analysis', icon: 'bi-puzzle' },
  { label: 'index templates', route: '/templates', icon: 'bi-journal-code' },
  { label: 'repositories', route: '/repository', icon: 'bi-database' },
  { label: 'snapshot', route: '/snapshot', icon: 'bi-camera' },
  { label: 'cat apis', route: '/cat', icon: 'bi-list-columns' },
];

@Component({
  selector: 'cerebro-navbar',
  imports: [FormsModule, RouterLink, RouterLinkActive],
  template: `
    @if (connection.connected()) {
      <nav
        [class]="'app-navbar health-' + (status() || 'unknown')"
        aria-label="Primary navigation"
      >
        <a
          class="app-navbar__brand"
          routerLink="/overview"
          [queryParams]="hostQuery()"
          aria-label="Cerebro overview"
          (click)="closeMobileNavigation()"
        >
          <img src="./img/favicon.png" width="28" height="28" alt="" />
        </a>

        <button
          type="button"
          class="app-navbar__toggle icon-button"
          aria-label="Toggle navigation"
          [attr.aria-expanded]="mobileNavigationOpen()"
          (click)="mobileNavigationOpen.update(open => !open)"
        >
          <i class="bi bi-list" aria-hidden="true"></i>
        </button>

        <div
          class="app-navbar__content"
          [class.app-navbar__content--open]="mobileNavigationOpen()"
        >
          <div class="app-navbar__links">
            @for (item of primaryNavigation; track item.route) {
              <a
                class="app-navbar__link"
                [routerLink]="item.route"
                [queryParams]="hostQuery()"
                routerLinkActive="is-active"
                (click)="closeMobileNavigation()"
              >
                <i [class]="'bi ' + item.icon" aria-hidden="true"></i>
                {{ item.label }}
              </a>
            }

            <details class="app-navbar__menu">
              <summary class="app-navbar__link">
                <i class="bi bi-magic" aria-hidden="true"></i>
                more
                <i class="bi bi-chevron-down app-navbar__chevron" aria-hidden="true"></i>
              </summary>
              <div class="app-navbar__dropdown">
                @for (item of moreNavigation; track item.route) {
                  <a
                    [routerLink]="item.route"
                    [queryParams]="hostQuery()"
                    (click)="closeMobileNavigation()"
                  >
                    <i [class]="'bi ' + item.icon" aria-hidden="true"></i>
                    {{ item.label }}
                  </a>
                }
              </div>
            </details>
          </div>

          <div class="app-navbar__context">
            <label class="refresh-control">
              <i class="bi bi-arrow-repeat" aria-hidden="true"></i>
              <span class="visually-hidden">Refresh interval</span>
              <select
                [ngModel]="refresh.interval()"
                (ngModelChange)="setRefreshIntervalValue($event)"
              >
                @for (interval of refreshIntervals; track interval) {
                  <option [ngValue]="interval">{{ intervalLabel(interval) }}</option>
                }
              </select>
            </label>

            <span class="cluster-context" [title]="clusterName() || connection.host()">
              <span class="cluster-context__name">
                {{ clusterName() || connection.host() }}
              </span>
              <span class="cluster-context__status">{{ status() || 'connecting' }}</span>
            </span>

            <button
              type="button"
              class="icon-button"
              aria-label="Disconnect from cluster"
              title="Disconnect"
              (click)="disconnect()"
            >
              <i class="bi bi-plug" aria-hidden="true"></i>
            </button>

            @if (sessionUsername()) {
              <form action="./auth/logout" method="post" class="logout-form">
                <input type="hidden" name="csrfToken" [value]="csrfToken" />
                <button
                  type="submit"
                  class="icon-button"
                  aria-label="Sign out"
                  title="Sign out"
                >
                  <i class="bi bi-power" aria-hidden="true"></i>
                </button>
              </form>
            }
          </div>
        </div>
      </nav>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NavbarComponent {
  private readonly api = inject(ClusterApiService);
  private readonly document = inject(DOCUMENT);
  private loadSequence = 0;

  readonly connection = inject(ConnectionService);
  readonly refresh = inject(RefreshService);
  readonly primaryNavigation = PRIMARY_NAVIGATION;
  readonly moreNavigation = MORE_NAVIGATION;
  readonly refreshIntervals = REFRESH_INTERVALS;
  readonly status = signal<string | undefined>(undefined);
  readonly clusterName = signal<string | undefined>(undefined);
  readonly sessionUsername = signal<string | undefined>(undefined);
  readonly mobileNavigationOpen = signal(false);
  readonly hostQuery = computed(() => ({ host: this.connection.host() }));

  readonly csrfToken =
    this.document
      .querySelector<HTMLMetaElement>('meta[name="csrf-token"]')
      ?.content.trim() ?? '';

  constructor() {
    effect(() => {
      const host = this.connection.host();
      this.refresh.tick();
      if (host) {
        void this.loadNavbar(host);
      } else {
        this.clearNavbar();
      }
    });
  }

  setRefreshIntervalValue(interval: number): void {
    this.refresh.setInterval(interval);
  }

  intervalLabel(interval: number): string {
    return `${interval / 1_000}s`;
  }

  disconnect(): void {
    this.clearNavbar();
    this.closeMobileNavigation();
    this.connection.disconnect();
  }

  closeMobileNavigation(): void {
    this.mobileNavigationOpen.set(false);
  }

  private async loadNavbar(expectedHost: string): Promise<void> {
    const sequence = ++this.loadSequence;
    try {
      const data = await this.api.post<NavbarData>('navbar');
      if (
        sequence !== this.loadSequence ||
        expectedHost !== this.connection.host()
      ) {
        return;
      }
      this.status.set(data.status);
      this.clusterName.set(data.cluster_name);
      this.sessionUsername.set(data.username);
      this.setupPage(data.cluster_name, data.status);
    } catch {
      if (sequence === this.loadSequence) {
        this.clearNavbar();
      }
    }
  }

  private clearNavbar(): void {
    this.loadSequence++;
    this.status.set(undefined);
    this.clusterName.set(undefined);
    this.sessionUsername.set(undefined);
    this.setupPage();
  }

  private setupPage(name?: string, status?: string): void {
    this.document.title = name
      ? `${name}[${status ?? ''}]`
      : 'cerebro - no connection';

    const icon = this.document.querySelector<HTMLLinkElement>('link[rel~="icon"]');
    if (icon) {
      const knownStatus =
        status === 'green' || status === 'yellow' || status === 'red'
          ? status
          : 'black';
      icon.type = 'image/png';
      icon.href = `img/${knownStatus}-favicon.png`;
    }
  }
}
