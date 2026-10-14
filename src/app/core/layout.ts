/**
 * Breakpoints of the design system that code needs to know about. Keep them
 * in step with docs/FRONTEND.md rule 11 and the media queries in
 * styles/components.css (`.layout-split`, `.layout-sidebar-*`).
 */

/** Below this width two-column layouts stack into one column. */
export const STACKED_LAYOUT_QUERY = '(max-width: 1180px)';

export interface RevealOptions {
  /**
   * Only scroll when the element starts in the lower part of the viewport
   * (below 60% of its height), e.g. a response that may already be visible.
   */
  readonly onlyBelowFold?: boolean;
}

function windowOf(element: Element): Window | null {
  return element.ownerDocument?.defaultView ?? null;
}

/** True while master/detail layouts are stacked (one column). */
export function isStackedLayout(view: Window | null = globalThis.window ?? null): boolean {
  return view?.matchMedia?.(STACKED_LAYOUT_QUERY).matches ?? false;
}

/**
 * In the stacked layout the detail (an editor, a response) sits below the
 * list: scroll it into view after the user picked something in the list.
 * Does nothing in the side-by-side layout, where the detail is already
 * visible. The sticky top bar is cleared by `html { scroll-padding-top }`.
 * Returns whether it scrolled.
 */
export function revealWhenStacked(
  element: Element | null | undefined,
  options: RevealOptions = {},
): boolean {
  if (!element) {
    return false;
  }
  const view = windowOf(element);
  if (!isStackedLayout(view)) {
    return false;
  }
  if (options.onlyBelowFold && view && element.getBoundingClientRect().top <= view.innerHeight * 0.6) {
    return false;
  }
  const reduceMotion = view?.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  element.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
  return true;
}
