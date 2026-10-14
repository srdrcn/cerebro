import { TestBed } from '@angular/core/testing';
import { AlertService } from './alert.service';

describe('AlertService', () => {
  it('keeps the newest three alerts', () => {
    const service = TestBed.inject(AlertService);

    service.info('one', undefined, 0);
    service.warn('two', undefined, 0);
    service.error('three', undefined, 0);
    service.success('four', undefined, 0);

    expect(service.alerts().map((alert) => alert.message)).toEqual([
      'four',
      'three',
      'two',
    ]);
  });

  it('renders response values as plain JSON text', () => {
    const service = TestBed.inject(AlertService);
    expect(service.formatResponse({ value: '<script>unsafe()</script>' })).toBe(
      '{\n  "value": "<script>unsafe()</script>"\n}',
    );
  });
});
