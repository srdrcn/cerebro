import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, ParamMap, Router, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AlertService } from '../../core/alert.service';
import { ClusterApiError } from '../../core/api-envelope';
import { ClusterApiService } from '../../core/cluster-api.service';
import { ConnectionService } from '../../core/connection.service';
import { DialogService } from '../../core/dialog.service';
import { MetricsService } from '../../core/metrics.service';
import { RefreshService } from '../../core/refresh.service';
import { NodesComponent } from './nodes.component';
import { NodesNode } from './nodes.models';

function node(id: string, name: string): NodesNode {
  return {
    id,
    name,
    current_master: name === 'es-node-2',
    host: '127.0.0.1',
    master: true,
    data: true,
    ingest: true,
    coordinating: false,
    cpu: { load: 1.86, process: 4, os: 13 },
    heap: { percent: 50, used: '200mb', max: '400mb' },
    disk: { percent: 91, available: 23_000_000_000, total: 252_000_000_000 },
    uptime: 3_600_000,
    jvm: '22.0.1',
    version: '8.15.3',
    attributes: {},
  };
}

const NODES = [node('id-1', 'es-node-1'), node('id-2', 'es-node-2'), node('id-3', 'es-node-3')];

/** `metrics/nodes` with `indexTotal` documents indexed so far on every node. */
function metricsBody(indexTotal: number, timestamp: number) {
  return {
    nodes: Object.fromEntries(
      NODES.map((entry) => [
        entry.id,
        {
          name: entry.name,
          timestamp,
          indices: { indexing: { index_total: indexTotal, index_time_in_millis: indexTotal / 10 } },
          jvm: { mem: { heap_used_percent: entry.name === 'es-node-1' ? 63 : 50 } },
          process: { cpu: { percent: entry.name === 'es-node-1' ? 9 : 4 } },
          os: { cpu: { percent: 21, load_average: { '1m': 2.5 } } },
          thread_pool: { write: { threads: 4, active: 1, queue: 0, rejected: 2, completed: 10 } },
        },
      ]),
    ),
  };
}

describe('NodesComponent', () => {
  const post = vi.fn();
  const alerts = { error: vi.fn(), warn: vi.fn(), success: vi.fn(), info: vi.fn() };
  const host = signal<string | undefined>('http://localhost:9200');
  const tick = signal(1);
  const interval = signal(15_000);
  let params: BehaviorSubject<ParamMap>;
  let snapshotParams: ParamMap;
  let metricsCalls = 0;
  let now = 1_000_000;

  beforeEach(() => {
    now = 1_000_000;
    host.set('http://localhost:9200');
    interval.set(15_000);
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    post.mockReset();
    alerts.warn.mockReset();
    metricsCalls = 0;
    post.mockImplementation((path: string) => {
      if (path === 'nodes') {
        return Promise.resolve(NODES);
      }
      metricsCalls++;
      return Promise.resolve(metricsBody(metricsCalls * 1_000, 1_000_000 + metricsCalls * 15_000));
    });
    params = new BehaviorSubject(convertToParamMap({}));
    snapshotParams = convertToParamMap({});
    Element.prototype.scrollIntoView = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: ClusterApiService, useValue: { post } },
        { provide: AlertService, useValue: alerts },
        { provide: DialogService, useValue: { showJson: vi.fn() } },
        {
          provide: ActivatedRoute,
          useValue: {
            queryParamMap: params,
            get snapshot() {
              return { queryParamMap: snapshotParams };
            },
          },
        },
        {
          provide: ConnectionService,
          useValue: { host, connected: () => host() !== undefined, hostQuery: () => ({ host: host() ?? null }) },
        },
        {
          provide: RefreshService,
          useValue: { tick, interval, paused: computed(() => interval() === 0), resume: vi.fn() },
        },
      ],
    });
  });

  afterEach(() => vi.restoreAllMocks());

  async function render() {
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const fixture = TestBed.createComponent(NodesComponent);
    await fixture.whenStable();
    await vi.waitFor(() => expect(fixture.componentInstance.nodes()).toBeDefined());
    await fixture.whenStable();
    return { fixture, element: fixture.nativeElement as HTMLElement, component: fixture.componentInstance, navigate };
  }

  function expandButton(element: HTMLElement, name: string): HTMLButtonElement {
    return element.querySelector(`button[aria-label$="live activity of ${name}"]`) as HTMLButtonElement;
  }

  it('samples live metrics while the page is shown and draws a sparkline per node', async () => {
    const { fixture, element } = await render();

    expect(post).toHaveBeenCalledWith('nodes');
    expect(post).toHaveBeenCalledWith('metrics/nodes');
    // CPU, heap and the two activity rates.
    expect(element.querySelectorAll('tbody tr.node-row')[0]?.querySelectorAll('cerebro-sparkline')).toHaveLength(4);
    expect(element.querySelector('th.activity-col')?.textContent?.trim()).toBe('Activity');

    // While the page is shown, a refresh tick takes a sample (positive control).
    const metrics = TestBed.inject(MetricsService);
    const attached = metricsCalls;
    now += 15_000;
    tick.update((value) => value + 1);
    TestBed.tick();
    await vi.waitFor(() => expect(metricsCalls).toBe(attached + 1));
    await vi.waitFor(() => expect(metrics.sampling()).toBe(false));

    // Leaving the page stops the sampling: the same steps take no sample.
    fixture.destroy();
    const calls = metricsCalls;
    now += 15_000;
    tick.update((value) => value + 1);
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(metricsCalls).toBe(calls);
  });

  it('expands a node from ?node=, highlights it and scrolls to it', async () => {
    params.next(convertToParamMap({ node: 'es-node-2' }));
    snapshotParams = convertToParamMap({ node: 'es-node-2' });
    const { element, component } = await render();

    expect(component.expanded()).toBe('es-node-2');
    const row = element.querySelector('#node-row-id-2') as HTMLElement;
    expect(row.classList).toContain('is-selected');
    expect(expandButton(element, 'es-node-2').getAttribute('aria-expanded')).toBe('true');
    const detail = element.querySelector('#node-detail-id-2') as HTMLElement;
    expect(detail.querySelector('h2')?.textContent?.replace(/\s+/g, ' ').trim()).toBe('Live activity of es-node-2');
    expect(detail.querySelectorAll('.node-chart')).toHaveLength(8);
    expect(detail.querySelector('caption')?.textContent).toContain('Thread pools of es-node-2');
    expect(detail.textContent).toContain('Collecting samples…');
    await vi.waitFor(() => expect(Element.prototype.scrollIntoView).toHaveBeenCalled());
  });

  it('clears filters that would hide the linked node', async () => {
    const { fixture, component } = await render();
    component.name.set('es-node-1');
    await fixture.whenStable();

    params.next(convertToParamMap({ node: 'es-node-3' }));
    await fixture.whenStable();
    expect(component.name()).toBe('');
    expect(component.visibleNodes().map((entry) => entry.name)).toContain('es-node-3');
  });

  it('warns about an unknown node and drops the parameter', async () => {
    params.next(convertToParamMap({ node: 'es-node-9' }));
    snapshotParams = convertToParamMap({ node: 'es-node-9' });
    const { component, navigate } = await render();

    expect(alerts.warn).toHaveBeenCalledWith('Node es-node-9 is not in the cluster');
    expect(component.expanded()).toBeNull();
    expect(navigate).toHaveBeenCalledWith(
      [],
      expect.objectContaining({ queryParams: { node: null }, queryParamsHandling: 'merge', replaceUrl: true }),
    );
  });

  it('mirrors the expanded node in the URL without reacting to its own echo', async () => {
    const { fixture, element, component, navigate } = await render();

    expandButton(element, 'es-node-1').click();
    await fixture.whenStable();
    expect(component.expanded()).toBe('es-node-1');
    expect(navigate).toHaveBeenLastCalledWith(
      [],
      expect.objectContaining({ queryParams: { node: 'es-node-1' }, replaceUrl: true }),
    );
    expect(element.querySelector('#node-detail-id-1')).not.toBeNull();

    // Opening another node closes the first one.
    expandButton(element, 'es-node-3').click();
    await fixture.whenStable();
    expect(element.querySelector('#node-detail-id-1')).toBeNull();
    expect(element.querySelector('#node-detail-id-3')).not.toBeNull();

    snapshotParams = convertToParamMap({ node: 'es-node-3' });
    expandButton(element, 'es-node-3').click();
    await fixture.whenStable();
    expect(component.expanded()).toBeNull();
    expect(navigate).toHaveBeenLastCalledWith([], expect.objectContaining({ queryParams: { node: null } }));
    expect(element.querySelector('.node-detail-row')).toBeNull();
  });

  it('shows rates and thread pools once two samples were compared', async () => {
    params.next(convertToParamMap({ node: 'es-node-1' }));
    const { fixture, element } = await render();

    now += 15_000;
    tick.update((value) => value + 1);
    await vi.waitFor(() => expect(TestBed.inject(MetricsService).ready()).toBe(true));
    await fixture.whenStable();

    const detail = element.querySelector('#node-detail-id-1') as HTMLElement;
    // 1,000 more documents in the node's 15 seconds.
    const indexing = [...detail.querySelectorAll('.node-chart')].find((chart) =>
      chart.textContent?.includes('Indexing rate'),
    );
    expect(indexing?.querySelector('.node-chart__value')?.textContent?.trim()).toBe('66.7');
    expect(indexing?.querySelector('.node-chart__unit')?.textContent?.trim()).toBe('docs/s');
    const write = detail.querySelector('.node-pools tbody tr') as HTMLElement;
    expect([...write.querySelectorAll('th, td')].map((cell) => cell.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
      'Write',
      '1 of 4',
      '0',
      '0',
      '0',
      '2',
    ]);
    const activity = element.querySelector('#node-row-id-1 .activity__value') as HTMLElement;
    expect(activity.textContent?.replace(/\s+/g, '')).toBe('66.7/s');
    // Only the stable part is a live region; the growing window is not announced.
    const status = detail.querySelector('.node-detail__status') as HTMLElement;
    expect(status.querySelector('[role="status"]')?.textContent?.trim()).toBe('Every 15s');
    expect(status.textContent?.replace(/\s+/g, ' ')).toContain('last 15s');
    expect(status.querySelector('[role="status"]')?.textContent).not.toContain('last');
  });

  it('shows the CPU, heap and load of the latest sample, like the sparklines beside them', async () => {
    const { element } = await render();
    const row = element.querySelector('#node-row-id-1') as HTMLElement;
    const values = [...row.querySelectorAll('.metric__value')].map((cell) => cell.textContent?.trim());
    // The nodes request said 4% and 50%; the metrics sample 9% and 63%.
    expect(values.slice(0, 2)).toEqual(['9%', '63%']);
    expect(row.querySelector('.metric__detail')?.textContent?.replace(/\s+/g, ' ').trim()).toBe('OS 21% · load 2.50');
    // No Load column: it is part of the CPU cell.
    expect(element.querySelectorAll('thead th')).toHaveLength(7);
  });

  it('shows an error state with the reason instead of empty charts when no sample could be taken', async () => {
    let answer: (value: unknown) => void = () => undefined;
    post.mockImplementation((path: string) => {
      if (path === 'nodes') {
        return Promise.resolve(NODES);
      }
      metricsCalls++;
      return metricsCalls === 1
        ? Promise.reject(new ClusterApiError(429, { error: { reason: '[parent] Data too large' } }))
        : new Promise((resolve) => (answer = resolve));
    });
    params.next(convertToParamMap({ node: 'es-node-1' }));
    const { fixture, element } = await render();
    await vi.waitFor(() => expect(TestBed.inject(MetricsService).failed()).toBe(true));
    await fixture.whenStable();

    const detail = element.querySelector('#node-detail-id-1') as HTMLElement;
    expect(detail.querySelector('.node-chart')).toBeNull();
    expect(detail.querySelector('.node-pools')).toBeNull();
    const empty = detail.querySelector('cerebro-empty') as HTMLElement;
    expect(empty.textContent).toContain('Could not sample the nodes');
    expect(empty.textContent).toContain('[parent] Data too large');
    // Cells fall back to the nodes request while sampling fails.
    expect(element.querySelector('#node-row-id-1 .metric__value')?.textContent?.trim()).toBe('4%');

    const retry = empty.querySelector('button') as HTMLButtonElement;
    retry.click();
    await fixture.whenStable();
    expect(retry.disabled).toBe(true);
    expect(retry.classList).toContain('is-loading');
    answer(metricsBody(1_000, 1_015_000));
    await vi.waitFor(() => expect(TestBed.inject(MetricsService).failed()).toBe(false));
    await fixture.whenStable();
    expect(detail.querySelectorAll('.node-chart')).toHaveLength(8);
  });

  it('points the expand button at the detail only while it is shown', async () => {
    const { fixture, element } = await render();
    const button = expandButton(element, 'es-node-2');
    expect(button.hasAttribute('aria-controls')).toBe(false);
    button.click();
    await fixture.whenStable();
    expect(button.getAttribute('aria-controls')).toBe('node-detail-id-2');
    expect(element.querySelector('#node-detail-id-2')).not.toBeNull();
  });

  it('says the sampling is paused rather than collecting while auto refresh is off', async () => {
    interval.set(0);
    params.next(convertToParamMap({ node: 'es-node-1' }));
    const { element } = await render();

    const status = element.querySelector('.node-detail__status') as HTMLElement;
    expect(status.querySelector('[role="status"]')?.textContent?.trim()).toBe('Paused');
    expect(status.querySelector('button')?.textContent?.trim()).toBe('Resume auto refresh');
  });
});
