import { describe, expect, it } from 'vitest';
import {
  CAT_APIS,
  CatRow,
  catApiValue,
  catColumns,
  sortCatRows,
} from './cat.utils';

describe('CAT API options', () => {
  it('keeps the fixed sixteen APIs in legacy order', () => {
    expect(CAT_APIS).toHaveLength(16);
    expect(CAT_APIS).toEqual([
      'aliases',
      'allocation',
      'count',
      'fielddata',
      'health',
      'indices',
      'master',
      'nodeattrs',
      'nodes',
      'pending tasks',
      'plugins',
      'recovery',
      'repositories',
      'thread pool',
      'shards',
      'segments',
    ]);
    expect(catApiValue('pending tasks')).toBe('pending_tasks');
    expect(catApiValue('thread pool')).toBe('thread_pool');
  });

  it('discovers columns added by rows after the first one', () => {
    expect(catColumns([{ name: 'a' }, { name: 'b', docs: '2' }])).toEqual([
      'name',
      'docs',
    ]);
  });
});

describe('CAT sorting', () => {
  const rows: readonly CatRow[] = [
    { name: 'node-10', docs: '10' },
    { name: 'node-2', docs: '2' },
    { name: 'node-1', docs: null },
    { name: 'node-3', docs: '2' },
  ];

  it('sorts numeric-looking values numerically and stably', () => {
    expect(sortCatRows(rows, 'docs', 'asc').map((row) => row['name'])).toEqual([
      'node-2',
      'node-3',
      'node-10',
      'node-1',
    ]);
  });

  it('sorts descending while keeping missing values at the end', () => {
    expect(sortCatRows(rows, 'docs', 'desc').map((row) => row['name'])).toEqual([
      'node-10',
      'node-2',
      'node-3',
      'node-1',
    ]);
  });

  it('does not mutate the API response', () => {
    const copy = [...rows];
    sortCatRows(rows, 'name', 'asc');
    expect(rows).toEqual(copy);
  });
});
