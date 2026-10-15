import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ClipboardService } from '../../../core/clipboard.service';
import { formatBytes, formatNumber, pluralize } from '../../../core/format';
import { CodeEditorComponent } from '../../../shared/code-editor.component';
import { PlannedRequest, isResizeKind } from '../index-ops.models';
import { IndexOpsStore } from '../index-ops.store';
import { requestText, totalDocs } from '../index-ops.utils';

/** Step 4: what happens, the risk, and each request as it is sent. */
@Component({
  selector: 'cerebro-ops-review-step',
  imports: [CodeEditorComponent],
  template: `
    <div class="ops-sections">
      <div class="callout callout-info">
        <i class="bi bi-info-circle" aria-hidden="true"></i>
        <div>{{ description() }}</div>
      </div>
      @if (store.risk(); as risk) {
        <div class="callout callout-danger">
          <i class="bi bi-exclamation-octagon" aria-hidden="true"></i>
          <div><strong>Check before running.</strong> {{ risk }}</div>
        </div>
      }
      @if (warnings().length > 0) {
        <div class="callout callout-warning">
          <i class="bi bi-exclamation-triangle" aria-hidden="true"></i>
          <div class="min-w-0">
            <strong>{{ warnings().length === 1 ? 'One check has a warning' : warnings().length + ' checks have warnings' }}:</strong>
            <ul class="ops-warnings">
              @for (warning of warnings(); track warning.id) {
                <li>{{ warning.title }}. {{ warning.detail }}</li>
              }
            </ul>
          </div>
        </div>
      }

      <section class="ops-section" aria-labelledby="ops-requests-title">
        <div class="ops-section__head">
          <h3 id="ops-requests-title" class="section-title"><i class="bi bi-send" aria-hidden="true"></i> {{ store.requests().length === 1 ? 'Request' : 'Requests' }}</h3>
        </div>
        @for (request of store.requests(); track request.preview.path) {
          <article class="ops-request" [attr.aria-label]="request.preview.title">
            <div class="ops-request__head">
              <span class="method" [class]="'method method-' + request.preview.method">{{ request.preview.method }}</span>
              <code class="ops-request__path">{{ request.preview.path }}</code>
              <button type="button" class="btn btn-sm btn-ghost ops-request__copy" (click)="copy(request)">
                <i class="bi bi-clipboard" aria-hidden="true"></i> Copy
              </button>
            </div>
            <p class="ops-request__title">{{ request.preview.title }}</p>
            @if (request.preview.body) {
              <cerebro-code-editor
                [value]="json(request)"
                [readOnly]="true"
                [minLines]="2"
                [maxLines]="30"
                [flush]="true"
                [ariaLabel]="'Body of ' + request.preview.method + ' ' + request.preview.path"
              />
            } @else {
              <p class="ops-request__empty">No body.</p>
            }
          </article>
        }
        <p class="ops-section__hint">Copy gives the request in the form of the REST console and Kibana Dev Tools.</p>
      </section>

      @if (afterwards().length > 0) {
        <section class="ops-section" aria-labelledby="ops-after-title">
          <div class="ops-section__head">
            <h3 id="ops-after-title" class="section-title"><i class="bi bi-signpost" aria-hidden="true"></i> Afterwards</h3>
          </div>
          <ul class="ops-after">
            @for (line of afterwards(); track line) {
              <li>{{ line }}</li>
            }
          </ul>
        </section>
      }
    </div>
  `,
  styleUrls: ['./ops-steps.css'],
  styles: `
    .ops-request {
      overflow: hidden;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      background: var(--surface);
    }

    .ops-request__head {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 8px 8px 12px;
      border-bottom: 1px solid var(--border-subtle);
      background: var(--surface-2);
    }

    .ops-request__path {
      min-width: 0;
      flex: 1;
      color: var(--text);
      font-family: var(--font-mono);
      font-size: var(--text-sm);
      overflow-wrap: anywhere;
    }

    .ops-request__copy {
      flex: none;
    }

    .ops-request__title {
      padding: 8px 12px 0;
      color: var(--text-3);
      font-size: var(--text-xs);
    }

    .ops-request__empty {
      padding: 4px 12px 12px;
      color: var(--text-3);
      font-size: var(--text-sm);
    }

    .ops-warnings,
    .ops-after {
      display: grid;
      gap: 4px;
      margin: 4px 0 0;
      padding-left: 18px;
    }

    .ops-after {
      color: var(--text-2);
      font-size: var(--text-sm);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OpsReviewStepComponent {
  readonly store = inject(IndexOpsStore);
  private readonly clipboard = inject(ClipboardService);

  /** Warnings of the checks; the destination warning is left out when the danger callout says the same. */
  readonly warnings = computed(() =>
    this.store.checks().filter((check) => check.status === 'warn' && !(this.store.risk() && check.id === 'dest')),
  );

  readonly description = computed(() => {
    const store = this.store;
    const operation = store.operation();
    if (isResizeKind(operation)) {
      const source = store.sourceIndex();
      const options = store.resizeOptions();
      const facts = source ? ` (${pluralize(source.docs ?? 0, 'document')}, ${formatBytes(source.primarySize)} in the primaries)` : '';
      switch (operation) {
        case 'shrink':
          return `Creates ${options.target} with ${pluralize(options.shards ?? 0, 'primary shard')} from the ${formatNumber(source?.primaries ?? 0)} of ${store.source()}${facts}.`;
        case 'split':
          return `Creates ${options.target} with ${pluralize(options.shards ?? 0, 'primary shard')} from the ${formatNumber(source?.primaries ?? 0)} of ${store.source()}${facts}.`;
        case 'clone':
          return `Creates ${options.target}, a copy of ${store.source()} with its ${pluralize(source?.primaries ?? 0, 'primary shard')}${facts}.`;
      }
    }
    if (operation === 'rollover') {
      const target = store.rolloverTarget();
      const dry = store.dryRun();
      const next = dry.state === 'ready' ? dry.preview.newIndex : store.newIndex().trim() || store.generatedName();
      const what = `Creates ${next ?? 'a new index'} and makes it the write index of ${target?.name ?? store.source()}`;
      const conditions = Object.values(store.conditions()).filter((value) => value.trim() !== '').length;
      if (conditions === 0) {
        return `${what}, right away.${target?.implicitWrite ? ' The alias then points only to the new index.' : ''}`;
      }
      const moves = target?.implicitWrite ? ` The alias then points only to the new index.` : '';
      if (conditions === 1) {
        const met = dry.state === 'ready' ? `it ${dry.preview.metCount > 0 ? 'is' : 'is not'} at the dry run` : 'checked when it runs';
        return `${what} if the condition is met (${met}).${moves}`;
      }
      const met = dry.state === 'ready' ? `${dry.preview.metCount === 0 ? 'none is' : `${formatNumber(dry.preview.metCount)} ${dry.preview.metCount === 1 ? 'is' : 'are'}`} at the dry run` : 'checked when it runs';
      return `${what} if one of the ${pluralize(conditions, 'condition')} is met (${met}).${moves}`;
    }
    if (operation === 'reindex') {
      const lookup = store.sourcesLookup();
      const indices = lookup.state === 'ready' ? lookup.indices : [];
      const docs = totalDocs(indices);
      const options = store.reindex();
      const limit = options.maxDocs.trim() ? ` (at most ${formatNumber(Number(options.maxDocs))})` : '';
      const scope = options.query.trim() ? 'the matching documents' : docs !== null ? pluralize(docs, 'document') : 'the documents';
      return `Copies ${scope}${limit} of ${pluralize(indices.length, 'index', 'indices')} into ${options.dest.trim()}, as a background task the next step follows.`;
    }
    return '';
  });

  readonly afterwards = computed<readonly string[]>(() => {
    const operation = this.store.operation();
    const target = this.store.resizeOptions().target;
    const source = this.store.source();
    if (isResizeKind(operation)) {
      return [
        `The wizard follows the shards of ${target} until it is green.`,
        this.store.sourceIndex()?.dataStream
          ? `It then offers to lift what it set on ${source}. ${source} stays in its data stream and is not offered for deletion.`
          : `It then offers to lift what it set on ${source} (write block${operation === 'shrink' ? ', node requirement' : ''}), or to delete it.`,
      ];
    }
    if (operation === 'reindex') {
      return ['The progress is shown live; the reindex can be cancelled while it runs.', 'Leaving the page does not stop it: it stays listed under Tasks.'];
    }
    return [];
  });

  json(request: PlannedRequest): string {
    return JSON.stringify(request.preview.body, null, 2);
  }

  copy(request: PlannedRequest): void {
    void this.clipboard.copyAndNotify(requestText(request.preview), 'request');
  }
}
