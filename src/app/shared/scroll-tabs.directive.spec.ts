import { ChangeDetectionStrategy, Component, signal, viewChild } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ScrollTabsDirective } from './scroll-tabs.directive';

@Component({
  imports: [ScrollTabsDirective],
  template: `
    <div class="tabs" role="tablist" aria-label="Views" cerebroScrollTabs style="--tabs-fade: 48px">
      @for (tab of tabs(); track tab) {
        <button type="button" role="tab" [attr.aria-selected]="tab === selected()">{{ tab }}</button>
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class HostComponent {
  readonly tabs = signal(['one', 'two', 'three', 'four', 'five']);
  readonly selected = signal('one');
  readonly strip = viewChild.required(ScrollTabsDirective);
}

/** Records what is observed (jsdom has no ResizeObserver) and reports resizes on demand. */
class FakeResizeObserver {
  static last: FakeResizeObserver | undefined;
  readonly targets = new Set<Element>();
  constructor(readonly resized: () => void) {
    FakeResizeObserver.last = this;
  }
  observe(target: Element): void {
    this.targets.add(target);
  }
  unobserve(target: Element): void {
    this.targets.delete(target);
  }
  disconnect(): void {
    this.targets.clear();
  }
}

/**
 * jsdom has no layout: lays the `role="tab"` children of a tablist side by
 * side, `tab` pixels wide each, in a strip `box` pixels wide that scrolls
 * (and clamps `scrollLeft` like a browser). Change `box` or `tab` to resize.
 */
function fakeLayout(layout: { box: number; tab: number }): void {
  const scrolled = new WeakMap<Element, number>();
  const isStrip = (element: Element) => element.getAttribute('role') === 'tablist';
  const contentWidth = (strip: Element) => strip.children.length * layout.tab;
  vi.spyOn(Element.prototype, 'clientWidth', 'get').mockImplementation(function (this: Element) {
    return isStrip(this) ? layout.box : 0;
  });
  vi.spyOn(Element.prototype, 'scrollWidth', 'get').mockImplementation(function (this: Element) {
    return isStrip(this) ? Math.max(layout.box, contentWidth(this)) : 0;
  });
  vi.spyOn(Element.prototype, 'scrollLeft', 'get').mockImplementation(function (this: Element) {
    return scrolled.get(this) ?? 0;
  });
  vi.spyOn(Element.prototype, 'scrollLeft', 'set').mockImplementation(function (this: Element, value: number) {
    scrolled.set(this, Math.min(Math.max(0, contentWidth(this) - layout.box), Math.max(0, value)));
  });
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return this.getAttribute('role') === 'tab' ? layout.tab : 0;
  });
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const strip = this.parentElement;
    if (this.getAttribute('role') !== 'tab' || !strip) {
      return new DOMRect(0, 0, isStrip(this) ? layout.box : 0, 42);
    }
    const index = Array.from(strip.children).indexOf(this);
    return new DOMRect(index * layout.tab - strip.scrollLeft, 0, layout.tab, 42);
  });
}

describe('ScrollTabsDirective', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function render(selected = 'one') {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.selected.set(selected);
    await fixture.whenStable();
    const strip = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('[role="tablist"]')!;
    return { fixture, host: fixture.componentInstance, strip };
  }

  /** Which edges fade. */
  function fades(strip: HTMLElement): { start: boolean; end: boolean } {
    return { start: strip.classList.contains('is-overflow-start'), end: strip.classList.contains('is-overflow-end') };
  }

  it('fades only the edges that hide tabs, following the scroll', async () => {
    fakeLayout({ box: 250, tab: 100 });
    const { fixture, strip } = await render();
    expect(strip.classList).toContain('tabs--scroll');
    expect(fades(strip)).toEqual({ start: false, end: true });

    strip.scrollLeft = 120;
    strip.dispatchEvent(new Event('scroll'));
    await fixture.whenStable();
    expect(fades(strip)).toEqual({ start: true, end: true });

    strip.scrollLeft = 250;
    strip.dispatchEvent(new Event('scroll'));
    await fixture.whenStable();
    expect(fades(strip)).toEqual({ start: true, end: false });
  });

  it('neither fades nor scrolls a strip whose tabs fit', async () => {
    fakeLayout({ box: 600, tab: 100 });
    const { strip } = await render('five');
    expect(fades(strip)).toEqual({ start: false, end: false });
    expect(strip.scrollLeft).toBe(0);
  });

  it('scrolls a newly selected tab clear of the faded edges', async () => {
    fakeLayout({ box: 320, tab: 100 });
    const { fixture, host, strip } = await render();

    // Fully clear of the fade at the end (272px on): stays put.
    host.selected.set('two');
    await fixture.whenStable();
    expect(strip.scrollLeft).toBe(0);

    // Visible, but under the fade: centred.
    host.selected.set('three');
    await fixture.whenStable();
    expect(strip.scrollLeft).toBe(90);
    expect(fades(strip)).toEqual({ start: true, end: true });

    // Under the fade at the start: back to the beginning.
    host.selected.set('one');
    await fixture.whenStable();
    expect(strip.scrollLeft).toBe(0);
    expect(fades(strip)).toEqual({ start: false, end: true });
  });

  it('takes the fade width from --tabs-fade', async () => {
    fakeLayout({ box: 320, tab: 100 });
    const { fixture, host, strip } = await render();
    strip.style.setProperty('--tabs-fade', '16px');

    host.selected.set('three');
    await fixture.whenStable();
    expect(strip.scrollLeft).toBe(0);
  });

  it('reveals the selected tab after the first render without a ResizeObserver', async () => {
    vi.stubGlobal('ResizeObserver', undefined);
    fakeLayout({ box: 250, tab: 100 });
    const { strip } = await render('five');
    expect(strip.scrollLeft).toBe(250);
    expect(fades(strip)).toEqual({ start: true, end: false });
  });

  it('reveals the selected tab again when the strip or a tab changes size', async () => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    const layout = { box: 600, tab: 100 };
    fakeLayout(layout);
    const { fixture, host, strip } = await render('five');
    const observer = FakeResizeObserver.last!;
    expect([...observer.targets]).toEqual([strip, ...Array.from(strip.querySelectorAll('[role="tab"]'))]);
    expect(fades(strip)).toEqual({ start: false, end: false });

    // The page narrows: the selected last tab would be cut off.
    layout.box = 250;
    observer.resized();
    await fixture.whenStable();
    expect(strip.scrollLeft).toBe(250);
    expect(fades(strip)).toEqual({ start: true, end: false });

    // A tab added later is watched too.
    host.tabs.update((tabs) => [...tabs, 'six']);
    await fixture.whenStable();
    expect(observer.targets.size).toBe(7);
    expect(observer.targets.has(strip.lastElementChild!)).toBe(true);

    fixture.destroy();
    expect(observer.targets.size).toBe(0);
  });

  it('reveals the selected tab on demand', async () => {
    fakeLayout({ box: 250, tab: 100 });
    const { fixture, host, strip } = await render();
    strip.scrollLeft = 250;
    strip.dispatchEvent(new Event('scroll'));

    host.strip().reveal();
    await fixture.whenStable();
    expect(strip.scrollLeft).toBe(0);
    expect(fades(strip)).toEqual({ start: false, end: true });
  });
});
