import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, ParamMap, Router, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AlertService } from '../../core/alert.service';
import { ClusterApiError } from '../../core/api-envelope';
import { ClusterApiService } from '../../core/cluster-api.service';
import { ConnectionService } from '../../core/connection.service';
import { DialogService } from '../../core/dialog.service';
import { RefreshService } from '../../core/refresh.service';
import { DoctorComponent } from './doctor.component';
import { liveReport } from './doctor.fixtures';

describe('DoctorComponent', () => {
  const post = vi.fn();
  const alerts = { error: vi.fn(), success: vi.fn(), info: vi.fn(), warn: vi.fn() };
  const dialogs = { confirm: vi.fn(), showJson: vi.fn() };
  const host = signal<string | undefined>('http://localhost:9200');
  let params: BehaviorSubject<ParamMap>;

  beforeEach(() => {
    post.mockReset();
    alerts.error.mockReset();
    alerts.success.mockReset();
    dialogs.confirm.mockReset();
    dialogs.showJson.mockReset();
    host.set('http://localhost:9200');
    params = new BehaviorSubject(convertToParamMap({}));
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: ClusterApiService, useValue: { post } },
        { provide: AlertService, useValue: alerts },
        { provide: DialogService, useValue: dialogs },
        { provide: ActivatedRoute, useValue: { queryParamMap: params, snapshot: { queryParamMap: convertToParamMap({}) } } },
        {
          provide: ConnectionService,
          useValue: { host, connected: () => host() !== undefined, hostQuery: () => ({ host: host() ?? null }) },
        },
      ],
    });
  });

  function component(): DoctorComponent {
    const target = TestBed.runInInjectionContext(() => new DoctorComponent());
    TestBed.tick();
    return target;
  }

  it('runs the checks once on landing and announces the verdict', async () => {
    post.mockResolvedValue(liveReport());
    const target = component();

    await vi.waitFor(() => expect(target.report()).toBeDefined());

    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith('doctor');
    expect(target.report()?.counts).toEqual({ critical: 1, warning: 7, info: 2 });
    expect(target.announcement()).toBe(
      'Checks finished. Critical problems found: 1 critical problem and 7 warnings need attention, plus 2 suggestions.',
    );
    expect(target.checkedLabel()).toBe('Checked just now');
    expect(target.running()).toBe(false);
  });

  it('does not re-run on auto refresh ticks', async () => {
    post.mockResolvedValue(liveReport());
    const target = component();
    await vi.waitFor(() => expect(target.report()).toBeDefined());

    TestBed.inject(RefreshService).refresh();
    TestBed.tick();

    expect(post).toHaveBeenCalledTimes(1);
  });

  it('keeps only the latest of overlapping runs', async () => {
    let resolveFirst: (value: unknown) => void = () => undefined;
    post.mockImplementationOnce(() => new Promise((resolve) => (resolveFirst = resolve)));
    const healthy = liveReport();
    healthy['health'].status = 'green';
    post.mockResolvedValueOnce(healthy);
    const target = component();

    await target.run();
    resolveFirst(liveReport());
    await Promise.resolve();

    expect(target.report()?.findings.some((finding) => finding.id === 'cluster-status:yellow')).toBe(false);
    expect(target.running()).toBe(false);
  });

  it('shows an error with the Elasticsearch reason when the cluster does not answer', async () => {
    post.mockRejectedValue(new ClusterApiError(503, { error: { reason: 'master_not_discovered_exception' } }));
    const target = component();

    await vi.waitFor(() => expect(target.loadError()).toBe('Master_not_discovered_exception'));

    expect(target.report()).toBeUndefined();
    expect(alerts.error).not.toHaveBeenCalled();
  });

  it('keeps the last report and raises a toast when a re-run fails', async () => {
    post.mockResolvedValueOnce(liveReport());
    const target = component();
    await vi.waitFor(() => expect(target.report()).toBeDefined());
    const failure = new ClusterApiError(500, { error: { reason: 'boom' } });
    post.mockRejectedValueOnce(failure);

    await target.run();

    expect(target.report()).toBeDefined();
    expect(target.loadError()).toBe('Boom');
    expect(alerts.error).toHaveBeenCalledWith('Could not run the checks: boom', failure);
  });

  it('applies a fix after confirmation, then runs the checks again', async () => {
    post.mockResolvedValue(liveReport());
    dialogs.confirm.mockResolvedValue(true);
    const target = component();
    await vi.waitFor(() => expect(target.report()).toBeDefined());
    const fix = target.report()!.findings.find((finding) => finding.id === 'index-blocks:read-only-allow-delete')!.fixes[0]!;
    post.mockClear();
    post.mockImplementation(async (path: string) => (path === 'doctor' ? liveReport() : { acknowledged: true }));

    await target.applyFix(fix);

    expect(dialogs.confirm).toHaveBeenCalledWith({
      title: 'Remove the read-only block from tmp-doctor-ro?',
      message: expect.stringContaining('Removes index.blocks.read_only_allow_delete'),
      items: [],
      confirmLabel: 'Remove block',
      tone: 'default',
    });
    expect(post.mock.calls.map((call) => call[0])).toEqual(['doctor/index_settings', 'doctor']);
    expect(post.mock.calls[0]?.[1]).toEqual({
      indices: ['tmp-doctor-ro'],
      settings: { 'index.blocks.read_only_allow_delete': null },
    });
    expect(alerts.success).toHaveBeenCalledWith('Removed the read-only block from tmp-doctor-ro', { acknowledged: true });
    expect(target.fixing()).toBeNull();
  });

  it('does nothing when the confirmation is declined', async () => {
    post.mockResolvedValue(liveReport());
    dialogs.confirm.mockResolvedValue(false);
    const target = component();
    await vi.waitFor(() => expect(target.report()).toBeDefined());
    post.mockClear();

    await target.applyFix(target.report()!.findings.find((finding) => finding.fixes.length > 0)!.fixes[0]!);

    expect(post).not.toHaveBeenCalled();
  });

  it('reports a failed fix with the Elasticsearch reason and does not re-run', async () => {
    post.mockResolvedValue(liveReport());
    dialogs.confirm.mockResolvedValue(true);
    const target = component();
    await vi.waitFor(() => expect(target.report()).toBeDefined());
    const fix = target.report()!.findings.find((finding) => finding.id === 'ilm-errors')!.fixes[0]!;
    const failure = new ClusterApiError(403, { error: { reason: 'action [indices:admin/ilm/retry] is unauthorized' } });
    post.mockClear();
    post.mockRejectedValueOnce(failure);

    await target.applyFix(fix);

    expect(alerts.error).toHaveBeenCalledWith(
      'Could not retry the failed step of tmp-doctor-ilm-1: action [indices:admin/ilm/retry] is unauthorized',
      failure,
    );
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('reads the filters from the URL and writes them back', async () => {
    post.mockResolvedValue(liveReport());
    const target = component();
    await vi.waitFor(() => expect(target.report()).toBeDefined());
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    params.next(convertToParamMap({ severity: 'warning', category: 'shards' }));

    expect(target.visibleFindings().map((finding) => finding.id)).toEqual(['impossible-replicas', 'unassigned-shards:replica']);
    expect(target.severityCounts()).toEqual({ critical: 0, warning: 2, info: 1 });

    target.toggleSeverity('critical');
    expect(navigate).toHaveBeenCalledWith([], expect.objectContaining({ queryParams: { severity: 'critical,warning', category: 'shards' }, replaceUrl: true }));
    target.resetFilters();
    expect(target.filtered()).toBe(false);
    expect(target.visibleFindings().length).toBe(10);
  });

  it('shows the raw report', async () => {
    const raw = liveReport();
    post.mockResolvedValue(raw);
    const target = component();
    await vi.waitFor(() => expect(target.report()).toBeDefined());

    target.viewRaw();

    expect(dialogs.showJson).toHaveBeenCalledWith('Cluster doctor report', raw, expect.stringMatching(/^cerebro-demo · \d{4}-/));
  });

  it('runs again for another cluster and drops the old report', async () => {
    post.mockResolvedValue(liveReport());
    const target = component();
    await vi.waitFor(() => expect(target.report()).toBeDefined());
    post.mockImplementation(() => new Promise(() => undefined));

    host.set('http://other:9200');
    TestBed.tick();

    expect(target.report()).toBeUndefined();
    expect(post).toHaveBeenCalledTimes(2);
  });
});
