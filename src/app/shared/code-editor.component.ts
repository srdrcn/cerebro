import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  effect,
  inject,
  input,
  model,
  output,
  untracked,
  viewChild,
} from '@angular/core';
import * as ace from 'ace-builds';
import type { Ace } from 'ace-builds';
import 'ace-builds/src-noconflict/mode-json';
import 'ace-builds/src-noconflict/mode-text';
import 'ace-builds/src-noconflict/ext-searchbox';
import { ThemeService } from '../core/theme.service';

export type CodeEditorMode = 'json' | 'text';

/**
 * Ace based JSON editor styled by the design tokens (see styles/ace.css).
 *
 * Height: either set `fill` and size the host with CSS, or use
 * `minLines`/`maxLines` to grow with the content.
 *
 * Keyboard: Tab and Shift+Tab move focus in and out of the editor like in any
 * other form field (no keyboard trap); Ctrl/⌘+] and Ctrl/⌘+[ indent and
 * outdent, and Enter keeps the indentation of the current line. Ctrl/⌘+K is
 * left to the command palette. The page scrolls to keep the caret visible
 * and clear of sticky bars (top bar, sticky card footers).
 *
 * Validation: `[invalid]` draws the red error frame and sets aria-invalid,
 * `[describedBy]` links the field error (`.field-error` id) like on inputs.
 */
@Component({
  selector: 'cerebro-code-editor',
  host: {
    class: 'code-frame',
    '[class.code-frame--flush]': 'flush()',
    '[class.is-fill]': 'fill()',
    '[class.is-readonly]': 'readOnly()',
    '[class.is-invalid]': 'invalid()',
  },
  template: `<div #host class="code-editor__surface"></div>`,
  styles: `
    :host {
      display: block;
    }

    :host(.is-fill) {
      height: 100%;
    }

    .code-editor__surface {
      width: 100%;
      min-height: 60px;
    }

    :host(.is-fill) .code-editor__surface {
      height: 100%;
    }

    :host(.is-readonly) ::ng-deep .ace_cursor-layer {
      display: none;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CodeEditorComponent {
  readonly value = model('');
  readonly mode = input<CodeEditorMode>('json');
  readonly readOnly = input(false);
  readonly placeholder = input('');
  readonly ariaLabel = input('Code editor');
  readonly minLines = input(12);
  readonly maxLines = input(40);
  readonly fill = input(false);
  readonly flush = input(false);
  readonly wrap = input(false);
  readonly invalid = input(false);
  /** Id of the element describing the content, typically the field error. */
  readonly describedBy = input<string | null>(null);
  /** Emitted on Ctrl/⌘ + Enter. */
  readonly submit = output<void>();

  private readonly hostRef = viewChild.required<ElementRef<HTMLElement>>('host');
  private readonly theme = inject(ThemeService);
  private readonly destroyRef = inject(DestroyRef);
  private editor: Ace.Editor | undefined;
  private writing = false;
  private resizeObserver: ResizeObserver | undefined;

  constructor() {
    afterNextRender(() => this.createEditor());

    effect(() => {
      const value = this.value();
      const editor = this.editor;
      if (editor && editor.getValue() !== value) {
        this.writing = true;
        editor.session.setValue(value);
        this.writing = false;
      }
    });

    effect(() => {
      const dark = this.theme.resolved() === 'dark';
      this.editor?.setTheme({ cssClass: 'ace-cerebro', isDark: dark, cssText: '' } as Ace.Theme);
    });

    effect(() => {
      const readOnly = this.readOnly();
      const mode = this.mode();
      const wrap = this.wrap();
      const placeholder = this.placeholder();
      const ariaLabel = this.ariaLabel();
      const invalid = this.invalid();
      const describedBy = this.describedBy();
      const editor = this.editor;
      if (!editor) {
        return;
      }
      editor.setReadOnly(readOnly);
      editor.session.setMode(`ace/mode/${mode}`);
      editor.session.setUseWrapMode(wrap);
      editor.setOption('placeholder', placeholder);
      this.applyAriaLabel(editor, ariaLabel);
      this.applyValidity(editor, invalid, describedBy);
    });

    this.destroyRef.onDestroy(() => {
      this.resizeObserver?.disconnect();
      this.editor?.destroy();
      this.editor?.container.remove();
      this.editor = undefined;
    });
  }

  /** Pretty-prints JSON content; invalid JSON is left untouched. */
  format(): boolean {
    try {
      const content = this.value();
      if (!content.trim()) {
        return true;
      }
      this.value.set(JSON.stringify(JSON.parse(content), null, 2));
      return true;
    } catch {
      return false;
    }
  }

  focus(): void {
    this.editor?.focus();
  }

  private createEditor(): void {
    const editor = ace.edit(this.hostRef().nativeElement, {
      useWorker: false,
      mode: `ace/mode/${this.mode()}`,
      value: this.value(),
      readOnly: this.readOnly(),
      fontFamily: getComputedStyle(document.documentElement).getPropertyValue('--font-mono').trim(),
      fontSize: '12.5px',
      showPrintMargin: false,
      highlightActiveLine: !this.readOnly(),
      highlightGutterLine: !this.readOnly(),
      showGutter: true,
      tabSize: 2,
      useSoftTabs: true,
      wrap: this.wrap(),
      placeholder: this.placeholder(),
      scrollPastEnd: 0,
      fixedWidthGutter: true,
      ...(this.fill() ? {} : { minLines: this.minLines(), maxLines: this.maxLines() }),
    });
    untracked(() => {
      const dark = this.theme.resolved() === 'dark';
      editor.setTheme({ cssClass: 'ace-cerebro', isDark: dark, cssText: '' } as Ace.Theme);
    });
    editor.session.setUseWorker(false);
    editor.renderer.setScrollMargin(8, 8, 0, 0);
    editor.renderer.setPadding(10);
    this.applyAriaLabel(editor, this.ariaLabel());
    this.applyValidity(editor, this.invalid(), this.describedBy());
    // Ace binds Tab/Shift+Tab to indent/outdent, which traps keyboard users
    // inside the editor (WCAG 2.1.2). Let the browser move focus instead;
    // block indentation stays on Ctrl/⌘+] and Ctrl/⌘+[.
    editor.commands.removeCommand('indent');
    editor.commands.removeCommand('outdent');
    // Ace binds Ctrl-K to "find next" and swallows it; leave it to the command
    // palette (find next stays on Command-G on macOS). A null command removes
    // the binding, which Ace's typings do not declare.
    editor.commands.bindKey({ win: 'Ctrl-K', mac: 'Command-K' }, null as unknown as string);
    editor.selection.clearSelection();
    editor.session.getUndoManager().reset();

    editor.on('change', () => {
      if (!this.writing) {
        this.value.set(editor.getValue());
      }
    });
    editor.commands.addCommand({
      name: 'cerebroSubmit',
      bindKey: { win: 'Ctrl-Enter', mac: 'Command-Enter' },
      exec: () => this.submit.emit(),
    });
    editor.commands.addCommand({
      name: 'cerebroFormat',
      bindKey: { win: 'Ctrl-Shift-F', mac: 'Command-Shift-F' },
      exec: () => this.format(),
    });

    this.followCaret(editor);

    this.editor = editor;
    if (this.fill()) {
      this.resizeObserver = new ResizeObserver(() => editor.resize());
      this.resizeObserver.observe(this.hostRef().nativeElement);
    }
  }

  /**
   * Auto-height editors grow taller than the viewport and rely on the page
   * scroll, which Ace does not drive. After every render that moved the
   * caret of the focused editor, scroll the nearest scroll container so the
   * caret line is inside the viewport and not under a sticky or fixed bar.
   */
  private followCaret(editor: Ace.Editor): void {
    let moved = false;
    editor.on('changeSelection', () => {
      moved = true;
    });
    editor.renderer.on('afterRender', () => {
      if (!moved) {
        return;
      }
      moved = false;
      if (editor.isFocused()) {
        this.revealCaret(editor);
      }
    });
  }

  private revealCaret(editor: Ace.Editor): void {
    const view = editor.container.ownerDocument.defaultView;
    if (!view) {
      return;
    }
    const margin = 8;
    const scroller = this.scrollParent(editor.container, view);
    // Twice at most: scrolling a caret that was off-screen can land it under
    // a sticky footer that only the second pass can see.
    for (let pass = 0; pass < 2; pass++) {
      const cursor = editor.getCursorPosition();
      const point = editor.renderer.textToScreenCoordinates(cursor.row, cursor.column);
      const top = point.pageY;
      const bottom = top + (editor.renderer.lineHeight || 16);
      const x = Math.min(Math.max(point.pageX + 2, 0), view.innerWidth - 1);
      // A bar in the upper half of the viewport (the top bar) hides the caret
      // from above, one in the lower half (a sticky footer) from below.
      const covers = [top + 1, bottom - 1]
        .map((y) => this.coveringBar(editor.container, x, y, view))
        .filter((rect): rect is DOMRect => rect !== null);
      const middle = view.innerHeight / 2;
      const coverAbove = covers.find((rect) => rect.top + rect.height / 2 < middle);
      const coverBelow = covers.find((rect) => rect.top + rect.height / 2 >= middle);

      const frame = scroller?.getBoundingClientRect();
      let visibleTop = Math.max(frame?.top ?? 0, 0);
      let visibleBottom = Math.min(frame?.bottom ?? view.innerHeight, view.innerHeight);
      if (coverAbove) {
        visibleTop = Math.max(visibleTop, coverAbove.bottom);
      } else if (!scroller && top < 0) {
        // Off-screen above: the sticky top bar will cover the first rows.
        visibleTop = this.topbarHeight(view);
      }
      if (coverBelow) {
        visibleBottom = Math.min(visibleBottom, coverBelow.top);
      }

      let delta = 0;
      if (top < visibleTop) {
        delta = top - visibleTop - margin;
      } else if (bottom > visibleBottom) {
        delta = bottom - visibleBottom + margin;
      }
      if (delta === 0) {
        return;
      }
      // scrollIntoView cannot be used: the editor frames clip with overflow
      // hidden, which drops the scroll margins needed to clear the bars.
      (scroller ?? view).scrollBy({ top: delta });
    }
  }

  /** The nearest ancestor that scrolls vertically, or `null` for the page. */
  private scrollParent(element: HTMLElement, view: Window): HTMLElement | null {
    const root = element.ownerDocument.scrollingElement;
    for (let node = element.parentElement; node && node !== root; node = node.parentElement) {
      const overflow = view.getComputedStyle(node).overflowY;
      if ((overflow === 'auto' || overflow === 'scroll') && node.scrollHeight > node.clientHeight) {
        return node;
      }
    }
    return null;
  }

  /** The sticky or fixed element drawn over the point, if any. */
  private coveringBar(container: HTMLElement, x: number, y: number, view: Window): DOMRect | null {
    if (y < 0 || y >= view.innerHeight) {
      return null;
    }
    let element = container.ownerDocument.elementFromPoint(x, y);
    if (!element || container.contains(element)) {
      return null;
    }
    while (element) {
      const position = view.getComputedStyle(element).position;
      if (position === 'sticky' || position === 'fixed') {
        return element.getBoundingClientRect();
      }
      element = element.parentElement;
    }
    return null;
  }

  private topbarHeight(view: Window): number {
    const value = view.getComputedStyle(view.document.documentElement).getPropertyValue('--topbar-height');
    return Number.parseFloat(value) || 0;
  }

  /**
   * Ace rewrites the text area's aria-label to "Cursor at row N" whenever
   * the selection changes; `textInputAriaLabel` keeps the field's name in
   * front of it.
   */
  private applyAriaLabel(editor: Ace.Editor, label: string): void {
    editor.setOption('textInputAriaLabel', label);
    editor.textInput.getElement().setAttribute('aria-label', label);
  }

  private applyValidity(editor: Ace.Editor, invalid: boolean, describedBy: string | null): void {
    const field = editor.textInput.getElement();
    if (invalid) {
      field.setAttribute('aria-invalid', 'true');
    } else {
      field.removeAttribute('aria-invalid');
    }
    if (describedBy) {
      field.setAttribute('aria-describedby', describedBy);
    } else {
      field.removeAttribute('aria-describedby');
    }
  }
}
