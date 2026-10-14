import { DOCUMENT } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { RefreshService } from './refresh.service';

describe('RefreshService', () => {
  it('starts at 15 seconds and refreshes immediately when shortened', () => {
    const setTimeout = vi.fn().mockReturnValue(7);
    const clearTimeout = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        {
          provide: DOCUMENT,
          useValue: {
            defaultView: { setTimeout, clearTimeout },
          } as unknown as Document,
        },
      ],
    });

    const service = TestBed.inject(RefreshService);
    const initialTick = service.tick();
    expect(service.interval()).toBe(15_000);
    expect(setTimeout).toHaveBeenCalledWith(expect.any(Function), 15_000);

    service.setInterval(5_000);

    expect(service.interval()).toBe(5_000);
    expect(service.tick()).toBeGreaterThan(initialTick);
    expect(clearTimeout).toHaveBeenCalledWith(7);
    expect(setTimeout).toHaveBeenLastCalledWith(expect.any(Function), 5_000);
  });

  it('rejects unsupported intervals', () => {
    const service = TestBed.inject(RefreshService);
    expect(() => service.setInterval(2_000)).toThrow(RangeError);
  });
});
