import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterRenderEffect,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { map } from 'rxjs';
import { ConnectionService } from '../../core/connection.service';
import { PendingChangesAware } from '../../core/pending-changes.guard';
import { HotThreadsComponent } from './hot-threads.component';
import { PendingTasksComponent } from './pending-tasks.component';
import { PerformanceTab } from './performance.models';
import { DEFAULT_TAB, PERFORMANCE_TABS, nextTab, parseTab } from './performance.utils';
import { SlowLogsComponent } from './slow-logs.component';
import { ThreadPoolsComponent } from './thread-pools.component';

/**
 * Performance diagnosis: hot threads, thread pools, the master's pending
 * tasks and slow log thresholds, one tab each (`?tab=`). A tab is created
 * the first time it is shown and then only hidden, so a capture, a filter or
 * unsaved slow log edits survive switching tabs; hidden tabs stop refreshing.
 */
@Component({
  selector: 'cerebro-performance',
  imports: [HotThreadsComponent, PendingTasksComponent, RouterLink, SlowLogsComponent, ThreadPoolsComponent],
  host: { '(window:beforeunload)': 'onBeforeUnload($event)' },
  templateUrl: './performance.component.html',
  styleUrl: './performance.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PerformanceComponent implements PendingChangesAware {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly connection = inject(ConnectionService);

  readonly tabs = PERFORMANCE_TABS;
  readonly tab = toSignal(this.route.queryParamMap.pipe(map((params) => parseTab(params.get('tab')))), {
    initialValue: DEFAULT_TAB,
  });

  /** Tabs shown at least once (they stay rendered, hidden, afterwards). */
  private readonly visitedTabs = signal<ReadonlySet<PerformanceTab>>(new Set());
  readonly visited = computed(() => new Set([...this.visitedTabs(), this.tab()]));

  /** Counts reported by the tabs for their badges (`null` until known). */
  readonly pendingCount = signal<number | null>(null);
  readonly newRejections = signal<number | null>(null);
  readonly slowLogIndices = signal<number | null>(null);

  private readonly slowLogs = viewChild(SlowLogsComponent);
  private readonly tablist = viewChild<ElementRef<HTMLElement>>('tablist');

  constructor() {
    effect(() => {
      const tab = this.tab();
      untracked(() => {
        if (!this.visitedTabs().has(tab)) {
          this.visitedTabs.update((tabs) => new Set([...tabs, tab]));
        }
      });
    });
    afterRenderEffect(() => {
      this.tab();
      untracked(() => this.revealActiveTab());
    });
  }

  selectTab(tab: PerformanceTab): void {
    if (tab === this.tab()) {
      return;
    }
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { tab: tab === DEFAULT_TAB ? null : tab },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  onTabKeydown(event: KeyboardEvent): void {
    const next = nextTab(this.tab(), event.key);
    if (!next) {
      return;
    }
    event.preventDefault();
    this.selectTab(next);
    this.tablist()?.nativeElement.querySelector<HTMLElement>(`#performance-tab-${next}`)?.focus();
  }

  tabBadge(tab: PerformanceTab): { readonly value: number; readonly tone: string; readonly label: string } | null {
    switch (tab) {
      case 'pending-tasks': {
        const count = this.pendingCount();
        return count ? { value: count, tone: count >= 10 ? 'badge-yellow' : '', label: `${count} pending` } : null;
      }
      case 'thread-pools': {
        const count = this.newRejections();
        return count ? { value: count, tone: 'badge-red', label: `${count} new rejections` } : null;
      }
      case 'slow-logs': {
        const count = this.slowLogIndices();
        return count ? { value: count, tone: '', label: `${count} configured` } : null;
      }
      default:
        return null;
    }
  }

  confirmDiscard(): boolean | Promise<boolean> {
    return this.slowLogs()?.confirmDiscard() ?? true;
  }

  onBeforeUnload(event: BeforeUnloadEvent): void {
    if (this.slowLogs()?.dirty()) {
      event.preventDefault();
    }
  }

  /** Keeps the selected tab visible when the strip scrolls (phones). */
  private revealActiveTab(): void {
    const list = this.tablist()?.nativeElement;
    const button = list?.querySelector<HTMLElement>(`#performance-tab-${this.tab()}`);
    if (!list || !button || list.scrollWidth <= list.clientWidth) {
      return;
    }
    const left = button.offsetLeft - list.offsetLeft;
    if (left < list.scrollLeft || left + button.offsetWidth > list.scrollLeft + list.clientWidth) {
      list.scrollLeft = Math.max(0, left - (list.clientWidth - button.offsetWidth) / 2);
    }
  }
}
