import { TestBed } from '@angular/core/testing';
import { AlertService } from './alert.service';

describe('AlertService', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps the newest alerts up to the limit', () => {
    const service = TestBed.inject(AlertService);

    ['one', 'two', 'three', 'four', 'five'].forEach((message) =>
      service.info(message, undefined, 0),
    );

    expect(service.alerts().map((alert) => alert.message)).toEqual([
      'five',
      'four',
      'three',
      'two',
    ]);
  });

  it('folds identical alerts instead of stacking them', () => {
    const service = TestBed.inject(AlertService);

    service.error('Error connecting to the server', { attempt: 1 }, 0);
    service.error('Error connecting to the server', { attempt: 2 }, 0);
    service.warn('Error connecting to the server', undefined, 0);

    const alerts = service.alerts();
    expect(alerts).toHaveLength(2);
    expect(alerts[1]).toMatchObject({
      level: 'error',
      count: 2,
      response: { attempt: 2 },
    });
  });

  it('dismisses alerts after their timeout unless pinned', () => {
    vi.useFakeTimers();
    const service = TestBed.inject(AlertService);

    const transient = service.success('Saved', undefined, 1_000);
    const pinned = service.error('Failed', { reason: 'boom' }, 1_000);
    service.pin(pinned);
    vi.advanceTimersByTime(1_500);

    expect(service.alerts().map((alert) => alert.id)).toEqual([pinned]);
    expect(service.alerts().some((alert) => alert.id === transient)).toBe(false);
  });

  it('renders response values as plain JSON text', () => {
    const service = TestBed.inject(AlertService);
    expect(service.formatResponse({ value: '<script>unsafe()</script>' })).toBe(
      '{\n  "value": "<script>unsafe()</script>"\n}',
    );
  });
});
