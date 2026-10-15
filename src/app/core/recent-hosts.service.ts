import { Injectable, signal } from '@angular/core';
import { readJsonPreference, writeJsonPreference } from './preferences';

export const RECENT_HOSTS_STORAGE_KEY = 'cerebro.recent-hosts';
export const MAX_RECENT_HOSTS = 5;

/** Only host addresses are remembered — never credentials. */
@Injectable({ providedIn: 'root' })
export class RecentHostsService {
  private readonly hostsState = signal<readonly string[]>(this.load());

  readonly hosts = this.hostsState.asReadonly();

  remember(host: string): void {
    const value = host.trim();
    if (!value) {
      return;
    }
    this.update([value, ...this.hostsState().filter((item) => item !== value)]);
  }

  forget(host: string): void {
    this.update(this.hostsState().filter((item) => item !== host));
  }

  private update(hosts: readonly string[]): void {
    const next = hosts.slice(0, MAX_RECENT_HOSTS);
    this.hostsState.set(next);
    writeJsonPreference(RECENT_HOSTS_STORAGE_KEY, next);
  }

  private load(): readonly string[] {
    const stored = readJsonPreference<unknown>(RECENT_HOSTS_STORAGE_KEY, []);
    return Array.isArray(stored)
      ? stored
          .filter((item): item is string => typeof item === 'string' && item.trim() !== '')
          .slice(0, MAX_RECENT_HOSTS)
      : [];
  }
}
