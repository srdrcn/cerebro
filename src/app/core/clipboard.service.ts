import { DOCUMENT } from '@angular/common';
import { inject, Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class ClipboardService {
  private readonly document = inject(DOCUMENT);

  async copy(
    value: string,
    success?: () => void,
    failure?: (error: unknown) => void,
  ): Promise<boolean> {
    try {
      const clipboard = this.document.defaultView?.navigator.clipboard;
      if (clipboard) {
        await clipboard.writeText(value);
        success?.();
        return true;
      }

      // The modern API is absent on some non-secure/local origins.
      this.copyWithTemporaryTextarea(value);
      success?.();
      return true;
    } catch (error: unknown) {
      failure?.(error);
      return false;
    }
  }

  private copyWithTemporaryTextarea(value: string): void {
    const textarea = this.document.createElement('textarea');
    const activeElement = this.document.activeElement;
    textarea.value = value;
    textarea.readOnly = true;
    textarea.setAttribute('aria-hidden', 'true');
    Object.assign(textarea.style, {
      position: 'fixed',
      inset: '0 auto auto -9999px',
      opacity: '0',
      pointerEvents: 'none',
    });

    this.document.body.appendChild(textarea);
    try {
      textarea.select();
      if (!this.document.execCommand('copy')) {
        throw new Error('The browser rejected the clipboard operation');
      }
    } finally {
      textarea.remove();
      if (activeElement instanceof HTMLElement) {
        activeElement.focus();
      }
    }
  }
}
