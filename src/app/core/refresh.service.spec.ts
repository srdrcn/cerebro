import { DOCUMENT } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import {
  REFRESH_STORAGE_KEY,
  RefreshService,
  refreshIntervalLabel,
} from './refresh.service';

function fakeDocument(hidden = false) {
  const listeners = new Map<string, () => void>();
  const setTimeout = vi.fn().mockReturnValue(7);
  const clearTimeout = vi.fn();
  const document = {
    hidden,
    defaultView: { setTimeout, clearTimeout },
    addEventListener: (type: string, listener: () => void) => listeners.set(type, listener),
    removeEventListener: vi.fn(),
  };
  return { document, listeners, setTimeout, clearTimeout };
}

describe('RefreshService', () => {
  beforeEach(() => localStorage.clear());

  it('starts at 15 seconds and refreshes immediately when shortened', () => {
    const fake = fakeDocument();
    TestBed.configureTestingModule({
      providers: [{ provide: DOCUMENT, useValue: fake.document as unknown as Document }],
    });

    const service = TestBed.inject(RefreshService);
    const initialTick = service.tick();
    expect(service.interval()).toBe(15_000);
    expect(fake.setTimeout).toHaveBeenCalledWith(expect.any(Function), 15_000);

    service.setInterval(5_000);

    expect(service.interval()).toBe(5_000);
    expect(service.tick()).toBeGreaterThan(initialTick);
    expect(fake.clearTimeout).toHaveBeenCalledWith(7);
    expect(fake.setTimeout).toHaveBeenLastCalledWith(expect.any(Function), 5_000);
    expect(localStorage.getItem(REFRESH_STORAGE_KEY)).toBe('5000');
  });

  it('pauses automatic refresh with an interval of 0', () => {
    const fake = fakeDocument();
    TestBed.configureTestingModule({
      providers: [{ provide: DOCUMENT, useValue: fake.document as unknown as Document }],
    });

    const service = TestBed.inject(RefreshService);
    fake.setTimeout.mockClear();
    service.setInterval(0);

    expect(service.paused()).toBe(true);
    expect(fake.setTimeout).not.toHaveBeenCalled();
  });

  it('restores a stored interval', () => {
    localStorage.setItem(REFRESH_STORAGE_KEY, '60000');
    const fake = fakeDocument();
    TestBed.configureTestingModule({
      providers: [{ provide: DOCUMENT, useValue: fake.document as unknown as Document }],
    });

    expect(TestBed.inject(RefreshService).interval()).toBe(60_000);
  });

  it('skips ticks while hidden and catches up when visible again', () => {
    const fake = fakeDocument(true);
    TestBed.configureTestingModule({
      providers: [{ provide: DOCUMENT, useValue: fake.document as unknown as Document }],
    });
    const service = TestBed.inject(RefreshService);
    const initialTick = service.tick();

    const scheduled = fake.setTimeout.mock.calls[0]?.[0] as () => void;
    scheduled();
    expect(service.tick()).toBe(initialTick);

    fake.document.hidden = false;
    fake.listeners.get('visibilitychange')?.();
    expect(service.tick()).toBeGreaterThan(initialTick);
  });

  it('rejects unsupported intervals', () => {
    const service = TestBed.inject(RefreshService);
    expect(() => service.setInterval(2_000)).toThrow(RangeError);
  });

  it('labels intervals for the UI', () => {
    expect(refreshIntervalLabel(0)).toBe('Off');
    expect(refreshIntervalLabel(5_000)).toBe('5s');
    expect(refreshIntervalLabel(60_000)).toBe('1m');
  });
});
