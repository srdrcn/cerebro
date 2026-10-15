import { DestroyRef, computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClusterApiError } from './api-envelope';
import { ClusterApiService } from './cluster-api.service';
import { ConnectionService } from './connection.service';
import { FOLLOW_UP_MS, MetricsService, PAUSED_RESAMPLE_MS } from './metrics.service';
import { RefreshService } from './refresh.service';

function body(indexTotal: number, timestamp: number, name = 'es-node-1') {
  return {
    _nodes: { total: 1, successful: 1, failed: 0 },
    nodes: {
      [`id-${name}`]: {
        name,
        timestamp,
        indices: { indexing: { index_total: indexTotal, index_time_in_millis: indexTotal / 10 } },
        jvm: { mem: { heap_used_percent: 40 } },
      },
    },
  };
}

/** A promise the test resolves or rejects by hand (an in-flight request). */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

describe('MetricsService', () => {
  const post = vi.fn();
  const host = signal<string | undefined>('http://localhost:9200');
  const tick = signal(1);
  const interval = signal(15_000);
  let now = 1_000_000;

  beforeEach(() => {
    post.mockReset();
    host.set('http://localhost:9200');
    tick.set(1);
    interval.set(15_000);
    now = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    // The follow-up sample runs on a timer: only when a test advances it.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    TestBed.configureTestingModule({
      providers: [
        { provide: ClusterApiService, useValue: { post } },
        { provide: ConnectionService, useValue: { host } },
        {
          provide: RefreshService,
          useValue: { tick, interval, paused: computed(() => interval() === 0) },
        },
      ],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function service(): MetricsService {
    const target = TestBed.inject(MetricsService);
    TestBed.tick();
    return target;
  }

  /** Lets the effect run and the mocked request settle. */
  async function settle(): Promise<void> {
    TestBed.tick();
    const metrics = TestBed.inject(MetricsService);
    for (let turn = 0; turn < 50 && metrics.sampling(); turn++) {
      await new Promise<void>((resolve) => queueMicrotask(resolve));
    }
    expect(metrics.sampling()).toBe(false);
  }

  async function nextTick(advance = 15_000): Promise<void> {
    now += advance;
    tick.update((value) => value + 1);
    await settle();
  }

  it('does not poll while no page shows metrics', async () => {
    const metrics = service();
    await nextTick();
    await nextTick();

    expect(post).not.toHaveBeenCalled();
    expect(metrics.samples()).toEqual([]);
  });

  it('samples when a page attaches and on every refresh tick, then computes rates', async () => {
    post.mockResolvedValueOnce(body(1_000, 500_000)).mockResolvedValueOnce(body(2_500, 515_000));
    const metrics = service();

    metrics.attach();
    await settle();
    expect(post).toHaveBeenCalledWith('metrics/nodes');
    expect(metrics.samples()).toHaveLength(1);
    expect(metrics.ready()).toBe(false);
    expect(metrics.sampledAt()).toBe(1_000_000);

    await nextTick();
    expect(post).toHaveBeenCalledTimes(2);
    expect(metrics.ready()).toBe(true);
    // 1,500 documents over the node's 15 seconds.
    expect(metrics.history().cluster.indexingRate.map((point) => point.value)).toEqual([null, 100]);
    expect(metrics.nodes().map((node) => node.name)).toEqual(['es-node-1']);
    expect(metrics.latest().get('id-es-node-1')?.indexTotal).toBe(2_500);
    expect(metrics.interval()).toBe(15_000);
  });

  it('stops polling when the last page detaches and keeps the history', async () => {
    post.mockResolvedValue(body(1_000, 500_000));
    const metrics = service();
    const releaseOverview = metrics.attach();
    await settle();
    const releaseNodes = metrics.attach();
    TestBed.tick();
    expect(post).toHaveBeenCalledTimes(1);

    releaseOverview();
    releaseOverview();
    await nextTick();
    expect(post).toHaveBeenCalledTimes(2);

    releaseNodes();
    await nextTick();
    expect(post).toHaveBeenCalledTimes(2);
    expect(metrics.samples()).toHaveLength(2);
  });

  it('releases a page when its DestroyRef is destroyed', async () => {
    post.mockResolvedValue(body(1_000, 500_000));
    const metrics = service();
    const callbacks: (() => void)[] = [];
    const destroyRef = { onDestroy: (callback: () => void) => callbacks.push(callback) } as unknown as DestroyRef;

    metrics.attach(destroyRef);
    await settle();
    expect(post).toHaveBeenCalledTimes(1);
    callbacks.forEach((callback) => callback());
    await nextTick();
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('does not resample when a page attaches right after a sample (moving between pages)', async () => {
    post.mockResolvedValue(body(1_000, 500_000));
    const metrics = service();
    const release = metrics.attach();
    await settle();
    release();
    TestBed.tick();

    now += 3_000;
    metrics.attach();
    await settle();
    expect(post).toHaveBeenCalledTimes(1);

    // A stale history (half an interval old) is refreshed on arrival.
    metrics.attach()();
    now += 5_000;
    metrics.attach();
    await settle();
    expect(post).toHaveBeenCalledTimes(2);
  });

  it('skips a tick that comes right after a sample', async () => {
    post.mockResolvedValue(body(1_000, 500_000));
    const metrics = service();
    metrics.attach();
    await settle();

    // Every 15s: a tick within 5s of the arrival sample adds no noisy interval.
    await nextTick(1_200);
    await nextTick(3_700);
    expect(post).toHaveBeenCalledTimes(1);
    await nextTick(100);
    expect(post).toHaveBeenCalledTimes(2);

    // Every 5s: half the interval.
    interval.set(5_000);
    await nextTick(2_400);
    expect(post).toHaveBeenCalledTimes(2);
    await nextTick(100);
    expect(post).toHaveBeenCalledTimes(3);
  });

  it('samples on every manual refresh a second apart while paused', async () => {
    interval.set(0);
    post.mockResolvedValue(body(1_000, 500_000));
    const metrics = service();
    metrics.attach();
    await settle();

    await nextTick(400);
    expect(post).toHaveBeenCalledTimes(1);
    await nextTick(600);
    expect(post).toHaveBeenCalledTimes(2);
  });

  it('samples on arrival while auto refresh is paused, but only once the last sample is old', async () => {
    interval.set(0);
    post.mockResolvedValue(body(1_000, 500_000));
    const metrics = service();
    const release = metrics.attach();
    await settle();
    expect(metrics.paused()).toBe(true);
    expect(post).toHaveBeenCalledTimes(1);
    release();

    now += PAUSED_RESAMPLE_MS - 1;
    const releaseAgain = metrics.attach();
    await settle();
    expect(post).toHaveBeenCalledTimes(1);
    releaseAgain();

    now += 1;
    metrics.attach();
    await settle();
    expect(post).toHaveBeenCalledTimes(2);
  });

  it('starts a new history for a new host and drops answers of the old one', async () => {
    const pending = deferred<unknown>();
    post.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(body(9, 700_000, 'other-node'));
    const metrics = service();
    metrics.attach();
    TestBed.tick();
    expect(metrics.sampling()).toBe(true);

    host.set('http://other:9200');
    await nextTick(2_000);
    pending.resolve(body(1_000, 500_000));
    await pending.promise;
    await settle();

    expect(post).toHaveBeenCalledTimes(2);
    expect(metrics.nodes().map((node) => node.name)).toEqual(['other-node']);
    expect(metrics.samples()).toHaveLength(1);
  });

  it('skips a tick while a sample is still running', async () => {
    const pending = deferred<unknown>();
    post.mockReturnValueOnce(pending.promise);
    const metrics = service();
    metrics.attach();
    TestBed.tick();

    now += 15_000;
    tick.update((value) => value + 1);
    TestBed.tick();
    expect(post).toHaveBeenCalledTimes(1);

    pending.resolve(body(1_000, 500_000));
    await settle();
    expect(metrics.samples()).toHaveLength(1);
  });

  it('keeps the history and the reason when a sample fails, and recovers', async () => {
    post
      .mockResolvedValueOnce(body(1_000, 500_000))
      .mockRejectedValueOnce(new ClusterApiError(503, { error: { reason: 'master not discovered yet' } }))
      .mockResolvedValueOnce(body(1_500, 530_000));
    const metrics = service();
    metrics.attach();
    await settle();

    await nextTick();
    expect(metrics.failed()).toBe(true);
    expect(metrics.lastError()).toBe('Master not discovered yet');
    expect(metrics.samples()).toHaveLength(1);

    now += 15_000;
    await metrics.sampleNow();
    expect(metrics.failed()).toBe(false);
    expect(metrics.lastError()).toBeUndefined();
    expect(metrics.history().cluster.indexingRate.map((point) => point.value)).toEqual([null, 500 / 30]);
  });

  it('does nothing without a connection', async () => {
    host.set(undefined);
    const metrics = service();
    metrics.attach();
    await settle();
    await metrics.sampleNow();
    expect(post).not.toHaveBeenCalled();
  });
  describe('follow-up sample', () => {
    /** Runs the follow-up timer and lets its request settle. */
    async function runFollowUp(advance = FOLLOW_UP_MS): Promise<void> {
      now += advance;
      await vi.advanceTimersByTimeAsync(advance);
      await settle();
    }

    it('takes a second sample soon after the first, so rates show within seconds', async () => {
      post.mockResolvedValueOnce(body(1_000, 500_000)).mockResolvedValueOnce(body(1_300, 503_000));
      post.mockResolvedValue(body(2_800, 518_000));
      const metrics = service();
      metrics.attach();
      await settle();
      expect(metrics.ready()).toBe(false);

      await runFollowUp();
      expect(post).toHaveBeenCalledTimes(2);
      expect(metrics.ready()).toBe(true);
      expect(metrics.history().cluster.indexingRate.map((point) => point.value)).toEqual([null, 100]);

      // Later samples follow the refresh ticks only.
      await runFollowUp(10_000);
      expect(post).toHaveBeenCalledTimes(2);
      await nextTick(5_000);
      expect(post).toHaveBeenCalledTimes(3);
      await runFollowUp(10_000);
      expect(post).toHaveBeenCalledTimes(3);
    });

    it('takes one after a sample that follows a gap (a tab that was hidden)', async () => {
      post.mockResolvedValue(body(1_000, 500_000));
      interval.set(5_000);
      const metrics = service();
      metrics.attach();
      await settle();
      await runFollowUp();
      expect(post).toHaveBeenCalledTimes(2);

      // The catch-up tick of a tab hidden for 40s.
      await nextTick(40_000);
      expect(metrics.history().gaps.at(-1)).toBe(true);
      await runFollowUp();
      expect(post).toHaveBeenCalledTimes(4);
      expect(metrics.history().gaps.at(-1)).toBe(false);
    });

    it('uses the interval when it is shorter, and never runs while paused or detached', async () => {
      post.mockResolvedValue(body(1_000, 500_000));
      interval.set(0);
      const metrics = service();
      const release = metrics.attach();
      await settle();
      await runFollowUp();
      expect(post).toHaveBeenCalledTimes(1);
      release();
      TestBed.tick();

      interval.set(5_000);
      now += 60_000;
      const releaseAgain = metrics.attach();
      await settle();
      expect(post).toHaveBeenCalledTimes(2);
      releaseAgain();
      TestBed.tick();
      await runFollowUp();
      expect(post).toHaveBeenCalledTimes(2);
    });

    it('is dropped when the host changes', async () => {
      post.mockResolvedValueOnce(body(1_000, 500_000)).mockResolvedValue(body(5, 900_000, 'other-node'));
      const metrics = service();
      metrics.attach();
      await settle();
      host.set('http://other:9200');
      await settle();
      expect(post).toHaveBeenCalledTimes(2);
      // The new host's first sample schedules its own follow-up; the old one is gone.
      await runFollowUp();
      expect(post).toHaveBeenCalledTimes(3);
      expect(metrics.nodes().map((node) => node.name)).toEqual(['other-node']);
    });
  });

  it('keeps measuring rates after switching to a longer refresh interval', async () => {
    let total = 0;
    let timestamp = 500_000;
    post.mockImplementation(() => {
      total += 1_000;
      return Promise.resolve(body(total, timestamp));
    });
    interval.set(5_000);
    const metrics = service();
    metrics.attach();
    await settle();
    for (let index = 0; index < 59; index++) {
      timestamp += 5_000;
      await nextTick(5_000);
    }
    interval.set(60_000);
    for (let index = 0; index < 3; index++) {
      timestamp += 60_000;
      await nextTick(60_000);
    }
    expect(metrics.samples().at(-1)?.expected).toBe(60_000);
    expect(metrics.history().gaps.slice(-3)).toEqual([false, false, false]);
    expect(metrics.history().cluster.indexingRate.slice(-3).map((point) => point.value)).toEqual([1_000 / 60, 1_000 / 60, 1_000 / 60]);
  });

  it('reports a sample that has been running for several intervals as late', async () => {
    const pending = deferred<unknown>();
    post.mockResolvedValueOnce(body(1_000, 500_000)).mockReturnValueOnce(pending.promise);
    const metrics = service();
    metrics.attach();
    await settle();

    now += 15_000;
    tick.update((value) => value + 1);
    TestBed.tick();
    expect(metrics.sampling()).toBe(true);
    expect(metrics.late()).toBe(false);

    for (let index = 0; index < 3; index++) {
      now += 15_000;
      tick.update((value) => value + 1);
      TestBed.tick();
    }
    expect(post).toHaveBeenCalledTimes(2);
    expect(metrics.late()).toBe(true);

    pending.resolve(body(1_500, 560_000));
    await settle();
    expect(metrics.late()).toBe(false);
  });
});
