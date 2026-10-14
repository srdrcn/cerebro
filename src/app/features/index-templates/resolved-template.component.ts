import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { textMatcher } from '../../core/format';
import { NumberPipe, PluralPipe } from '../../shared/format.pipes';
import { SearchInputComponent } from '../../shared/search-input.component';
import { Origin, ResolvedView } from './index-templates.models';

/** "Defined by" cell: the component template, this template or Elasticsearch. */
@Component({
  selector: 'cerebro-template-origin',
  template: `
    @let value = origin();
    @switch (value.kind) {
      @case ('component') {
        <span class="origin">
          <i class="bi bi-puzzle" aria-hidden="true"></i>
          <button type="button" class="link-button" [title]="'Open component template ' + value.name" (click)="open.emit(value.name)">{{ value.name }}</button>
        </span>
      }
      @case ('self') {
        <span class="origin origin--self"><i class="bi bi-layers" aria-hidden="true"></i> this template</span>
      }
      @default {
        <span class="origin" title="Added by Elasticsearch (defaults, data stream or data tier settings)">
          <i class="bi bi-gear" aria-hidden="true"></i> Elasticsearch
        </span>
      }
    }
  `,
  styles: `
    .origin {
      max-width: 220px;
      display: inline-flex;
      align-items: center;
      gap: 5px;
      color: var(--text-3);
      font-size: var(--text-xs);
      white-space: nowrap;
    }

    .origin .link-button {
      overflow: hidden;
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      text-overflow: ellipsis;
    }

    .origin--self {
      color: var(--accent-text);
      font-weight: 560;
    }

  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TemplateOriginComponent {
  readonly origin = input.required<Origin>();
  readonly open = output<string>();
}

type Section = 'settings' | 'mappings' | 'aliases';

/**
 * Readable rendering of an `_index_template/_simulate` result: the settings,
 * mapping fields and aliases a new matching index receives, each with the
 * template that contributes it.
 */
@Component({
  selector: 'cerebro-resolved-template',
  imports: [NumberPipe, PluralPipe, SearchInputComponent, TemplateOriginComponent],
  template: `
    @let data = view();
    @if (data.overlapping.length > 0) {
      <div class="callout callout-warning">
        <i class="bi bi-exclamation-triangle" aria-hidden="true"></i>
        <div>
          <p>
            <strong>Overlaps with {{ data.overlapping.length | num }} other {{ data.overlapping.length | plural: 'template' }}.</strong>
            Only the matching template with the highest priority is applied to a new index; the others are ignored.
          </p>
          <ul class="overlap-list">
            @for (overlap of data.overlapping; track overlap.name) {
              <li>
                <button type="button" class="link-button mono" (click)="openIndexTemplate.emit(overlap.name)">{{ overlap.name }}</button>
                @if (overlap.patterns) {
                  <span class="text-muted"> · </span><span class="mono text-secondary">{{ overlap.patterns }}</span>
                }
              </li>
            }
          </ul>
        </div>
      </div>
    }

    <div class="resolved-facts">
      <div class="resolved-fact">
        <span class="resolved-fact__value tabular">{{ data.settings.length | num }}</span>
        <span class="resolved-fact__label">{{ data.settings.length | plural: 'setting' }}</span>
      </div>
      <div class="resolved-fact">
        <span class="resolved-fact__value tabular">{{ fieldCount() | num }}</span>
        <span class="resolved-fact__label">{{ fieldCount() | plural: 'mapped field' }}</span>
      </div>
      <div class="resolved-fact">
        <span class="resolved-fact__value tabular">{{ data.aliases.length | num }}</span>
        <span class="resolved-fact__label">{{ data.aliases.length | plural: 'alias' : 'aliases' }}</span>
      </div>
      <div class="resolved-fact resolved-fact--wide">
        <span class="resolved-fact__value resolved-fact__value--text mono truncate" [title]="data.lifecycle ?? ''">{{ data.lifecycle ?? 'None' }}</span>
        <span class="resolved-fact__label">lifecycle policy</span>
      </div>
    </div>

    <div class="section-tabs-row">
      <div class="segmented segmented-sm" role="tablist" aria-label="Resolved template sections">
        @for (item of sections; track item.key) {
          <button
            type="button"
            role="tab"
            [id]="'resolved-tab-' + item.key"
            [attr.aria-selected]="section() === item.key"
            [attr.aria-controls]="'resolved-panel'"
            [attr.tabindex]="section() === item.key ? 0 : -1"
            (click)="selectSection(item.key)"
            (keydown)="onTabKeydown($event)"
          >
            {{ item.label }} <span class="text-muted tabular">{{ sectionCount(item.key) }}</span>
          </button>
        }
      </div>
      @if (section() !== 'aliases') {
        <cerebro-search
          class="resolved-filter"
          [value]="filter()"
          (valueChange)="filter.set($event)"
          [small]="true"
          [placeholder]="section() === 'settings' ? 'Filter settings' : 'Filter fields'"
          [ariaLabel]="section() === 'settings' ? 'Filter resolved settings' : 'Filter resolved mapping fields'"
        />
      }
    </div>

    <div id="resolved-panel" role="tabpanel" [attr.aria-labelledby]="'resolved-tab-' + section()">
      @switch (section()) {
        @case ('settings') {
          @if (visibleSettings().length > 0) {
            <div class="table-wrap resolved-table-wrap">
              <table class="data-table data-table--compact resolved-table">
                <thead>
                  <tr>
                    <th scope="col">Setting</th>
                    <th scope="col">Value</th>
                    <th scope="col" class="resolved-origin-col">Defined by</th>
                  </tr>
                </thead>
                <tbody>
                  @for (entry of visibleSettings(); track entry.key) {
                    <tr>
                      <th scope="row" class="mono resolved-key"><span class="text-muted">index.</span>{{ entry.key.slice(6) }}</th>
                      <td class="resolved-value">
                        <span class="mono break-all">{{ entry.value }}</span>
                        <cerebro-template-origin class="resolved-origin-inline" [origin]="entry.origin" (open)="openComponent.emit($event)" />
                      </td>
                      <td class="resolved-origin-col"><cerebro-template-origin [origin]="entry.origin" (open)="openComponent.emit($event)" /></td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          } @else {
            <p class="resolved-empty">{{ filter() ? 'No setting matches the filter.' : 'No settings: new indices use the cluster defaults.' }}</p>
          }
        }
        @case ('mappings') {
          @if (data.mappingOptions.length > 0) {
            <div class="mapping-options" aria-label="Mapping options">
              @for (option of data.mappingOptions; track option.key) {
                <span class="tag" [title]="option.key + ': ' + option.value">
                  <span class="tag-key">{{ option.key }}</span>
                  <span class="mono">{{ option.value }}</span>
                </span>
              }
            </div>
          }
          @if (visibleFields().length > 0) {
            <div class="table-wrap resolved-table-wrap">
              <table class="data-table data-table--compact resolved-table">
                <thead>
                  <tr>
                    <th scope="col">Field</th>
                    <th scope="col">Type</th>
                    <th scope="col" class="resolved-origin-col">Defined by</th>
                  </tr>
                </thead>
                <tbody>
                  @for (entry of visibleFields(); track entry.path + (entry.runtime ? ':runtime' : '')) {
                    <tr>
                      <th scope="row" class="mono resolved-key">
                        <span [style.padding-left.px]="filter() ? 0 : entry.depth * 14" class="field-path">
                          @if (entry.depth > 0 && !filter()) {
                            <span class="text-muted">{{ parentPath(entry.path) }}.</span>{{ leafName(entry.path) }}
                          } @else {
                            {{ entry.path }}
                          }
                        </span>
                      </th>
                      <td>
                        <span class="badge" [class.badge-blue]="!entry.multi && entry.type !== 'object' && entry.type !== 'nested'" [class.badge-outline]="entry.type === 'object' || entry.type === 'nested'">{{ entry.type }}</span>
                        @if (entry.multi) {
                          <span class="text-muted text-xs field-note">multi-field</span>
                        }
                        @if (entry.runtime) {
                          <span class="text-muted text-xs field-note">runtime</span>
                        }
                        <cerebro-template-origin class="resolved-origin-inline" [origin]="entry.origin" (open)="openComponent.emit($event)" />
                      </td>
                      <td class="resolved-origin-col"><cerebro-template-origin [origin]="entry.origin" (open)="openComponent.emit($event)" /></td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          } @else {
            <p class="resolved-empty">{{ filter() ? 'No field matches the filter.' : 'No explicit fields: new fields are mapped dynamically.' }}</p>
          }
        }
        @case ('aliases') {
          @if (data.aliases.length > 0) {
            <ul class="list resolved-aliases">
              @for (alias of data.aliases; track alias.name) {
                <li class="list-item">
                  <span class="list-item__icon" aria-hidden="true"><i class="bi bi-tag"></i></span>
                  <span class="list-item__body">
                    <span class="list-item__title mono">{{ alias.name }}</span>
                    @if (alias.flags.length > 0) {
                      <span class="list-item__meta">{{ alias.flags.join(' · ') }}</span>
                    }
                  </span>
                  <cerebro-template-origin [origin]="alias.origin" (open)="openComponent.emit($event)" />
                </li>
              }
            </ul>
          } @else {
            <p class="resolved-empty">New indices get no aliases from this template.</p>
          }
        }
      }
    </div>
  `,
  styles: `
    :host {
      min-width: 0;
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      gap: var(--space-4);
    }

    .overlap-list {
      margin: 6px 0 0;
      padding-left: 18px;
    }

    .resolved-facts {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr)) minmax(0, 2fr);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      background: var(--surface-2);
    }

    .resolved-fact {
      min-width: 0;
      display: grid;
      gap: 2px;
      padding: 10px 14px;
    }

    .resolved-fact + .resolved-fact {
      border-left: 1px solid var(--border);
    }

    .resolved-fact__value {
      color: var(--text);
      font-size: var(--text-lg);
      font-weight: 650;
      line-height: 1.2;
    }

    .resolved-fact__value--text {
      font-size: var(--text-base);
      line-height: 1.6;
    }

    .resolved-fact__label {
      color: var(--text-3);
      font-size: var(--text-xs);
    }

    .section-tabs-row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-2) var(--space-3);
    }

    .resolved-filter {
      width: min(260px, 100%);
    }

    .resolved-table-wrap {
      max-height: 460px;
      overflow: auto;
      border: 1px solid var(--border);
      border-radius: var(--radius);
    }

    .resolved-table thead th {
      position: sticky;
      top: 0;
      z-index: 1;
    }

    .resolved-table tbody th {
      font-weight: 500;
    }

    .resolved-key {
      color: var(--text);
      font-size: 12.5px;
      white-space: nowrap;
    }

    .resolved-value {
      min-width: 160px;
      color: var(--text-2);
      font-size: 12.5px;
    }

    .resolved-origin-inline {
      display: none;
    }

    .field-path {
      display: inline-block;
    }

    .field-note {
      margin-left: 6px;
    }

    .mapping-options {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-bottom: var(--space-3);
    }

    .resolved-aliases {
      border: 1px solid var(--border);
      border-radius: var(--radius);
    }

    .resolved-aliases .list-item {
      padding: 9px 14px;
    }

    .resolved-empty {
      margin: 0;
      padding: 18px;
      border: 1px dashed var(--border-strong);
      border-radius: var(--radius);
      color: var(--text-3);
      font-size: var(--text-sm);
      text-align: center;
    }

    @media (max-width: 760px) {
      .resolved-facts {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }

      .resolved-fact--wide {
        grid-column: 1 / -1;
        border-top: 1px solid var(--border);
        border-left: 0 !important;
      }

      /* Two columns on phones: keys wrap and "Defined by" moves under the value. */
      .resolved-key {
        white-space: normal;
        overflow-wrap: anywhere;
      }

      .resolved-value {
        min-width: 0;
      }

      .resolved-origin-col {
        display: none;
      }

      .resolved-origin-inline {
        display: block;
        margin-top: 4px;
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ResolvedTemplateComponent {
  readonly view = input.required<ResolvedView>();
  readonly openComponent = output<string>();
  readonly openIndexTemplate = output<string>();

  readonly sections: readonly { readonly key: Section; readonly label: string }[] = [
    { key: 'settings', label: 'Settings' },
    { key: 'mappings', label: 'Mappings' },
    { key: 'aliases', label: 'Aliases' },
  ];

  readonly section = signal<Section>('settings');
  readonly filter = signal('');

  readonly fieldCount = computed(() => this.view().fields.filter((field) => !field.multi).length);

  /** Regex-or-substring filter, like every other filter of the app. */
  readonly visibleSettings = computed(() => {
    const matches = textMatcher(this.filter());
    return this.view().settings.filter((entry) => matches(entry.key) || matches(entry.value));
  });

  readonly visibleFields = computed(() => {
    const matches = textMatcher(this.filter());
    return this.view().fields.filter((entry) => matches(entry.path) || matches(entry.type));
  });

  /** Settings and mapping fields are filtered separately: switching clears the filter. */
  selectSection(section: Section): void {
    if (section !== this.section()) {
      this.section.set(section);
      this.filter.set('');
    }
  }

  sectionCount(section: Section): number {
    const view = this.view();
    return section === 'settings' ? view.settings.length : section === 'mappings' ? this.fieldCount() : view.aliases.length;
  }

  onTabKeydown(event: KeyboardEvent): void {
    const order: readonly Section[] = ['settings', 'mappings', 'aliases'];
    const index = order.indexOf(this.section());
    let next: number | undefined;
    if (event.key === 'ArrowRight') next = (index + 1) % order.length;
    if (event.key === 'ArrowLeft') next = (index + order.length - 1) % order.length;
    if (next === undefined) {
      return;
    }
    event.preventDefault();
    const key = order[next] ?? 'settings';
    this.selectSection(key);
    document.getElementById(`resolved-tab-${key}`)?.focus();
  }

  parentPath(path: string): string {
    return path.slice(0, path.lastIndexOf('.'));
  }

  leafName(path: string): string {
    return path.slice(path.lastIndexOf('.') + 1);
  }
}
