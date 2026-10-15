import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { ClusterApiService } from './cluster-api.service';
import { ClusterStatusService } from './cluster-status.service';
import { ConnectionService } from './connection.service';
import { RefreshService } from './refresh.service';

describe('ClusterStatusService', () => {
  function setup(post: ReturnType<typeof vi.fn>) {
    const host = signal<string | undefined>('http://localhost:9200');
    TestBed.configureTestingModule({
      providers: [
        { provide: ClusterApiService, useValue: { post } },
        { provide: ConnectionService, useValue: { host, connected: () => host() !== undefined } },
        { provide: RefreshService, useValue: { tick: signal(0) } },
      ],
    });
    const service = TestBed.inject(ClusterStatusService);
    return { service, host };
  }

  it('shows the name and health the cluster answered', async () => {
    const post = vi.fn().mockResolvedValue({ cluster_name: 'cerebro-demo', status: 'yellow', username: 'elastic' });
    const { service } = setup(post);
    TestBed.tick();
    await vi.waitFor(() => expect(service.clusterName()).toBe('cerebro-demo'));

    expect(service.status()).toBe('yellow');
    expect(service.username()).toBe('elastic');
    expect(service.displayName()).toBe('cerebro-demo');
  });

  it('drops the previous cluster as soon as the host changes', async () => {
    const post = vi
      .fn()
      .mockResolvedValueOnce({ cluster_name: 'cerebro-demo', status: 'green', username: 'elastic' })
      .mockRejectedValue(new Error('Connection refused'));
    const { service, host } = setup(post);
    TestBed.tick();
    await vi.waitFor(() => expect(service.clusterName()).toBe('cerebro-demo'));

    host.set('http://localhost:9299');
    TestBed.tick();

    expect(service.clusterName()).toBeUndefined();
    expect(service.status()).toBeUndefined();
    expect(service.username()).toBeUndefined();
    expect(service.displayName()).toBe('http://localhost:9299');
    await vi.waitFor(() => expect(service.reachable()).toBe(false));
    expect(service.displayName()).toBe('http://localhost:9299');
  });

  it('keeps the name while the same cluster is briefly unreachable', async () => {
    const post = vi
      .fn()
      .mockResolvedValueOnce({ cluster_name: 'cerebro-demo', status: 'green' })
      .mockRejectedValue(new Error('timeout'));
    const host = signal<string | undefined>('http://localhost:9200');
    const tick = signal(0);
    TestBed.configureTestingModule({
      providers: [
        { provide: ClusterApiService, useValue: { post } },
        { provide: ConnectionService, useValue: { host, connected: () => true } },
        { provide: RefreshService, useValue: { tick } },
      ],
    });
    const service = TestBed.inject(ClusterStatusService);
    TestBed.tick();
    await vi.waitFor(() => expect(service.clusterName()).toBe('cerebro-demo'));

    tick.set(1);
    TestBed.tick();
    await vi.waitFor(() => expect(service.reachable()).toBe(false));
    expect(service.clusterName()).toBe('cerebro-demo');
  });
});
