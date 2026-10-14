import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AlertService } from '../../core/alert.service';
import { ClusterApiService } from '../../core/cluster-api.service';
import { DialogService } from '../../core/dialog.service';
import { ClusterSettingsComponent } from './cluster-settings.component';
import { buildClusterSettingRows } from './cluster-settings.models';

describe('ClusterSettingsComponent', () => {
  const alerts = { error: vi.fn(), success: vi.fn(), info: vi.fn(), warn: vi.fn() };
  const dialogs = { confirm: vi.fn(), showJson: vi.fn() };

  beforeEach(() => {
    Object.values(alerts).forEach((mock) => mock.mockReset());
    dialogs.confirm.mockReset();
    dialogs.confirm.mockResolvedValue(false);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: ClusterApiService, useValue: { post: vi.fn(async () => ({})) } },
        { provide: AlertService, useValue: alerts },
        { provide: DialogService, useValue: dialogs },
      ],
    });
  });

  function component(): ClusterSettingsComponent {
    const target = TestBed.runInInjectionContext(() => new ClusterSettingsComponent());
    target.rows.set(
      buildClusterSettingRows({ defaults: { cluster: { routing: { allocation: { enable: 'all' } } } } }),
    );
    return target;
  }

  it('lets the route leave without a dialog when nothing is pending', async () => {
    await expect(component().confirmDiscard()).resolves.toBe(true);
    expect(dialogs.confirm).not.toHaveBeenCalled();
  });

  it('asks once before discarding pending edits and lists them', async () => {
    const target = component();
    target.drafts.set({ 'cluster.routing.allocation.enable': { value: 'primaries', scope: 'persistent' } });

    await expect(target.confirmDiscard()).resolves.toBe(false);

    expect(dialogs.confirm).toHaveBeenCalledTimes(1);
    expect(dialogs.confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Discard unsaved changes?',
        tone: 'danger',
        items: ['cluster.routing.allocation.enable'],
      }),
    );
  });
});
