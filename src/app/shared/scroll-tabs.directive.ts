import { DestroyRef, Directive, ElementRef, afterNextRender, inject, signal } from '@angular/core';

/** Which edges of the strip hide tabs. */
interface Overflow {
  readonly start: boolean;
  readonly end: boolean;
}

/**
 * A `.tabs` strip that scrolls sideways when its tabs do not fit (phones,
 * long labels, badges):
 *
 *   <div class="tabs" role="tablist" aria-label="…" cerebroScrollTabs>
 *
 * It sets `.tabs--scroll`, and `.is-overflow-start` / `.is-overflow-end` on
 * the edges that hide tabs, which fade as a scroll cue. They are measured on
 * scroll and whenever the strip or one of its tabs changes size (the page
 * narrows, the web font loads, a badge fills in).
 *
 * The selected tab (`aria-selected="true"`) is scrolled clear of the faded
 * edges after the first render, whenever the selection moves to another tab
 * and whenever the layout changes, so the page only renders its tabs.
 * `reveal()` (`#strip="cerebroScrollTabs"`) does it on demand.
 *
 * The fade width is `--tabs-fade` on `.tabs--scroll` in components.css: the
 * mask draws it and `reveal()` reads it, so the two never disagree.
 */
@Directive({
  selector: '[cerebroScrollTabs]',
  exportAs: 'cerebroScrollTabs',
  host: {
    class: 'tabs--scroll',
    '[class.is-overflow-start]': 'overflow().start',
    '[class.is-overflow-end]': 'overflow().end',
    '(scroll)': 'measure()',
  },
})
export class ScrollTabsDirective {
  private readonly strip = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private mutations: MutationObserver | undefined;
  private resizes: ResizeObserver | undefined;

  protected readonly overflow = signal<Overflow>(
    { start: false, end: false },
    { equal: (a, b) => a.start === b.start && a.end === b.end },
  );

  constructor() {
    // After the first render, so the page has created its tabs.
    afterNextRender(() => {
      // The selection moves, or tabs come and go (they are watched for size).
      this.mutations = new MutationObserver((records) => {
        if (records.some((record) => record.target === this.strip)) {
          this.observeSizes();
        }
        this.reveal();
      });
      this.mutations.observe(this.strip, { subtree: true, childList: true, attributeFilter: ['aria-selected'] });
      if (typeof ResizeObserver !== 'undefined') {
        this.resizes = new ResizeObserver(() => this.reveal());
        this.observeSizes();
      }
      this.reveal();
    });
    inject(DestroyRef).onDestroy(() => {
      this.mutations?.disconnect();
      this.resizes?.disconnect();
    });
  }

  /** Scrolls the selected tab clear of the faded edges, if it is not, and measures the edges again. */
  reveal(): void {
    const strip = this.strip;
    const tab = strip.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
    if (tab && strip.scrollWidth > strip.clientWidth) {
      const fade = this.fadeWidth();
      const left = tab.getBoundingClientRect().left - strip.getBoundingClientRect().left + strip.scrollLeft;
      const right = left + tab.offsetWidth;
      const max = strip.scrollWidth - strip.clientWidth;
      const start = strip.scrollLeft + (strip.scrollLeft > 1 ? fade : 0);
      const end = strip.scrollLeft + strip.clientWidth - (strip.scrollLeft < max - 1 ? fade : 0);
      if (left < start || right > end) {
        strip.scrollLeft = Math.min(max, Math.max(0, left - (strip.clientWidth - tab.offsetWidth) / 2));
      }
    }
    this.measure();
  }

  /** Records which edges hide tabs. */
  protected measure(): void {
    const { scrollLeft, clientWidth, scrollWidth } = this.strip;
    this.overflow.set({ start: scrollLeft > 1, end: scrollLeft + clientWidth < scrollWidth - 1 });
  }

  /** Watches the strip and each of its tabs. */
  private observeSizes(): void {
    if (!this.resizes) {
      return;
    }
    this.resizes.disconnect();
    this.resizes.observe(this.strip);
    for (const tab of Array.from(this.strip.children)) {
      this.resizes.observe(tab);
    }
  }

  /** `--tabs-fade` in pixels; 0 when the stylesheet sets none. */
  private fadeWidth(): number {
    const view = this.strip.ownerDocument.defaultView;
    return Number.parseFloat(view?.getComputedStyle(this.strip).getPropertyValue('--tabs-fade') ?? '') || 0;
  }
}
