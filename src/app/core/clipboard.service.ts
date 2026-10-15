import { DOCUMENT } from '@angular/common';
import { inject, Injectable } from '@angular/core';
import { AlertService } from './alert.service';
import { failureMessage } from './errors';

/** "host address" → "Host address"; names such as "cURL command" keep their casing. */
function capitalized(what: string): string {
  const text = what.trim();
  if (!text || /^.[A-Z]/.test(text)) {
    return text;
  }
  return text.charAt(0).toLocaleUpperCase() + text.slice(1);
}

@Injectable({ providedIn: 'root' })
export class ClipboardService {
  private readonly document = inject(DOCUMENT);
  private readonly alerts = inject(AlertService);

  /**
   * Copies `value` and reports the outcome with the app-wide wording:
   * "Host address copied to the clipboard" or "Could not copy the host
   * address: <reason>". `what` names the copied thing in lower case
   * ("request body", "task id", "filter of logs-read").
   */
  copyAndNotify(value: string, what: string): Promise<boolean> {
    const noun = what.trim();
    return this.copy(
      value,
      () => this.alerts.success(`${capitalized(noun)} copied to the clipboard`),
      (error) => this.alerts.error(failureMessage(`Could not copy the ${noun}`, error), error),
    );
  }

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
