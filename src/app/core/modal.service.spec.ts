import { TestBed } from '@angular/core/testing';
import { ModalService } from './modal.service';

describe('ModalService', () => {
  it('resolves a confirmation only after accepting it', async () => {
    const service = TestBed.inject(ModalService);
    const result = service.confirm('Delete the selected index?');

    expect(service.state()).toEqual({
      kind: 'confirmation',
      message: 'Delete the selected index?',
    });

    service.accept();
    await expect(result).resolves.toBe(true);
    expect(service.state()).toBeUndefined();
  });

  it('resolves a dismissed confirmation as false', async () => {
    const service = TestBed.inject(ModalService);
    const result = service.confirm('Continue?');

    service.close();

    await expect(result).resolves.toBe(false);
  });

  it('stores JSON as text rather than trusted HTML', () => {
    const service = TestBed.inject(ModalService);
    service.showJson('Response', { html: '<img src=x onerror=alert(1)>' });

    expect(service.state()).toEqual({
      kind: 'json',
      title: 'Response',
      text: '{\n  "html": "<img src=x onerror=alert(1)>"\n}',
    });
  });
});
