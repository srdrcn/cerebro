import { describe, expect, it } from 'vitest';
import {
  clampPercent,
  formatBytes,
  formatCompact,
  formatDuration,
  formatNumber,
  matchesText,
  severity,
  sortByName,
} from './format';

describe('format helpers', () => {
  it('formats bytes with binary units', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(5 * 1024 ** 3)).toBe('5 GB');
    expect(formatBytes(null)).toBe('–');
    expect(formatBytes(Number.NaN)).toBe('–');
  });

  it('formats numbers', () => {
    expect(formatNumber(1234567)).toBe('1,234,567');
    expect(formatCompact(1234)).toBe('1.2K');
    expect(formatCompact(undefined)).toBe('–');
  });

  it('formats durations with the two most significant units', () => {
    expect(formatDuration(450)).toBe('450ms');
    expect(formatDuration(61_000)).toBe('1m 1s');
    expect(formatDuration(3 * 86_400_000 + 4 * 3_600_000 + 5_000)).toBe('3d 4h');
    expect(formatDuration(86_400_000 + 30_000)).toBe('1d');
    expect(formatDuration(-1)).toBe('–');
  });

  it('classifies severities and clamps percentages', () => {
    expect(severity(10)).toBe('ok');
    expect(severity(80)).toBe('warn');
    expect(severity(95)).toBe('danger');
    expect(severity(null)).toBe('ok');
    expect(clampPercent(140)).toBe(100);
    expect(clampPercent(-3)).toBe(0);
  });

  it('matches text as a case-insensitive regex with a substring fallback', () => {
    expect(matchesText('logs-2026.10.14', '^logs-.*14$')).toBe(true);
    expect(matchesText('Products', 'prod')).toBe(true);
    expect(matchesText('a[b', '[b')).toBe(true);
    expect(matchesText('anything', '  ')).toBe(true);
    expect(matchesText('orders', 'logs')).toBe(false);
  });

  it('sorts and de-duplicates names', () => {
    expect(sortByName(['b', 'a', 'b'])).toEqual(['a', 'b']);
  });
});
