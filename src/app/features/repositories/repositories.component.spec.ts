import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AlertService } from '../../core/alert.service';
import { ClusterApiService } from '../../core/cluster-api.service';
import { DialogService } from '../../core/dialog.service';
import { RepositoriesComponent } from './repositories.component';
import { RepositoryRecord } from './repositories.models';

const local: RepositoryRecord = {
  name: 'local',
  type: 'fs',
  settings: { location: '/snap/local', compress: 'true', max_number_of_snapshots: '50' },
};
const cloud: RepositoryRecord = { name: 'cloud', type: 's3', settings: { bucket: 'backups' } };

describe('RepositoriesComponent', () => {
  const post = vi.fn();
  const alerts = { error: vi.fn(), success: vi.fn(), info: vi.fn(), warn: vi.fn() };
  const dialogs = { confirm: vi.fn(), showJson: vi.fn() };

  beforeEach(() => {
    post.mockReset();
    Object.values(alerts).forEach((mock) => mock.mockReset());
    dialogs.confirm.mockReset();
    dialogs.showJson.mockReset();
    post.mockImplementation(async (path: string) => (path === 'repositories' ? [local, cloud] : { acknowledged: true }));
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: ClusterApiService, useValue: { post } },
        { provide: AlertService, useValue: alerts },
        { provide: DialogService, useValue: dialogs },
      ],
    });
  });

  function component(): RepositoriesComponent {
    return TestBed.runInInjectionContext(() => new RepositoriesComponent());
  }

  it('lists repositories by name with their location', async () => {
    const target = component();
    await target.load();

    expect(target.views().map((view) => [view.record.name, view.summary])).toEqual([
      ['cloud', 'backups'],
      ['local', '/snap/local'],
    ]);
  });

  it('opens the repository named in ?repository=', async () => {
    await TestBed.inject(Router).navigateByUrl('/?repository=local');
    const target = component();
    await target.load();

    expect(target.editing()).toBe('local');
    expect(alerts.warn).not.toHaveBeenCalled();
  });

  it('reports an unknown ?repository= and drops it from the URL', async () => {
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/?repository=gone&host=h');
    const target = component();
    await target.load();

    expect(target.editing()).toBeNull();
    expect(alerts.warn).toHaveBeenCalledWith('Repository gone does not exist');
    await vi.waitFor(() => expect(router.url).toBe('/?host=h'));
  });

  it('loads a repository into the form with typed values and extra settings', async () => {
    const target = component();
    await target.load();

    target.edit(local);

    expect(target.updateMode()).toBe(true);
    expect(target.type()).toBe('fs');
    expect(target.booleanValue('compress')).toBe('true');
    expect(target.textValue('location')).toBe('/snap/local');
    expect(target.extras().map(({ key, value }) => ({ key, value }))).toEqual([
      { key: 'max_number_of_snapshots', value: '50' },
    ]);
  });

  it('registers a new repository without asking for confirmation', async () => {
    const target = component();
    await target.load();

    target.setName('nightly');
    target.setType('fs');
    target.setText('location', '/snap/nightly');
    target.setBoolean('compress', 'false');
    await target.save();

    expect(dialogs.confirm).not.toHaveBeenCalled();
    expect(post).toHaveBeenCalledWith('repositories/create', {
      name: 'nightly',
      type: 'fs',
      settings: { location: '/snap/nightly', compress: false },
    });
    expect(alerts.success).toHaveBeenCalledWith('Repository nightly registered', { acknowledged: true });
  });

  it('confirms updates with the list of changes and keeps extra settings', async () => {
    const target = component();
    await target.load();
    target.edit(local);
    target.setText('location', '/snap/moved');
    target.setBoolean('compress', '');

    dialogs.confirm.mockResolvedValueOnce(false);
    await target.save();
    expect(dialogs.confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Update repository local?',
        items: ['compress: removed', 'location: /snap/local → /snap/moved'],
        confirmLabel: 'Update repository',
      }),
    );
    expect(post).not.toHaveBeenCalledWith('repositories/create', expect.anything());

    dialogs.confirm.mockResolvedValueOnce(true);
    await target.save();
    expect(post).toHaveBeenCalledWith('repositories/create', {
      name: 'local',
      type: 'fs',
      settings: { location: '/snap/moved', max_number_of_snapshots: '50' },
    });
  });

  it('keeps settings shared by the new type when the type changes', () => {
    const target = component();
    target.setType('fs');
    target.setText('location', '/snap/x');
    target.setText('chunk_size', '10m');

    target.setType('s3');

    expect(target.settings()).toEqual({ chunk_size: '10m' });
  });

  it('does not submit an invalid form', async () => {
    const target = component();
    await target.load();
    target.setName('bad name');
    const nameField = document.body.appendChild(document.createElement('input'));
    nameField.id = 'repository-name';
    try {
      await target.save();

      expect(target.submitted()).toBe(true);
      expect(target.nameError()).toMatch(/spaces/);
      expect(target.typeError()).not.toBeNull();
      expect(document.activeElement).toBe(nameField);
      expect(post).not.toHaveBeenCalledWith('repositories/create', expect.anything());
    } finally {
      nameField.remove();
    }
  });

  it('offers "New repository" only when the form is not already blank', async () => {
    const target = component();
    await target.load();
    expect(target.blankForm()).toBe(true);
    target.edit(local);
    expect(target.blankForm()).toBe(false);
    target.newRepository(false);
    expect(target.blankForm()).toBe(true);
  });

  it('deletes after a danger confirmation and clears the form of the deleted repository', async () => {
    const target = component();
    await target.load();
    target.edit(cloud);

    dialogs.confirm.mockResolvedValueOnce(true);
    await target.remove(cloud);

    expect(dialogs.confirm).toHaveBeenCalledWith(
      expect.objectContaining({ tone: 'danger', confirmLabel: 'Delete repository' }),
    );
    expect(post).toHaveBeenCalledWith('repositories/delete', { name: 'cloud' });
    expect(target.editing()).toBeNull();
    expect(target.name()).toBe('');
  });

  it('keeps the open repository in the URL', async () => {
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/?host=h');
    const target = component();
    await target.load();

    await target.select(local);
    await vi.waitFor(() => expect(router.url).toBe('/?host=h&repository=local'));

    await target.startNew();
    await vi.waitFor(() => expect(router.url).toBe('/?host=h'));
  });

  it('tracks unsaved edits against the opened repository', async () => {
    const target = component();
    await target.load();
    expect(target.dirty()).toBe(false);

    target.setType('fs');
    expect(target.dirty()).toBe(true);

    target.edit(local);
    expect(target.dirty()).toBe(false);
    target.setText('location', '/snap/moved');
    expect(target.dirty()).toBe(true);
    target.setText('location', '/snap/local');
    expect(target.dirty()).toBe(false);
    // An empty extra row or a cleared optional field is not a change.
    target.addExtra();
    target.setText('chunk_size', '');
    expect(target.dirty()).toBe(false);
  });

  it('asks before dropping unsaved edits and keeps them when declined', async () => {
    const target = component();
    await target.load();
    target.edit(local);
    target.setText('location', '/snap/moved');

    dialogs.confirm.mockResolvedValueOnce(false);
    await target.select(cloud);
    expect(dialogs.confirm).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Discard unsaved changes?', tone: 'danger', confirmLabel: 'Discard changes' }),
    );
    expect(target.editing()).toBe('local');
    expect(target.textValue('location')).toBe('/snap/moved');

    dialogs.confirm.mockResolvedValueOnce(true);
    await target.startNew();
    expect(target.editing()).toBeNull();
    expect(await target.confirmDiscard()).toBe(true);
    expect(dialogs.confirm).toHaveBeenCalledTimes(2);
  });

  it('asks the browser to confirm closing the tab only while edits are pending', () => {
    const target = component();
    const clean = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent;
    target.onBeforeUnload(clean);
    expect(clean.defaultPrevented).toBe(false);

    target.setName('nightly');
    const dirty = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent;
    target.onBeforeUnload(dirty);
    expect(dirty.defaultPrevented).toBe(true);
  });

  it('masks secrets in the request preview', () => {
    const target = component();
    target.setName('s3');
    target.setType('s3');
    target.setText('secret_key', 'hunter2');

    expect(target.preview()).toContain('PUT _snapshot/s3');
    expect(target.preview()).not.toContain('hunter2');
  });
});
