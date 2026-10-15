import { TestBed } from '@angular/core/testing';
import { NavigationEnd, NavigationStart, Router, type Event } from '@angular/router';
import { Subject } from 'rxjs';
import { DialogService } from './dialog.service';

describe('DialogService', () => {
  it('resolves a confirmation only after accepting it', async () => {
    const service = TestBed.inject(DialogService);
    const result = service.confirm({
      title: 'Delete index?',
      message: 'This cannot be undone.',
      items: ['logs-1'],
      confirmLabel: 'Delete index',
      tone: 'danger',
    });

    expect(service.state()).toEqual({
      kind: 'confirm',
      title: 'Delete index?',
      message: 'This cannot be undone.',
      items: ['logs-1'],
      confirmLabel: 'Delete index',
      cancelLabel: 'Cancel',
      tone: 'danger',
    });

    service.accept();
    await expect(result).resolves.toBe(true);
    expect(service.state()).toBeUndefined();
  });

  it('accepts a plain string and applies defaults', () => {
    const service = TestBed.inject(DialogService);
    void service.confirm('Continue?');

    expect(service.state()).toMatchObject({
      kind: 'confirm',
      title: 'Continue?',
      confirmLabel: 'Confirm',
      tone: 'default',
      items: [],
    });
  });

  it('resolves a dismissed or replaced confirmation as false', async () => {
    const service = TestBed.inject(DialogService);
    const dismissed = service.confirm('Continue?');
    service.close();
    await expect(dismissed).resolves.toBe(false);

    const replaced = service.confirm('First?');
    service.showJson('Details', {});
    await expect(replaced).resolves.toBe(false);
  });

  it('stores JSON as text rather than trusted HTML', () => {
    const service = TestBed.inject(DialogService);
    service.showJson('Response', { html: '<img src=x onerror=alert(1)>' }, 'subtitle');

    expect(service.state()).toEqual({
      kind: 'json',
      title: 'Response',
      subtitle: 'subtitle',
      text: '{\n  "html": "<img src=x onerror=alert(1)>"\n}',
    });
  });

  describe('on navigation', () => {
    const events = new Subject<Event>();

    beforeEach(() => {
      TestBed.configureTestingModule({ providers: [{ provide: Router, useValue: { events } }] });
    });

    it('closes the dialog of the page being left and declines its confirmation', async () => {
      const service = TestBed.inject(DialogService);
      const result = service.confirm({ title: 'Close index products?', confirmLabel: 'Close index' });

      events.next(new NavigationStart(2, '/overview', 'popstate'));

      await expect(result).resolves.toBe(false);
      expect(service.state()).toBeUndefined();
    });

    it('closes a JSON viewer and leaves dialogs opened later alone', async () => {
      const service = TestBed.inject(DialogService);
      service.showJson('Response', { ok: true });
      events.next(new NavigationStart(2, '/tasks'));
      expect(service.state()).toBeUndefined();

      // A discard-changes guard asks after the navigation started.
      const guard = service.confirm('Discard changes?');
      events.next(new NavigationEnd(2, '/tasks', '/tasks'));
      expect(service.state()).toMatchObject({ kind: 'confirm', title: 'Discard changes?' });
      service.accept();
      await expect(guard).resolves.toBe(true);
    });
  });
});
