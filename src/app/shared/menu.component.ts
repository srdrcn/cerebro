import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';

let nextMenuId = 0;

/**
 * Dropdown menu rendered in the browser's top layer (Popover API), so it is
 * never clipped by scrolling tables or cards. Project the trigger content
 * with the `trigger` attribute and menu entries as `.menu-item` buttons or
 * links; clicking an entry closes the menu.
 *
 *   <cerebro-menu label="Index actions" align="end">
 *     <i trigger class="bi bi-three-dots"></i>
 *     <button class="menu-item" (click)="…">Refresh</button>
 *   </cerebro-menu>
 */
@Component({
  selector: 'cerebro-menu',
  host: { class: 'menu-host' },
  template: `
    <button
      #trigger
      type="button"
      [class]="triggerClass()"
      [attr.popovertarget]="id"
      [attr.aria-label]="label() || null"
      [attr.title]="tooltip() ? label() : null"
      [attr.aria-expanded]="open()"
      [attr.aria-controls]="id"
      aria-haspopup="menu"
      [disabled]="disabled()"
    >
      <ng-content select="[trigger]" />
    </button>
    <div
      #panel
      class="menu"
      popover
      role="menu"
      [id]="id"
      [style.min-width.px]="minWidth()"
      (beforetoggle)="onBeforeToggle($event)"
      (toggle)="onToggle($event)"
      (click)="onPanelClick($event)"
      (keydown)="onKeydown($event)"
    >
      <ng-content />
    </div>
  `,
  styles: `
    :host {
      display: inline-flex;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MenuComponent {
  readonly label = input('');
  readonly triggerClass = input('btn btn-ghost btn-icon btn-sm');
  readonly align = input<'start' | 'end'>('start');
  readonly disabled = input(false);
  readonly tooltip = input(true);
  readonly minWidth = input(200);
  readonly opened = output<void>();

  readonly id = `cerebro-menu-${nextMenuId++}`;
  readonly open = signal(false);

  private readonly trigger = viewChild.required<ElementRef<HTMLButtonElement>>('trigger');
  private readonly panel = viewChild.required<ElementRef<HTMLElement>>('panel');
  private readonly destroyRef = inject(DestroyRef);
  private readonly closeOnViewportChange = (event: Event) => {
    if (event.target instanceof Node && this.panel().nativeElement.contains(event.target)) {
      return;
    }
    this.close();
  };

  constructor() {
    this.destroyRef.onDestroy(() => this.detachViewportListeners());
  }

  close(): void {
    const panel = this.panel().nativeElement;
    if (panel.matches(':popover-open')) {
      panel.hidePopover();
    }
  }

  onBeforeToggle(event: Event): void {
    if ((event as ToggleEvent).newState === 'open') {
      this.placeBelowTrigger();
    }
  }

  onToggle(event: Event): void {
    const isOpen = (event as ToggleEvent).newState === 'open';
    this.open.set(isOpen);
    if (isOpen) {
      this.adjustToViewport();
      this.attachViewportListeners();
      this.items()[0]?.focus({ preventScroll: true });
      this.opened.emit();
    } else {
      this.detachViewportListeners();
      const active = document.activeElement;
      if (!active || active === document.body || this.panel().nativeElement.contains(active)) {
        this.trigger().nativeElement.focus({ preventScroll: true });
      }
    }
  }

  onPanelClick(event: MouseEvent): void {
    const item = (event.target as HTMLElement | null)?.closest('.menu-item');
    if (item && !item.hasAttribute('data-keep-open')) {
      this.close();
    }
  }

  onKeydown(event: KeyboardEvent): void {
    const items = this.items();
    if (items.length === 0) {
      return;
    }
    const index = items.indexOf(document.activeElement as HTMLElement);
    let next: number | undefined;
    switch (event.key) {
      case 'ArrowDown':
        next = index < 0 ? 0 : (index + 1) % items.length;
        break;
      case 'ArrowUp':
        next = index <= 0 ? items.length - 1 : index - 1;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = items.length - 1;
        break;
      case 'Tab':
        this.close();
        return;
    }
    if (next !== undefined) {
      event.preventDefault();
      items[next]?.focus();
    }
  }

  private items(): HTMLElement[] {
    return Array.from(
      this.panel().nativeElement.querySelectorAll<HTMLElement>(
        '.menu-item:not(:disabled), [role="menuitem"]:not(:disabled), [role="menuitemradio"]:not(:disabled)',
      ),
    );
  }

  private placeBelowTrigger(): void {
    const rect = this.trigger().nativeElement.getBoundingClientRect();
    const style = this.panel().nativeElement.style;
    style.top = `${Math.round(rect.bottom + 6)}px`;
    style.bottom = 'auto';
    if (this.align() === 'end') {
      style.left = 'auto';
      style.right = `${Math.round(document.documentElement.clientWidth - rect.right)}px`;
    } else {
      style.right = 'auto';
      style.left = `${Math.round(rect.left)}px`;
    }
  }

  private adjustToViewport(): void {
    const margin = 8;
    const panel = this.panel().nativeElement;
    const trigger = this.trigger().nativeElement.getBoundingClientRect();
    const rect = panel.getBoundingClientRect();
    const viewportWidth = document.documentElement.clientWidth;
    const viewportHeight = document.documentElement.clientHeight;
    if (rect.bottom > viewportHeight - margin && trigger.top - rect.height - 6 > margin) {
      panel.style.top = `${Math.round(trigger.top - rect.height - 6)}px`;
    }
    if (rect.right > viewportWidth - margin) {
      panel.style.left = `${Math.max(margin, Math.round(viewportWidth - rect.width - margin))}px`;
      panel.style.right = 'auto';
    } else if (rect.left < margin) {
      panel.style.left = `${margin}px`;
      panel.style.right = 'auto';
    }
  }

  private attachViewportListeners(): void {
    window.addEventListener('scroll', this.closeOnViewportChange, true);
    window.addEventListener('resize', this.closeOnViewportChange);
  }

  private detachViewportListeners(): void {
    window.removeEventListener('scroll', this.closeOnViewportChange, true);
    window.removeEventListener('resize', this.closeOnViewportChange);
  }
}
