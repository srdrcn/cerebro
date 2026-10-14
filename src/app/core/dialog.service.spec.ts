import { TestBed } from '@angular/core/testing';
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
});
