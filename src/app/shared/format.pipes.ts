import { Pipe, PipeTransform } from '@angular/core';
import {
  formatBytes,
  formatCompact,
  formatDuration,
  formatNumber,
  plural,
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

/** The noun for a count: `{{ n | plural: 'stream' }}`, `{{ n | plural: 'index' : 'indices' }}`. */
@Pipe({ name: 'plural' })
export class PluralPipe implements PipeTransform {
  transform(count: number | null | undefined, singular: string, pluralForm?: string): string {
    return plural(count ?? 0, singular, pluralForm);
  }
}
