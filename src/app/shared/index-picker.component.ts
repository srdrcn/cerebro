import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { AlertService } from '../core/alert.service';
import { ClusterApiService } from '../core/cluster-api.service';
import { ConnectionService } from '../core/connection.service';
import { failureMessage, readableReason } from '../core/errors';
import { sortByName } from '../core/format';
import { RefreshService } from '../core/refresh.service';

export interface IndexOptionGroups {
  readonly regular: readonly string[];
  /** Dot-prefixed system and hidden indices, listed last. */
  readonly system: readonly string[];
}

/** Splits the index picker options into regular and dot-prefixed indices. */
export function groupIndexOptions(names: readonly string[]): IndexOptionGroups {
  const sorted = sortByName(names);
  return {
    regular: sorted.filter((name) => !name.startsWith('.')),
    system: sorted.filter((name) => name.startsWith('.')),
  };
}

/**
 * Header select (`.context-picker`) that picks the index a page shows. It
 * loads the index list of the connected cluster itself (reloaded on every
 * refresh once it is a minute old, reset when the host changes) and exposes it, so the page can offer
 * quick picks or explain an empty or failed list:
 *
 *   <cerebro-index-picker #picker inputId="x-picker" [index]="index()" (picked)="navigate($event)" />
 *   @for (name of picker.groups().regular.slice(0, 8); track name) { … }
 *
 * Picking emits `picked` and leaves the URL to the page; a page that declines
 * the switch (pending edits) calls `revert()`.
 */
@Component({
  selector: 'cerebro-index-picker',
  host: { class: 'context-picker' },
  template: `
    <label class="visually-hidden" [for]="inputId()">{{ label() }}</label>
    <i class="bi bi-database" aria-hidden="true"></i>
    <select
      #select
      class="select"
      [id]="inputId()"
      [disabled]="indices() === undefined && !index()"
      (focus)="refreshIfOlderThan(focusRefreshMs)"
      (change)="onChange(select.value)"
    >
      <option value="" [selected]="!index()">
        {{ failed() ? 'Indices unavailable' : indices() === undefined ? 'Loading indices…' : 'Choose an index…' }}
      </option>
      @if (extra()) {
        <option [value]="extra()" [selected]="true">{{ extra() }}</option>
      }
      @if (groups().regular.length > 0) {
        <optgroup label="Indices">
          @for (name of groups().regular; track name) {
            <option [value]="name" [selected]="name === index()">{{ name }}</option>
          }
        </optgroup>
      }
      @if (groups().system.length > 0) {
        <optgroup label="System and hidden indices">
          @for (name of groups().system; track name) {
            <option [value]="name" [selected]="name === index()">{{ name }}</option>
          }
        </optgroup>
      }
    </select>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class IndexPickerComponent {
  private readonly api = inject(ClusterApiService);
  private readonly alerts = inject(AlertService);
  private readonly connection = inject(ConnectionService);
  private readonly refreshService = inject(RefreshService);

  /** Id of the select (for `<label for>` and focus targets). */
  readonly inputId = input.required<string>();
  /** The index the page shows ('' for none); may be an alias or a name the list does not have. */
  readonly index = input.required<string>();
  /** Visually hidden label of the select. */
  readonly label = input('Index');

  /** The user chose another option ('' for "Choose an index…"). */
  readonly picked = output<string>();

  /** Index names of the cluster, `undefined` until loaded. */
  readonly indices = signal<readonly string[] | undefined>(undefined);
  /** The index list could not be loaded (as opposed to the cluster having none). */
  readonly failed = signal(false);
  /** Why the list could not be loaded, as Elasticsearch put it. */
  readonly loadError = signal<string | undefined>(undefined);
  readonly groups = computed(() => groupIndexOptions(this.indices() ?? []));
  /** The current index when the list does not contain it (an alias, or not loaded yet). */
  readonly extra = computed(() => {
    const index = this.index();
    const { regular, system } = this.groups();
    return index && !regular.includes(index) && !system.includes(index) ? index : '';
  });

  private readonly select = viewChild.required<ElementRef<HTMLSelectElement>>('select');
  /**
   * Listing indices makes every node compute index statistics, so the list
   * is refreshed on ticks only once it is a minute old, and when the select
   * is focused if it is older than a few seconds.
   */
  private readonly tickRefreshMs = 60_000;
  protected readonly focusRefreshMs = 10_000;
  private loadedAt = 0;
  private sequence = 0;
  /** Cluster the index list belongs to. */
  private host: string | undefined;

  constructor() {
    effect(() => {
      this.refreshService.tick();
      const host = this.connection.host();
      untracked(() => {
        if (host !== this.host) {
          this.host = host;
          this.sequence++;
          this.indices.set(undefined);
          this.failed.set(false);
        }
        if (host) {
          this.refreshIfOlderThan(this.tickRefreshMs);
        }
      });
    });
  }

  async load(): Promise<void> {
    const sequence = ++this.sequence;
    try {
      const indices = await this.api.post<readonly string[]>('commons/indices');
      if (sequence === this.sequence) {
        this.indices.set(Array.isArray(indices) ? indices : []);
        this.failed.set(false);
        this.loadedAt = Date.now();
      }
    } catch (error: unknown) {
      // A failed background refresh keeps the list that is already shown.
      if (sequence === this.sequence && this.indices() === undefined) {
        this.loadError.set(readableReason(error));
        this.failed.set(true);
        this.alerts.error(failureMessage('Could not load the index list', error), error);
      }
    }
  }

  /** Loads the list unless the one shown is younger than `maxAgeMs`. */
  refreshIfOlderThan(maxAgeMs: number): void {
    if (this.indices() === undefined || Date.now() - this.loadedAt >= maxAgeMs) {
      void this.load();
    }
  }

  retry(): void {
    this.failed.set(false);
    void this.load();
  }

  focus(): void {
    this.select().nativeElement.focus();
  }

  /** Shows the current index again after the page declined a pick. */
  revert(): void {
    this.select().nativeElement.value = this.index();
  }

  onChange(value: string): void {
    if (value !== this.index()) {
      this.picked.emit(value);
    }
  }
}
