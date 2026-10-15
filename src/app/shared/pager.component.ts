import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';

/** "1–20 of 143" with previous/next buttons. Pages are 1-based. */
@Component({
  selector: 'cerebro-pager',
  host: { class: 'pager' },
  template: `
    <span class="count-label">
      @if (total() === 0) {
        0 {{ noun() }}
      } @else {
        <strong>{{ first() }}–{{ last() }}</strong> of <strong>{{ total() }}</strong> {{ noun() }}
      }
    </span>
    @if (pageCount() > 1) {
      <span class="btn-group">
        <button
          type="button"
          class="btn btn-sm btn-icon"
          aria-label="Previous page"
          [disabled]="page() <= 1"
          (click)="pageChange.emit(page() - 1)"
        >
          <i class="bi bi-chevron-left" aria-hidden="true"></i>
        </button>
        <button
          type="button"
          class="btn btn-sm btn-icon"
          aria-label="Next page"
          [disabled]="page() >= pageCount()"
          (click)="pageChange.emit(page() + 1)"
        >
          <i class="bi bi-chevron-right" aria-hidden="true"></i>
        </button>
      </span>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PagerComponent {
  readonly page = input.required<number>();
  readonly pageSize = input.required<number>();
  readonly total = input.required<number>();
  readonly noun = input('');
  readonly pageChange = output<number>();

  readonly pageCount = computed(() =>
    Math.max(1, Math.ceil(this.total() / Math.max(1, this.pageSize()))),
  );
  readonly first = computed(() =>
    this.total() === 0 ? 0 : (Math.min(this.page(), this.pageCount()) - 1) * this.pageSize() + 1,
  );
  readonly last = computed(() =>
    Math.min(Math.min(this.page(), this.pageCount()) * this.pageSize(), this.total()),
  );
}

/** Clamps a 1-based page number into range for the given item count. */
export function clampPage(page: number, total: number, pageSize: number): number {
  const pages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
  return Math.min(Math.max(1, page), pages);
}

export function pageSlice<T>(items: readonly T[], page: number, pageSize: number): T[] {
  const current = clampPage(page, items.length, pageSize);
  return items.slice((current - 1) * pageSize, current * pageSize);
}
