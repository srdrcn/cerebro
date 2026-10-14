import { describe, expect, it } from 'vitest';
import {
  MAX_STORED_BODY_LENGTH,
  RestMethod,
  bodyPreview,
  buildCurlCommand,
  buildRequestPayload,
  describeBody,
  destructiveDeleteTarget,
  draftForStorage,
  formatEditorBody,
  formatElapsed,
  autocompleteDefinitions,
  getAutocompleteOptions,
  getPathSuggestions,
  historyBody,
  historyTimestamp,
  hostPrefix,
  isNdjsonPath,
  isRawTextPath,
  isTextCatPath,
  matchesHistoryEntry,
  networkErrorText,
  parseEditorBody,
  parseStoredDraft,
  prependHistoryEntry,
  responseHint,
  responseSize,
  restoredBody,
  shellQuote,
  statusText,
  statusTone,
  suggestionParts,
  withJsonFormat,
  wrapIndex,
} from './rest.utils';

describe('REST JSON and NDJSON handling', () => {
  it('parses valid regular JSON but preserves malformed input', () => {
    expect(parseEditorBody('/books/_search', '{"query":{"match_all":{}}}')).toEqual({
      query: { match_all: {} },
    });
    expect(parseEditorBody('/books/_search', '{not json}')).toBe('{not json}');
  });

  it('preserves NDJSON as a string even when every line is valid JSON', () => {
    const body = '{"index":{}}\n{"title":"One"}\n';
    expect(isNdjsonPath('/books/_bulk?refresh=true')).toBe(true);
    expect(isNdjsonPath('/books/_msearch/template')).toBe(true);
    expect(isNdjsonPath('/books/_search')).toBe(false);
    expect(parseEditorBody('/books/_bulk?refresh=true', body)).toBe(body);
    expect(formatEditorBody('/books/_bulk', '{ "index": {} }\n{ "title": "One" }')).toBe(
      '{"index":{}}\n{"title":"One"}\n',
    );
  });
});

describe('non-JSON body APIs', () => {
  it('recognises the other NDJSON endpoints', () => {
    expect(isNdjsonPath('_monitoring/bulk?system_id=x')).toBe(true);
    expect(isNdjsonPath('_fleet/_fleet_msearch')).toBe(true);
    expect(isNdjsonPath('logs/_fleet/_fleet_msearch')).toBe(true);
    expect(isNdjsonPath('/_ml/anomaly_detectors/job-1/_data')).toBe(true);
    expect(isNdjsonPath('_ml/anomaly_detectors/job-1')).toBe(false);
    expect(isNdjsonPath('products/_doc/bulk')).toBe(false);
  });

  it('sends plain-text analysis bodies verbatim', () => {
    const csv = 'name,age\nada,36\n';
    expect(isRawTextPath('_text_structure/find_structure?lines_to_sample=10')).toBe(true);
    expect(isRawTextPath('_ml/find_file_structure')).toBe(true);
    expect(isRawTextPath('_search')).toBe(false);
    expect(describeBody('_text_structure/find_structure', csv)).toEqual({ kind: 'text', lines: 2 });
    expect(formatEditorBody('_text_structure/find_structure', csv)).toBe(csv);
    expect(buildRequestPayload({ method: 'POST', path: '_text_structure/find_structure', body: csv }).data).toBe(csv);
    const command = buildCurlCommand({
      method: 'POST',
      host: 'http://localhost:9200',
      path: '_text_structure/find_structure',
      body: csv,
    });
    expect(command).toContain("'Content-Type: application/x-ndjson'");
    expect(command).toContain(shellQuote(csv));
  });

  it('keeps invalid JSON as raw text so it can still be sent', () => {
    expect(buildRequestPayload({ method: 'POST', path: 'x/_search', body: '{oops' }).data).toBe('{oops');
  });
});

describe('REST path autocomplete', () => {
  it('suggests only known-index routes with starts-with semantics', () => {
    expect(getAutocompleteOptions(['books', 'logs'], 'books/_se')).toEqual([
      'books/_search',
    ]);
    expect(getAutocompleteOptions(['books', 'logs'], 'unknown/')).toEqual([]);
  });

  it('supports nested template paths and preserves a leading slash', () => {
    expect(getAutocompleteOptions(['books'], '/books/_search/')).toEqual([
      '/books/_search/template',
    ]);
  });
});

describe('cURL generation', () => {
  it('escapes apostrophes in every shell-controlled argument', () => {
    const command = buildCurlCommand({
      method: 'POST',
      host: "https://elastic.example/user's",
      path: "/books/_search?q=author's",
      body: '{"author":"O\'Reilly"}',
    });

    expect(command).toContain(shellQuote("https://elastic.example/user's/books/_search?q=author's"));
    expect(command).toContain(shellQuote('{\n  "author": "O\'Reilly"\n}'));
    expect(command).not.toContain("--data-raw '{\n  \"author\": \"O'Reilly\"");
  });

  it('uses NDJSON content type and guarantees one final newline', () => {
    const command = buildCurlCommand({
      method: 'PUT',
      host: 'http://localhost:9200/',
      path: 'books/_bulk',
      body: '{ "index": {} }\n{ "title": "One" }\n\n',
    });

    expect(command).toContain("'Content-Type: application/x-ndjson'");
    expect(command).toContain(shellQuote('{"index":{}}\n{"title":"One"}\n'));
  });

  it('keeps valid Elasticsearch GET bodies in the copied request', () => {
    const command = buildCurlCommand({
      method: 'GET',
      host: 'http://localhost:9200',
      path: 'books/_search',
      body: '{"query":{"match_all":{}}}',
    });
    expect(command).toContain('--data-raw');
    expect(command).toContain(
      shellQuote('{\n  "query": {\n    "match_all": {}\n  }\n}'),
    );
  });
});

describe('request payloads', () => {
  it('omits the body when the editor is blank and strips leading slashes', () => {
    expect(buildRequestPayload({ method: 'GET', path: ' /_cluster/health ', body: '  ' })).toEqual({
      method: 'GET',
      path: '_cluster/health',
    });
  });

  it('sends JSON values for regular paths and raw strings for NDJSON', () => {
    expect(buildRequestPayload({ method: 'POST', path: 'books/_search', body: '{"size":1}' })).toEqual({
      method: 'POST',
      path: 'books/_search',
      data: { size: 1 },
    });
    const bulk = '{"index":{}}\n{"a":1}\n';
    expect(buildRequestPayload({ method: 'POST', path: '_bulk', body: bulk }).data).toBe(bulk);
  });

  it('stores bodies in history the way the server does', () => {
    expect(historyBody({ method: 'GET', path: '_cat/indices' })).toBe('{}');
    expect(historyBody({ method: 'POST', path: 'x/_search', data: { size: 1 } })).toBe('{"size":1}');
    expect(historyBody({ method: 'POST', path: '_bulk', data: 'a\nb\n' })).toBe('a\nb\n');
  });
});

describe('body description', () => {
  it('reports empty, valid, NDJSON and invalid bodies', () => {
    expect(describeBody('_search', '')).toEqual({ kind: 'empty' });
    expect(describeBody('_search', '{"a":1}')).toEqual({ kind: 'json' });
    expect(describeBody('_bulk', '{"index":{}}\n{"a":1}')).toEqual({ kind: 'ndjson', lines: 2 });
    expect(describeBody('_bulk', '{"index":{}}\n{oops}').kind).toBe('invalid');
    expect(describeBody('_search', '{oops').kind).toBe('invalid');
  });
});

describe('stored drafts', () => {
  it('accepts only well formed drafts', () => {
    expect(parseStoredDraft({ method: 'PUT', path: 'x', body: '' })).toEqual({
      method: 'PUT',
      path: 'x',
      body: '',
    });
    expect(parseStoredDraft({ method: 'PATCH', path: 'x', body: '' })).toBeNull();
    expect(parseStoredDraft({ method: 'GET', path: 1, body: '' })).toBeNull();
    expect(parseStoredDraft(null)).toBeNull();
    expect(parseStoredDraft('GET x')).toBeNull();
  });

  it('drops oversized bodies before persisting', () => {
    const body = 'x'.repeat(MAX_STORED_BODY_LENGTH + 1);
    expect(draftForStorage({ method: 'GET', path: 'p', body })).toEqual({
      method: 'GET',
      path: 'p',
      body: '',
    });
    expect(draftForStorage({ method: 'GET', path: 'p', body: '{}' }).body).toBe('{}');
  });
});

describe('response status', () => {
  it('maps status codes to tones and labels', () => {
    expect(statusTone(200)).toBe('green');
    expect(statusTone(201)).toBe('green');
    expect(statusTone(304)).toBe('blue');
    expect(statusTone(404)).toBe('yellow');
    expect(statusTone(503)).toBe('red');
    expect(statusTone(null)).toBe('gray');
    expect(statusText(404)).toBe('Not Found');
    expect(statusText(null)).toBe('No response');
    expect(statusText(299)).toBe('');
  });

  it('measures the UTF-8 size of the compact response', () => {
    expect(responseSize({ a: 1 })).toBe(7);
    expect(responseSize('é')).toBe(2);
  });

  it('explains _cat failures without format=json and unreachable servers', () => {
    expect(responseHint('_cat/indices', 500)).toContain('format=json');
    expect(responseHint('_cat/indices?format=json', 500)).toBeNull();
    expect(responseHint('_search', 500)).toBeNull();
    expect(responseHint('_search', null)).toContain('could not reach');
    expect(isTextCatPath('/_cat/health?v')).toBe(true);
    expect(isTextCatPath('_cat/health?format=json')).toBe(false);
  });

  it('explains plain-text answers of other APIs', () => {
    const parseError = { error: "Unexpected character (':' (code 58)): expected a valid value" };
    expect(responseHint('_nodes/hot_threads', 500, parseError)).toContain('plain text');
    expect(responseHint('_search', 500, { error: 'boom' })).toBeNull();
    expect(responseHint('_search', 404, parseError)).toBeNull();
  });

  it('formats elapsed times', () => {
    expect(formatElapsed(12.4)).toBe('12 ms');
    expect(formatElapsed(1234)).toBe('1.23 s');
    expect(formatElapsed(12_345)).toBe('12.3 s');
    expect(formatElapsed(65_000)).toBe('1m 05s');
    expect(formatElapsed(-5)).toBe('0 ms');
  });

  it('describes network failures', () => {
    expect(networkErrorText({ error: 'Bad gateway' })).toBe('Bad gateway');
    expect(networkErrorText({ error: { reason: 'x' } })).toContain('"reason": "x"');
    expect(networkErrorText({ message: 'Http failure response' })).toBe('Http failure response');
    expect(networkErrorText(undefined)).toBe('The request could not be sent.');
    expect(
      networkErrorText({ status: 0, message: 'Http failure response for rest/request: 0 undefined' }),
    ).toBe("The request did not reach Cerebro's server (network error).");
  });
});

describe('history helpers', () => {
  const entry = (method: RestMethod, path: string, body = '{}') => ({
    method,
    path,
    body,
    created_at: '14/10 10:00:00',
  });

  it('restores bodies, treating {} as no body and formatting JSON/NDJSON', () => {
    expect(restoredBody(entry('GET', '_cluster/health'))).toBe('');
    expect(restoredBody(entry('GET', '_search', '{"size":1}'))).toBe('{\n  "size": 1\n}');
    expect(restoredBody(entry('POST', '_bulk', '{"index":{}}\n{"a":1}'))).toBe(
      '{"index":{}}\n{"a":1}\n',
    );
  });

  it('builds one line previews', () => {
    expect(bodyPreview('{}')).toBe('');
    expect(bodyPreview('{\n  "a": 1\n}')).toBe('{ "a": 1 }');
    expect(bodyPreview('x'.repeat(200), 10)).toBe(`${'x'.repeat(9)}…`);
  });

  it('filters by method, path and body', () => {
    expect(matchesHistoryEntry(entry('DELETE', 'tmp'), 'delete')).toBe(true);
    expect(matchesHistoryEntry(entry('GET', 'products/_search', '{"size":3}'), 'size')).toBe(true);
    expect(matchesHistoryEntry(entry('GET', 'products'), 'orders')).toBe(false);
  });

  it('prepends executed requests and drops identical older ones', () => {
    const older = [entry('GET', 'a'), entry('GET', 'b')];
    const next = prependHistoryEntry(older, { ...entry('GET', 'b'), created_at: 'now' });
    expect(next.map((item) => item.path)).toEqual(['b', 'a']);
    expect(next[0]?.created_at).toBe('now');
  });

  it('formats timestamps like the server', () => {
    expect(historyTimestamp(new Date(2026, 9, 4, 7, 5, 9))).toBe('04/10 07:05:09');
  });
});

describe('destructive requests', () => {
  it('flags DELETE of whole indices, wildcards and _all', () => {
    expect(destructiveDeleteTarget('DELETE', 'products')).toBe('products');
    expect(destructiveDeleteTarget('DELETE', '/logs-*?ignore_unavailable=true')).toBe('logs-*');
    expect(destructiveDeleteTarget('DELETE', '_all')).toBe('_all');
    expect(destructiveDeleteTarget('DELETE', 'logs-*')).toBe('logs-*');
  });

  it('does not treat wildcard sub-resources as index drops', () => {
    expect(destructiveDeleteTarget('DELETE', 'logs-*/_alias/x')).toBeNull();
    expect(destructiveDeleteTarget('DELETE', 'logs-*/_doc/1')).toBeNull();
    expect(destructiveDeleteTarget('DELETE', '_all/_alias/x')).toBeNull();
    expect(destructiveDeleteTarget('DELETE', '_template/old')).toBeNull();
  });

  it('lets narrower or non-DELETE requests through', () => {
    expect(destructiveDeleteTarget('DELETE', 'products/_doc/1')).toBeNull();
    expect(destructiveDeleteTarget('DELETE', '_snapshot/repo/snap')).toBeNull();
    expect(destructiveDeleteTarget('DELETE', '')).toBeNull();
    expect(destructiveDeleteTarget('GET', 'products')).toBeNull();
  });
});

describe('autocomplete helpers', () => {
  it('offers _cat APIs with format=json and index names', () => {
    expect(getAutocompleteOptions(['products'], '_cat/ind')).toEqual(['_cat/indices?format=json']);
    expect(getAutocompleteOptions(['products', 'orders'], 'pro')).toEqual(['products']);
  });

  it('only suggests paths that answer with JSON', () => {
    for (const definition of autocompleteDefinitions()) {
      expect(definition).not.toContain('hot_threads');
      if (definition.startsWith('_cat/')) {
        expect(definition).toContain('format=json');
      }
    }
  });

  it('offers index names next to API roots on an empty path', () => {
    const indices = ['customers', 'logs', 'orders', 'products'];
    const options = getPathSuggestions(indices, '');
    expect(options.length).toBeLessThanOrEqual(12);
    for (const index of indices) {
      expect(options).toContain(index);
    }
    expect(options.some((option) => option.startsWith('_'))).toBe(true);
  });

  it('offers the next level once the path equals a suggestion', () => {
    expect(getPathSuggestions(['products'], 'products')).toContain('products/_search');
    expect(getPathSuggestions(['products'], '_cluster')).toContain('_cluster/health');
    expect(getPathSuggestions(['products'], '_search')).toEqual(['_search/template']);
    expect(getPathSuggestions(['products'], '_count')).toEqual([]);
    expect(getPathSuggestions(['products'], 'products/_se')).toEqual(['products/_search']);
  });

  it('splits options into typed text and completion', () => {
    expect(suggestionParts('_cluster/health', '_clu')).toEqual({
      typed: '_clu',
      completion: 'ster/health',
    });
    expect(suggestionParts('_search', 'x')).toEqual({ typed: '', completion: '_search' });
  });

  it('wraps keyboard navigation', () => {
    expect(wrapIndex(-1, 1, 3)).toBe(0);
    expect(wrapIndex(-1, -1, 3)).toBe(2);
    expect(wrapIndex(2, 1, 3)).toBe(0);
    expect(wrapIndex(0, -1, 3)).toBe(2);
    expect(wrapIndex(0, 1, 0)).toBe(-1);
  });

  it('shows the host without its scheme', () => {
    expect(hostPrefix('http://localhost:9200/')).toBe('localhost:9200/');
    expect(hostPrefix('https://es.example.com/base')).toBe('es.example.com/base/');
    expect(hostPrefix(' ')).toBe('');
  });

  it('builds cURL commands without a body when the editor is empty', () => {
    expect(
      buildCurlCommand({ method: 'GET', host: 'http://localhost:9200', path: '_cat/health', body: '' }),
    ).toBe(
      "curl --request GET --header 'Content-Type: application/json' --url 'http://localhost:9200/_cat/health'",
    );
  });
});

describe('withJsonFormat', () => {
  it('adds or replaces the format parameter', () => {
    expect(withJsonFormat('_cat/indices')).toBe('_cat/indices?format=json');
    expect(withJsonFormat('_cat/indices?v')).toBe('_cat/indices?v&format=json');
    expect(withJsonFormat('_cat/indices?')).toBe('_cat/indices?format=json');
    expect(withJsonFormat('_cat/indices?format=txt&v')).toBe('_cat/indices?format=json&v');
    expect(withJsonFormat('_cat/indices?format=json')).toBe('_cat/indices?format=json');
  });
});
