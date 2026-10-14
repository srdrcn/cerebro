import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injectable,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import { ClusterApiService } from '../core/cluster-api.service';
import { ConnectionService } from '../core/connection.service';
import { NAVIGATION_ITEMS } from '../core/navigation';
import { RefreshService } from '../core/refresh.service';
import { ThemeService } from '../core/theme.service';
import { ModalDialogDirective } from './modal-dialog.directive';

@Injectable({ providedIn: 'root' })
export class CommandPaletteService {
  readonly isOpen = signal(false);

  open(): void {
    this.isOpen.set(true);
  }

  close(): void {
    this.isOpen.set(false);
  }

  toggle(): void {
    this.isOpen.update((open) => !open);
  }
}

interface PaletteCommand {
  readonly id: string;
  readonly group: 'Pages' | 'Actions' | 'Indices';
  readonly label: string;
  readonly icon: string;
  readonly hint?: string;
  readonly keywords?: string;
  readonly run: () => void;
}

/** Scores a command against the query; 0 means "no match". */
export function scoreCommand(label: string, keywords: string, query: string): number {
  const q = query.trim().toLocaleLowerCase();
  if (!q) {
    return 1;
  }
  const text = label.toLocaleLowerCase();
  if (text === q) {
    return 100;
  }
  if (text.startsWith(q)) {
    return 80;
  }
  if (text.split(/[\s\-_.]+/).some((word) => word.startsWith(q))) {
    return 60;
  }
  if (text.includes(q)) {
    return 40;
  }
  if (keywords.toLocaleLowerCase().includes(q)) {
    return 25;
  }
  // Subsequence match ("clst" → "cluster settings").
  let position = 0;
  for (const character of text) {
    if (character === q[position]) {
      position++;
    }
    if (position === q.length) {
      return 10;
    }
  }
  return 0;
}

@Component({
  selector: 'cerebro-command-palette',
  imports: [ModalDialogDirective],
  template: `
    <dialog
      cerebroModal="manual"
      class="palette"
      aria-label="Command palette"
      (opened)="onOpened()"
      (dismiss)="palette.close()"
    >
      @if (palette.isOpen()) {
        <div class="palette__search">
          <i class="bi bi-search" aria-hidden="true"></i>
          <input
            #input
            type="text"
            placeholder="Search pages, actions and indices…"
            aria-label="Search commands"
            role="combobox"
            aria-controls="palette-results"
            [attr.aria-activedescendant]="activeId()"
            aria-expanded="true"
            autocomplete="off"
            spellcheck="false"
            [value]="query()"
            (input)="setQuery(input.value)"
            (keydown)="onKeydown($event)"
          />
          <kbd>esc</kbd>
        </div>
        <div class="palette__results" id="palette-results" role="listbox">
          @for (group of groups(); track group.name) {
            <div class="palette__group" role="presentation">{{ group.name }}</div>
            @for (command of group.commands; track command.id) {
              <button
                type="button"
                class="palette__item"
                role="option"
                [id]="'palette-' + command.id"
                [class.is-active]="command.id === activeCommand()?.id"
                [attr.aria-selected]="command.id === activeCommand()?.id"
                (mousemove)="activate(command)"
                (click)="execute(command)"
              >
                <i class="bi" [class]="'bi ' + command.icon" aria-hidden="true"></i>
                <span class="palette__item-label">{{ command.label }}</span>
                @if (command.hint) {
                  <span class="palette__item-hint">{{ command.hint }}</span>
                }
              </button>
            }
          } @empty {
            <div class="empty empty--compact">
              <p class="empty__title">No results</p>
              <p class="empty__text">Nothing matches “{{ query() }}”.</p>
            </div>
          }
        </div>
        <footer class="palette__footer">
          <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
          <span><kbd>↵</kbd> open</span>
          @if (loadingIndices()) {
            <span class="spacer"></span>
            <span><span class="spinner" style="width: 12px; height: 12px"></span> loading indices</span>
          }
        </footer>
      }
    </dialog>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommandPaletteComponent {
  readonly palette = inject(CommandPaletteService);
  private readonly router = inject(Router);
  private readonly api = inject(ClusterApiService);
  private readonly connection = inject(ConnectionService);
  private readonly refresh = inject(RefreshService);
  private readonly theme = inject(ThemeService);
  private readonly modal = viewChild.required(ModalDialogDirective);
  private readonly input = viewChild<ElementRef<HTMLInputElement>>('input');

  readonly query = signal('');
  readonly indices = signal<readonly string[]>([]);
  readonly loadingIndices = signal(false);
  private readonly activeIndex = signal(0);

  private readonly commands = computed<readonly PaletteCommand[]>(() => {
    const hostQuery = this.connection.hostQuery();
    const pages: PaletteCommand[] = NAVIGATION_ITEMS.map((item) => ({
      id: `page-${item.route.slice(1)}`,
      group: 'Pages',
      label: item.label,
      icon: item.icon,
      hint: item.description,
      keywords: item.keywords ?? '',
      run: () => void this.router.navigate([item.route], { queryParams: hostQuery }),
    }));
    const actions: PaletteCommand[] = [
      {
        id: 'action-refresh',
        group: 'Actions',
        label: 'Refresh data',
        icon: 'bi-arrow-clockwise',
        keywords: 'reload update',
        run: () => this.refresh.refresh(),
      },
      {
        id: 'action-theme',
        group: 'Actions',
        label: `Switch to ${this.theme.resolved() === 'dark' ? 'light' : 'dark'} theme`,
        icon: this.theme.resolved() === 'dark' ? 'bi-sun' : 'bi-moon-stars',
        keywords: 'appearance dark light mode color',
        run: () => this.theme.set(this.theme.resolved() === 'dark' ? 'light' : 'dark'),
      },
      {
        id: 'action-pause',
        group: 'Actions',
        label: this.refresh.paused() ? 'Resume auto-refresh' : 'Pause auto-refresh',
        icon: this.refresh.paused() ? 'bi-play-circle' : 'bi-pause-circle',
        keywords: 'interval polling stop',
        run: () => this.refresh.setInterval(this.refresh.paused() ? 15_000 : 0),
      },
      {
        id: 'action-switch',
        group: 'Actions',
        label: 'Switch cluster',
        icon: 'bi-arrow-left-right',
        keywords: 'disconnect connect host change',
        run: () => this.connection.disconnect(),
      },
    ];
    const indices: PaletteCommand[] = this.indices().map((index) => ({
      id: `index-${index}`,
      group: 'Indices',
      label: index,
      icon: 'bi-box',
      hint: 'Open index details',
      run: () =>
        void this.router.navigate(['/index_detail'], {
          queryParams: { ...hostQuery, index },
        }),
    }));
    return [...pages, ...actions, ...indices];
  });

  readonly results = computed(() => {
    const query = this.query();
    const scored = this.commands()
      .map((command) => ({
        command,
        score: scoreCommand(command.label, command.keywords ?? '', query),
      }))
      .filter((entry) => entry.score > 0);
    if (query.trim()) {
      scored.sort((left, right) => right.score - left.score);
    }
    const limitIndices = query.trim() ? 20 : 6;
    let indexCount = 0;
    return scored
      .map((entry) => entry.command)
      .filter((command) => command.group !== 'Indices' || indexCount++ < limitIndices);
  });

  readonly groups = computed(() => {
    const order: PaletteCommand['group'][] = ['Pages', 'Actions', 'Indices'];
    const results = this.results();
    return order
      .map((name) => ({ name, commands: results.filter((command) => command.group === name) }))
      .filter((group) => group.commands.length > 0);
  });

  /** Commands in visual order, used for keyboard navigation. */
  private readonly ordered = computed(() => this.groups().flatMap((group) => group.commands));
  readonly activeCommand = computed<PaletteCommand | undefined>(() => this.ordered()[this.activeIndex()]);
  readonly activeId = computed(() => {
    const command = this.activeCommand();
    return command ? `palette-${command.id}` : null;
  });

  constructor() {
    effect(() => {
      if (this.palette.isOpen()) {
        this.modal().open();
      } else {
        this.modal().close();
      }
    });

    effect(() => {
      if (this.palette.isOpen()) {
        this.input()?.nativeElement.focus();
      }
    });

    document.addEventListener('keydown', (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        if (this.connection.connected()) {
          event.preventDefault();
          this.palette.toggle();
        }
      }
    });
  }

  setQuery(value: string): void {
    this.query.set(value);
    this.activeIndex.set(0);
  }

  activate(command: PaletteCommand): void {
    const index = this.ordered().indexOf(command);
    if (index >= 0 && index !== this.activeIndex()) {
      this.activeIndex.set(index);
    }
  }

  execute(command: PaletteCommand | undefined): void {
    if (!command) {
      return;
    }
    this.palette.close();
    command.run();
  }

  onKeydown(event: KeyboardEvent): void {
    const count = this.ordered().length;
    if (event.key === 'ArrowDown' && count > 0) {
      event.preventDefault();
      this.activeIndex.update((index) => (index + 1) % count);
      this.scrollActiveIntoView();
    } else if (event.key === 'ArrowUp' && count > 0) {
      event.preventDefault();
      this.activeIndex.update((index) => (index - 1 + count) % count);
      this.scrollActiveIntoView();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      this.execute(this.activeCommand());
    }
  }

  /** Every opening starts from an empty query and fresh index names. */
  onOpened(): void {
    this.query.set('');
    this.activeIndex.set(0);
    void this.loadIndices();
  }

  private scrollActiveIntoView(): void {
    requestAnimationFrame(() => {
      const id = this.activeId();
      if (id) {
        document.getElementById(id)?.scrollIntoView({ block: 'nearest' });
      }
    });
  }

  private async loadIndices(): Promise<void> {
    if (!this.connection.connected()) {
      return;
    }
    this.loadingIndices.set(true);
    try {
      const indices = await this.api.post<readonly string[]>('commons/indices');
      this.indices.set([...indices].sort((left, right) => left.localeCompare(right)));
    } catch {
      this.indices.set([]);
    } finally {
      this.loadingIndices.set(false);
    }
  }
}
