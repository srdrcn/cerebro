import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  Input,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AlertService } from '../../core/alert.service';
import { ClusterApiService } from '../../core/cluster-api.service';

export interface AnalysisToken {
  readonly token: string;
  readonly position: number;
  readonly start_offset: number;
  readonly end_offset: number;
  readonly type?: string;
}

export function sortedNames(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

@Component({
  selector: 'cerebro-analysis-tokens',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (tokens !== null) {
      <div class="table-responsive mt-3">
        <table class="table table-sm table-hover align-middle">
          <thead>
            <tr>
              <th scope="col">token</th>
              <th scope="col">position</th>
              <th scope="col">start offset</th>
              <th scope="col">end offset</th>
            </tr>
          </thead>
          <tbody>
            @for (item of tokens; track $index) {
              <tr>
                <td>{{ item.token }}</td>
                <td>{{ item.position }}</td>
                <td>{{ item.start_offset }}</td>
                <td>{{ item.end_offset }}</td>
              </tr>
            } @empty {
              <tr>
                <td colspan="4" class="text-center text-body-secondary">No tokens returned.</td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AnalysisTokensComponent {
  @Input() tokens: readonly AnalysisToken[] | null = null;
}

@Component({
  selector: 'cerebro-analysis',
  standalone: true,
  imports: [CommonModule, FormsModule, AnalysisTokensComponent],
  template: `
    <main class="container-fluid py-3" aria-labelledby="analysis-title">
      <h1 id="analysis-title" class="visually-hidden">Text analysis</h1>
      <div class="row g-4">
        <section class="col-lg-6" aria-labelledby="field-analysis-title">
          <h2 id="field-analysis-title" class="h4">analyze by field type</h2>
          <div class="row g-3">
            <div class="col-sm-6">
              <label for="field-index" class="form-label">index name</label>
              <select
                id="field-index"
                class="form-select"
                [ngModel]="fieldIndex"
                (ngModelChange)="selectFieldIndex($event)"
              >
                <option value="">select an index</option>
                @for (index of indices(); track index) {
                  <option [value]="index">{{ index }}</option>
                }
              </select>
            </div>
            <div class="col-sm-6">
              <label for="field-name" class="form-label">field name</label>
              <select
                id="field-name"
                class="form-select"
                [(ngModel)]="field"
                [disabled]="fieldsLoading() || fields().length === 0"
              >
                <option value="">select a field</option>
                @for (option of fields(); track option) {
                  <option [value]="option">{{ option }}</option>
                }
              </select>
            </div>
            <div class="col-12">
              <label for="field-text" class="form-label">text to analyze</label>
              <input
                id="field-text"
                type="text"
                class="form-control"
                placeholder="text to analyze"
                [(ngModel)]="fieldText"
                (keydown.enter)="analyzeByField()"
              />
            </div>
            <div class="col-12 text-end">
              <button
                type="button"
                class="btn btn-success"
                [disabled]="fieldAnalysisLoading() || !canAnalyzeByField()"
                (click)="analyzeByField()"
              >
                <i class="bi bi-lightning-fill" aria-hidden="true"></i>
                {{ fieldAnalysisLoading() ? 'analyzing…' : 'analyze' }}
              </button>
            </div>
          </div>
          <cerebro-analysis-tokens [tokens]="fieldTokens()" />
        </section>

        <section class="col-lg-6" aria-labelledby="analyzer-analysis-title">
          <h2 id="analyzer-analysis-title" class="h4">analyze by analyzer</h2>
          <div class="row g-3">
            <div class="col-sm-6">
              <label for="analyzer-index" class="form-label">index name</label>
              <select
                id="analyzer-index"
                class="form-select"
                [ngModel]="analyzerIndex"
                (ngModelChange)="selectAnalyzerIndex($event)"
              >
                <option value="">select an index</option>
                @for (index of indices(); track index) {
                  <option [value]="index">{{ index }}</option>
                }
              </select>
            </div>
            <div class="col-sm-6">
              <label for="analyzer-name" class="form-label">analyzer name</label>
              <select
                id="analyzer-name"
                class="form-select"
                [(ngModel)]="analyzer"
                [disabled]="analyzersLoading() || analyzers().length === 0"
              >
                <option value="">select an analyzer</option>
                @for (option of analyzers(); track option) {
                  <option [value]="option">{{ option }}</option>
                }
              </select>
            </div>
            <div class="col-12">
              <label for="analyzer-text" class="form-label">text to analyze</label>
              <input
                id="analyzer-text"
                type="text"
                class="form-control"
                placeholder="text to analyze"
                [(ngModel)]="analyzerText"
                (keydown.enter)="analyzeByAnalyzer()"
              />
            </div>
            <div class="col-12 text-end">
              <button
                type="button"
                class="btn btn-success"
                [disabled]="analyzerAnalysisLoading() || !canAnalyzeByAnalyzer()"
                (click)="analyzeByAnalyzer()"
              >
                <i class="bi bi-lightning-fill" aria-hidden="true"></i>
                {{ analyzerAnalysisLoading() ? 'analyzing…' : 'analyze' }}
              </button>
            </div>
          </div>
          <cerebro-analysis-tokens [tokens]="analyzerTokens()" />
        </section>
      </div>
    </main>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AnalysisComponent implements OnInit {
  private readonly api = inject(ClusterApiService);
  private readonly alerts = inject(AlertService);

  readonly indices = signal<readonly string[]>([]);
  readonly fields = signal<readonly string[]>([]);
  readonly analyzers = signal<readonly string[]>([]);
  readonly fieldTokens = signal<readonly AnalysisToken[] | null>(null);
  readonly analyzerTokens = signal<readonly AnalysisToken[] | null>(null);
  readonly fieldsLoading = signal(false);
  readonly analyzersLoading = signal(false);
  readonly fieldAnalysisLoading = signal(false);
  readonly analyzerAnalysisLoading = signal(false);

  fieldIndex = '';
  field = '';
  fieldText = '';
  analyzerIndex = '';
  analyzer = '';
  analyzerText = '';

  private fieldsLoadVersion = 0;
  private analyzersLoadVersion = 0;
  private fieldAnalysisVersion = 0;
  private analyzerAnalysisVersion = 0;

  ngOnInit(): void {
    void this.loadIndices();
  }

  canAnalyzeByField(): boolean {
    return Boolean(
      !this.fieldAnalysisLoading() &&
      this.fieldIndex &&
      this.field &&
      this.fieldText,
    );
  }

  canAnalyzeByAnalyzer(): boolean {
    return Boolean(
      !this.analyzerAnalysisLoading() &&
      this.analyzerIndex &&
      this.analyzer &&
      this.analyzerText,
    );
  }

  selectFieldIndex(index: string): void {
    const version = ++this.fieldsLoadVersion;
    this.fieldAnalysisVersion += 1;
    this.fieldIndex = index;
    this.field = '';
    this.fields.set([]);
    this.fieldTokens.set(null);
    this.fieldAnalysisLoading.set(false);
    this.fieldsLoading.set(Boolean(index));
    if (index) {
      void this.loadFields(index, version);
    }
  }

  selectAnalyzerIndex(index: string): void {
    const version = ++this.analyzersLoadVersion;
    this.analyzerAnalysisVersion += 1;
    this.analyzerIndex = index;
    this.analyzer = '';
    this.analyzers.set([]);
    this.analyzerTokens.set(null);
    this.analyzerAnalysisLoading.set(false);
    this.analyzersLoading.set(Boolean(index));
    if (index) {
      void this.loadAnalyzers(index, version);
    }
  }

  async analyzeByField(): Promise<void> {
    if (!this.canAnalyzeByField()) {
      return;
    }

    const version = ++this.fieldAnalysisVersion;
    const request = {
      index: this.fieldIndex,
      field: this.field,
      text: this.fieldText,
    } as const;
    this.fieldTokens.set(null);
    this.fieldAnalysisLoading.set(true);
    try {
      const tokens = await this.api.post<readonly AnalysisToken[]>(
        'analysis/analyze/field',
        request,
      );
      if (
        version === this.fieldAnalysisVersion &&
        request.index === this.fieldIndex &&
        request.field === this.field &&
        request.text === this.fieldText
      ) {
        this.fieldTokens.set(tokens);
      }
    } catch (error: unknown) {
      if (version === this.fieldAnalysisVersion) {
        this.alerts.error('Error analyzing text by field', error);
      }
    } finally {
      if (version === this.fieldAnalysisVersion) {
        this.fieldAnalysisLoading.set(false);
      }
    }
  }

  async analyzeByAnalyzer(): Promise<void> {
    if (!this.canAnalyzeByAnalyzer()) {
      return;
    }

    const version = ++this.analyzerAnalysisVersion;
    const request = {
      index: this.analyzerIndex,
      analyzer: this.analyzer,
      text: this.analyzerText,
    } as const;
    this.analyzerTokens.set(null);
    this.analyzerAnalysisLoading.set(true);
    try {
      const tokens = await this.api.post<readonly AnalysisToken[]>(
        'analysis/analyze/analyzer',
        request,
      );
      if (
        version === this.analyzerAnalysisVersion &&
        request.index === this.analyzerIndex &&
        request.analyzer === this.analyzer &&
        request.text === this.analyzerText
      ) {
        this.analyzerTokens.set(tokens);
      }
    } catch (error: unknown) {
      if (version === this.analyzerAnalysisVersion) {
        this.alerts.error('Error analyzing text by analyzer', error);
      }
    } finally {
      if (version === this.analyzerAnalysisVersion) {
        this.analyzerAnalysisLoading.set(false);
      }
    }
  }

  private async loadIndices(): Promise<void> {
    try {
      const indices = await this.api.post<readonly string[]>('analysis/indices');
      this.indices.set(sortedNames(indices));
    } catch (error: unknown) {
      this.indices.set([]);
      this.alerts.error('Error loading indices', error);
    }
  }

  private async loadFields(index: string, version: number): Promise<void> {
    try {
      const fields = await this.api.post<readonly string[]>('analysis/fields', { index });
      if (version === this.fieldsLoadVersion) {
        this.fields.set(sortedNames(fields));
      }
    } catch (error: unknown) {
      if (version === this.fieldsLoadVersion) {
        this.fields.set([]);
        this.alerts.error('Error loading index fields', error);
      }
    } finally {
      if (version === this.fieldsLoadVersion) {
        this.fieldsLoading.set(false);
      }
    }
  }

  private async loadAnalyzers(index: string, version: number): Promise<void> {
    try {
      const analyzers = await this.api.post<readonly string[]>(
        'analysis/analyzers',
        { index },
      );
      if (version === this.analyzersLoadVersion) {
        this.analyzers.set(sortedNames(analyzers));
      }
    } catch (error: unknown) {
      if (version === this.analyzersLoadVersion) {
        this.analyzers.set([]);
        this.alerts.error('Error loading index analyzers', error);
      }
    } finally {
      if (version === this.analyzersLoadVersion) {
        this.analyzersLoading.set(false);
      }
    }
  }
}
