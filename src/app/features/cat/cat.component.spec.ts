import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AlertService } from '../../core/alert.service';
import { ClusterApiService } from '../../core/cluster-api.service';
import { CatComponent } from './cat.component';

describe('CatComponent', () => {
  const post = vi.fn();
  const alerts = { error: vi.fn() };

  beforeEach(() => {
    post.mockReset();
    alerts.error.mockReset();
    TestBed.configureTestingModule({
      imports: [CatComponent],
      providers: [
        { provide: ClusterApiService, useValue: { post } },
        { provide: AlertService, useValue: alerts },
      ],
    });
  });

  function component(): CatComponent {
    return TestBed.runInInjectionContext(() => new CatComponent());
  }

  it('converts spaces to underscores and derives all returned columns', async () => {
    post.mockResolvedValue([{ node: 'a' }, { node: 'b', queue: '2' }]);
    const target = component();
    target.selectedApi = 'thread pool';

    await target.execute();

    expect(post).toHaveBeenCalledWith('cat', { api: 'thread_pool' });
    expect(target.columns()).toEqual(['node', 'queue']);
    expect(target.sortColumn()).toBe('node');
    expect(target.sortDirection()).toBe('desc');
  });

  it('clears stale data when the request fails', async () => {
    post.mockResolvedValueOnce([{ name: 'old' }]);
    const target = component();
    target.selectedApi = 'nodes';
    await target.execute();

    post.mockRejectedValueOnce(new Error('kaput'));
    await target.execute();

    expect(target.rows()).toEqual([]);
    expect(target.columns()).toEqual([]);
    expect(target.executed()).toBe(true);
    expect(alerts.error).toHaveBeenCalledOnce();
  });
});
