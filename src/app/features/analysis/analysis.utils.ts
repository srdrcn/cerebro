import { ClusterApiError } from '../../core/api-envelope';
import { sortByName } from '../../core/format';
import {
  AnalysisMode,
  AnalysisRun,
  AnalysisSelection,
  AnalysisToken,
  BUILT_IN_ANALYZERS,
  IndexGroups,
  LANGUAGE_ANALYZERS,
  OptionGroup,
  TextSegment,
  TokenSummary,
} from './analysis.models';

/** Sorted, de-duplicated index, field or analyzer names. */
export function sortedNames(values: readonly string[]): readonly string[] {
  return sortByName(values);
}

/** Keeps the string entries of an API response that should be a name list. */
export function asNames(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return sortedNames(value.filter((name): name is string => typeof name === 'string' && name !== ''));
}

/** Regular indices first; hidden/system ones (".kibana") in their own group. */
export function splitIndices(names: readonly string[]): IndexGroups {
  const sorted = sortedNames(names);
  return {
    regular: sorted.filter((name) => !name.startsWith('.')),
    hidden: sorted.filter((name) => name.startsWith('.')),
  };
}

/**
 * Analyzer choices for an index: the analyzers it defines, then the built-in
 * and language analyzers (an index-defined analyzer shadows a built-in one).
 */
export function analyzerGroups(custom: readonly string[]): readonly OptionGroup[] {
  const defined = new Set(custom);
  const groups: OptionGroup[] = [];
  if (custom.length > 0) {
    groups.push({ label: 'Defined in this index', options: sortedNames(custom) });
  }
  groups.push(
    { label: 'Built-in', options: BUILT_IN_ANALYZERS.filter((name) => !defined.has(name)) },
    { label: 'Language', options: LANGUAGE_ANALYZERS.filter((name) => !defined.has(name)) },
  );
  return groups;
}

/**
 * Field or analyzer to preselect once the options of an index are known:
 * the remembered one when it still exists, otherwise the only text field, or
 * the analyzer Elasticsearch itself uses for the index — the one named
 * `default` when the index defines it, else `standard`.
 */
export function defaultTarget(
  mode: AnalysisMode,
  options: readonly string[],
  preferred: string,
): string {
  const available =
    mode === 'analyzer' ? analyzerGroups(options).flatMap((group) => group.options) : options;
  if (preferred && available.includes(preferred)) {
    return preferred;
  }
  if (mode === 'field') {
    return options.length === 1 ? (options[0] ?? '') : '';
  }
  // `standard` is always available: built in, or redefined by the index.
  return options.includes('default') ? 'default' : 'standard';
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function offset(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** Validates the tokens returned by the analyze endpoints. */
export function asTokens(value: unknown): readonly AnalysisToken[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(isRecord).map((entry) => {
    const type = entry['type'];
    return {
      token: typeof entry['token'] === 'string' ? entry['token'] : String(entry['token'] ?? ''),
      position: offset(entry['position']),
      start_offset: offset(entry['start_offset']),
      end_offset: offset(entry['end_offset']),
      ...(typeof type === 'string' && type ? { type } : {}),
    };
  });
}

export function tokenSummary(tokens: readonly AnalysisToken[]): TokenSummary {
  return {
    count: tokens.length,
    unique: new Set(tokens.map((token) => token.token)).size,
    positions: new Set(tokens.map((token) => token.position)).size,
  };
}

/**
 * Splits the analyzed text at every token boundary so the UI can show which
 * characters became which token — and which ones (stop words, punctuation)
 * did not end up in any token. Segments covered by no token have no indexes.
 */
export function textSegments(
  text: string,
  tokens: readonly AnalysisToken[],
): readonly TextSegment[] {
  const length = text.length;
  if (length === 0) {
    return [];
  }
  const clamp = (value: number) => Math.min(Math.max(0, Math.trunc(value)), length);
  const ranges = tokens
    .map((token, index) => ({
      index,
      start: clamp(token.start_offset),
      end: clamp(token.end_offset),
    }))
    .filter((range) => range.end > range.start);

  const bounds = new Set<number>([0, length]);
  for (const range of ranges) {
    bounds.add(range.start);
    bounds.add(range.end);
  }
  const edges = [...bounds].sort((left, right) => left - right);

  const segments: TextSegment[] = [];
  for (let edge = 0; edge < edges.length - 1; edge++) {
    const start = edges[edge] ?? 0;
    const end = edges[edge + 1] ?? length;
    const covering = ranges
      .filter((range) => range.start <= start && range.end >= end)
      .map((range) => range.index);
    const previous = segments.at(-1);
    if (previous && previous.tokens.length === 0 && covering.length === 0) {
      segments[segments.length - 1] = {
        ...previous,
        text: text.slice(previous.start, end),
        end,
      };
    } else {
      segments.push({ text: text.slice(start, end), start, end, tokens: covering });
    }
  }
  return segments;
}

/** Restores a remembered selection, ignoring anything malformed. */
export function parseSelection(value: unknown): AnalysisSelection | null {
  if (!isRecord(value)) {
    return null;
  }
  const index = value['index'];
  const target = value['target'];
  if (typeof index !== 'string' || !index) {
    return null;
  }
  return { index, target: typeof target === 'string' ? target : '' };
}

/**
 * Short outcome of an analysis for screen readers: the token count (or the
 * failure), never the tokens themselves.
 */
export function analysisAnnouncement(
  run: Pick<AnalysisRun, 'index' | 'target' | 'tokens'> | null,
  error: string | null,
): string {
  if (error !== null) {
    return `Analysis failed: ${error}`;
  }
  if (!run) {
    return '';
  }
  const count = run.tokens.length;
  const tokens = count === 0 ? 'No tokens' : `${count} ${count === 1 ? 'token' : 'tokens'}`;
  return `${tokens} for ${run.index} › ${run.target}`;
}

/** Best human readable reason of a failed request (Elasticsearch error body). */
export function analysisErrorReason(error: unknown): string | null {
  if (error instanceof ClusterApiError) {
    const body: unknown = error.body;
    if (typeof body === 'string') {
      return body || null;
    }
    if (isRecord(body)) {
      const inner = body['error'];
      if (typeof inner === 'string') {
        return inner;
      }
      if (isRecord(inner) && typeof inner['reason'] === 'string') {
        return inner['reason'];
      }
    }
    return `The cluster answered with status ${error.status}.`;
  }
  return error instanceof Error ? error.message : null;
}
