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
import { ActivatedRoute, PRIMARY_OUTLET, Router, UrlTree } from '@angular/router';
import { AlertService } from '../../core/alert.service';
import { ClusterApiError } from '../../core/api-envelope';
import { ConnectionService } from '../../core/connection.service';
import { elasticsearchReason } from '../../core/errors';
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
  /** Set by the first submit of each form; field errors show from then on. */
  readonly hostSubmitted = signal(false);
  readonly authSubmitted = signal(false);
  /**
   * In-app page the user was on when the cluster asked for credentials
   * (`returnUrl`, set by the 401 redirect); signing in goes back to it.
   */
  private returnUrl: string | null = null;

  readonly hostError = computed(() => this.hostSubmitted() && !this.host().trim());
  readonly usernameError = computed(() => this.authSubmitted() && !this.username());
  readonly passwordError = computed(() => this.authSubmitted() && !this.password());

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
    this.returnUrl = params.get('returnUrl');
    void this.loadHosts();
  }

  submitHost(): void {
    this.hostSubmitted.set(true);
    if (this.hostError()) {
      this.focus('host');
      return;
    }
    void this.connectTo(this.host());
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
            queryParams: { host: target, unauthorized: true, returnUrl: this.returnUrl },
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
    this.authSubmitted.set(true);
    if (this.usernameError() || this.passwordError()) {
      this.focus(this.usernameError() ? 'username' : 'password');
      return;
    }
    const target = this.host().trim();
    const username = this.username();
    const password = this.password();
    if (!target || this.connecting()) {
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
    this.authSubmitted.set(false);
    this.feedback.set(undefined);
    this.username.set('');
    this.password.set('');
    this.returnUrl = null;
    void this.router.navigate([], {
      queryParams: { host: this.host() || null, unauthorized: null, returnUrl: null },
      replaceUrl: true,
    });
  }

  private async enter(host: string, username?: string, password?: string): Promise<void> {
    this.connection.connect(host, username, password);
    const target = this.returnTarget(host);
    if (target) {
      await this.router.navigateByUrl(target, { replaceUrl: true });
    } else {
      await this.router.navigate(['/overview'], { queryParams: { host } });
    }
  }

  /**
   * The validated `returnUrl` with its host rewritten to the connected one:
   * only an in-app path (never another origin or the connect page itself).
   */
  private returnTarget(host: string): UrlTree | null {
    const url = this.returnUrl;
    if (!url || !url.startsWith('/') || url.startsWith('//') || url.startsWith('/\\')) {
      return null;
    }
    let tree: UrlTree;
    try {
      tree = this.router.parseUrl(url);
    } catch {
      return null;
    }
    const first = tree.root.children[PRIMARY_OUTLET]?.segments[0]?.path;
    if (!first || first === 'connect') {
      return null;
    }
    const params: Record<string, unknown> = { ...tree.queryParams, host };
    delete params['unauthorized'];
    delete params['returnUrl'];
    tree.queryParams = params;
    return tree;
  }

  private describeFailure(host: string, status: number, body: unknown): string {
    // HTML error pages (a proxy or a server that is not Elasticsearch) carry no reason.
    const reason = elasticsearchReason(body);
    return reason
      ? `${host} responded with ${status}: ${reason}`
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

  private focus(id: string): void {
    this.document.getElementById(id)?.focus();
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
