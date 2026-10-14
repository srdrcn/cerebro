import { HttpErrorResponse } from '@angular/common/http';
import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { AlertService } from '../../core/alert.service';
import { ClusterApiError } from '../../core/api-envelope';
import { ConnectionService } from '../../core/connection.service';
import { RecentHostsService } from '../../core/recent-hosts.service';
import { ThemeService } from '../../core/theme.service';
import { LogoComponent } from '../../shared/logo.component';
import { ConnectApiService } from './connect-api.service';

@Component({
  selector: 'cerebro-connect',
  imports: [FormsModule, LogoComponent],
  templateUrl: './connect.component.html',
  styles: `
    :host {
      display: block;
    }

    .recent-option {
      position: relative;
      display: flex;
      align-items: center;
    }

    .recent-option .cluster-option {
      padding-right: 44px;
    }

    .recent-option__remove {
      position: absolute;
      right: 34px;
      opacity: 0;
      transition: opacity var(--duration-fast) ease;
    }

    .recent-option:hover .recent-option__remove,
    .recent-option__remove:focus-visible {
      opacity: 1;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConnectComponent implements OnInit {
  private readonly api = inject(ConnectApiService);
  private readonly document = inject(DOCUMENT);
  private readonly connection = inject(ConnectionService);
  private readonly alerts = inject(AlertService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly recentHosts = inject(RecentHostsService);
  readonly theme = inject(ThemeService);

  readonly hosts = signal<readonly string[]>([]);
  readonly loadingHosts = signal(true);
  /** Host currently being tested, if any. */
  readonly connecting = signal<string | undefined>(undefined);
  readonly unauthorized = signal(false);
  readonly feedback = signal<string | undefined>(undefined);
  readonly host = signal('');
  readonly username = signal('');
  readonly password = signal('');

  /** Recent manual entries that are not already listed as configured clusters. */
  readonly recent = computed(() => {
    const configured = new Set(this.hosts());
    return this.recentHosts.hosts().filter((host) => !configured.has(host));
  });

  readonly themeLabel = computed(() =>
    this.theme.resolved() === 'dark' ? 'Switch to light theme' : 'Switch to dark theme',
  );

  readonly appVersion =
    this.document
      .querySelector<HTMLMetaElement>('meta[name="cerebro-version"]')
      ?.content.trim() ?? '';

  ngOnInit(): void {
    const params = this.route.snapshot.queryParamMap;
    this.host.set(params.get('host') ?? this.connection.host() ?? '');
    this.unauthorized.set(params.has('unauthorized'));
    void this.loadHosts();
  }

  async connectTo(host: string): Promise<void> {
    const target = host.trim();
    if (!target || this.connecting()) {
      return;
    }

    this.host.set(target);
    this.feedback.set(undefined);
    this.connecting.set(target);
    try {
      const response = await this.api.testConnection({ host: target });
      switch (response.status) {
        case 200:
          await this.enter(target);
          break;
        case 401:
          this.unauthorized.set(true);
          await this.router.navigate([], {
            queryParams: { host: target, unauthorized: true },
            replaceUrl: true,
          });
          break;
        case 303:
          break;
        default:
          this.feedback.set(this.describeFailure(target, response.status, response.body));
      }
    } catch (error: unknown) {
      this.feedback.set(`Could not reach ${target}.`);
      this.alerts.error(`Could not connect to ${target}`, this.errorDetails(error));
    } finally {
      this.connecting.set(undefined);
    }
  }

  async authorize(): Promise<void> {
    const target = this.host().trim();
    const username = this.username();
    const password = this.password();
    if (!target || !username || !password || this.connecting()) {
      return;
    }

    this.feedback.set(undefined);
    this.connecting.set(target);
    try {
      const response = await this.api.testConnection({ host: target, username, password });
      switch (response.status) {
        case 200:
          await this.enter(target, username, password);
          break;
        case 401:
          this.feedback.set('Invalid username or password.');
          break;
        case 303:
          break;
        default:
          this.feedback.set(this.describeFailure(target, response.status, response.body));
      }
    } catch (error: unknown) {
      this.feedback.set(`Could not reach ${target}.`);
      this.alerts.error(`Could not connect to ${target}`, this.errorDetails(error));
    } finally {
      this.connecting.set(undefined);
    }
  }

  cancelAuthorization(): void {
    this.unauthorized.set(false);
    this.feedback.set(undefined);
    this.username.set('');
    this.password.set('');
    void this.router.navigate([], {
      queryParams: { host: this.host() || null, unauthorized: null },
      replaceUrl: true,
    });
  }

  private async enter(host: string, username?: string, password?: string): Promise<void> {
    this.connection.connect(host, username, password);
    await this.router.navigate(['/overview'], { queryParams: { host } });
  }

  private describeFailure(host: string, status: number, body: unknown): string {
    const reason =
      typeof body === 'object' && body !== null && 'error' in body
        ? (body as { error: unknown }).error
        : undefined;
    const detail =
      typeof reason === 'string'
        ? reason
        : typeof reason === 'object' && reason !== null && 'reason' in reason
          ? String((reason as { reason: unknown }).reason)
          : undefined;
    return detail
      ? `${host} responded with ${status}: ${detail}`
      : `${host} responded with an unexpected status (${status}).`;
  }

  private async loadHosts(): Promise<void> {
    try {
      const hosts = await this.api.getHosts();
      this.hosts.set([...hosts].sort((left, right) => left.localeCompare(right)));
    } catch (error: unknown) {
      this.alerts.error('Could not load the list of known clusters', this.errorDetails(error));
    } finally {
      this.loadingHosts.set(false);
    }
  }

  private errorDetails(error: unknown): unknown {
    if (error instanceof ClusterApiError) {
      return error.body;
    }
    if (error instanceof HttpErrorResponse) {
      return error.error ?? error.message;
    }
    return error;
  }
}
