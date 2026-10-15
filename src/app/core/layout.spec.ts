import { STACKED_LAYOUT_QUERY, isStackedLayout, revealWhenStacked } from './layout';

describe('layout helpers', () => {
  const originalMatchMedia = window.matchMedia;
  const originalInnerHeight = window.innerHeight;

  function mockMedia(matches: Record<string, boolean>): void {
    window.matchMedia = ((query: string) => ({ matches: matches[query] ?? false })) as typeof window.matchMedia;
  }

  function element(top = 0): HTMLElement {
    const node = document.createElement('div');
    node.scrollIntoView = vi.fn();
    node.getBoundingClientRect = () => ({ top }) as DOMRect;
    return node;
  }

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: originalInnerHeight });
  });

  it('uses the design-system breakpoint', () => {
    expect(STACKED_LAYOUT_QUERY).toBe('(max-width: 1180px)');
    mockMedia({ [STACKED_LAYOUT_QUERY]: true });
    expect(isStackedLayout()).toBe(true);
    mockMedia({});
    expect(isStackedLayout()).toBe(false);
  });

  it('scrolls the element into view only in the stacked layout', () => {
    const target = element();
    mockMedia({});
    expect(revealWhenStacked(target)).toBe(false);
    expect(target.scrollIntoView).not.toHaveBeenCalled();

    mockMedia({ [STACKED_LAYOUT_QUERY]: true });
    expect(revealWhenStacked(target)).toBe(true);
    expect(target.scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
  });

  it('jumps without animation when the user prefers reduced motion', () => {
    const target = element();
    mockMedia({ [STACKED_LAYOUT_QUERY]: true, '(prefers-reduced-motion: reduce)': true });
    revealWhenStacked(target);
    expect(target.scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto', block: 'start' });
  });

  it('leaves an element that is already visible when asked to', () => {
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 1000 });
    mockMedia({ [STACKED_LAYOUT_QUERY]: true });
    const visible = element(300);
    expect(revealWhenStacked(visible, { onlyBelowFold: true })).toBe(false);
    const below = element(900);
    expect(revealWhenStacked(below, { onlyBelowFold: true })).toBe(true);
  });

  it('ignores a missing element', () => {
    mockMedia({ [STACKED_LAYOUT_QUERY]: true });
    expect(revealWhenStacked(undefined)).toBe(false);
    expect(revealWhenStacked(null)).toBe(false);
  });
});
