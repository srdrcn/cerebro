import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClusterApiError } from '../../core/api-envelope';
import { ClusterApiService } from '../../core/cluster-api.service';
import { ConnectionService } from '../../core/connection.service';
import { MetricsService } from '../../core/metrics.service';
import { RefreshService } from '../../core/refresh.service';
import { LIVE_COLLAPSED_PREFERENCE, OverviewLiveComponent } from './overview-live.component';

function body(indexTotal: number, queryTotal: number, timestamp: number, failed = 0) {
  return {
    _nodes: { total: 2 + failed, successful: 2, failed },
    nodes: {
      a: {
        name: 'es-node-1',
        timestamp,
        indices: {
          indexing: { index_total: indexTotal, index_time_in_millis: indexTotal / 100 },
          search: { query_total: queryTotal, query_time_in_millis: queryTotal * 2, fetch_total: 0 },
        },
        jvm: { mem: { heap_used_percent: 61 } },
        os: { cpu: { percent: 12 } },
      },
      b: {
        name: 'es-node-2',
        timestamp,
        indices: {
          indexing: { index_total: indexTotal, index_time_in_millis: indexTotal / 100 },
          search: { query_total: queryTotal, query_time_in_millis: queryTotal * 2, fetch_total: 0 },
        },
        jvm: { mem: { heap_used_percent: 79 } },
        os: { cpu: { percent: 12 } },
      },
    },
  };
}

describe('OverviewLiveComponent', () => {
  const post = vi.fn();
  const host = signal<string | undefined>('http://localhost:9200');
  const tick = signal(1);
  const interval = signal(15_000);
  const resume = vi.fn();
  let now = 1_000_000;

  beforeEach(() => {
    localStorage.clear();
    post.mockReset();
    resume.mockReset();
    interval.set(15_000);
    now = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    // The follow-up sample's timer only runs when a test advances it.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    TestBed.configureTestingModule({
      providers: [
        { provide: ClusterApiService, useValue: { post } },
        { provide: ConnectionService, useValue: { host } },
        { provide: RefreshService, useValue: { tick, interval, paused: computed(() => interval() === 0), resume } },
      ],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /** Lets the mocked sample request settle. */
  async function settle(): Promise<void> {
    const metrics = TestBed.inject(MetricsService);
    for (let turn = 0; turn < 50 && metrics.sampling(); turn++) {
      await new Promise<void>((resolve) => queueMicrotask(resolve));
    }
  }

  async function render() {
    const fixture = TestBed.createComponent(OverviewLiveComponent);
    await fixture.whenStable();
    await settle();
    await fixture.whenStable();
    return { fixture, element: fixture.nativeElement as HTMLElement };
  }

  function text(element: Element | null): string {
    return element?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  }

  async function nextSample(fixture: { whenStable(): Promise<unknown> }) {
    now += 15_000;
    tick.update((value) => value + 1);
    await fixture.whenStable();
    await settle();
    await fixture.whenStable();
  }

  it('collects samples, then shows the cluster rates with sparklines', async () => {
    post.mockResolvedValueOnce(body(1_000, 100, 500_000)).mockResolvedValueOnce(body(4_000, 400, 515_000));
    const { fixture, element } = await render();

    expect(text(element.querySelector('h2'))).toBe('Live activity');
    expect(element.querySelector('[role="status"]')?.textContent).toContain('Collecting samples…');
    const tiles = () =>
      [...element.querySelectorAll('.ov-live__tile')].map((tile) =>
        `${text(tile.querySelector('.ov-live__value'))} ${text(tile.querySelector('.ov-live__unit'))}`.trim(),
      );
    expect(tiles()).toEqual(['–', '–', '–', '70 %', '12 %']);

    await nextSample(fixture);
    // Two nodes × 3,000 documents in 15 seconds; 300 queries each at 2 ms.
    expect(tiles()).toEqual(['400 docs/s', '40 shard queries/s', '2 ms', '70 %', '12 %']);
    // Only the stable part is a live region; the growing window is not announced.
    expect(text(element.querySelector('.ov-live__status [role="status"]'))).toBe('Every 15s');
    expect(text(element.querySelector('.ov-live__window'))).toBe('last 15s');
    expect(element.querySelectorAll('cerebro-sparkline')).toHaveLength(5);
    expect(element.querySelector('.ov-live__tile .sparkline__chart')?.getAttribute('aria-label')).toBe(
      'Indexing rate: 400/s',
    );
    expect(text(element.querySelectorAll('.ov-live__meta')[3] ?? null)).toBe('max 79% on es-node-2');
    // The tile colours the average (70%), below the 75% warning level.
    expect(element.querySelectorAll('cerebro-sparkline')[3]?.classList).not.toContain('tone-yellow');
  });

  it('collapses, stops sampling and remembers it', async () => {
    post.mockResolvedValue(body(1_000, 100, 500_000));
    const { fixture, element } = await render();
    const metrics = TestBed.inject(MetricsService);
    const toggle = element.querySelector('.ov-live__toggle') as HTMLButtonElement;
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.getAttribute('aria-controls')).toBe('ov-live-body');
    expect(metrics.active()).toBe(true);

    toggle.click();
    await fixture.whenStable();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    // It controls nothing while the body is not rendered.
    expect(toggle.hasAttribute('aria-controls')).toBe(false);
    expect(element.querySelector('#ov-live-body')).toBeNull();
    expect(text(element.querySelector('.ov-live__status'))).toBe('Hidden, not sampling');
    expect(metrics.active()).toBe(false);
    expect(localStorage.getItem(LIVE_COLLAPSED_PREFERENCE)).toBe('true');

    const calls = post.mock.calls.length;
    now += 15_000;
    tick.update((value) => value + 1);
    await fixture.whenStable();
    expect(post).toHaveBeenCalledTimes(calls);

    fixture.destroy();
    const again = TestBed.createComponent(OverviewLiveComponent);
    await again.whenStable();
    expect((again.nativeElement as HTMLElement).querySelector('#ov-live-body')).toBeNull();
  });

  it('pauses with auto refresh and offers to resume it', async () => {
    interval.set(0);
    post.mockResolvedValue(body(1_000, 100, 500_000));
    const { element } = await render();

    expect(text(element.querySelector('.ov-live__status [role="status"]'))).toBe('Paused');
    // One sample covers no time yet, and nothing is collected while paused.
    expect(element.querySelector('.ov-live__window')).toBeNull();
    expect(text(element.querySelector('.ov-live__meta'))).toBe('Refresh to measure rates');
    const button = [...element.querySelectorAll('button')].find((candidate) => text(candidate) === 'Resume auto refresh');
    button?.click();
    expect(resume).toHaveBeenCalled();
  });

  it('shows why sampling failed and retries', async () => {
    let answer: (value: unknown) => void = () => undefined;
    post
      .mockRejectedValueOnce(new ClusterApiError(500, { error: { reason: 'node stats timed out' } }))
      .mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
    const { fixture, element } = await render();

    expect(text(element.querySelector('.ov-live__warning'))).toBe('Not updating');
    // The whole reason, wrapped, in a callout (not a truncated hover title).
    const callout = element.querySelector('.ov-live__callout');
    expect(callout?.getAttribute('role')).toBe('status');
    expect(text(callout)).toBe('Could not sample the nodes. Node stats timed out Try again');
    expect([...element.querySelectorAll('.ov-live__meta')].map(text)).toEqual(Array(5).fill('No sample yet'));
    const retry = [...element.querySelectorAll('button')].find((candidate) => text(candidate) === 'Try again');
    retry?.click();
    await fixture.whenStable();
    expect(retry?.disabled).toBe(true);
    expect(retry?.classList).toContain('is-loading');
    answer(body(1_000, 100, 500_000));
    await settle();
    await fixture.whenStable();
    expect(element.querySelector('.ov-live__callout')).toBeNull();
    expect(post).toHaveBeenCalledTimes(2);
  });

  it('shows rates a few seconds after arrival with a follow-up sample', async () => {
    post.mockResolvedValueOnce(body(1_000, 100, 500_000)).mockResolvedValueOnce(body(1_600, 160, 503_000));
    const { fixture, element } = await render();
    expect(text(element.querySelector('.ov-live__value'))).toBe('–');

    now += 3_000;
    await vi.advanceTimersByTimeAsync(3_000);
    await settle();
    await fixture.whenStable();
    expect(post).toHaveBeenCalledTimes(2);
    expect(text(element.querySelector('.ov-live__value'))).toBe('400');
  });

  it('tells when some nodes did not answer and when a sample is late', async () => {
    let resolveLate: (value: unknown) => void = () => undefined;
    post
      .mockResolvedValueOnce(body(1_000, 100, 500_000))
      .mockResolvedValueOnce(body(4_000, 400, 515_000, 1))
      .mockReturnValueOnce(new Promise((resolve) => (resolveLate = resolve)));
    const { fixture, element } = await render();
    await nextSample(fixture);
    expect(text(element.querySelector('.ov-live__status .badge'))).toBe('2 of 3 nodes answered');
    // Cluster sums of that sample would dip by the missing node's share.
    expect(text(element.querySelector('.ov-live__value'))).toBe('–');

    for (let index = 0; index < 4; index++) {
      now += 15_000;
      tick.update((value) => value + 1);
      await fixture.whenStable();
    }
    expect(text(element.querySelector('.ov-live__warning'))).toBe('Waiting for the nodes…');
    expect(text(element.querySelector('.ov-live__status'))).toMatch(/last sample \d\d:\d\d:\d\d/);
    resolveLate(body(5_000, 500, 575_000));
    await settle();
    await fixture.whenStable();
    expect(element.querySelector('.ov-live__warning')).toBeNull();
  });
});
