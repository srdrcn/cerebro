import { DOCUMENT } from '@angular/common';
import { computed, inject, Injectable, signal } from '@angular/core';
import { Router } from '@angular/router';
import { NoClusterConnectionError } from './api-envelope';
import { RecentHostsService } from './recent-hosts.service';
import { RefreshService } from './refresh.service';

export interface ConnectionSnapshot {
  readonly host: string;
  readonly username?: string;
  readonly password?: string;
}

/**
 * Holds the Elasticsearch target of the session. The host is mirrored into
 * the URL (`#/route?host=…`) so views can be bookmarked and shared; the
 * credentials only ever live in memory.
 */
@Injectable({ providedIn: 'root' })
export class ConnectionService {
  private readonly document = inject(DOCUMENT);
  private readonly router = inject(Router);
  private readonly refreshService = inject(RefreshService);
  private readonly recentHosts = inject(RecentHostsService);
  private readonly initialHost = this.hostFromHash();

  private readonly hostState = signal<string | undefined>(this.initialHost);
  private readonly usernameState = signal<string | undefined>(undefined);
  private readonly passwordState = signal<string | undefined>(undefined);

  readonly host = this.hostState.asReadonly();
  readonly username = this.usernameState.asReadonly();
  readonly connected = computed(() => this.hostState() !== undefined);
  /** Query parameters every in-app link carries to keep the target host. */
  readonly hostQuery = computed(() => ({ host: this.hostState() ?? null }));

  connect(host: string, username?: string, password?: string): void {
    const normalizedHost = host.trim();
    if (!normalizedHost) {
      throw new Error('An Elasticsearch host is required');
    }

    this.hostState.set(normalizedHost);
    this.usernameState.set(username || undefined);
    this.passwordState.set(password || undefined);
    this.recentHosts.remember(normalizedHost);
    this.writeHostToHash(normalizedHost);
    this.refreshService.refresh();
  }

  /**
   * Follows the host of the URL when it differs from the connected one (Back
   * and Forward, pasted or bookmarked links). The URL already carries the
   * host, and credentials belong to the previous cluster, so they are
   * dropped; a secured cluster then goes through the sign-in flow.
   */
  followUrlHost(host: string): void {
    const normalizedHost = host.trim();
    if (!normalizedHost || normalizedHost === this.hostState()) {
      return;
    }
    this.hostState.set(normalizedHost);
    this.usernameState.set(undefined);
    this.passwordState.set(undefined);
    this.recentHosts.remember(normalizedHost);
    this.refreshService.refresh();
  }

  /**
   * Leaves the cluster for the connect screen. The connection is only cleared
   * once the navigation succeeded: when the user keeps unsaved edits (a
   * cancelled `canDeactivate`), the page stays connected and usable.
   */
  async disconnect(): Promise<boolean> {
    const previousHost = this.hostState();
    const navigated = await this.router.navigate(['/connect'], {
      queryParams: previousHost ? { host: previousHost } : {},
      replaceUrl: true,
    });
    if (navigated && this.hostState() === previousHost) {
      this.hostState.set(undefined);
      this.usernameState.set(undefined);
      this.passwordState.set(undefined);
    }
    return navigated;
  }

  snapshot(): ConnectionSnapshot {
    const host = this.hostState();
    if (!host) {
      throw new NoClusterConnectionError();
    }

    const username = this.usernameState();
    const password = this.passwordState();
    return {
      host,
      ...(username ? { username } : {}),
      ...(password ? { password } : {}),
    };
  }

  private hostFromHash(): string | undefined {
    const location = this.document.defaultView?.location;
    if (!location) {
      return undefined;
    }

    const queryIndex = location.hash.indexOf('?');
    if (queryIndex < 0) {
      return undefined;
    }

    const host = new URLSearchParams(location.hash.slice(queryIndex + 1)).get(
      'host',
    );
    return host?.trim() || undefined;
  }

  private writeHostToHash(host: string): void {
    const view = this.document.defaultView;
    if (!view) {
      return;
    }

    const currentHash = view.location.hash || '#/connect';
    const queryIndex = currentHash.indexOf('?');
    const currentRoute =
      queryIndex >= 0 ? currentHash.slice(0, queryIndex) : currentHash;
    const route = currentRoute && currentRoute !== '#' ? currentRoute : '#/connect';
    const params = new URLSearchParams(
      queryIndex >= 0 ? currentHash.slice(queryIndex + 1) : '',
    );
    params.set('host', host);
    params.delete('unauthorized');

    const query = params.toString();
    const hash = `${route}${query ? `?${query}` : ''}`;
    view.history.replaceState(
      view.history.state,
      '',
      `${view.location.pathname}${view.location.search}${hash}`,
    );
  }
}
