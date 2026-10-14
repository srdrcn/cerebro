import { HttpErrorResponse } from '@angular/common/http';
import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { AlertService } from '../../core/alert.service';
import { ClusterApiError } from '../../core/api-envelope';
import { ConnectionService } from '../../core/connection.service';
import { ConnectApiService } from './connect-api.service';

@Component({
  selector: 'cerebro-connect',
  imports: [FormsModule],
  template: `
    <main class="connect-shell" aria-labelledby="connect-title">
      <header class="connect-brand">
        <img class="connect-logo" src="./img/logo.png" alt="" />
        <div>
          <h1 id="connect-title">Cerebro</h1>
          <p>Elasticsearch administration console</p>
        </div>
        @if (appVersion) {
          <span class="connect-version">{{ appVersion }}</span>
        }
      </header>

      <section class="connect-workspace" aria-label="Cluster connection">
        <div class="connect-status" role="status" aria-live="polite">
          @if (connecting()) {
            <span><i class="bi bi-arrow-repeat spin" aria-hidden="true"></i> Connecting…</span>
          } @else if (feedback()) {
            <span class="connect-feedback">
              <i class="bi bi-exclamation-circle" aria-hidden="true"></i>
              {{ feedback() }}
            </span>
          } @else {
            <span class="connect-hint">
              {{ unauthorized() ? 'Authentication is required for this cluster.' : 'Choose a known cluster or enter a node address.' }}
            </span>
          }
        </div>

        @if (!unauthorized()) {
          @if (hosts().length > 0) {
            <div class="known-clusters">
              <h2>Known clusters</h2>
              <div class="known-clusters__list">
                @for (knownHost of hosts(); track knownHost) {
                  <button
                    type="button"
                    [disabled]="connecting()"
                    (click)="connectTo(knownHost)"
                  >
                    <i class="bi bi-hdd-network" aria-hidden="true"></i>
                    <span>{{ knownHost }}</span>
                    <i class="bi bi-arrow-right" aria-hidden="true"></i>
                  </button>
                }
              </div>
            </div>
          }

          <form class="connect-form" (ngSubmit)="connectTo(host)">
            <label for="host">Node address</label>
            <div class="connect-input-row">
              <input
                id="host"
                name="host"
                type="text"
                inputmode="url"
                autocomplete="url"
                required
                placeholder="e.g. http://localhost:9200"
                [(ngModel)]="host"
              />
              <button
                type="submit"
                class="button-primary"
                [disabled]="connecting() || !host.trim()"
              >
                Connect
                <i class="bi bi-plug" aria-hidden="true"></i>
              </button>
            </div>
          </form>
        } @else {
          <form class="connect-form authentication-form" (ngSubmit)="authorize()">
            <div class="authentication-target">
              <span>Cluster</span>
              <strong>{{ host }}</strong>
              <button type="button" (click)="cancelAuthorization()">change</button>
            </div>

            <div class="form-field-grid">
              <label for="username">
                <span>Username</span>
                <input
                  id="username"
                  name="username"
                  type="text"
                  autocomplete="username"
                  required
                  placeholder="admin"
                  [(ngModel)]="username"
                />
              </label>
              <label for="password">
                <span>Password</span>
                <input
                  id="password"
                  name="password"
                  type="password"
                  autocomplete="current-password"
                  required
                  [(ngModel)]="password"
                />
              </label>
            </div>

            <div class="connect-form__actions">
              <button
                type="submit"
                class="button-primary"
                [disabled]="connecting() || !host.trim() || !username || !password"
              >
                Authenticate
                <i class="bi bi-shield-lock" aria-hidden="true"></i>
              </button>
            </div>
          </form>
        }
      </section>
    </main>
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

  readonly hosts = signal<readonly string[]>([]);
  readonly connecting = signal(false);
  readonly unauthorized = signal(false);
  readonly feedback = signal<string | undefined>(undefined);

  host = '';
  username = '';
  password = '';
  readonly appVersion =
    this.document
      .querySelector<HTMLMetaElement>('meta[name="cerebro-version"]')
      ?.content.trim() ?? '';

  ngOnInit(): void {
    const params = this.route.snapshot.queryParamMap;
    this.host = params.get('host') ?? this.connection.host() ?? '';
    this.unauthorized.set(params.has('unauthorized'));
    void this.loadHosts();
  }

  async connectTo(host: string): Promise<void> {
    const target = host.trim();
    if (!target || this.connecting()) {
      return;
    }

    this.host = target;
    this.feedback.set(undefined);
    this.connecting.set(true);
    try {
      const response = await this.api.testConnection({ host: target });
      switch (response.status) {
        case 200:
          this.connection.connect(target);
          await this.router.navigate(['/overview'], {
            queryParams: { host: target },
          });
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
          this.feedback.set(
            `Unexpected response status: [${response.status}]`,
          );
      }
    } catch (error: unknown) {
      this.alerts.error(
        `Error connecting to [${target}]`,
        this.errorDetails(error),
      );
    } finally {
      this.connecting.set(false);
    }
  }

  async authorize(): Promise<void> {
    const target = this.host.trim();
    if (
      !target ||
      !this.username ||
      !this.password ||
      this.connecting()
    ) {
      return;
    }

    this.feedback.set(undefined);
    this.connecting.set(true);
    try {
      const response = await this.api.testConnection({
        host: target,
        username: this.username,
        password: this.password,
      });
      switch (response.status) {
        case 200:
          this.connection.connect(target, this.username, this.password);
          await this.router.navigate(['/overview'], {
            queryParams: { host: target },
          });
          break;
        case 401:
          this.feedback.set('Invalid username or password');
          break;
        case 303:
          break;
        default:
          this.feedback.set(
            `Unexpected response status: [${response.status}]`,
          );
      }
    } catch (error: unknown) {
      this.alerts.error(
        `Error connecting to [${target}]`,
        this.errorDetails(error),
      );
    } finally {
      this.connecting.set(false);
    }
  }

  cancelAuthorization(): void {
    this.unauthorized.set(false);
    this.feedback.set(undefined);
    this.username = '';
    this.password = '';
    void this.router.navigate([], {
      queryParams: { host: this.host || null, unauthorized: null },
      replaceUrl: true,
    });
  }

  private async loadHosts(): Promise<void> {
    try {
      const hosts = await this.api.getHosts();
      this.hosts.set([...hosts].sort((left, right) => left.localeCompare(right)));
    } catch (error: unknown) {
      this.alerts.error(
        'Error while fetching list of known hosts',
        this.errorDetails(error),
      );
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
