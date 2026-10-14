import { describe, expect, it } from 'vitest';
import {
  buildCurlCommand,
  formatEditorBody,
  getAutocompleteOptions,
  isNdjsonPath,
  parseEditorBody,
  shellQuote,
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
