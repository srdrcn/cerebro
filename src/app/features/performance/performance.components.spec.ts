import { Type, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AlertService } from '../../core/alert.service';
import { ClusterApiError } from '../../core/api-envelope';
import { ClipboardService } from '../../core/clipboard.service';
import { ClusterApiService } from '../../core/cluster-api.service';
import { ConnectionService } from '../../core/connection.service';
import { DialogService } from '../../core/dialog.service';
import { RefreshService } from '../../core/refresh.service';
import { ScrollTabsDirective } from '../../shared/scroll-tabs.directive';
import { HotThreadsComponent } from './hot-threads.component';
import { PendingTasksComponent } from './pending-tasks.component';
import { PerformanceComponent } from './performance.component';
import {
  BUSY_CPU_CAPTURE,
  BUSY_SEARCH_CAPTURE,
  EMPTY_CPU_CAPTURE,
  PENDING_TASKS,
  SLOWLOG_RESPONSE,
  THREAD_POOL_ROWS,
  WAIT_CAPTURE,
} from './performance.fixtures';
import { SlowLogsComponent } from './slow-logs.component';
import { ThreadPoolsComponent } from './thread-pools.component';

const NODES = [
  { id: 'wEqTWTA0T2CktRBr56viXg', name: 'es-node-2' },
  { id: 'I7MELLk0RvSiAPhRW6211Q', name: 'es-node-1' },
];
const INDICES = ['tmp-performance-a', 'tmp-performance-b', 'logs', '.kibana', '.ds-app-events-web-2026.10.14-000001'];

/** A cluster that keeps flat slow log settings and applies `index_settings/bulk_update` to them. */
function fakeSettings(): { slowlog: () => unknown; bulkUpdate: (payload: unknown) => unknown; failOn?: string } {
  const state = new Map<string, Record<string, string>>(
    Object.entries(SLOWLOG_RESPONSE).map(([index, value]) => [index, { ...(value.settings as Record<string, string>) }]),
  );
  const fake: { slowlog: () => unknown; bulkUpdate: (payload: unknown) => unknown; failOn?: string } = {
    slowlog: () => Object.fromEntries([...state].map(([index, settings]) => [index, { settings: { ...settings } }])),
    bulkUpdate: (payload: unknown) => {
      const { indices, settings } = payload as { indices: string[]; settings: Record<string, string | null> };
      for (const index of indices) {
        if (index === fake.failOn) {
          throw new ClusterApiError(403, { error: { reason: `action [indices:admin/settings/update] is unauthorized for index [${index}]` } });
        }
        const current = state.get(index) ?? {};
        for (const [key, value] of Object.entries(settings)) {
          if (value === null) {
            delete current[key];
          } else {
            current[key] = value;
          }
        }
        if (Object.keys(current).length > 0) {
          state.set(index, current);
        } else {
          state.delete(index);
        }
      }
      return { acknowledged: true };
    },
  };
  return fake;
}

describe('performance tabs', () => {
  const post = vi.fn();
  const alerts = { error: vi.fn(), success: vi.fn(), info: vi.fn(), warn: vi.fn() };
  const dialogs = { confirm: vi.fn(), showJson: vi.fn() };
  const clipboard = { copyAndNotify: vi.fn() };
  const host = signal<string | undefined>('http://localhost:9200');

  beforeEach(() => {
    post.mockReset();
    alerts.error.mockReset();
    alerts.success.mockReset();
    alerts.warn.mockReset();
    dialogs.confirm.mockReset();
    dialogs.showJson.mockReset();
    clipboard.copyAndNotify.mockReset();
    host.set('http://localhost:9200');
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: ClusterApiService, useValue: { post } },
        { provide: AlertService, useValue: alerts },
        { provide: DialogService, useValue: dialogs },
        { provide: ClipboardService, useValue: clipboard },
        {
          provide: ConnectionService,
          useValue: { host, connected: () => host() !== undefined, hostQuery: () => ({ host: host() ?? null }) },
        },
      ],
    });
  });

  function routes(answers: Record<string, unknown>): void {
    post.mockImplementation(async (path: string, payload?: unknown) => {
      if (!(path in answers)) {
        throw new Error(`unexpected ${path}`);
      }
      const answer = answers[path];
      if (answer instanceof Error) {
        throw answer;
      }
      return typeof answer === 'function' ? (answer as (payload?: unknown) => unknown)(payload) : answer;
    });
  }

  async function render<T>(type: Type<T>, active = true): Promise<ComponentFixture<T>> {
    const fixture = TestBed.createComponent(type);
    fixture.componentRef.setInput('active', active);
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture;
  }

  describe('HotThreadsComponent', () => {
    it('captures once when shown and sorts the busiest node first', async () => {
      routes({ nodes: NODES, 'performance/hot_threads': BUSY_CPU_CAPTURE });
      const fixture = await render(HotThreadsComponent);
      const target = fixture.componentInstance;

      await vi.waitFor(() => expect(target.capture()).toBeDefined());
      expect(post).toHaveBeenCalledWith('performance/hot_threads', {
        threads: 3,
        interval: '500ms',
        type: 'cpu',
        ignore_idle_threads: true,
      });
      expect(target.capture()?.nodes.map((node) => node.name)).toEqual(['es-node-2', 'es-node-1', 'es-node-3']);
      expect(target.hint()?.lead).toBe(
        'Most busy time went to the search worker pool, mostly waiting on I/O or for a free CPU core rather than computing',
      );
      expect(target.hint()?.detail).toBe('3 threads on es-node-2, up to 90.9% busy with 6.9% on CPU');
      expect(target.announcement()).toBe('Captured 4 threads worth a look on 3 nodes');
      expect(target.nodes().map((node) => node.name)).toEqual(['es-node-1', 'es-node-2']);

      // Refresh ticks never capture again.
      TestBed.inject(RefreshService).refresh();
      fixture.detectChanges();
      await fixture.whenStable();
      expect(post.mock.calls.filter(([path]) => path === 'performance/hot_threads')).toHaveLength(1);

      fixture.detectChanges();
      const element = fixture.nativeElement as HTMLElement;
      const card = element.querySelector('.hot-thread')!;
      const text = card.textContent ?? '';
      expect(text).toContain('90.9%');
      // The stack doing work comes first; the executor-only 6/10 folds into one line.
      expect(text).toContain('In 2 of 10 snapshots');
      expect(text).toContain('Show all 25 frames');
      expect(text).toContain('Different code in 6 of 10 snapshots: only the 3 executor frames at the bottom were the same');
      expect(text).toContain('Show 3 frames');
      expect(text).toContain('Show 1 other stack');
      expect(card.querySelectorAll('.frames')).toHaveLength(1);
      // The top frame named on the card is in the stack shown under it.
      expect(text).toContain('IntersectTermsEnum.next');
      expect(text).not.toContain('(in another stack)');
      const hottest = target.capture()!.nodes[0]!.threads[0]!;
      target.toggleStacks(hottest);
      fixture.detectChanges();
      expect(card.textContent).toContain('Show all 12 frames');
      expect(card.querySelectorAll('.frames')).toHaveLength(2);
    });

    it('waits for Capture on large clusters', async () => {
      const many = Array.from({ length: 12 }, (_, index) => ({ id: `id-${index}`, name: `node-${index}` }));
      routes({ nodes: many, 'performance/hot_threads': BUSY_CPU_CAPTURE });
      const fixture = await render(HotThreadsComponent);
      const target = fixture.componentInstance;
      await vi.waitFor(() => expect(target.waitingForCapture()).toBe(true));
      expect(post.mock.calls.some(([path]) => path === 'performance/hot_threads')).toBe(false);
      fixture.detectChanges();
      expect((fixture.nativeElement as HTMLElement).textContent).toContain('This cluster has 12 nodes.');
      target.submit();
      await vi.waitFor(() => expect(target.capture()).toBeDefined());
      expect(target.waitingForCapture()).toBe(false);
    });

    it('waits for Capture when the node list fails', async () => {
      routes({ nodes: new ClusterApiError(500, { error: { reason: 'boom' } }), 'performance/hot_threads': BUSY_CPU_CAPTURE });
      const fixture = await render(HotThreadsComponent);
      const target = fixture.componentInstance;
      await vi.waitFor(() => expect(target.waitingForCapture()).toBe(true));
      expect(target.nodesFailed()).toBe(true);
      expect(post.mock.calls.some(([path]) => path === 'performance/hot_threads')).toBe(false);
    });

    it('shows a thread with only a unique snapshot as 1 of 10', async () => {
      routes({ nodes: NODES, 'performance/hot_threads': BUSY_SEARCH_CAPTURE });
      const fixture = await render(HotThreadsComponent);
      const target = fixture.componentInstance;
      await vi.waitFor(() => expect(target.capture()).toBeDefined());
      fixture.detectChanges();
      const cards = [...(fixture.nativeElement as HTMLElement).querySelectorAll('.hot-thread')];
      const unique = cards.find((card) => card.textContent?.includes('es-node-3][search_worker][T#1]'));
      expect(unique?.textContent).toContain('In 1 of 10 snapshots (unique)');
      const parked = cards.find((card) => card.textContent?.includes('es-node-2][search_worker][T#5]'));
      expect(parked?.textContent).toContain('Waiting for work in 6 of 10 snapshots');
      expect(parked?.querySelectorAll('.frames')).toHaveLength(0);
    });

    it('calls a wait capture of idle workers calm', async () => {
      routes({ nodes: NODES, 'performance/hot_threads': WAIT_CAPTURE });
      const fixture = await render(HotThreadsComponent);
      const target = fixture.componentInstance;
      await vi.waitFor(() => expect(target.capture()).toBeDefined());
      expect(target.idleOnly()).toBe(true);
      expect(target.hint()).toBeNull();
      fixture.detectChanges();
      expect((fixture.nativeElement as HTMLElement).textContent).toContain('Every waiting thread was idle, waiting for work: nothing is blocked.');
    });

    it('does nothing while hidden', async () => {
      routes({ nodes: NODES, 'performance/hot_threads': BUSY_CPU_CAPTURE });
      await render(HotThreadsComponent, false);
      expect(post).not.toHaveBeenCalled();
    });

    it('sends the chosen node and options, and validates the thread count', async () => {
      routes({ nodes: NODES, 'performance/hot_threads': EMPTY_CPU_CAPTURE });
      const fixture = await render(HotThreadsComponent);
      const target = fixture.componentInstance;
      await vi.waitFor(() => expect(target.capture()).toBeDefined());
      expect(target.quietState()?.heading).toBe('No busy threads');

      target.setThreads('99');
      target.submit();
      expect(target.threadsError()).toBe('Enter a whole number from 1 to 50');
      expect(post.mock.calls.filter(([path]) => path === 'performance/hot_threads')).toHaveLength(1);

      target.setThreads(10);
      target.node.set('I7MELLk0RvSiAPhRW6211Q');
      target.type.set('block');
      target.interval.set('2s');
      target.ignoreIdle.set(false);
      target.submit();
      await vi.waitFor(() => expect(target.capturing()).toBe(false));
      expect(post).toHaveBeenLastCalledWith('performance/hot_threads', {
        node: 'I7MELLk0RvSiAPhRW6211Q',
        threads: 10,
        interval: '2s',
        type: 'block',
        ignore_idle_threads: false,
      });
      expect(target.requestLabel()).toBe('Block · 2s on es-node-1 · top 10 per node');
    });

    it('shows the Elasticsearch reason when the capture fails', async () => {
      const failure = new ClusterApiError(400, { error: { reason: 'type must be one of block, cpu, mem, wait' } });
      routes({ nodes: NODES, 'performance/hot_threads': failure });
      const fixture = await render(HotThreadsComponent);
      const target = fixture.componentInstance;
      await vi.waitFor(() => expect(target.captureError()).toBe('Type must be one of block, cpu, mem, wait'));
      expect(alerts.error).toHaveBeenCalledWith('Could not capture hot threads: type must be one of block, cpu, mem, wait', failure);
    });
  });

  describe('ThreadPoolsComponent', () => {
    it('marks rejections that grew since the previous sample', async () => {
      let rows = THREAD_POOL_ROWS;
      routes({ 'performance/thread_pools': () => rows });
      const fixture = await render(ThreadPoolsComponent);
      const target = fixture.componentInstance;
      const emitted: number[] = [];
      target.newRejections.subscribe((value) => emitted.push(value));
      await vi.waitFor(() => expect(target.rows()).toBeDefined());
      expect(target.increases().size).toBe(0);

      rows = THREAD_POOL_ROWS.map((row) =>
        row.node_name === 'es-node-1' && row.name === 'write' ? { ...row, rejected: '7' } : row,
      );
      await target.load();
      expect([...target.increases()]).toEqual([['es-node-1/write', 7]]);
      expect(target.sinceBaseline()).toBe(7);
      expect(emitted.at(-1)).toBe(7);
      expect(target.announcement()).toBe('7 new rejections in 1 thread pool');

      await target.load();
      expect(target.increases().size).toBe(0);
      expect(target.sinceBaseline()).toBe(7);
      // The rejecting row comes first in the default order while its counter grows.
      rows = rows.map((row) => (row.node_name === 'es-node-1' && row.name === 'write' ? { ...row, rejected: '9' } : row));
      await target.load();
      expect(target.visible()[0]?.key).toBe('es-node-1/write');
      expect(target.sinceBaseline()).toBe(9);
    });

    it('hides uninteresting pools until asked', async () => {
      routes({ 'performance/thread_pools': THREAD_POOL_ROWS });
      const fixture = await render(ThreadPoolsComponent);
      const target = fixture.componentInstance;
      await vi.waitFor(() => expect(target.rows()).toBeDefined());
      const shown = target.visible().length;
      expect(target.hiddenCount()).toBeGreaterThan(0);
      target.showAll.set(true);
      expect(target.visible().length).toBe(shown + target.hiddenCount());
      expect(target.visible()[0]?.pool).toBe('search');
    });

    it('keeps the last sample when a refresh fails', async () => {
      routes({ 'performance/thread_pools': THREAD_POOL_ROWS });
      const fixture = await render(ThreadPoolsComponent);
      const target = fixture.componentInstance;
      await vi.waitFor(() => expect(target.rows()).toBeDefined());
      routes({ 'performance/thread_pools': new ClusterApiError(502, { error: { reason: 'node disconnected' } }) });
      await target.load();
      expect(target.rows()).toBeDefined();
      expect(target.staleReason()).toBe('Node disconnected');
    });
  });

  describe('PendingTasksComponent', () => {
    it('lists the queue and reports its size', async () => {
      routes({ 'performance/pending_tasks': PENDING_TASKS });
      const fixture = await render(PendingTasksComponent);
      const target = fixture.componentInstance;
      const counts: number[] = [];
      target.count.subscribe((value) => counts.push(value));
      await vi.waitFor(() => expect(target.tasks()).toHaveLength(13));
      routes({ 'performance/pending_tasks': { tasks: [] } });
      await target.load();
      expect(counts).toEqual([0]);
      expect(target.announcement()).toBe('No pending cluster tasks');
      fixture.detectChanges();
      expect((fixture.nativeElement as HTMLElement).textContent).toContain('No pending cluster tasks');
    });
  });

  describe('SlowLogsComponent', () => {
    let cluster = fakeSettings();
    let fixture: ComponentFixture<SlowLogsComponent>;

    async function slowLogs(): Promise<SlowLogsComponent> {
      cluster = fakeSettings();
      routes({
        'performance/slowlog': () => cluster.slowlog(),
        'commons/indices': INDICES,
        'index_settings/bulk_update': (payload: unknown) => cluster.bulkUpdate(payload),
      });
      fixture = await render(SlowLogsComponent);
      const target = fixture.componentInstance;
      await vi.waitFor(() => expect(target.rows()).toHaveLength(2));
      await vi.waitFor(() => expect(target.indexNames()).toEqual(INDICES));
      return target;
    }

    function calls(path: string): number {
      return post.mock.calls.filter(([called]) => called === path).length;
    }

    it('loads once per visit instead of on every refresh tick', async () => {
      await slowLogs();
      expect(calls('performance/slowlog')).toBe(1);
      expect(calls('commons/indices')).toBe(1);
      TestBed.inject(RefreshService).refresh();
      fixture.detectChanges();
      await fixture.whenStable();
      expect(calls('performance/slowlog')).toBe(1);
      expect(calls('commons/indices')).toBe(1);
      // Leaving and coming back reads the index names again, the settings stay.
      fixture.componentRef.setInput('active', false);
      fixture.detectChanges();
      fixture.componentRef.setInput('active', true);
      fixture.detectChanges();
      await fixture.whenStable();
      expect(calls('performance/slowlog')).toBe(1);
      expect(calls('commons/indices')).toBe(2);
      fixture.componentInstance.reload();
      await vi.waitFor(() => expect(calls('performance/slowlog')).toBe(2));
    });

    it('edits an index from the table and applies the form after confirmation', async () => {
      const target = await slowLogs();
      await target.edit(target.rows()![1]!);
      expect([...target.selected()]).toEqual(['tmp-performance-b']);
      expect(target.preset()).toBe('moderate');
      expect(target.dirty()).toBe(false);

      target.applyPreset('aggressive');
      target.setThreshold('index', 'trace', '');
      expect(target.dirty()).toBe(true);
      expect(target.preset()).toBe('custom');

      dialogs.confirm.mockResolvedValue(true);
      await target.apply();
      expect(dialogs.confirm).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Apply slow log settings to 1 index?',
          message: 'tmp-performance-b. Empty fields reset the setting to its default.',
          confirmLabel: 'Apply settings',
        }),
      );
      const items = (dialogs.confirm.mock.calls[0]?.[0] as { items: string[] }).items;
      expect(items[0]).toBe('Overwrites tmp-performance-b (Moderate): changes 11 settings, removes Indexing trace');
      const call = post.mock.calls.find(([path]) => path === 'index_settings/bulk_update');
      expect(call?.[1]).toEqual({
        indices: ['tmp-performance-b'],
        settings: expect.objectContaining({
          'index.search.slowlog.threshold.query.warn': '2s',
          'index.search.slowlog.threshold.fetch.trace': '50ms',
          'index.indexing.slowlog.threshold.index.trace': null,
          'index.indexing.slowlog.source': null,
          'index.indexing.slowlog.reformat': null,
        }),
      });
      expect(alerts.success).toHaveBeenCalledWith('Slow log settings applied to 1 index');
      expect(target.dirty()).toBe(false);
      expect(target.rows()?.find((row) => row.index === 'tmp-performance-b')?.thresholds.query.warn).toBe('2s');
      // Focus goes back to the editor title rather than to the page.
      await Promise.resolve();
      expect(document.activeElement?.id).toBe('slowlog-editor-title');
    });

    it('starts from the settings of the first configured index picked', async () => {
      const target = await slowLogs();
      target.toggleIndex('tmp-performance-b');
      expect(target.preset()).toBe('moderate');
      expect(target.dirty()).toBe(false);
      // A second pick keeps the form.
      target.toggleIndex('logs');
      expect(target.preset()).toBe('moderate');
    });

    it('reports a change that only reached some indices', async () => {
      const target = await slowLogs();
      cluster.failOn = 'tmp-performance-b';
      target.toggleIndex('logs');
      target.toggleIndex('tmp-performance-b');
      target.applyPreset('aggressive');
      dialogs.confirm.mockResolvedValue(true);
      await target.apply();
      expect(alerts.warn).toHaveBeenCalledWith(
        'Slow log settings applied to 1 of 2 indices; not applied to tmp-performance-b: action [indices:admin/settings/update] is unauthorized for index [tmp-performance-b]',
      );
      expect(alerts.success).not.toHaveBeenCalled();
    });

    it('selects regular indices only with Select all', async () => {
      const target = await slowLogs();
      target.selectShown();
      expect(target.selectedList()).toEqual(['logs', 'tmp-performance-a', 'tmp-performance-b']);
      expect(target.pickerGroups().backing).toEqual(['.ds-app-events-web-2026.10.14-000001']);
      target.toggleIndex('.ds-app-events-web-2026.10.14-000001');
      target.applyPreset('moderate');
      dialogs.confirm.mockResolvedValue(false);
      await target.apply();
      expect((dialogs.confirm.mock.calls[0]?.[0] as { message: string }).message).toContain(
        'Backing indices of data streams keep this only until the next rollover',
      );
    });

    it('blocks invalid values and an empty selection', async () => {
      const target = await slowLogs();
      target.setThreshold('query', 'warn', '1.5s');
      await target.apply();
      expect(target.selectionError()).toBe('Choose at least one index');
      expect(dialogs.confirm).not.toHaveBeenCalled();

      target.toggleIndex('logs');
      await target.apply();
      expect(target.fieldError('query', 'warn')).toBe(
        'Elasticsearch does not accept fractions: use a smaller unit, such as 1500ms for 1.5s',
      );
      expect(dialogs.confirm).not.toHaveBeenCalled();
      expect(post.mock.calls.some(([path]) => path === 'index_settings/bulk_update')).toBe(false);
    });

    it('resets every slow log setting of the selected indices', async () => {
      const target = await slowLogs();
      await target.edit(target.rows()![0]!);
      dialogs.confirm.mockResolvedValue(true);
      await target.resetSelected();
      expect(dialogs.confirm).toHaveBeenCalledWith(expect.objectContaining({ tone: 'danger', confirmLabel: 'Reset to defaults' }));
      const call = post.mock.calls.find(([path]) => path === 'index_settings/bulk_update');
      const settings = (call?.[1] as { settings: Record<string, unknown> }).settings;
      expect(Object.keys(settings)).toHaveLength(15);
      expect(Object.values(settings).every((value) => value === null)).toBe(true);
      expect(target.form().thresholds.query.warn).toBe('');
      expect(alerts.success).toHaveBeenCalledWith('Slow logs of 1 index reset to the defaults');
      expect(target.rows()?.map((row) => row.index)).toEqual(['tmp-performance-b']);
    });

    it('hides the editor while nothing could be loaded', async () => {
      routes({
        'performance/slowlog': new ClusterApiError(502, { error: { reason: 'connection refused' } }),
        'commons/indices': new ClusterApiError(502, { error: { reason: 'connection refused' } }),
      });
      fixture = await render(SlowLogsComponent);
      const target = fixture.componentInstance;
      await vi.waitFor(() => expect(target.loadError()).toBe('Connection refused'));
      await vi.waitFor(() => expect(target.indicesError()).toBeDefined());
      expect(target.showEditor()).toBe(false);
      fixture.detectChanges();
      expect((fixture.nativeElement as HTMLElement).querySelector('.slowlog-editor')).toBeNull();
    });

    it('asks before dropping unsaved edits', async () => {
      const target = await slowLogs();
      expect(await target.confirmDiscard()).toBe(true);
      target.applyPreset('moderate');
      dialogs.confirm.mockResolvedValue(false);
      expect(await target.confirmDiscard()).toBe(false);
      await target.edit(target.rows()![0]!);
      expect(target.selected().size).toBe(0);
    });

    it('selects matching indices from the filter', async () => {
      const target = await slowLogs();
      target.pickerQuery.set('^tmp-');
      target.selectShown();
      expect(target.selectedList()).toEqual(['tmp-performance-a', 'tmp-performance-b']);
      target.pickerQuery.set('logs');
      expect(target.hiddenSelected()).toBe(2);
      expect(target.pickerGroups()).toEqual({ regular: ['logs'], backing: [], system: [] });
    });
  });

  describe('PerformanceComponent', () => {
    it('lets the shared directive scroll its tab strip', async () => {
      routes({ nodes: NODES, 'performance/hot_threads': BUSY_CPU_CAPTURE });
      const fixture = TestBed.createComponent(PerformanceComponent);
      await fixture.whenStable();
      const strip = fixture.debugElement.query(By.directive(ScrollTabsDirective));
      expect(strip.attributes['role']).toBe('tablist');
      expect(strip.queryAll(By.css('[role="tab"]'))).toHaveLength(4);
    });
  });
});
