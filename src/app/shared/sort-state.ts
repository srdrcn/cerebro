import { Signal, WritableSignal, signal } from '@angular/core';

export type AriaSort = 'ascending' | 'descending' | 'none';

/**
 * State of a sortable table: the active column, its direction and what a
 * `.sort-button` header needs.
 *
 *   readonly sort = createSort<NodeSortField>('name');
 *
 *   <th scope="col" [attr.aria-sort]="sort.ariaSort('name')">
 *     <button type="button" class="sort-button" [class.is-active]="sort.isActive('name')" (click)="sort.sortBy('name')">
 *       Node <i class="bi" [class]="'bi ' + sort.icon('name')" aria-hidden="true"></i>
 *     </button>
 *   </th>
 */
export interface SortState<F extends string> {
  readonly field: WritableSignal<F>;
  /** `true` for descending order. */
  readonly reverse: WritableSignal<boolean>;
  /** Clicking the active column flips the direction; another column starts in its default direction. */
  sortBy(field: F): void;
  isActive(field: F): boolean;
  ariaSort(field: F): AriaSort;
  /** Bootstrap icon class for the column's sort indicator. */
  icon(field: F): string;
}

export interface SortOptions<F extends string> {
  /** Initial direction (ascending by default). */
  readonly reverse?: boolean;
  /** Columns that start in descending order when picked, e.g. resource usage. */
  readonly descendingFirst?: (field: F) => boolean;
}

export function createSort<F extends string>(initial: F, options: SortOptions<F> = {}): SortState<F> {
  const field = signal<F>(initial);
  const reverse = signal(options.reverse ?? false);
  const active = (candidate: F, current: Signal<F>) => current() === candidate;
  return {
    field,
    reverse,
    sortBy(next: F): void {
      if (field() === next) {
        reverse.update((value) => !value);
        return;
      }
      field.set(next);
      reverse.set(options.descendingFirst?.(next) ?? false);
    },
    isActive: (candidate) => active(candidate, field),
    ariaSort(candidate: F): AriaSort {
      if (!active(candidate, field)) {
        return 'none';
      }
      return reverse() ? 'descending' : 'ascending';
    },
    icon(candidate: F): string {
      if (!active(candidate, field)) {
        return 'bi-arrow-down-up';
      }
      return reverse() ? 'bi-arrow-down' : 'bi-arrow-up';
    },
  };
}
