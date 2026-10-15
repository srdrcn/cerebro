import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { AlertService } from '../../core/alert.service';
import { ClusterApiService } from '../../core/cluster-api.service';
import { ConnectionService } from '../../core/connection.service';
import { failureMessage, readableReason } from '../../core/errors';
import { RefreshService } from '../../core/refresh.service';
import { EmptyStateComponent } from '../../shared/empty-state.component';
import { AnalysisPanelComponent } from './analysis-panel.component';
import { asNames } from './analysis.utils';

@Component({
  selector: 'cerebro-analysis',
  imports: [AnalysisPanelComponent, EmptyStateComponent, RouterLink],
  template: `
    <section class="page" aria-labelledby="analysis-title">
      <header class="page-header">
        <div class="page-header__text">
          <h1 id="analysis-title" class="page-title">Analysis</h1>
          <p class="page-subtitle">
            See how Elasticsearch breaks text into tokens, through a field's mapping or any analyzer.
          </p>
        </div>
      </header>

      @if (failed() && !loaded()) {
        <div class="card">
          <cerebro-empty
            icon="bi-exclamation-triangle"
            heading="Could not load the open indices"
            [text]="loadError() ?? 'Analysis runs against an index, but the cluster did not return its list of open indices.'"
          >
            <button type="button" class="btn btn-sm" [class.is-loading]="loading()" [disabled]="loading()" (click)="load()">
              <i class="bi bi-arrow-clockwise" aria-hidden="true"></i> Try again
            </button>
          </cerebro-empty>
        </div>
      } @else if (loaded() && indices().length === 0) {
        <div class="card">
          <cerebro-empty
            icon="bi-collection"
            heading="No open indices"
            text="Analysis runs against an index. Create an index, or open a closed one, to analyze text."
          >
            <a class="btn btn-sm" routerLink="/create" [queryParams]="connection.hostQuery()">
              <i class="bi bi-plus-lg" aria-hidden="true"></i> Create index
            </a>
          </cerebro-empty>
        </div>
      } @else {
        <div class="layout-split">
          <cerebro-analysis-panel mode="field" [indices]="indices()" [indicesLoading]="loading()" />
          <cerebro-analysis-panel mode="analyzer" [indices]="indices()" [indicesLoading]="loading()" />
        </div>
      }
    </section>
  `,
  styles: `
    :host {
      display: block;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AnalysisComponent {
  private readonly api = inject(ClusterApiService);
  private readonly alerts = inject(AlertService);
  private readonly refreshService = inject(RefreshService);
  readonly connection = inject(ConnectionService);

  readonly indices = signal<readonly string[]>([]);
  readonly loading = signal(false);
  readonly loaded = signal(false);
  readonly failed = signal(false);
  readonly loadError = signal<string | undefined>(undefined);

  private loadSequence = 0;

  constructor() {
    effect(() => {
      this.refreshService.tick();
      if (this.connection.connected()) {
        untracked(() => void this.load());
      }
    });
  }

  async load(): Promise<void> {
    const sequence = ++this.loadSequence;
    this.loading.set(true);
    try {
      const indices = asNames(await this.api.post<unknown>('analysis/indices'));
      if (sequence === this.loadSequence) {
        // Keep the array identity when nothing changed so panels do not churn.
        const current = this.indices();
        if (current.length !== indices.length || current.some((name, i) => name !== indices[i])) {
          this.indices.set(indices);
        }
        this.loaded.set(true);
        this.failed.set(false);
        this.loadError.set(undefined);
      }
    } catch (error: unknown) {
      if (sequence === this.loadSequence) {
        this.failed.set(true);
        this.loadError.set(readableReason(error));
        this.alerts.error(failureMessage('Could not load the open indices', error), error);
      }
    } finally {
      if (sequence === this.loadSequence) {
        this.loading.set(false);
      }
    }
  }
}
