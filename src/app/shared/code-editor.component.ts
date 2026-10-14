import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  EventEmitter,
  forwardRef,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
  ViewChild,
} from '@angular/core';
import {
  ControlValueAccessor,
  NG_VALUE_ACCESSOR,
} from '@angular/forms';
import * as ace from 'ace-builds';
import type { Ace } from 'ace-builds';
import 'ace-builds/src-noconflict/mode-json';
import 'ace-builds/src-noconflict/theme-tomorrow_night_eighties';

@Component({
  selector: 'cerebro-code-editor',
  template: `
    <div class="shared-code-editor">
      <div
        #aceHost
        class="shared-code-editor__ace"
        [class.d-none]="!aceAvailable"
        [style.min-height.px]="minHeight"
      ></div>
      <textarea
        class="shared-code-editor__fallback"
        [class.d-none]="aceAvailable"
        [attr.aria-label]="ariaLabel"
        [disabled]="disabled"
        [readOnly]="readOnly"
        [style.min-height.px]="minHeight"
        [value]="value"
        (blur)="markTouched()"
        (input)="updateFromTextarea($event)"
      ></textarea>
    </div>
  `,
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => CodeEditorComponent),
      multi: true,
    },
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CodeEditorComponent
  implements AfterViewInit, OnChanges, OnDestroy, ControlValueAccessor
{
  @ViewChild('aceHost', { static: true })
  private aceHost!: ElementRef<HTMLElement>;

  @Input() value = '';
  @Input() ariaLabel = 'JSON editor';
  @Input() minHeight = 240;
  @Input() readOnly = false;
  @Output() readonly valueChange = new EventEmitter<string>();

  aceAvailable = false;
  disabled = false;
  private editor: Ace.Editor | undefined;
  private writingValue = false;
  private onChange: (value: string) => void = () => undefined;
  private onTouched: () => void = () => undefined;

  constructor(private readonly changeDetector: ChangeDetectorRef) {}

  ngAfterViewInit(): void {
    try {
      const editor = ace.edit(this.aceHost.nativeElement);
      editor.setTheme('ace/theme/tomorrow_night_eighties');
      editor.session.setMode('ace/mode/json');
      editor.session.setUseWorker(false);
      editor.setOptions({
        fontFamily: 'Monaco, Menlo, Consolas, "Courier New", monospace',
        fontSize: '12px',
        readOnly: this.readOnly || this.disabled,
        showPrintMargin: false,
        tabSize: 2,
        useSoftTabs: true,
      });
      editor.setValue(this.value, -1);
      editor.textInput.getElement().setAttribute('aria-label', this.ariaLabel);
      editor.on('change', () => {
        if (!this.writingValue) {
          this.publish(editor.getValue());
        }
      });
      editor.on('blur', () => this.markTouched());
      this.editor = editor;
      this.aceAvailable = true;
      this.changeDetector.markForCheck();
    } catch {
      this.editor = undefined;
      this.aceAvailable = false;
      this.changeDetector.markForCheck();
    }
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['value'] && this.editor?.getValue() !== this.value) {
      this.writeEditorValue(this.value);
    }
    if (changes['readOnly']) {
      this.editor?.setReadOnly(this.readOnly || this.disabled);
    }
    if (changes['ariaLabel']) {
      this.editor?.textInput
        .getElement()
        .setAttribute('aria-label', this.ariaLabel);
    }
  }

  ngOnDestroy(): void {
    this.editor?.destroy();
    this.editor = undefined;
  }

  writeValue(value: string | null | undefined): void {
    const nextValue = value ?? '';
    this.value = nextValue;
    this.writeEditorValue(nextValue);
    this.changeDetector.markForCheck();
  }

  registerOnChange(onChange: (value: string) => void): void {
    this.onChange = onChange;
  }

  registerOnTouched(onTouched: () => void): void {
    this.onTouched = onTouched;
  }

  setDisabledState(disabled: boolean): void {
    this.disabled = disabled;
    this.editor?.setReadOnly(disabled || this.readOnly);
    this.changeDetector.markForCheck();
  }

  setValue(value: string): void {
    this.value = value;
    this.writeEditorValue(value);
    this.publish(value);
  }

  getStringValue(): string {
    return this.editor?.getValue() ?? this.value;
  }

  getValue(): unknown {
    const content = this.getStringValue();
    return content.trim() ? JSON.parse(content) : undefined;
  }

  format(): void {
    try {
      const parsed = this.getValue();
      if (parsed !== undefined) {
        this.setValue(JSON.stringify(parsed, null, 2));
        this.editor?.gotoLine(0, 0, false);
      }
    } catch {
      // Keep invalid JSON untouched so the user can correct it.
    }
  }

  updateFromTextarea(event: Event): void {
    this.publish((event.target as HTMLTextAreaElement).value);
  }

  markTouched(): void {
    this.onTouched();
  }

  private writeEditorValue(value: string): void {
    if (!this.editor || this.editor.getValue() === value) {
      return;
    }
    this.writingValue = true;
    this.editor.setValue(value, -1);
    this.writingValue = false;
  }

  private publish(value: string): void {
    this.value = value;
    this.onChange(value);
    this.valueChange.emit(value);
    this.changeDetector.markForCheck();
  }
}
