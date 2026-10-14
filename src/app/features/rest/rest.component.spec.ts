import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AlertService } from '../../core/alert.service';
import { ClipboardService } from '../../core/clipboard.service';
import { ClusterApiService } from '../../core/cluster-api.service';
import { ConnectionService } from '../../core/connection.service';
import { RestComponent } from './rest.component';

describe('RestComponent history behavior', () => {
  const post = vi.fn();
  const alerts = {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  };

  beforeEach(() => {
    post.mockReset();
    alerts.error.mockReset();
    alerts.info.mockReset();
    alerts.warn.mockReset();
    TestBed.configureTestingModule({
      imports: [RestComponent],
      providers: [
        { provide: ClusterApiService, useValue: { post } },
        { provide: AlertService, useValue: alerts },
        { provide: ClipboardService, useValue: { copy: vi.fn() } },
        {
          provide: ConnectionService,
          useValue: { host: signal('http://localhost:9200') },
        },
      ],
    });
  });

  function component(): RestComponent {
    return TestBed.runInInjectionContext(() => new RestComponent());
  }

  it('reloads history only after a successful request', async () => {
    post.mockImplementation(async (path: string) => {
      if (path === 'rest/request') {
        return { acknowledged: true };
      }
      if (path === 'rest/history') {
        return [];
      }
      throw new Error(`Unexpected path ${path}`);
    });
    const target = component();
    target.path = '/books/_search';

    await target.execute();

    expect(post).toHaveBeenNthCalledWith(1, 'rest/request', {
      method: 'GET',
      path: '/books/_search',
      data: {},
    });
    expect(post).toHaveBeenNthCalledWith(2, 'rest/history');
  });

  it('shows an error response without reloading history', async () => {
    post.mockRejectedValue({ body: '<script>unsafe()</script>' });
    const target = component();
    target.path = '/books/_search';

    await target.execute();

    expect(post).toHaveBeenCalledTimes(1);
    expect(target.renderedResponse()).toBe('<script>unsafe()</script>');
    expect(alerts.error).toHaveBeenCalledWith(
      'Error executing request',
      { body: '<script>unsafe()</script>' },
    );
  });
});
