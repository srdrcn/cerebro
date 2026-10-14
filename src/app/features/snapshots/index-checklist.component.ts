import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  model,
  signal,
} from '@angular/core';
import { matchesText } from '../../core/format';
import { SearchInputComponent } from '../../shared/search-input.component';

export interface ChecklistOption {
  readonly name: string;
  /** Small badge after the name (for example "system"). */
  readonly badge?: string;
  /** Secondary text, e.g. the name the index is restored as. */
  readonly detail?: string;
  /** Highlights the detail as a problem (shown in the warning colour). */
  readonly warn?: boolean;
  readonly warnLabel?: string;
  /** Neutral outlined badge, e.g. "replaces closed". */
  readonly note?: string;
}

let nextChecklistId = 0;

/**
 * Searchable list of checkboxes used to pick indices. Selection is a set of
 * names, so options that are filtered out keep their state.
 */
@Component({
  selector: 'cerebro-index-checklist',
  imports: [SearchInputComponent],
  template: `
    <div class="checklist__toolbar">
      <!-- The checklist lives inside create/restore forms: Enter in the
           filter must filter, never submit the surrounding form. -->
      <cerebro-search
        (keydown.enter)="$event.preventDefault()"
        [(value)]="query"
        [small]="true"
        [placeholder]="'Filter ' + noun()"
        [ariaLabel]="'Filter ' + noun()"
        [inputId]="id + '-search'"
      />
      <div class="checklist__bulk" role="group" [attr.aria-label]="'Select ' + noun()">
        <button
          type="button"
          class="btn btn-ghost btn-sm"
          [disabled]="visible().length === 0 || allVisibleSelected()"
          (click)="selectVisible(true)"
        >
          {{ query() ? 'Select shown' : 'Select all' }}
        </button>
        <button
          type="button"
          class="btn btn-ghost btn-sm"
          [disabled]="visibleSelectedCount() === 0"
          (click)="selectVisible(false)"
        >
          {{ query() ? 'Clear shown' : 'Clear' }}
        </button>
      </div>
    </div>
    <ng-content />
    <ul class="checklist__items" [attr.aria-label]="label()" [style.max-height.px]="maxHeight()">
      @for (option of visible(); track option.name) {
        <li>
          <label class="check checklist__item" [class.is-checked]="selected().has(option.name)">
            <input
              type="checkbox"
              [checked]="selected().has(option.name)"
              (change)="toggle(option.name)"
            />
            <span class="checklist__text">
              <span class="checklist__name truncate" [title]="option.name">{{ option.name }}</span>
              @if (option.detail) {
                <span class="checklist__detail truncate" [class.is-warn]="option.warn" [title]="option.detail">
                  <i class="bi bi-arrow-return-right" aria-hidden="true"></i>{{ option.detail }}
                </span>
              }
            </span>
            @if (option.warn && option.warnLabel) {
              <span class="badge badge-yellow">{{ option.warnLabel }}</span>
            }
            @if (option.note) {
              <span class="badge badge-outline">{{ option.note }}</span>
            }
            @if (option.badge) {
              <span class="badge">{{ option.badge }}</span>
            }
          </label>
        </li>
      } @empty {
        <li class="checklist__empty">
          @if (options().length === 0) {
            {{ emptyText() }}
          } @else {
            No {{ noun() }} match “{{ query() }}”.
          }
        </li>
      }
    </ul>
    <div class="checklist__footer">
      <span class="count-label" aria-live="polite">
        <strong>{{ selectedCount() }}</strong> of {{ options().length }} selected
      </span>
      @if (hiddenSelectedCount() > 0) {
        <span class="count-label">· {{ hiddenSelectedCount() }} hidden by the filter</span>
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
      overflow: hidden;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      background: var(--surface);
    }

    .checklist__toolbar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-2);
      padding: 8px;
      border-bottom: 1px solid var(--border);
      background: var(--surface-2);
    }

    .checklist__toolbar cerebro-search {
      flex: 1 1 160px;
    }

    .checklist__bulk {
      display: flex;
      gap: 2px;
      margin-left: auto;
    }

    .checklist__items {
      margin: 0;
      padding: 4px;
      overflow: auto;
      list-style: none;
    }

    .checklist__item {
      width: 100%;
      min-height: 32px;
      padding: 5px 8px;
      border-radius: var(--radius-sm);
      font-size: var(--text-sm);
    }

    .checklist__item:hover {
      background: var(--surface-hover);
    }

    .checklist__text {
      display: grid;
      min-width: 0;
      flex: 1;
    }

    .checklist__name {
      font-family: var(--font-mono);
      font-size: 12px;
    }

    .checklist__detail {
      display: flex;
      align-items: center;
      gap: 5px;
      color: var(--text-3);
      font-family: var(--font-mono);
      font-size: 11.5px;
    }

    .checklist__detail.is-warn {
      color: var(--yellow-text);
    }

    .checklist__detail .bi {
      font-size: 10px;
    }

    .checklist__empty {
      padding: 18px 8px;
      color: var(--text-3);
      font-size: var(--text-sm);
      text-align: center;
    }

    .checklist__footer {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      padding: 7px 12px;
      border-top: 1px solid var(--border);
      background: var(--surface-2);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class IndexChecklistComponent {
  readonly options = input.required<readonly ChecklistOption[]>();
  readonly selected = model<ReadonlySet<string>>(new Set());
  readonly label = input('Indices');
  readonly noun = input('indices');
  readonly emptyText = input('There is nothing to select.');
  readonly maxHeight = input(240);

  readonly id = `index-checklist-${nextChecklistId++}`;
  readonly query = signal('');

  readonly visible = computed(() =>
    this.options().filter((option) => matchesText(option.name, this.query())),
  );
  readonly selectedCount = computed(
    () => this.options().filter((option) => this.selected().has(option.name)).length,
  );
  readonly visibleSelectedCount = computed(
    () => this.visible().filter((option) => this.selected().has(option.name)).length,
  );
  readonly allVisibleSelected = computed(
    () => this.visibleSelectedCount() === this.visible().length,
  );
  readonly hiddenSelectedCount = computed(
    () => this.selectedCount() - this.visibleSelectedCount(),
  );

  toggle(name: string): void {
    const next = new Set(this.selected());
    if (next.has(name)) {
      next.delete(name);
    } else {
      next.add(name);
    }
    this.selected.set(next);
  }

  selectVisible(checked: boolean): void {
    const next = new Set(this.selected());
    for (const option of this.visible()) {
      if (checked) {
        next.add(option.name);
      } else {
        next.delete(option.name);
      }
    }
    this.selected.set(next);
  }
}
