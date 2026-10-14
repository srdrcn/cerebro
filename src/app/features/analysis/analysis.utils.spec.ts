import { describe, expect, it } from 'vitest';
import { AnalysisToken } from './analysis.models';
import {
  analysisAnnouncement,
  analyzerGroups,
  asNames,
  asTokens,
  defaultTarget,
  parseSelection,
  splitIndices,
  textSegments,
  tokenSummary,
} from './analysis.utils';

function token(
  value: string,
  position: number,
  start: number,
  end: number,
  type?: string,
): AnalysisToken {
  return {
    token: value,
    position,
    start_offset: start,
    end_offset: end,
    ...(type ? { type } : {}),
  };
}

describe('analysis option normalization', () => {
  it('keeps only non-empty string names from a response', () => {
    expect(asNames(['b', 3, '', null, 'a', 'b'])).toEqual(['a', 'b']);
    expect(asNames({ error: 'x' })).toEqual([]);
  });

  it('puts hidden and system indices in their own group', () => {
    expect(splitIndices(['products', '.kibana', 'logs', '.tasks'])).toEqual({
      regular: ['logs', 'products'],
      hidden: ['.kibana', '.tasks'],
    });
  });
});

describe('analyzer choices', () => {
  it('lists built-in and language analyzers when the index defines none', () => {
    const groups = analyzerGroups([]);
    expect(groups.map((group) => group.label)).toEqual(['Built-in', 'Language']);
    expect(groups[0]?.options).toContain('standard');
    expect(groups[1]?.options).toContain('english');
  });

  it('puts index analyzers first and lets them shadow built-in names', () => {
    const groups = analyzerGroups(['autocomplete', 'english']);
    expect(groups[0]).toEqual({ label: 'Defined in this index', options: ['autocomplete', 'english'] });
    expect(groups[2]?.options).not.toContain('english');
  });

  it('preselects the remembered choice when it is still available', () => {
    expect(defaultTarget('field', ['description', 'title'], 'title')).toBe('title');
    expect(defaultTarget('field', ['description', 'title'], 'missing')).toBe('');
    expect(defaultTarget('field', ['name'], '')).toBe('name');
    expect(defaultTarget('field', [], '')).toBe('');
  });

  it('defaults to the analyzer Elasticsearch uses for the index', () => {
    // An index analyzer named `default` is what the index uses for text fields.
    expect(defaultTarget('analyzer', ['bad', 'default', 'my_shingle'], '')).toBe('default');
    // Otherwise `standard`, never an arbitrary custom analyzer.
    expect(defaultTarget('analyzer', ['bad', 'my_shingle', 'standard'], '')).toBe('standard');
    expect(defaultTarget('analyzer', ['my_analyzer'], '')).toBe('standard');
    expect(defaultTarget('analyzer', [], '')).toBe('standard');
  });

  it('keeps a remembered analyzer only while it is still available', () => {
    expect(defaultTarget('analyzer', ['default', 'my_analyzer'], 'my_analyzer')).toBe('my_analyzer');
    expect(defaultTarget('analyzer', [], 'french')).toBe('french');
    expect(defaultTarget('analyzer', [], 'gone_custom')).toBe('standard');
  });
});

describe('analysis tokens', () => {
  it('normalizes the analyze response', () => {
    expect(
      asTokens([
        { token: 'quick', start_offset: 4, end_offset: 9, type: '<ALPHANUM>', position: 1 },
        { token: 42, position: 'x' },
        'junk',
      ]),
    ).toEqual([
      token('quick', 1, 4, 9, '<ALPHANUM>'),
      { token: '42', position: 0, start_offset: 0, end_offset: 0 },
    ]);
    expect(asTokens(null)).toEqual([]);
  });

  it('summarizes counts, unique terms and positions', () => {
    expect(
      tokenSummary([token('fox', 0, 0, 3), token('fox', 1, 4, 7), token('dog', 1, 4, 7)]),
    ).toEqual({ count: 3, unique: 2, positions: 2 });
  });
});

describe('text segments', () => {
  it('marks covered characters and keeps dropped text visible', () => {
    const text = 'The quick fox';
    expect(textSegments(text, [token('quick', 1, 4, 9), token('fox', 2, 10, 13)])).toEqual([
      { text: 'The ', start: 0, end: 4, tokens: [] },
      { text: 'quick', start: 4, end: 9, tokens: [0] },
      { text: ' ', start: 9, end: 10, tokens: [] },
      { text: 'fox', start: 10, end: 13, tokens: [1] },
    ]);
  });

  it('handles overlapping tokens such as synonyms and n-grams', () => {
    const segments = textSegments('abc', [token('ab', 0, 0, 2), token('abc', 0, 0, 3), token('bc', 1, 1, 3)]);
    expect(segments).toEqual([
      { text: 'a', start: 0, end: 1, tokens: [0, 1] },
      { text: 'b', start: 1, end: 2, tokens: [0, 1, 2] },
      { text: 'c', start: 2, end: 3, tokens: [1, 2] },
    ]);
  });

  it('clamps offsets outside the text and ignores empty ranges', () => {
    expect(textSegments('hi', [token('hi', 0, -3, 99), token('x', 1, 1, 1)])).toEqual([
      { text: 'hi', start: 0, end: 2, tokens: [0] },
    ]);
    expect(textSegments('', [token('x', 0, 0, 1)])).toEqual([]);
    expect(textSegments('plain', [])).toEqual([{ text: 'plain', start: 0, end: 5, tokens: [] }]);
  });
});

describe('remembered selection', () => {
  it('accepts only a well-formed selection', () => {
    expect(parseSelection({ index: 'products', target: 'title' })).toEqual({
      index: 'products',
      target: 'title',
    });
    expect(parseSelection({ index: 'products' })).toEqual({ index: 'products', target: '' });
    expect(parseSelection({ index: '' })).toBeNull();
    expect(parseSelection('products')).toBeNull();
    expect(parseSelection(null)).toBeNull();
  });
});

describe('analysis announcements', () => {
  const run = (tokens: readonly AnalysisToken[]) => ({ index: 'products', target: 'title', tokens });

  it('summarizes the outcome instead of reading every token', () => {
    expect(analysisAnnouncement(run([token('a', 0, 0, 1), token('b', 1, 2, 3)]), null)).toBe(
      '2 tokens for products › title',
    );
    expect(analysisAnnouncement(run([token('a', 0, 0, 1)]), null)).toBe('1 token for products › title');
    expect(analysisAnnouncement(run([]), null)).toBe('No tokens for products › title');
  });

  it('announces failures and stays silent without an outcome', () => {
    expect(analysisAnnouncement(null, 'failed to find analyzer [x]')).toBe(
      'Analysis failed: failed to find analyzer [x]',
    );
    expect(analysisAnnouncement(null, null)).toBe('');
  });
});
