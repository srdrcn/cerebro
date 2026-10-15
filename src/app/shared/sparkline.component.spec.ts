import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import {
  SPARK_PADDING,
  SparkPoint,
  SparklineComponent,
  SparklineTone,
  sparklineGeometry,
  sparklineSummary,
} from './sparkline.component';

const MINUTE = 60_000;

function points(...values: (number | null)[]): SparkPoint[] {
  return values.map((value, index) => ({ time: index * 15_000, value }));
}

describe('sparklineGeometry', () => {
  it('spreads points over time and scales values from zero to the largest', () => {
    const geometry = sparklineGeometry(points(0, 5, 10), 26);

    expect(geometry.max).toBe(10);
    expect(geometry.coordinates.map((c) => [c.x, c.y])).toEqual([
      [0, 26 - SPARK_PADDING],
      [50, 13],
      [100, SPARK_PADDING],
    ]);
    expect(geometry.line).toBe('M0 23 L50 13 L100 3');
    expect(geometry.area).toBe('M0 23 L0 23 L50 13 L100 3 L100 23 Z');
  });

  it('places points by time, not by position', () => {
    const geometry = sparklineGeometry(
      [
        { time: 0, value: 1 },
        { time: 10_000, value: 1 },
        { time: 40_000, value: 1 },
      ],
      20,
    );
    expect(geometry.coordinates.map((c) => c.x)).toEqual([0, 25, 100]);
  });

  it('starts at the first value and ends at the latest sample', () => {
    const geometry = sparklineGeometry(points(null, 2, 4, null, null), 20);
    // Values at 15s and 30s of a window that runs from 15s to 60s.
    expect(geometry.coordinates.map((c) => c.x)).toEqual([0, 33.33]);
  });

  it('uses a fixed domain for percentages unless the data exceeds it', () => {
    expect(sparklineGeometry(points(50), 26, 100).coordinates[0]?.y).toBe(13);
    expect(sparklineGeometry(points(150), 26, 100).max).toBe(150);
  });

  it('does not stretch small values to full height below the minimum domain', () => {
    // 0.2 gets/s on a chart whose top is at least 1/s: a fifth of the height.
    const geometry = sparklineGeometry(points(0, 0.2), 23, undefined, 1);
    expect(geometry.max).toBe(1);
    expect(geometry.coordinates[1]?.y).toBe(23 - SPARK_PADDING - 0.2 * (23 - 2 * SPARK_PADDING));
    // Larger values still scale to the data.
    expect(sparklineGeometry(points(0, 40), 23, undefined, 1).max).toBe(40);
    expect(sparklineGeometry(points(50), 26, 100, 1).max).toBe(100);
  });

  it('draws a flat line at the bottom for an idle series', () => {
    const geometry = sparklineGeometry(points(0, 0), 20);
    expect(geometry.max).toBe(1);
    expect(geometry.coordinates.every((c) => c.y === 20 - SPARK_PADDING)).toBe(true);
  });

  it('breaks the line at missing values and gaps, with a dot for a lone point', () => {
    const series: SparkPoint[] = [
      { time: 0, value: 1 },
      { time: 1, value: 2 },
      { time: 2, value: null },
      { time: 3, value: 2 },
      { time: 4, value: 1 },
      { time: 5, value: 1, gap: true },
    ];
    const geometry = sparklineGeometry(series, 23);
    const subpaths = geometry.line.split('M').filter(Boolean).map((part) => part.trim());

    expect(subpaths).toHaveLength(3);
    expect(subpaths[2]).toMatch(/h0$/);
    // The lone point has no area under it.
    expect(geometry.area.split('Z').filter((part) => part.trim())).toHaveLength(2);
  });

  it('draws nothing without values and clamps negative values to the baseline', () => {
    expect(sparklineGeometry(points(null, null), 20)).toEqual({ line: '', area: '', coordinates: [], max: 1 });
    expect(sparklineGeometry([], 20).line).toBe('');
    expect(sparklineGeometry(points(-5, 5), 20).coordinates[0]?.y).toBe(20 - SPARK_PADDING);
  });
});

describe('sparklineSummary', () => {
  const format = (value: number) => `${value}/s`;

  it('summarizes the current value and the range over the window', () => {
    const series: SparkPoint[] = [
      { time: 0, value: 4 },
      { time: 2 * MINUTE, value: 12 },
      { time: 5 * MINUTE, value: 7 },
      { time: 5 * MINUTE + 1, value: null },
    ];
    expect(sparklineSummary('Indexing rate', series, format)).toBe(
      'Indexing rate: now 7/s, low 4/s, high 12/s over the last 5m',
    );
  });

  it('reads a single value or no data', () => {
    expect(sparklineSummary('Heap', points(null, 40), (value) => `${value}%`)).toBe('Heap: 40%');
    expect(sparklineSummary('Heap', points(null), String)).toBe('Heap: no data yet');
  });
});

@Component({
  imports: [SparklineComponent],
  template: `
    <cerebro-sparkline
      [points]="points()"
      label="Search rate"
      [format]="format"
      [tone]="tone()"
      [height]="30"
      [focusable]="focusable()"
      [dot]="dot()"
    />
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class HostComponent {
  readonly points = signal<readonly SparkPoint[]>(points(1, 3, 2));
  readonly tone = signal<SparklineTone>('accent');
  readonly focusable = signal(true);
  readonly dot = signal(true);
  readonly format = (value: number) => `${value} q/s`;
}

describe('SparklineComponent', () => {
  async function render() {
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    const host = element.querySelector('cerebro-sparkline') as HTMLElement;
    const chart = element.querySelector('.sparkline__chart') as HTMLElement;
    return { fixture, element, host, chart };
  }

  it('is an image with a summary of the window', async () => {
    const { fixture, chart, element } = await render();
    fixture.componentInstance.focusable.set(false);
    await fixture.whenStable();

    expect(chart.getAttribute('role')).toBe('img');
    expect(chart.hasAttribute('aria-describedby')).toBe(false);
    expect(chart.hasAttribute('aria-roledescription')).toBe(false);
    expect(chart.getAttribute('aria-label')).toBe('Search rate: now 2 q/s, low 1 q/s, high 3 q/s over the last 30s');
    expect(chart.style.height).toBe('30px');
    expect(element.querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 100 30');
    expect(element.querySelector('.sparkline__line')?.getAttribute('d')).toBe('M0 19 L50 3 L100 11');
    expect(element.querySelectorAll('.sparkline__dot')).toHaveLength(1);
  });

  it('takes its colour from the tone classes', async () => {
    const { fixture, host } = await render();
    expect(host.className).not.toMatch(/tone-/);

    fixture.componentInstance.tone.set('purple');
    await fixture.whenStable();
    expect(host.classList).toContain('tone-purple');
  });

  it('is a chart in application mode that explains its keys when focusable', async () => {
    const { chart, element } = await render();

    // Screen readers in browse mode pass the arrow keys to an application.
    expect(chart.getAttribute('role')).toBe('application');
    expect(chart.getAttribute('aria-roledescription')).toBe('chart');
    expect(chart.getAttribute('aria-label')).toMatch(/^Search rate: now 2 q\/s/);
    const hint = element.querySelector(`#${chart.getAttribute('aria-describedby')}`);
    expect(hint?.textContent).toMatch(/left and right arrow keys/);
  });

  it('can leave out the end dot (inline sparklines of a few dozen pixels)', async () => {
    const { fixture, element } = await render();
    fixture.componentInstance.dot.set(false);
    await fixture.whenStable();
    expect(element.querySelector('.sparkline__dot')).toBeNull();
  });

  it('walks the points with the keyboard and reads them out', async () => {
    const { fixture, chart, element } = await render();
    expect(chart.tabIndex).toBe(0);

    chart.dispatchEvent(new FocusEvent('focus'));
    await fixture.whenStable();
    expect(element.querySelector('.sparkline__tip strong')?.textContent).toBe('2 q/s');
    expect(element.querySelector('[aria-live]')?.textContent).toMatch(/^2 q\/s at \d\d:\d\d:\d\d$/);

    chart.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    await fixture.whenStable();
    expect(element.querySelector('.sparkline__tip strong')?.textContent).toBe('3 q/s');

    chart.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home' }));
    chart.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    await fixture.whenStable();
    expect(element.querySelector('.sparkline__tip strong')?.textContent).toBe('1 q/s');

    // A new sample keeps the tooltip on the same point in time.
    fixture.componentInstance.points.set([...points(1, 3, 2), { time: 45_000, value: 9 }]);
    await fixture.whenStable();
    expect(element.querySelector('.sparkline__tip strong')?.textContent).toBe('1 q/s');
    fixture.componentInstance.points.set(points(1, 3, 2).slice(1));
    await fixture.whenStable();
    expect(element.querySelector('.sparkline__tip')).toBeNull();

    chart.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await fixture.whenStable();
    expect(element.querySelector('.sparkline__tip')).toBeNull();
  });

  it('shows the value under the pointer', async () => {
    const { fixture, chart, element } = await render();
    chart.getBoundingClientRect = () => ({ left: 0, width: 200, top: 0, height: 30, right: 200, bottom: 30, x: 0, y: 0, toJSON: () => ({}) });

    chart.dispatchEvent(new MouseEvent('pointermove', { clientX: 95 }) as PointerEvent);
    await fixture.whenStable();
    expect(element.querySelector('.sparkline__tip strong')?.textContent).toBe('3 q/s');
    expect(element.querySelector('.sparkline__cursor')?.getAttribute('x1')).toBe('50');

    chart.dispatchEvent(new MouseEvent('pointerleave'));
    await fixture.whenStable();
    expect(element.querySelector('.sparkline__tip')).toBeNull();
  });

  it('is not a tab stop unless asked and has no end dot when the latest sample has no value', async () => {
    const { fixture, chart, element } = await render();
    fixture.componentInstance.focusable.set(false);
    fixture.componentInstance.points.set(points(1, 2, null));
    await fixture.whenStable();

    expect(chart.hasAttribute('tabindex')).toBe(false);
    expect(element.querySelector('[aria-live]')).toBeNull();
    expect(element.querySelector('.sparkline__dot')).toBeNull();
  });
});
