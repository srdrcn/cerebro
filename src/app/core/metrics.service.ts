import { DestroyRef, Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { ClusterApiService } from './cluster-api.service';
import { ConnectionService } from './connection.service';
import { readableReason } from './errors';
import { MetricsSample, appendSample, buildHistory, parseNodeMetrics } from './metrics';
import { RefreshService } from './refresh.service';

/** A refresh that comes sooner than this after the last sample is skipped (noisy rates). */
export const MIN_SAMPLE_SPACING_MS = 1_000;
/**
 * With auto refresh on, a tick is skipped when the last sample is younger than
 * half the interval, capped here: a page that sampled on arrival is not
 * sampled again by the timer a second later.
 */
export const MAX_TICK_SPACING_MS = 5_000;
/** While auto refresh is paused, opening a page samples again once the last sample is this old. */
export const PAUSED_RESAMPLE_MS = 5_000;
/**
 * After the first sample, or one that follows a gap, one more sample is taken
 * this soon (or at the interval, when shorter), so rates show within seconds
 * instead of a full refresh interval.
 */
export const FOLLOW_UP_MS = 3_000;
/** A sample still running after this many intervals is reported as late. */
export const STALE_INTERVALS = 3;

/**
 * Samples `POST metrics/nodes` on every refresh tick while at least one page
 * shows live metrics, and turns the samples into per-node and cluster series.
 *
 * Pages call `attach(destroyRef)` (or the returned release function when they
 * hide their charts): polling stops when nothing is attached, and the history
 * is kept so moving between the overview and the nodes page continues the
 * same charts. A new host starts a new history.
 */
@Injectable({ providedIn: 'root' })
export class MetricsService {
  private readonly api = inject(ClusterApiService);
  private readonly connection = inject(ConnectionService);
  private readonly refresh = inject(RefreshService);

  private readonly consumers = signal(0);
  private readonly samplesState = signal<readonly MetricsSample[]>([]);
  private host: string | undefined;
  private lastTick: number | undefined;
  private sequence = 0;
  private inFlight = false;
  private followUp: ReturnType<typeof setTimeout> | undefined;
  /** Time of the latest refresh tick seen while attached (drives `late`). */
  private readonly checkedAt = signal(Date.now());

  /** Buffered samples, oldest first. */
  readonly samples = this.samplesState.asReadonly();
  readonly history = computed(() => buildHistory(this.samplesState()));
  readonly cluster = computed(() => this.history().cluster);
  readonly nodes = computed(() => this.history().nodes);
  /** Rates can be shown once two samples of a node have been compared. */
  readonly ready = computed(() => this.history().ready);
  /** Time of the latest sample, `null` before the first one. */
  readonly sampledAt = computed(() => {
    const samples = this.samplesState();
    return samples[samples.length - 1]?.time ?? null;
  });
  /** Raw counters of the latest sample by node id (thread pool sizes, totals). */
  readonly latest = computed(() => {
    const samples = this.samplesState();
    return new Map((samples[samples.length - 1]?.nodes ?? []).map((node) => [node.id, node] as const));
  });
  /** Usual spacing of the samples, measured. */
  readonly spacing = computed(() => this.history().spacing);
  /** The configured sampling interval: the auto refresh interval (0 while paused). */
  readonly interval = computed(() => this.refresh.interval());
  readonly paused = computed(() => this.refresh.paused());
  /** Whether a page is showing metrics (and polling runs). */
  readonly active = computed(() => this.consumers() > 0);
  /** A sample request is running. */
  readonly sampling = signal(false);
  /** The latest sample failed; earlier samples are kept. */
  readonly failed = signal(false);
  /** Reason of the latest failure, when Elasticsearch gave one. */
  readonly lastError = signal<string | undefined>(undefined);
  /**
   * A sample has been running for more than `STALE_INTERVALS` intervals (a
   * node that does not answer): the charts show old values.
   */
  readonly late = computed(() => {
    const sampledAt = this.sampledAt();
    const interval = Math.max(this.refresh.interval(), PAUSED_RESAMPLE_MS);
    return this.sampling() && sampledAt !== null && this.checkedAt() - sampledAt > STALE_INTERVALS * interval;
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => this.cancelFollowUp());
    effect(() => {
      const host = this.connection.host();
      const tick = this.refresh.tick();
      const active = this.consumers() > 0;
      untracked(() => this.update(host, tick, active));
    });
  }

  /**
   * Registers a page that shows metrics. Polling runs while at least one is
   * attached. Returns the release function (idempotent); with a `DestroyRef`
   * it is also called when the page is destroyed.
   */
  attach(destroyRef?: DestroyRef): () => void {
    this.consumers.update((count) => count + 1);
    let released = false;
    const release = () => {
      if (!released) {
        released = true;
        this.consumers.update((count) => Math.max(0, count - 1));
      }
    };
    destroyRef?.onDestroy(release);
    return release;
  }

  /** Clears the timer of the follow-up sample. */
  private cancelFollowUp(): void {
    if (this.followUp !== undefined) {
      clearTimeout(this.followUp);
      this.followUp = undefined;
    }
  }

  /**
   * Rates need two samples: after the first one, or one that follows a gap,
   * take another soon rather than at the next refresh (not while paused).
   */
  private scheduleFollowUp(host: string): void {
    const interval = this.refresh.interval();
    const history = this.history();
    const last = history.times.length - 1;
    if (interval === 0 || this.consumers() === 0 || (last > 0 && !history.gaps[last])) {
      return;
    }
    this.cancelFollowUp();
    const sequence = this.sequence;
    this.followUp = setTimeout(() => {
      this.followUp = undefined;
      if (sequence === this.sequence && this.consumers() > 0 && host === this.connection.host()) {
        void this.sample(host);
      }
    }, Math.min(FOLLOW_UP_MS, interval));
  }

  /** Takes a sample now (the retry button of an error state). */
  sampleNow(): Promise<void> {
    const host = this.connection.host();
    return host ? this.sample(host) : Promise.resolve();
  }

  private update(host: string | undefined, tick: number, active: boolean): void {
    if (host !== this.host) {
      this.reset();
      this.host = host;
    }
    const ticked = this.lastTick !== undefined && tick !== this.lastTick;
    this.lastTick = tick;
    if (!host || !active) {
      this.cancelFollowUp();
      return;
    }
    this.checkedAt.set(Date.now());
    const last = this.sampledAt();
    const age = last === null ? Number.POSITIVE_INFINITY : Date.now() - last;
    // A refresh tick samples (unless one just ran). A page that attaches
    // samples only when the history is stale, so moving between pages does
    // not add a short, noisy interval.
    const paused = this.refresh.paused();
    const half = this.refresh.interval() / 2;
    const minimumAge = ticked
      ? paused
        ? MIN_SAMPLE_SPACING_MS
        : Math.max(MIN_SAMPLE_SPACING_MS, Math.min(half, MAX_TICK_SPACING_MS))
      : paused
        ? PAUSED_RESAMPLE_MS
        : half;
    if (age >= minimumAge) {
      void this.sample(host);
    }
  }

  private async sample(host: string): Promise<void> {
    if (this.inFlight) {
      return;
    }
    const sequence = this.sequence;
    this.inFlight = true;
    this.sampling.set(true);
    try {
      const body = await this.api.post<unknown>('metrics/nodes');
      if (sequence !== this.sequence || host !== this.connection.host()) {
        return;
      }
      const sample = parseNodeMetrics(body, Date.now(), this.refresh.interval());
      this.samplesState.update((samples) => appendSample(samples, sample));
      this.failed.set(false);
      this.lastError.set(undefined);
      this.scheduleFollowUp(host);
    } catch (error: unknown) {
      if (sequence === this.sequence) {
        // No toast: this runs on every tick, and the page's own load reports outages.
        this.failed.set(true);
        this.lastError.set(readableReason(error));
      }
    } finally {
      if (sequence === this.sequence) {
        this.inFlight = false;
        this.sampling.set(false);
      }
    }
  }

  private reset(): void {
    this.cancelFollowUp();
    this.sequence++;
    this.inFlight = false;
    this.sampling.set(false);
    this.samplesState.set([]);
    this.failed.set(false);
    this.lastError.set(undefined);
  }
}
