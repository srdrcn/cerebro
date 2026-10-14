import { describe, expect, it } from 'vitest';
import {
  CAT_APIS,
  CAT_API_INFO,
  CatRow,
  asCatRows,
  catApiFromParam,
  catApiValue,
  catCellText,
  catCellTone,
  catColumns,
  catKeyParts,
  catRowsToTsv,
  isCatRecord,
  filterCatRows,
  numericColumns,
  quantityValue,
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

  it('describes every API', () => {
    for (const api of CAT_APIS) {
      expect(CAT_API_INFO[api].label).toMatch(/^[A-Z][a-z ]+$/);
      expect(CAT_API_INFO[api].icon).toMatch(/^bi-/);
      expect(CAT_API_INFO[api].description.length).toBeGreaterThan(0);
      expect(CAT_API_INFO[api].emptyText.length).toBeGreaterThan(0);
    }
  });

  it('marks only the single-row APIs as records', () => {
    const singleRow = CAT_APIS.filter((api) => CAT_API_INFO[api].singleRow);
    expect(singleRow).toEqual(['count', 'health', 'master']);
  });

  it('shows a record only for a single row of a single-row API', () => {
    expect(isCatRecord('health', [{ status: 'green' }])).toBe(true);
    expect(isCatRecord('health', [])).toBe(false);
    expect(isCatRecord('master', [{ node: 'a' }, { node: 'b' }])).toBe(false);
    // One pending task or alias is still a (sortable, filterable) table.
    expect(isCatRecord('pending tasks', [{ source: 'x' }])).toBe(false);
    expect(isCatRecord('aliases', [{ alias: 'logs' }])).toBe(false);
  });

  it('splits long column names only between words', () => {
    expect(catKeyParts('active_shards_percent')).toEqual(['active_', 'shards_', 'percent']);
    expect(catKeyParts('max_task_wait_time')).toEqual(['max_', 'task_', 'wait_', 'time']);
    expect(catKeyParts('node.role')).toEqual(['node.', 'role']);
    expect(catKeyParts('_id')).toEqual(['_', 'id']);
    expect(catKeyParts('status')).toEqual(['status']);
    expect(catKeyParts('')).toEqual(['']);
    expect(catKeyParts('a__b').join('')).toBe('a__b');
  });

  it('resolves deep-link values in either spelling', () => {
    expect(catApiFromParam('thread_pool')).toBe('thread pool');
    expect(catApiFromParam('Pending tasks')).toBe('pending tasks');
    expect(catApiFromParam(' shards ')).toBe('shards');
    expect(catApiFromParam('nope')).toBeNull();
    expect(catApiFromParam('')).toBeNull();
    expect(catApiFromParam(null)).toBeNull();
  });

  it('discovers columns added by rows after the first one', () => {
    expect(catColumns([{ name: 'a' }, { name: 'b', docs: '2' }])).toEqual([
      'name',
      'docs',
    ]);
  });

  it('keeps only object rows from the response', () => {
    expect(asCatRows([{ a: '1' }, null, 'x', [1], { b: '2' }])).toEqual([{ a: '1' }, { b: '2' }]);
    expect(asCatRows({ error: 'x' })).toEqual([]);
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
    expect(sortCatRows(rows, 'docs', false).map((row) => row['name'])).toEqual([
      'node-2',
      'node-3',
      'node-10',
      'node-1',
    ]);
  });

  it('sorts descending while keeping missing values at the end', () => {
    expect(sortCatRows(rows, 'docs', true).map((row) => row['name'])).toEqual([
      'node-10',
      'node-2',
      'node-3',
      'node-1',
    ]);
  });

  it('does not mutate the API response', () => {
    const copy = [...rows];
    sortCatRows(rows, 'name', false);
    expect(rows).toEqual(copy);
  });

  it('keeps the natural order without a sort column', () => {
    expect(sortCatRows(rows, null, false)).toEqual(rows);
  });

  it('sorts sizes, durations and percentages by magnitude', () => {
    const sizes: readonly CatRow[] = [
      { i: 'a', size: '1.2mb' },
      { i: 'b', size: '45.1kb' },
      { i: 'c', size: '3gb' },
      { i: 'd', size: '900b' },
    ];
    expect(sortCatRows(sizes, 'size', true).map((row) => row['i'])).toEqual(['c', 'a', 'b', 'd']);

    const times: readonly CatRow[] = [
      { i: 'a', time: '1.5s' },
      { i: 'b', time: '28ms' },
      { i: 'c', time: '2m' },
    ];
    expect(sortCatRows(times, 'time', false).map((row) => row['i'])).toEqual(['b', 'a', 'c']);
  });

  it('treats CAT placeholders as missing values', () => {
    const waits: readonly CatRow[] = [
      { i: 'a', wait: '-' },
      { i: 'b', wait: '5ms' },
      { i: 'c', wait: 'n/a' },
      { i: 'd', wait: '1s' },
    ];
    expect(sortCatRows(waits, 'wait', false).map((row) => row['i'])).toEqual(['b', 'd', 'a', 'c']);
    expect(sortCatRows(waits, 'wait', true).map((row) => row['i'])).toEqual(['d', 'b', 'a', 'c']);
  });
});

describe('CAT values', () => {
  it('parses numbers and human readable quantities', () => {
    expect(quantityValue('42')).toBe(42);
    expect(quantityValue(7)).toBe(7);
    expect(quantityValue('-1.5')).toBe(-1.5);
    expect(quantityValue('2kb')).toBe(2048);
    expect(quantityValue('1.5s')).toBe(1500);
    expect(quantityValue('97.1%')).toBe(97.1);
    expect(quantityValue('127.0.0.1')).toBeNull();
    expect(quantityValue('9.11.1')).toBeNull();
    expect(quantityValue('es-node-1')).toBeNull();
    expect(quantityValue('13:51:20')).toBeNull();
    expect(quantityValue(null)).toBeNull();
  });

  it('detects numeric columns while ignoring missing values', () => {
    const rows: readonly CatRow[] = [
      { index: 'a', docs: '10', size: '1kb', wait: '-', ip: '127.0.0.1' },
      { index: 'b', docs: null, size: '2mb', wait: '-', ip: '127.0.0.2' },
    ];
    expect([...numericColumns(rows, ['index', 'docs', 'size', 'wait', 'ip'])]).toEqual([
      'docs',
      'size',
    ]);
  });

  it('renders objects as JSON and missing values as empty text', () => {
    expect(catCellText(null)).toBe('');
    expect(catCellText({ a: 1 })).toBe('{"a":1}');
    expect(catCellText(3)).toBe('3');
  });

  it('colours health and shard state cells only', () => {
    expect(catCellTone('health', 'yellow')).toBe('yellow');
    expect(catCellTone('status', 'green')).toBe('green');
    expect(catCellTone('status', 'close')).toBe('gray');
    expect(catCellTone('status', 'open')).toBeNull();
    expect(catCellTone('state', 'UNASSIGNED')).toBe('red');
    expect(catCellTone('state', 'STARTED')).toBe('green');
    expect(catCellTone('index', 'green')).toBeNull();
    expect(catCellTone('health', 3)).toBeNull();
  });
});

describe('CAT filtering and export', () => {
  const rows: readonly CatRow[] = [
    { index: 'logs-2026.10.12', health: 'green', docs: '10' },
    { index: 'products', health: 'yellow', docs: '200' },
  ];

  it('matches any column with plain text or a regular expression', () => {
    expect(filterCatRows(rows, ['index', 'health', 'docs'], 'yellow')).toEqual([rows[1]]);
    expect(filterCatRows(rows, ['index', 'health', 'docs'], '^logs-')).toEqual([rows[0]]);
    expect(filterCatRows(rows, ['index', 'health', 'docs'], '200')).toEqual([rows[1]]);
    expect(filterCatRows(rows, ['index', 'health', 'docs'], '(')).toEqual([]);
    expect(filterCatRows(rows, ['index'], 'yellow')).toEqual([]);
    expect(filterCatRows(rows, ['index'], '  ')).toBe(rows);
  });

  it('exports a header row and escapes tabs and line breaks', () => {
    expect(
      catRowsToTsv(['index', 'note'], [
        { index: 'a', note: 'x\ty' },
        { index: 'b', note: 'line\nbreak' },
        { index: 'c' },
      ]),
    ).toBe('index\tnote\na\tx y\nb\tline break\nc\t');
  });
});
