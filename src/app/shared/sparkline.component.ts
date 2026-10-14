import { ChangeDetectionStrategy, Component, ElementRef, computed, input, signal, viewChild } from '@angular/core';
import { formatDuration, formatTimestamp } from '../core/format';

/** A point of a sparkline; `null` values and `gap` break the line. */
export interface SparkPoint {
  readonly time: number;
  readonly value: number | null;
  /** Not joined to the previous point. */
  readonly gap?: boolean;
}

export type SparklineTone = 'accent' | 'green' | 'yellow' | 'red' | 'blue' | 'purple' | 'gray';

/** A drawn point: `x` in percent of the width, `y` in pixels from the top. */
export interface SparkCoordinate {
  readonly index: number;
  readonly x: number;
  readonly y: number;
  readonly time: number;
  readonly value: number;
}

export interface SparkGeometry {
  /** SVG path of the line (one subpath per unbroken run). */
  readonly line: string;
  /** SVG path of the area under the line. */
  readonly area: string;
  readonly coordinates: readonly SparkCoordinate[];
  /** Top of the y axis (the bottom is 0). */
  readonly max: number;
}

/** Room kept above and below the line so the stroke and end dot are not clipped. */
export const SPARK_PADDING = 3;

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Geometry of a sparkline in a `0 0 100 height` view box: x follows time
 * (oldest at 0, newest at 100), y starts at zero so a flat rate does not look
 * like a spike, and tops out at `domainMax` (100 for percentages) or the
 * largest value, but never below `minDomain` (so 0.2 gets/s of noise is not
 * drawn full height).
 */
export function sparklineGeometry(
  points: readonly SparkPoint[],
  height: number,
  domainMax?: number,
  minDomain?: number,
): SparkGeometry {
  const present = points
    .map((point, index) => ({ point, index }))
    .filter((entry): entry is { point: SparkPoint & { value: number }; index: number } =>
      entry.point.value !== null && Number.isFinite(entry.point.value),
    );
  const largest = present.reduce((max, entry) => Math.max(max, entry.point.value), 0);
  const floor = minDomain !== undefined && minDomain > 0 ? minDomain : 0;
  const max =
    domainMax !== undefined && domainMax >= largest ? domainMax : Math.max(largest, floor) > 0 ? Math.max(largest, floor) : 1;
  // From the first value (a rate has none at the first sample) to the latest
  // sample, so a series that just stopped reporting ends short of the edge.
  const first = present[0]?.point.time ?? 0;
  const last = Math.max(first, points[points.length - 1]?.time ?? first);
  const span = last - first;
  const bottom = height - SPARK_PADDING;
  const usable = Math.max(1, height - 2 * SPARK_PADDING);
  const coordinates = present.map(({ point, index }): SparkCoordinate => ({
    index,
    x: round(span > 0 ? ((point.time - first) / span) * 100 : 100),
    y: round(bottom - (Math.max(0, point.value) / max) * usable),
    time: point.time,
    value: point.value,
  }));

  const runs: SparkCoordinate[][] = [];
  let previousIndex = -2;
  for (const coordinate of coordinates) {
    const point = points[coordinate.index];
    const joined = coordinate.index === previousIndex + 1 && !point?.gap;
    if (joined && runs.length > 0) {
      runs[runs.length - 1]?.push(coordinate);
    } else {
      runs.push([coordinate]);
    }
    previousIndex = coordinate.index;
  }

  const line = runs
    .map((run) => run.map((c, position) => `${position === 0 ? 'M' : 'L'}${c.x} ${c.y}`).join(' ') + (run.length === 1 ? ' h0' : ''))
    .join(' ');
  const area = runs
    .filter((run) => run.length > 1)
    .map((run) => {
      const start = run[0]!;
      const end = run[run.length - 1]!;
      return `M${start.x} ${bottom} ${run.map((c) => `L${c.x} ${c.y}`).join(' ')} L${end.x} ${bottom} Z`;
    })
    .join(' ');
  return { line, area, coordinates, max };
}

/** "now 23.4/s, low 0/s, high 45.1/s over the last 5m". */
export function sparklineSummary(
  label: string,
  points: readonly SparkPoint[],
  format: (value: number) => string,
): string {
  const values = points.map((point) => point.value).filter((value): value is number => value !== null);
  if (values.length === 0) {
    return `${label}: no data yet`;
  }
  const latest = [...points].reverse().find((point) => point.value !== null);
  const now = format(latest?.value ?? 0);
  if (values.length === 1) {
    return `${label}: ${now}`;
  }
  const first = points.find((point) => point.value !== null)?.time ?? 0;
  const span = formatDuration((latest?.time ?? first) - first);
  return `${label}: now ${now}, low ${format(Math.min(...values))}, high ${format(Math.max(...values))} over the last ${span}`;
}

let nextId = 0;

/**
 * Small SVG line + area chart of a series with gaps, for live metrics. It
 * fills the width of its host at a fixed height and uses the token colours
 * of `tone`. Hovering shows the value under the pointer. A plain sparkline is
 * an image (`role="img"` with a now/low/high summary); with `focusable` it is
 * a tab stop in application mode (so screen readers in browse mode pass the
 * arrow keys through), whose arrow keys walk the points and a live region
 * reads them out.
 *
 *   <cerebro-sparkline [points]="series" label="Indexing rate" [format]="rate" tone="blue" />
 */
@Component({
  selector: 'cerebro-sparkline',
  host: {
    class: 'sparkline',
    '[class.tone-green]': 'tone() === "green"',
    '[class.tone-yellow]': 'tone() === "yellow"',
    '[class.tone-red]': 'tone() === "red"',
    '[class.tone-blue]': 'tone() === "blue"',
    '[class.tone-purple]': 'tone() === "purple"',
    '[class.tone-gray]': 'tone() === "gray"',
    '[class.has-value]': 'showValue()',
  },
  template: `
    <div
      #chart
      class="sparkline__chart"
      [attr.role]="focusable() ? 'application' : 'img'"
      [attr.aria-roledescription]="focusable() ? 'chart' : null"
      [attr.aria-label]="summary()"
      [attr.aria-describedby]="focusable() ? hintId : null"
      [attr.tabindex]="focusable() ? 0 : null"
      [style.height.px]="height()"
      (pointermove)="onPointer($event)"
      (pointerleave)="clear()"
      (focus)="onFocus()"
      (blur)="clear()"
      (keydown)="onKey($event)"
    >
      <svg [attr.viewBox]="'0 0 100 ' + height()" preserveAspectRatio="none" aria-hidden="true" focusable="false">
        <line class="sparkline__base" x1="0" x2="100" [attr.y1]="baseline()" [attr.y2]="baseline()" vector-effect="non-scaling-stroke" />
        @if (geometry().area) {
          <path class="sparkline__area" [attr.d]="geometry().area" />
        }
        @if (geometry().line) {
          <path class="sparkline__line" [attr.d]="geometry().line" vector-effect="non-scaling-stroke" />
        }
        @if (active(); as point) {
          <line class="sparkline__cursor" [attr.x1]="point.x" [attr.x2]="point.x" y1="0" [attr.y2]="height()" vector-effect="non-scaling-stroke" />
        }
      </svg>
      @if (active() ?? (dot() ? end() : undefined); as point) {
        <span class="sparkline__dot" [class.is-active]="active() !== undefined" [style.left.%]="point.x" [style.top.px]="point.y" aria-hidden="true"></span>
      }
      @if (active(); as point) {
        <span
          class="sparkline__tip"
          [class.is-start]="point.x < 25"
          [class.is-end]="point.x > 75"
          [style.left.%]="point.x"
          aria-hidden="true"
        >
          <strong>{{ format()(point.value) }}</strong>
          <span>{{ timeLabel(point.time) }}</span>
        </span>
      }
    </div>
    @if (showValue()) {
      <span class="sparkline__value">{{ end() ? format()(end()!.value) : '–' }}</span>
    }
    @if (focusable()) {
      <span class="visually-hidden" [id]="hintId">Use the left and right arrow keys to read each sample, Home and End for the first and latest.</span>
      <span class="visually-hidden" aria-live="polite">{{ announcement() }}</span>
    }
  `,
  styles: `
    :host {
      --spark: var(--tone, var(--accent));
      position: relative;
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
    }

    .sparkline__chart {
      position: relative;
      flex: 1;
      min-width: 0;
      border-radius: var(--radius-xs);
      touch-action: pan-y;
    }

    .sparkline__chart:focus-visible {
      outline: none;
      box-shadow: var(--focus-ring);
    }

    svg {
      display: block;
      width: 100%;
      height: 100%;
      overflow: visible;
    }

    .sparkline__base {
      stroke: var(--border);
      stroke-width: 1;
    }

    .sparkline__area {
      fill: var(--spark);
      opacity: 0.12;
    }

    .sparkline__line {
      fill: none;
      stroke: var(--spark);
      stroke-linecap: round;
      stroke-linejoin: round;
      stroke-width: 1.75;
    }

    .sparkline__cursor {
      stroke: var(--text-3);
      stroke-width: 1;
    }

    .sparkline__dot {
      position: absolute;
      width: 7px;
      height: 7px;
      border: 2px solid var(--surface);
      border-radius: var(--radius-full);
      background: var(--spark);
      box-sizing: content-box;
      transform: translate(-50%, -50%);
      pointer-events: none;
    }

    .sparkline__dot.is-active {
      width: 8px;
      height: 8px;
    }

    .sparkline__tip {
      position: absolute;
      bottom: calc(100% + 6px);
      z-index: 5;
      display: grid;
      gap: 1px;
      padding: 5px 8px;
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      background: var(--bg-elevated);
      box-shadow: var(--shadow-md);
      color: var(--text-3);
      font-size: var(--text-xs);
      line-height: 1.3;
      white-space: nowrap;
      transform: translateX(-50%);
      pointer-events: none;
    }

    .sparkline__tip.is-start {
      transform: translateX(-8px);
    }

    .sparkline__tip.is-end {
      transform: translateX(calc(-100% + 8px));
    }

    .sparkline__tip strong {
      color: var(--text);
      font-size: var(--text-sm);
      font-variant-numeric: tabular-nums;
      font-weight: 650;
    }

    .sparkline__value {
      flex: none;
      color: var(--text-2);
      font-size: var(--text-sm);
      font-variant-numeric: tabular-nums;
      font-weight: 600;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SparklineComponent {
  readonly points = input<readonly SparkPoint[]>([]);
  /** What the series is ("Indexing rate"), the start of the accessible summary. */
  readonly label = input.required<string>();
  readonly format = input<(value: number) => string>((value) => String(value));
  readonly tone = input<SparklineTone>('accent');
  readonly height = input(32);
  /** Fixed top of the y axis (100 for percentages); otherwise the largest value. */
  readonly domainMax = input<number | undefined>(undefined);
  /** Lowest top of a y axis that scales to the data (1 for a rate per second). */
  readonly minDomain = input<number | undefined>(undefined);
  /** Marks the latest value with a dot (inline sparklines of a few dozen pixels leave it out). */
  readonly dot = input(true);
  /** Shows the latest value to the right of the chart. */
  readonly showValue = input(false);
  /** A tab stop whose arrow keys walk the points (charts that are not one of many). */
  readonly focusable = input(false);

  private readonly chart = viewChild.required<ElementRef<HTMLElement>>('chart');
  /** Time of the point under the pointer or keyboard; a new sample does not move it. */
  private readonly activeTime = signal<number | undefined>(undefined);
  /** Read out while the keyboard walks the points. */
  readonly announcement = signal('');

  readonly hintId = `sparkline-hint-${nextId++}`;
  readonly geometry = computed(() =>
    sparklineGeometry(this.points(), this.height(), this.domainMax(), this.minDomain()),
  );
  readonly baseline = computed(() => this.height() - SPARK_PADDING + 0.5);
  readonly summary = computed(() => sparklineSummary(this.label(), this.points(), this.format()));
  /** The newest drawn point. */
  readonly end = computed(() => {
    const coordinates = this.geometry().coordinates;
    const last = coordinates[coordinates.length - 1];
    // Only when it belongs to the latest sample: an old value is not "now".
    return last && last.index === this.points().length - 1 ? last : undefined;
  });
  readonly active = computed(() => {
    const time = this.activeTime();
    return time === undefined ? undefined : this.geometry().coordinates.find((point) => point.time === time);
  });

  timeLabel(time: number): string {
    return formatTimestamp(time, { seconds: true }).slice(11);
  }

  onPointer(event: PointerEvent): void {
    const coordinates = this.geometry().coordinates;
    const rect = this.chart().nativeElement.getBoundingClientRect();
    if (coordinates.length === 0 || rect.width <= 0) {
      return;
    }
    const x = ((event.clientX - rect.left) / rect.width) * 100;
    let nearest = 0;
    coordinates.forEach((coordinate, position) => {
      if (Math.abs(coordinate.x - x) < Math.abs((coordinates[nearest]?.x ?? 0) - x)) {
        nearest = position;
      }
    });
    this.activeTime.set(coordinates[nearest]?.time);
  }

  onFocus(): void {
    const count = this.geometry().coordinates.length;
    if (count > 0) {
      this.select(count - 1);
    }
  }

  onKey(event: KeyboardEvent): void {
    const coordinates = this.geometry().coordinates;
    const count = coordinates.length;
    const active = this.active();
    const current = active ? coordinates.indexOf(active) : count - 1;
    const next =
      event.key === 'ArrowLeft'
        ? current - 1
        : event.key === 'ArrowRight'
          ? current + 1
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? count - 1
              : undefined;
    if (event.key === 'Escape') {
      this.clear();
      return;
    }
    if (next === undefined || count === 0) {
      return;
    }
    event.preventDefault();
    this.select(Math.max(0, Math.min(count - 1, next)));
  }

  clear(): void {
    this.activeTime.set(undefined);
  }

  private select(index: number): void {
    const point = this.geometry().coordinates[index];
    this.activeTime.set(point?.time);
    if (point) {
      this.announcement.set(`${this.format()(point.value)} at ${this.timeLabel(point.time)}`);
    }
  }
}
