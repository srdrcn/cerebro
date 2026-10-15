import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AlertService } from '../../core/alert.service';
import { ClusterApiError } from '../../core/api-envelope';
import { ClusterApiService } from '../../core/cluster-api.service';
import { CatComponent } from './cat.component';

describe('CatComponent', () => {
  const post = vi.fn();
  const alerts = { error: vi.fn(), success: vi.fn() };

  beforeEach(() => {
    post.mockReset();
    alerts.error.mockReset();
    alerts.success.mockReset();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: ClusterApiService, useValue: { post } },
        { provide: AlertService, useValue: alerts },
      ],
    });
  });

  function component(): CatComponent {
    return TestBed.runInInjectionContext(() => new CatComponent());
  }

  it('converts spaces to underscores and derives all returned columns', async () => {
    post.mockResolvedValue([{ node: 'a', queue: '2' }, { node: 'b', queue: '10', extra: 'x' }]);
    const target = component();

    await target.load('thread pool');

    expect(post).toHaveBeenCalledWith('cat', { api: 'thread_pool' });
    const result = target.result();
    expect(result?.api).toBe('thread pool');
    expect(result?.columns).toEqual(['node', 'queue', 'extra']);
    expect([...(result?.numeric ?? [])]).toEqual(['queue']);
    expect(target.failure()).toBeNull();
  });

  it('never shows the rows of another API after a failed request', async () => {
    post.mockResolvedValueOnce([{ name: 'old' }]);
    const target = component();
    await target.load('nodes');

    post.mockRejectedValueOnce(new ClusterApiError(500, { error: 'kaput' }));
    await target.load('indices');

    expect(target.result()).toBeNull();
    expect(target.failure()).toEqual({ api: 'indices', reason: 'Kaput' });
    expect(alerts.error).toHaveBeenCalledOnce();
  });

  it('keeps the last rows of the same API when a refresh fails', async () => {
    post.mockResolvedValueOnce([{ name: 'kept' }]);
    const target = component();
    await target.load('nodes');

    post.mockRejectedValueOnce(new Error('offline'));
    await target.load('nodes', true);

    expect(target.result()?.rows).toEqual([{ name: 'kept' }]);
    expect(target.failure()).toEqual({ api: 'nodes', reason: 'Offline' });
    expect(target.manualLoading()).toBe(false);
  });

  it('ignores responses that arrive after a newer request', async () => {
    let resolveSlow: (value: unknown) => void = () => undefined;
    post.mockImplementationOnce(() => new Promise((resolve) => (resolveSlow = resolve)));
    post.mockResolvedValueOnce([{ name: 'fresh' }]);
    const target = component();

    const slow = target.load('nodes');
    await target.load('shards');
    resolveSlow([{ name: 'stale' }]);
    await slow;

    expect(target.result()?.api).toBe('shards');
    expect(target.result()?.rows).toEqual([{ name: 'fresh' }]);
    expect(target.loading()).toBe(false);
  });

  it('resets filter, sort and page when switching to another API', async () => {
    post.mockResolvedValue([{ name: 'a', docs: '1' }]);
    const target = component();
    await target.load('indices');
    target.setFilter('a');
    target.sortBy('docs');
    target.page.set(3);

    await target.load('shards');

    expect(target.filter()).toBe('');
    expect(target.sort.field()).toBe('');
    expect(target.page()).toBe(1);
  });

  it('sorts numeric columns descending and text columns ascending first', async () => {
    post.mockResolvedValue([{ name: 'a', docs: '1' }]);
    const target = component();
    await target.load('indices');

    target.sortBy('docs');
    expect(target.sort.ariaSort('docs')).toBe('descending');
    target.sortBy('docs');
    expect(target.sort.ariaSort('docs')).toBe('ascending');
    target.sortBy('name');
    expect(target.sort.ariaSort('name')).toBe('ascending');
    expect(target.sort.ariaSort('docs')).toBe('none');
  });

  it('shows a record only for single-row APIs and copies the whole record', async () => {
    const router = TestBed.inject(Router);
    const target = component();

    await router.navigate([], { queryParams: { api: 'pending_tasks' } });
    post.mockResolvedValueOnce([{ source: 'create-index [x]', priority: 'URGENT' }]);
    await target.load('pending tasks');
    // One pending task is still a sortable, filterable table row.
    expect(target.current()?.api).toBe('pending tasks');
    expect(target.record()).toBeNull();
    target.setFilter('no-such-task');
    expect(target.copyRows()).toEqual([]);

    await router.navigate([], { queryParams: { api: 'health' } });
    post.mockResolvedValueOnce([{ cluster: 'demo', status: 'green' }]);
    await target.load('health');
    expect(target.record()).toEqual({ cluster: 'demo', status: 'green' });

    // A filter has no effect on what a record copies.
    target.setFilter('no-such-value');
    expect(target.copyRows()).toEqual([{ cluster: 'demo', status: 'green' }]);
  });
});
