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
 * outdent, and Enter keeps the indentation of the current line.
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

    this.editor = editor;
    if (this.fill()) {
      this.resizeObserver = new ResizeObserver(() => editor.resize());
      this.resizeObserver.observe(this.hostRef().nativeElement);
    }
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
