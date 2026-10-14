import { DOCUMENT } from '@angular/common';
import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { ClusterApiService } from './cluster-api.service';
import { ConnectionService } from './connection.service';
import { RefreshService } from './refresh.service';

export type ClusterHealth = 'green' | 'yellow' | 'red';

interface NavbarResponse {
  readonly status: string;
  readonly cluster_name: string;
  readonly username?: string;
  readonly number_of_nodes?: number;
}

export function isClusterHealth(value: unknown): value is ClusterHealth {
  return value === 'green' || value === 'yellow' || value === 'red';
}

/**
 * Lightweight cluster health polled on every refresh tick. It powers the
 * sidebar cluster card, the document title and the coloured favicon.
 */
@Injectable({ providedIn: 'root' })
export class ClusterStatusService {
  private readonly api = inject(ClusterApiService);
  private readonly connection = inject(ConnectionService);
  private readonly refresh = inject(RefreshService);
  private readonly document = inject(DOCUMENT);
  private sequence = 0;

  readonly status = signal<ClusterHealth | undefined>(undefined);
  readonly clusterName = signal<string | undefined>(undefined);
  readonly username = signal<string | undefined>(undefined);
  readonly loading = signal(false);
  readonly reachable = signal(true);
  /** Title of the current page, published by the shell. */
  readonly pageTitle = signal<string | undefined>(undefined);
  /**
   * Whether the application shell is shown. Screens without it (connect)
   * keep the plain "cerebro" title and favicon even while a host is set.
   */
  readonly shellActive = signal(false);

  readonly displayName = computed(
    () => this.clusterName() ?? this.connection.host() ?? 'No cluster',
  );

  constructor() {
    effect(() => {
      const host = this.connection.host();
      this.refresh.tick();
      if (host) {
        void this.load(host);
      } else {
        this.reset();
      }
    });

    effect(() => this.updateDocument());
  }

  private async load(expectedHost: string): Promise<void> {
    const sequence = ++this.sequence;
    this.loading.set(true);
    try {
      const data = await this.api.post<NavbarResponse>('navbar');
      if (sequence !== this.sequence || expectedHost !== this.connection.host()) {
        return;
      }
      this.status.set(isClusterHealth(data.status) ? data.status : undefined);
      this.clusterName.set(data.cluster_name);
      this.username.set(data.username);
      this.reachable.set(true);
    } catch {
      if (sequence === this.sequence) {
        this.status.set(undefined);
        this.reachable.set(false);
      }
    } finally {
      if (sequence === this.sequence) {
        this.loading.set(false);
      }
    }
  }

  private reset(): void {
    this.sequence++;
    this.status.set(undefined);
    this.clusterName.set(undefined);
    this.username.set(undefined);
    this.loading.set(false);
    this.reachable.set(true);
  }

  private updateDocument(): void {
    const inShell = this.shellActive();
    const status = inShell ? this.status() : undefined;
    const name = inShell ? this.clusterName() : undefined;
    const page = inShell ? this.pageTitle() : undefined;
    const parts = [page, name ? `${name}${status ? ` [${status}]` : ''}` : undefined, 'cerebro'];
    this.document.title = parts.filter(Boolean).join(' · ');

    const icon = this.document.querySelector?.<HTMLLinkElement>('link[rel~="icon"]');
    if (icon) {
      const color = status ?? (inShell && this.connection.connected() ? 'black' : undefined);
      icon.type = 'image/png';
      icon.href = color ? `img/${color}-favicon.png` : 'img/favicon.png';
    }
  }
}
