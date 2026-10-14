import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AlertService } from '../../core/alert.service';
import { ClipboardService } from '../../core/clipboard.service';
import { ClusterApiService } from '../../core/cluster-api.service';
import { ConnectionService } from '../../core/connection.service';
import {
  REST_METHODS,
  RestMethod,
  buildCurlCommand,
  errorResponse,
  formatEditorBody,
  getAutocompleteOptions,
  parseEditorBody,
  responseText,
} from './rest.utils';

interface RestIndexData {
  readonly host: string;
  readonly indices: readonly string[];
}

export interface RestHistoryEntry {
  readonly path: string;
  readonly method: RestMethod;
  readonly body: string;
  readonly created_at: string;
}

@Component({
  selector: 'cerebro-rest',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <main class="container-fluid py-3" aria-labelledby="rest-title">
      <h1 id="rest-title" class="visually-hidden">REST console</h1>

      <div class="row g-3">
        <section class="col-lg-6" aria-label="Request editor">
          <div class="row g-2 mb-2">
            <div class="col-sm-9">
              <label for="rest-path" class="visually-hidden">Request path</label>
              <input
                id="rest-path"
                class="form-control form-control-sm"
                type="text"
                list="rest-path-options"
                placeholder="path (eg: indexName/_search)"
                autocomplete="off"
                [ngModel]="path"
                (ngModelChange)="updatePath($event)"
              />
              <datalist id="rest-path-options">
                @for (option of options(); track option) {
                  <option [value]="option"></option>
                }
              </datalist>
            </div>
            <div class="col-sm-3">
              <label for="rest-method" class="visually-hidden">HTTP method</label>
              <select id="rest-method" class="form-select form-select-sm" [(ngModel)]="method">
                @for (option of methods; track option) {
                  <option [value]="option">{{ option }}</option>
                }
              </select>
            </div>
          </div>

          <details class="mb-2" [open]="false">
            <summary class="link-primary user-select-none">
              <i class="bi bi-clock-history" aria-hidden="true"></i>
              previous requests
            </summary>
            @if (history().length > 0) {
              <div class="table-responsive rest-history">
                <table class="table table-sm table-hover mb-0">
                  <thead class="visually-hidden">
                    <tr><th>Date</th><th>Method</th><th>Path</th></tr>
                  </thead>
                  <tbody>
                    @for (request of history(); track $index) {
                      <tr
                        tabindex="0"
                        role="button"
                        (click)="restoreRequest(request)"
                        (keydown.enter)="restoreRequest(request)"
                      >
                        <td class="text-nowrap">{{ request.created_at }}</td>
                        <td>{{ request.method }}</td>
                        <td class="text-break">{{ request.path }}</td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            } @else {
              <p class="text-body-secondary small mt-2 mb-0">No previous requests.</p>
            }
          </details>

          <label for="rest-editor" class="visually-hidden">JSON or NDJSON request body</label>
          <textarea
            id="rest-editor"
            class="form-control font-monospace rest-editor"
            spellcheck="false"
            aria-describedby="rest-editor-help"
            [(ngModel)]="editorValue"
          ></textarea>
          <div id="rest-editor-help" class="form-text">
            JSON is parsed automatically. _bulk and _msearch accept NDJSON.
          </div>

          <div class="d-flex justify-content-end gap-2 mt-2">
            <button type="button" class="btn btn-outline-secondary" (click)="copyAsCurl()">
              <i class="bi bi-clipboard" aria-hidden="true"></i> cURL
            </button>
            <button type="button" class="btn btn-outline-secondary" (click)="formatBody()">
              <i class="bi bi-text-indent-left" aria-hidden="true"></i> format
            </button>
            <button
              type="button"
              class="btn btn-success"
              [disabled]="executing()"
              (click)="execute()"
            >
              <i class="bi bi-lightning-fill" aria-hidden="true"></i>
              {{ executing() ? 'sending…' : 'send' }}
            </button>
          </div>
        </section>

        <section class="col-lg-6" aria-label="Response">
          <div class="border rounded h-100 rest-response">
            @if (hasResponse()) {
              <!-- textContent/interpolation deliberately avoids rendering response HTML. -->
              <pre class="p-3 mb-0 text-wrap" [textContent]="renderedResponse()"></pre>
            } @else {
              <p class="p-3 text-body-secondary" role="status">
                {{ executing() ? 'Waiting for response…' : 'Response will appear here.' }}
              </p>
            }
          </div>
        </section>
      </div>
    </main>
  `,
  styles: `
    .rest-editor { min-height: 32rem; resize: vertical; tab-size: 2; }
    .rest-response { min-height: 38rem; overflow: auto; }
    .rest-response pre { min-width: max-content; white-space: pre; }
    .rest-history { max-height: 14rem; }
    .rest-history tr[role='button'] { cursor: pointer; }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RestComponent implements OnInit {
  private readonly api = inject(ClusterApiService);
  private readonly alerts = inject(AlertService);
  private readonly clipboard = inject(ClipboardService);
  private readonly connection = inject(ConnectionService);

  readonly methods = REST_METHODS;
  readonly history = signal<readonly RestHistoryEntry[]>([]);
  readonly executing = signal(false);
  readonly hasResponse = signal(false);
  readonly renderedResponse = signal('');
  readonly options = computed(() =>
    getAutocompleteOptions(this.indices(), this.pathValue()),
  );

  method: RestMethod = 'GET';
  path = '';
  editorValue = '{}';

  private readonly indices = signal<readonly string[]>([]);
  private readonly pathValue = signal('');
  private readonly endpointHost = signal('');
  private historyLoadVersion = 0;

  ngOnInit(): void {
    void this.loadRestIndex();
    void this.loadHistory();
  }

  updatePath(path: string): void {
    this.path = path;
    this.pathValue.set(path);
  }

  formatBody(): void {
    this.editorValue = formatEditorBody(this.path, this.editorValue);
  }

  restoreRequest(request: RestHistoryEntry): void {
    this.method = request.method;
    this.updatePath(request.path);
    this.editorValue = formatEditorBody(request.path, request.body);
  }

  async execute(): Promise<void> {
    if (this.path.trim() === '') {
      this.alerts.warn('A request path is required');
      return;
    }

    this.executing.set(true);
    this.hasResponse.set(false);
    this.renderedResponse.set('');

    try {
      const response = await this.api.post<unknown>('rest/request', {
        method: this.method,
        path: this.path,
        data: parseEditorBody(this.path, this.editorValue),
      });
      this.renderedResponse.set(responseText(response));
      this.hasResponse.set(true);
      // A failed request must not appear to have been persisted in history.
      await this.loadHistory();
    } catch (error: unknown) {
      this.renderedResponse.set(responseText(errorResponse(error)));
      this.hasResponse.set(true);
      this.alerts.error('Error executing request', error);
    } finally {
      this.executing.set(false);
    }
  }

  async copyAsCurl(): Promise<void> {
    const host = this.endpointHost() || this.connection.host() || '';
    if (host.trim() === '') {
      this.alerts.error('No connected Elasticsearch host is available');
      return;
    }

    let command: string;
    try {
      command = buildCurlCommand({
        method: this.method,
        host,
        path: this.path,
        body: this.editorValue,
      });
    } catch (error: unknown) {
      this.alerts.error(`Unexpected content format for [${this.path}]`, error);
      return;
    }

    await this.clipboard.copy(
      command,
      () => this.alerts.info('cURL request successfully copied to clipboard'),
      (error) => this.alerts.error('Error while copying request to clipboard', error),
    );
  }

  async loadHistory(): Promise<void> {
    const version = ++this.historyLoadVersion;
    try {
      const history = await this.api.post<readonly RestHistoryEntry[]>('rest/history');
      if (version === this.historyLoadVersion) {
        this.history.set(history);
      }
    } catch (error: unknown) {
      if (version === this.historyLoadVersion) {
        this.alerts.error('Error while loading request history', error);
      }
    }
  }

  private async loadRestIndex(): Promise<void> {
    try {
      const response = await this.api.post<RestIndexData>('rest');
      this.indices.set(response.indices ?? []);
      this.endpointHost.set(response.host ?? '');
    } catch (error: unknown) {
      this.indices.set([]);
      this.alerts.error('Error while loading cluster indices', error);
    }
  }
}
