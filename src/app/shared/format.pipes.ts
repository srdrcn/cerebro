import { Pipe, PipeTransform } from '@angular/core';
import {
  formatBytes,
  formatCompact,
  formatDuration,
  formatNumber,
} from '../core/format';

@Pipe({ name: 'bytes' })
export class BytesPipe implements PipeTransform {
  transform(value: number | null | undefined, digits = 1): string {
    return formatBytes(value, digits);
  }
}

@Pipe({ name: 'num' })
export class NumberPipe implements PipeTransform {
  transform(value: number | null | undefined): string {
    return formatNumber(value);
  }
}

@Pipe({ name: 'compact' })
export class CompactNumberPipe implements PipeTransform {
  transform(value: number | null | undefined): string {
    return formatCompact(value);
  }
}

@Pipe({ name: 'duration' })
export class DurationPipe implements PipeTransform {
  transform(value: number | null | undefined): string {
    return formatDuration(value);
  }
}

export const FORMAT_PIPES = [
  BytesPipe,
  NumberPipe,
  CompactNumberPipe,
  DurationPipe,
] as const;
