import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AlertService } from '../../core/alert.service';
import { ClusterApiError } from '../../core/api-envelope';
import { ClipboardService } from '../../core/clipboard.service';
import { ClusterApiService } from '../../core/cluster-api.service';
import { ConnectionService } from '../../core/connection.service';
import { DialogService } from '../../core/dialog.service';
import { RefreshService } from '../../core/refresh.service';
import { TasksComponent } from './tasks.component';
import { normalizeTasks } from './tasks.utils';

/** A throttled reindex as `_tasks?detailed` lists it (trimmed). */
const [REINDEX] = normalizeTasks(
  {
    tasks: [
      {
        node: 'I7MELLk0RvSiAPhRW6211Q',
        id: 96204,
        type: 'transport',
        action: 'indices:data/write/reindex',
        description: 'reindex from [tmp-tasks-src] to [tmp-tasks-dst]',
        start_time_in_millis: 1_000,
        running_time_in_nanos: 5_000_000_000,
        cancellable: true,
        cancelled: false,
        headers: {},
      },
    ],
  },
  new Map([['I7MELLk0RvSiAPhRW6211Q', 'es-node-1']]),
);

/** Live answer of `_tasks/<id>/_cancel` (200) when the task's node is unknown. */
const NODE_FAILURES = {
  node_failures: [
    {
      type: 'failed_node_exception',
      reason: 'Failed node [x]',
      caused_by: { type: 'no_such_node_exception', reason: 'No such node [x]' },
    },
  ],
};

describe('TasksComponent cancel', () => {
  const post = vi.fn();
  const alerts = { error: vi.fn(), warn: vi.fn(), success: vi.fn(), info: vi.fn() };
  const confirm = vi.fn();
  const refresh = vi.fn();

  beforeEach(() => {
    post.mockReset();
    confirm.mockReset().mockResolvedValue(true);
    refresh.mockReset();
    Object.values(alerts).forEach((mock) => mock.mockReset());
    TestBed.configureTestingModule({
      providers: [
        { provide: ClusterApiService, useValue: { post } },
        { provide: AlertService, useValue: alerts },
        { provide: DialogService, useValue: { confirm, showJson: vi.fn() } },
        { provide: ClipboardService, useValue: { copyAndNotify: vi.fn() } },
        // Not connected: the page does not load, only the cancel call is exercised.
        { provide: ConnectionService, useValue: { host: signal(undefined), connected: () => false } },
        { provide: RefreshService, useValue: { tick: signal(1), interval: signal(0), paused: signal(true), refresh } },
      ],
    });
  });

  afterEach(() => vi.restoreAllMocks());

  function component(): TasksComponent {
    return TestBed.createComponent(TasksComponent).componentInstance;
  }

  it('confirms success and refreshes the list', async () => {
    post.mockResolvedValue({ nodes: {} });
    const page = component();
    expect(REINDEX).toBeDefined();
    await page.cancel(REINDEX!);

    expect(post).toHaveBeenCalledWith('tasks/cancel', { task_id: 'I7MELLk0RvSiAPhRW6211Q:96204' });
    expect(alerts.success).toHaveBeenCalledTimes(1);
    expect(alerts.error).not.toHaveBeenCalled();
    expect(page.cancelling().size).toBe(0);
    expect(refresh).toHaveBeenCalled();
  });

  it('reports node failures of a 200 answer instead of a success', async () => {
    post.mockResolvedValue(NODE_FAILURES);
    const page = component();
    await page.cancel(REINDEX!);

    expect(alerts.success).not.toHaveBeenCalled();
    expect(alerts.error).toHaveBeenCalledTimes(1);
    expect(alerts.error.mock.calls[0]?.[0]).toMatch(/^Could not cancel Reindex: \S/);
    expect(page.cancelling().size).toBe(0);
  });

  it('reads the failure reason from a refused call', async () => {
    post.mockRejectedValue(new ClusterApiError(500, NODE_FAILURES));
    const page = component();
    await page.cancel(REINDEX!);

    expect(alerts.error).toHaveBeenCalledTimes(1);
    expect(alerts.error.mock.calls[0]?.[0]).toMatch(/^Could not cancel Reindex: \S/);
    expect(page.cancelling().size).toBe(0);
  });

  it('does nothing when the confirmation is declined', async () => {
    confirm.mockResolvedValue(false);
    await component().cancel(REINDEX!);

    expect(post).not.toHaveBeenCalled();
    expect(alerts.error).not.toHaveBeenCalled();
    expect(alerts.success).not.toHaveBeenCalled();
  });
});
