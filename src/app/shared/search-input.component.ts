import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  input,
  model,
  viewChild,
} from '@angular/core';

let nextSearchId = 0;

/** Search field with a leading icon and a clear button: `[(value)]`. */
@Component({
  selector: 'cerebro-search',
  host: { class: 'input-group' },
  template: `
    <i class="bi bi-search" aria-hidden="true"></i>
    <input
      #input
      type="search"
      class="input"
      [class.input-sm]="small()"
      [id]="inputId()"
      [placeholder]="placeholder()"
      [attr.aria-label]="ariaLabel() || placeholder()"
      [value]="value()"
      (input)="value.set(input.value)"
      (keydown.escape)="clear($event)"
      autocomplete="off"
      spellcheck="false"
    />
    @if (value()) {
      <button
        type="button"
        class="input-clear"
        aria-label="Clear search"
        (click)="clear(); input.focus()"
      >
        <i class="bi bi-x" aria-hidden="true"></i>
      </button>
    }
  `,
  styles: `
    input[type='search']::-webkit-search-cancel-button {
      display: none;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SearchInputComponent {
  readonly value = model('');
  readonly placeholder = input('Search');
  readonly ariaLabel = input('');
  readonly small = input(false);
  readonly inputId = input(`cerebro-search-${nextSearchId++}`);

  private readonly inputRef = viewChild.required<ElementRef<HTMLInputElement>>('input');

  clear(event?: Event): void {
    if (event && this.value()) {
      event.stopPropagation();
    }
    this.value.set('');
  }

  focus(): void {
    this.inputRef().nativeElement.focus();
  }
}
