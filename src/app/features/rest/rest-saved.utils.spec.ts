import { describe, expect, it } from 'vitest';
import type { SavedRequest } from './rest-saved.models';
import {
  MAX_SAVED_NAME_LENGTH,
  MAX_SAVED_REQUESTS,
  applyImport,
  bodySummary,
  copyName,
  duplicateSaved,
  exportDocument,
  exportFileName,
  filterSavedRequests,
  findSaved,
  importSummary,
  bodyTooLarge,
  bodyTooLargeText,
  isSavedSort,
  markSavedUsed,
  nameProblem,
  nameProblemText,
  normalizeName,
  parseImportFile,
  parseSavedList,
  parseSavedRequest,
  parseStoredSavedRequests,
  planImport,
  removeSaved,
  renameSaved,
  sameName,
  sameRequest,
  savedFromDraft,
  sortSavedRequests,
  storedDocument,
  suggestName,
  uniqueName,
  upsertSaved,
  withoutCredentials,
} from './rest-saved.utils';
import { MAX_STORED_BODY_LENGTH } from './rest.utils';

const NOW = Date.UTC(2026, 9, 14, 12, 0, 0);

function saved(name: string, overrides: Partial<SavedRequest> = {}): SavedRequest {
  return {
    name,
    method: 'GET',
    path: '_cluster/health',
    body: '',
    createdAt: NOW - 10_000,
    updatedAt: NOW - 10_000,
    lastUsedAt: null,
    ...overrides,
  };
}

describe('saved request names', () => {
  it('normalises whitespace and compares names regardless of case', () => {
    expect(normalizeName('  Cluster \n  health ')).toBe('Cluster health');
    expect(sameName('Cluster health', ' cluster   HEALTH')).toBe(true);
    expect(sameName('Cluster health', 'Cluster health 2')).toBe(false);
    expect(findSaved([saved('Cluster health')], 'CLUSTER health')?.name).toBe('Cluster health');
    expect(findSaved([saved('a')], null)).toBeUndefined();
  });

  it('suggests a name from the method and the path without its query string', () => {
    expect(suggestName({ method: 'GET', path: '/_cat/indices?format=json&bytes=b' })).toBe(
      'GET _cat/indices',
    );
    expect(suggestName({ method: 'POST', path: 'products/_search/' })).toBe('POST products/_search');
    expect(suggestName({ method: 'DELETE', path: '  ' })).toBe('DELETE request');
    const long = suggestName({ method: 'GET', path: 'x'.repeat(300) });
    expect(long.length).toBe(MAX_SAVED_NAME_LENGTH);
    expect(long.endsWith('…')).toBe(true);
  });

  it('finds the first free name', () => {
    const requests = [saved('GET _search'), saved('GET _search (2)')];
    expect(uniqueName('Other', requests)).toBe('Other');
    expect(uniqueName('GET _search', requests)).toBe('GET _search (3)');
    expect(uniqueName('get _SEARCH', requests)).toBe('get _SEARCH (3)');
    expect(uniqueName('GET _search (2)', requests)).toBe('GET _search (3)');
    expect(uniqueName('   ', [])).toBe('Saved request');
    expect(uniqueName('x'.repeat(200), [saved('x'.repeat(119) + '…')]).length).toBeLessThanOrEqual(
      MAX_SAVED_NAME_LENGTH,
    );
  });

  it('names copies "(copy)", "(copy 2)" …', () => {
    const requests = [saved('Health')];
    expect(copyName('Health', requests)).toBe('Health (copy)');
    const more = [...requests, saved('Health (copy)')];
    expect(copyName('Health', more)).toBe('Health (copy 2)');
    expect(copyName('Health (copy)', more)).toBe('Health (copy 2)');
  });

  it('validates names', () => {
    const requests = [saved('Cluster health'), saved('Search')];
    expect(nameProblem('', requests)).toEqual({ kind: 'empty' });
    expect(nameProblem('   ', requests)).toEqual({ kind: 'empty' });
    expect(nameProblem('x'.repeat(MAX_SAVED_NAME_LENGTH + 1), requests)).toEqual({
      kind: 'too-long',
      max: MAX_SAVED_NAME_LENGTH,
    });
    expect(nameProblem(' cluster HEALTH ', requests)).toEqual({
      kind: 'duplicate',
      existing: 'Cluster health',
    });
    expect(nameProblem('New one', requests)).toBeNull();
    // Renaming a request onto its own name (or another case) is fine …
    expect(nameProblem('CLUSTER health', requests, 'Cluster health')).toBeNull();
    // … but not onto another request.
    expect(nameProblem('search', requests, 'Cluster health')?.kind).toBe('duplicate');
  });

  it('explains name problems in plain words', () => {
    expect(nameProblemText({ kind: 'empty' })).toBe('Enter a name for the request');
    expect(nameProblemText({ kind: 'too-long', max: 120 })).toBe('Use at most 120 characters');
    expect(nameProblemText({ kind: 'duplicate', existing: 'A' })).toBe(
      'A saved request named “A” already exists',
    );
  });
});

describe('reading saved requests defensively', () => {
  it('accepts a complete entry and drops unknown fields', () => {
    const entry = parseSavedRequest(
      {
        name: ' Health ',
        method: 'get',
        path: ' /_cluster/health ',
        body: '',
        createdAt: 1,
        updatedAt: 2,
        lastUsedAt: 3,
        host: 'http://secret:9200',
        password: 'hunter2',
      },
      NOW,
    );
    expect(entry).toEqual({
      name: 'Health',
      method: 'GET',
      path: '/_cluster/health',
      body: '',
      createdAt: 1,
      updatedAt: 2,
      lastUsedAt: 3,
    });
  });

  it('fills in missing or bad timestamps', () => {
    expect(parseSavedRequest({ name: 'a', method: 'GET', path: 'x' }, NOW)).toEqual({
      name: 'a',
      method: 'GET',
      path: 'x',
      body: '',
      createdAt: NOW,
      updatedAt: NOW,
      lastUsedAt: null,
    });
    const entry = parseSavedRequest(
      { name: 'a', method: 'GET', path: 'x', createdAt: -5, updatedAt: 'nope', lastUsedAt: Infinity },
      NOW,
    );
    expect(entry?.createdAt).toBe(NOW);
    expect(entry?.lastUsedAt).toBeNull();
    expect(
      parseSavedRequest({ name: 'a', method: 'GET', path: 'x', createdAt: '2026-10-01T00:00:00Z' }, NOW)
        ?.createdAt,
    ).toBe(Date.UTC(2026, 9, 1));
  });

  it('accepts a JSON body written as an object', () => {
    expect(
      parseSavedRequest({ name: 'a', method: 'POST', path: '_search', body: { size: 1 } }, NOW)?.body,
    ).toBe('{\n  "size": 1\n}');
  });

  it('rejects malformed entries', () => {
    const bad: unknown[] = [
      null,
      'GET _search',
      [],
      { name: '', method: 'GET', path: 'x' },
      { name: 'a', method: 'PATCH', path: 'x' },
      { name: 'a', method: 'GET' },
      { name: 'a', method: 3, path: 'x' },
      { name: 7, method: 'GET', path: 'x' },
      { name: 'a', method: 'GET', path: 'x', body: 12 },
      { name: 'x'.repeat(MAX_SAVED_NAME_LENGTH + 1), method: 'GET', path: 'x' },
      { name: 'a', method: 'GET', path: 'x', body: 'y'.repeat(MAX_STORED_BODY_LENGTH + 1) },
    ];
    for (const value of bad) {
      expect(parseSavedRequest(value, NOW)).toBeNull();
    }
  });

  it('never keeps credentials typed into a full URL', () => {
    expect(withoutCredentials('https://elastic:changeme@es.example.com/_search')).toBe(
      'https://es.example.com/_search',
    );
    expect(withoutCredentials('products/_search?q=user@example.com')).toBe(
      'products/_search?q=user@example.com',
    );
    expect(
      parseSavedRequest({ name: 'a', method: 'GET', path: 'http://u:p@host/_cat/health' }, NOW)?.path,
    ).toBe('http://host/_cat/health');
  });

  it('keeps the first of repeated names and counts what was dropped', () => {
    const result = parseSavedList(
      [
        { name: 'A', method: 'GET', path: '1' },
        { name: 'a', method: 'GET', path: '2' },
        { name: 'B', method: 'BREW', path: '3' },
        { name: 'C', method: 'PUT', path: '4' },
      ],
      NOW,
    );
    expect(result.requests.map((request) => `${request.name}:${request.path}`)).toEqual([
      'A:1',
      'C:4',
    ]);
    expect(result.invalid).toBe(2);
  });

  it('caps the number of entries', () => {
    const values = Array.from({ length: MAX_SAVED_REQUESTS + 3 }, (_, index) => ({
      name: `r${index}`,
      method: 'GET',
      path: 'x',
    }));
    const result = parseSavedList(values, NOW);
    expect(result.requests.length).toBe(MAX_SAVED_REQUESTS);
    expect(result.invalid).toBe(3);
  });

  it('only reads versioned documents from storage', () => {
    const entry = { name: 'A', method: 'GET', path: 'x' };
    expect(parseStoredSavedRequests(null, NOW).requests).toEqual([]);
    expect(parseStoredSavedRequests('junk', NOW).requests).toEqual([]);
    expect(parseStoredSavedRequests([entry], NOW).requests).toEqual([]);
    expect(parseStoredSavedRequests({ requests: [entry] }, NOW).requests).toEqual([]);
    expect(parseStoredSavedRequests({ version: 0, requests: [entry] }, NOW).requests).toEqual([]);
    expect(parseStoredSavedRequests({ version: 1, requests: 'x' }, NOW).requests).toEqual([]);
    expect(parseStoredSavedRequests({ version: 1, requests: [entry, 4] }, NOW)).toEqual({
      requests: [saved('A', { path: 'x', createdAt: NOW, updatedAt: NOW })],
      invalid: 1,
      newerVersion: null,
    });
    // A newer version is read as far as its entries still look like requests,
    // and flagged so that it is not rewritten in the older format.
    const newer = parseStoredSavedRequests({ version: 2, requests: [entry] }, NOW);
    expect(newer.requests).toHaveLength(1);
    expect(newer.newerVersion).toBe(2);
    expect(parseStoredSavedRequests(null, NOW).newerVersion).toBeNull();
  });
});

describe('stored and exported documents', () => {
  it('writes a versioned document with explicit fields only', () => {
    const sneaky = { ...saved('A'), host: 'http://h:9200' } as SavedRequest;
    const document = storedDocument([sneaky]);
    expect(document).toEqual({ format: 'cerebro-saved-requests', version: 1, requests: [saved('A')] });
    expect(JSON.stringify(document)).not.toContain('h:9200');
  });

  it('round-trips through storage', () => {
    const requests = [saved('A', { lastUsedAt: NOW }), saved('B', { method: 'POST', body: '{}' })];
    const text = JSON.stringify(storedDocument(requests));
    expect(parseStoredSavedRequests(JSON.parse(text), NOW).requests).toEqual(requests);
  });

  it('exports sorted by name with a date stamped file name', () => {
    const date = new Date(2026, 0, 5, 9, 30);
    const document = exportDocument([saved('b'), saved('A')], date);
    expect(document.requests.map((request) => request.name)).toEqual(['A', 'b']);
    expect(document.exportedAt).toBe(date.toISOString());
    expect(document.version).toBe(1);
    expect(exportFileName(date)).toBe('cerebro-saved-requests-2026-01-05.json');
  });
});

describe('importing files', () => {
  it('reads exported documents and plain arrays', () => {
    const exported = JSON.stringify(exportDocument([saved('A')], new Date(NOW)));
    const fromDocument = parseImportFile(exported, NOW);
    expect(fromDocument.ok && fromDocument.requests.map((request) => request.name)).toEqual(['A']);
    const fromArray = parseImportFile(
      JSON.stringify([{ name: 'B', method: 'post', path: '_search' }, { nope: 1 }]),
      NOW,
    );
    expect(fromArray).toMatchObject({ ok: true, invalid: 1 });
    expect(fromArray.ok && fromArray.requests[0]?.method).toBe('POST');
  });

  it('explains why a file cannot be imported', () => {
    expect(parseImportFile('{ nope', NOW)).toEqual({ ok: false, message: 'The file is not valid JSON.' });
    expect(parseImportFile('{"a":1}', NOW)).toEqual({
      ok: false,
      message: 'The file does not contain saved requests.',
    });
    expect(parseImportFile('"text"', NOW)).toMatchObject({ ok: false });
    expect(parseImportFile('[]', NOW)).toEqual({
      ok: false,
      message: 'The file does not contain any saved request.',
    });
    expect(parseImportFile('[{"name":"a"},{"name":"b"}]', NOW)).toEqual({
      ok: false,
      message: 'None of the 2 entries in the file is a valid saved request.',
    });
    expect(parseImportFile('{"version":7,"requests":[]}', NOW)).toEqual({
      ok: false,
      message: 'The file was exported by a newer version of Cerebro (format version 7).',
    });
  });

  it('classifies imported requests against the saved ones', () => {
    const existing = [saved('Same'), saved('Changed'), saved('Kept')];
    const incoming = [
      saved('same', { path: '/_cluster/health', body: '\n' }),
      saved('Changed', { path: '_cat/health' }),
      saved('New'),
    ];
    expect(planImport(existing, incoming, 2)).toEqual({
      incoming,
      added: ['New'],
      identical: ['Same'],
      conflicts: ['Changed'],
      invalid: 2,
    });
  });

  it('skips conflicts by default', () => {
    const existing = [saved('A'), saved('B')];
    const incoming = [saved('a'), saved('B', { method: 'DELETE', path: 'x' }), saved('C')];
    const outcome = applyImport(existing, incoming, 'skip', NOW);
    expect(outcome).toMatchObject({ added: 1, overwritten: 0, skipped: 2 });
    expect(outcome.requests.map((request) => `${request.name} ${request.method}`)).toEqual([
      'A GET',
      'B GET',
      'C GET',
    ]);
  });

  it('overwrites conflicts but keeps their name and history', () => {
    const existing = [saved('Health', { createdAt: 5, lastUsedAt: 6 })];
    const incoming = [saved('HEALTH', { method: 'POST', path: '_search', body: '{"size":1}' })];
    const outcome = applyImport(existing, incoming, 'overwrite', NOW);
    expect(outcome).toMatchObject({ added: 0, overwritten: 1, skipped: 0 });
    expect(outcome.requests).toEqual([
      {
        name: 'Health',
        method: 'POST',
        path: '_search',
        body: '{"size":1}',
        createdAt: 5,
        updatedAt: NOW,
        lastUsedAt: 6,
      },
    ]);
  });

  it('summarises an import for the toast', () => {
    expect(importSummary({ added: 2, overwritten: 0, skipped: 0 }, 0)).toEqual({
      message: 'Imported 2 saved requests',
      details: '',
    });
    expect(importSummary({ added: 1, overwritten: 2, skipped: 3 }, 1)).toEqual({
      message: 'Imported 3 saved requests',
      details: '1 added, 2 replaced, 3 skipped (already saved), 1 invalid entry ignored',
    });
    expect(importSummary({ added: 0, overwritten: 0, skipped: 4 }, 0)).toEqual({
      message: 'Nothing new to import',
      details: '4 skipped (already saved)',
    });
  });
});

describe('changing the list', () => {
  it('compares requests the way the editor shows them', () => {
    const base = { method: 'GET' as const, path: '_search', body: '{"a":1}' };
    expect(sameRequest(base, { ...base, path: '/_search ' })).toBe(true);
    expect(sameRequest(base, { ...base, body: '{"a":1}\r\n\n' })).toBe(true);
    expect(sameRequest(base, { ...base, body: '{ "a": 1 }' })).toBe(false);
    expect(sameRequest(base, { ...base, method: 'POST' })).toBe(false);
    expect(sameRequest(base, { ...base, path: '_count' })).toBe(false);
  });

  it('creates and updates saved requests from the editor', () => {
    const created = savedFromDraft(' My  search ', { method: 'POST', path: '/_search', body: '{}' }, NOW);
    expect(created).toEqual({
      name: 'My search',
      method: 'POST',
      path: '_search',
      body: '{}',
      createdAt: NOW,
      updatedAt: NOW,
      lastUsedAt: NOW,
    });
    const updated = savedFromDraft(
      'My search',
      { method: 'GET', path: '_count', body: '' },
      NOW + 5,
      created,
    );
    expect(updated).toMatchObject({ createdAt: NOW, updatedAt: NOW + 5, lastUsedAt: NOW, path: '_count' });
  });

  it('adds, replaces and removes by name', () => {
    const list = [saved('A'), saved('B')];
    expect(upsertSaved(list, saved('C')).map((request) => request.name)).toEqual(['A', 'B', 'C']);
    const replaced = upsertSaved(list, saved('b', { path: 'x' }));
    expect(replaced.map((request) => `${request.name}:${request.path}`)).toEqual([
      'A:_cluster/health',
      'b:x',
    ]);
    expect(removeSaved(list, 'a').map((request) => request.name)).toEqual(['B']);
    expect(removeSaved(list, 'missing')).toEqual(list);
  });

  it('renames unless the name is taken', () => {
    const list = [saved('A'), saved('B')];
    expect(renameSaved(list, 'A', ' Alpha ', NOW).map((request) => request.name)).toEqual([
      'Alpha',
      'B',
    ]);
    expect(renameSaved(list, 'A', 'Alpha', NOW)[0]?.updatedAt).toBe(NOW);
    expect(renameSaved(list, 'A', 'b', NOW).map((request) => request.name)).toEqual(['A', 'B']);
    expect(renameSaved(list, 'A', 'a', NOW).map((request) => request.name)).toEqual(['a', 'B']);
    expect(renameSaved(list, 'missing', 'C', NOW)).toEqual(list);
  });

  it('marks a request as used', () => {
    const list = markSavedUsed([saved('A'), saved('B')], 'b', NOW);
    expect(list.map((request) => request.lastUsedAt)).toEqual([null, NOW]);
  });

  it('duplicates right after the original', () => {
    const { requests, copy } = duplicateSaved([saved('A', { lastUsedAt: 1 }), saved('B')], 'A', NOW);
    expect(requests.map((request) => request.name)).toEqual(['A', 'A (copy)', 'B']);
    expect(copy).toMatchObject({ name: 'A (copy)', createdAt: NOW, lastUsedAt: null });
    expect(duplicateSaved([saved('A')], 'missing', NOW).copy).toBeNull();
  });
});

describe('listing', () => {
  const list = [
    saved('beta', { updatedAt: 10, lastUsedAt: 50 }),
    saved('Alpha 10', { updatedAt: 40, lastUsedAt: null }),
    saved('alpha 2', { updatedAt: 20, lastUsedAt: 30, method: 'POST', path: 'products/_search', body: '{"size":3}' }),
  ];

  it('sorts by name naturally, ignoring case', () => {
    expect(sortSavedRequests(list, 'name').map((request) => request.name)).toEqual([
      'alpha 2',
      'Alpha 10',
      'beta',
    ]);
  });

  it('sorts by the most recent use, never-used requests last', () => {
    // "Alpha 10" changed most recently but was never loaded: it comes last.
    expect(sortSavedRequests(list, 'recent').map((request) => request.name)).toEqual([
      'beta',
      'alpha 2',
      'Alpha 10',
    ]);
  });

  it('ranks freshly imported or duplicated requests below used ones', () => {
    const requests = [
      saved('Imported', { updatedAt: NOW, lastUsedAt: null }),
      saved('Copy', { createdAt: NOW, updatedAt: NOW - 1, lastUsedAt: null }),
      saved('Used long ago', { updatedAt: 1, lastUsedAt: 2 }),
      saved('Used', { updatedAt: 1, lastUsedAt: 5 }),
    ];
    expect(sortSavedRequests(requests, 'recent').map((request) => request.name)).toEqual([
      'Used',
      'Used long ago',
      // Never used: the most recently changed first.
      'Imported',
      'Copy',
    ]);
  });

  it('breaks ties in the recent order by change, then by name', () => {
    const requests = [
      saved('b', { updatedAt: 1, lastUsedAt: 9 }),
      saved('c', { updatedAt: 3, lastUsedAt: 9 }),
      saved('a', { updatedAt: 1, lastUsedAt: 9 }),
    ];
    expect(sortSavedRequests(requests, 'recent').map((request) => request.name)).toEqual(['c', 'a', 'b']);
  });

  it('filters on name, method, path and body', () => {
    expect(filterSavedRequests(list, '')).toBe(list);
    expect(filterSavedRequests(list, 'POST').map((request) => request.name)).toEqual(['alpha 2']);
    expect(filterSavedRequests(list, 'products').map((request) => request.name)).toEqual(['alpha 2']);
    expect(filterSavedRequests(list, '"size"').map((request) => request.name)).toEqual(['alpha 2']);
    expect(filterSavedRequests(list, '^beta').map((request) => request.name)).toEqual(['beta']);
    // Invalid regular expressions fall back to a plain substring match.
    expect(filterSavedRequests(list, 'alpha (').map((request) => request.name)).toEqual([]);
  });

  it('describes bodies', () => {
    expect(bodySummary('_search', '')).toBe('No body');
    expect(bodySummary('_search', '{"a":1}')).toBe('JSON body');
    expect(bodySummary('_bulk', '{"index":{}}\n{"a":1}\n')).toBe('NDJSON · 2 lines');
    expect(bodySummary('_text_structure/find_structure', 'a,b\n1,2')).toBe('Plain text · 2 lines');
    expect(bodySummary('_search', '{oops')).toBe('Body is not valid JSON');
  });

  it('recognises sort options', () => {
    expect(isSavedSort('name')).toBe(true);
    expect(isSavedSort('recent')).toBe(true);
    expect(isSavedSort('size')).toBe(false);
    expect(isSavedSort(null)).toBe(false);
  });
});

describe('body size', () => {
  it('refuses bodies that storage would drop when reading them back', () => {
    expect(bodyTooLarge('')).toBe(false);
    expect(bodyTooLarge('x'.repeat(MAX_STORED_BODY_LENGTH))).toBe(false);
    const big = 'x'.repeat(MAX_STORED_BODY_LENGTH + 1);
    expect(bodyTooLarge(big)).toBe(true);
    // Whatever is accepted is read back: the write side matches the read side.
    const kept = savedFromDraft('Big', { method: 'POST', path: '_bulk', body: 'x'.repeat(MAX_STORED_BODY_LENGTH) }, NOW);
    expect(parseSavedRequest(kept, NOW)).not.toBeNull();
    expect(parseSavedRequest(savedFromDraft('Too big', { method: 'POST', path: '_bulk', body: big }, NOW), NOW)).toBeNull();
  });

  it('explains the limit in plain language', () => {
    expect(bodyTooLargeText('x'.repeat(223_889))).toBe(
      'Saved requests hold bodies of at most 200,000 characters (this one has 223,889).',
    );
  });
});
