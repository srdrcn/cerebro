import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { formatDuration } from '../../core/format';
import { answeredLabel, metricFormatter } from '../../core/metrics';
import { MetricsService } from '../../core/metrics.service';
import { readPreference, writePreference } from '../../core/preferences';
import { RefreshService, refreshIntervalLabel } from '../../core/refresh.service';
import { SparklineComponent } from '../../shared/sparkline.component';
import { liveActivityTiles } from './overview.utils';

export const LIVE_COLLAPSED_PREFERENCE = 'cerebro.overview.live-collapsed';

/**
 * "Live activity" strip of the overview: cluster indexing and search rates,
 * search latency, heap and CPU, sampled on every refresh by MetricsService.
 * Collapsing it stops the sampling (remembered per browser).
 */
@Component({
  selector: 'cerebro-overview-live',
  imports: [DatePipe, SparklineComponent],
  templateUrl: './overview-live.component.html',
  styleUrl: './overview-live.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OverviewLiveComponent {
  private readonly metrics = inject(MetricsService);
  private readonly refresh = inject(RefreshService);

  readonly collapsed = signal(readPreference(LIVE_COLLAPSED_PREFERENCE) === 'true');
  readonly history = this.metrics.history;
  readonly ready = this.metrics.ready;
  readonly paused = this.metrics.paused;
  readonly failed = this.metrics.failed;
  readonly lastError = this.metrics.lastError;
  readonly sampling = this.metrics.sampling;
  /** A sample has been running for several intervals: the figures are old. */
  readonly late = this.metrics.late;
  readonly hasSamples = computed(() => this.history().times.length > 0);
  /** "2 of 3 nodes answered" while some nodes fail their statistics. */
  readonly partialLabel = computed(() => answeredLabel(this.history()));
  readonly sampledAt = this.metrics.sampledAt;
  /** Why rates are not shown yet. */
  readonly pending = computed(() =>
    this.failed() && !this.hasSamples()
      ? 'No sample yet'
      : this.paused()
        ? 'Refresh to measure rates'
        : 'Collecting samples…',
  );
  readonly tiles = computed(() => liveActivityTiles(this.history(), this.pending()));
  readonly intervalLabel = computed(() => refreshIntervalLabel(this.metrics.interval()));
  readonly windowLabel = computed(() => formatDuration(this.history().span));
  /** One stable formatter per metric, so the sparklines keep their inputs. */
  readonly format = metricFormatter;

  constructor() {
    effect((onCleanup) => {
      if (!this.collapsed()) {
        onCleanup(this.metrics.attach());
      }
    });
  }

  toggle(): void {
    const collapsed = !this.collapsed();
    this.collapsed.set(collapsed);
    writePreference(LIVE_COLLAPSED_PREFERENCE, String(collapsed));
  }

  resume(): void {
    this.refresh.resume();
  }

  retry(): void {
    void this.metrics.sampleNow();
  }
}
