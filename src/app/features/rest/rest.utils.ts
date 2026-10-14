export const REST_METHODS = ['GET', 'PUT', 'POST', 'DELETE'] as const;

export type RestMethod = (typeof REST_METHODS)[number];

export interface CurlRequest {
  readonly method: RestMethod;
  readonly host: string;
  readonly path: string;
  readonly body: string;
}

/**
 * Elasticsearch's bulk and multi-search APIs use newline-delimited JSON.
 * Query parameters are ignored while deciding the content type.
 */
export function isNdjsonPath(path: string): boolean {
  const pathname = path.trim().split(/[?#]/, 1)[0]?.replace(/\/+$/, '') ?? '';
  return /(?:^|\/)_(?:bulk|msearch(?:\/template)?)$/.test(pathname);
}

/**
 * Preserve NDJSON and malformed input as strings. Regular, valid JSON is sent
 * as a JSON value so the Play endpoint keeps its existing request contract.
 */
export function parseEditorBody(path: string, source: string): unknown {
  if (isNdjsonPath(path)) {
    return source;
  }

  try {
    return JSON.parse(source) as unknown;
  } catch {
    return source;
  }
}

export function formatNdjson(source: string): string {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');

  while (lines.at(-1)?.trim() === '') {
    lines.pop();
  }

  if (lines.length === 0) {
    return '';
  }

  const formatted = lines.map((line, index) => {
    if (line.trim() === '') {
      throw new SyntaxError(`Invalid blank NDJSON line ${index + 1}`);
    }
    try {
      return JSON.stringify(JSON.parse(line) as unknown);
    } catch {
      throw new SyntaxError(`Invalid JSON on NDJSON line ${index + 1}`);
    }
  });

  // Elasticsearch requires the final newline for bulk-style request bodies.
  return `${formatted.join('\n')}\n`;
}

export function formatEditorBody(path: string, source: string): string {
  try {
    if (isNdjsonPath(path)) {
      return formatNdjson(source);
    }
    return JSON.stringify(JSON.parse(source) as unknown, null, 2);
  } catch {
    return source;
  }
}

/** Quote one argument for a POSIX-compatible shell. */
export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function requestUrl(host: string, path: string): string {
  const normalizedHost = host.trim().replace(/\/+$/, '');
  const normalizedPath = path.trim().startsWith('/')
    ? path.trim()
    : `/${path.trim()}`;
  return `${normalizedHost}${encodeURI(normalizedPath)}`;
}

export function buildCurlCommand(request: CurlRequest): string {
  const ndjson = isNdjsonPath(request.path);
  const contentType = ndjson
    ? 'application/x-ndjson'
    : 'application/json';
  const args = [
    'curl',
    '--request',
    request.method,
    '--header',
    shellQuote(`Content-Type: ${contentType}`),
    '--url',
    shellQuote(requestUrl(request.host, request.path)),
  ];

  let body: string;
  if (ndjson) {
    body = formatNdjson(request.body);
  } else {
    body = JSON.stringify(JSON.parse(request.body) as unknown, null, 2);
  }
  // GET and DELETE bodies are supported by Elasticsearch and must not be lost
  // when copying the request (notably GET /_search).
  args.push('--data-raw', shellQuote(body));

  return args.join(' ');
}

const AUTOCOMPLETE_PATHS = [
  '_msearch',
  '{index}/_msearch',
  '_msearch/template',
  '{index}/_msearch/template',
  '_search',
  '{index}/_search',
  '_search/template',
  '{index}/_search/template',
] as const;

function autocompleteCandidates(indices: readonly string[], path: string): string[] {
  const leadingSlash = path.startsWith('/');
  const value = leadingSlash ? path.slice(1) : path;
  const pathTokens = value.split('/');
  const tokenIndex = pathTokens.length - 1;
  const alternatives = new Set<string>();

  for (const definition of AUTOCOMPLETE_PATHS) {
    const suggestionTokens: string[] = definition.split('/');
    if (suggestionTokens.length <= tokenIndex) {
      continue;
    }

    const previousTokensMatch = pathTokens
      .slice(0, -1)
      .every((token, index) =>
        suggestionTokens[index] === '{index}'
          ? indices.includes(token)
          : suggestionTokens[index] === token,
      );
    if (!previousTokensMatch) {
      continue;
    }

    const token = suggestionTokens[tokenIndex];
    const suggestedTokens = token === '{index}' ? indices : [token];
    const prefix = pathTokens.slice(0, -1).join('/');
    for (const suggestedToken of suggestedTokens) {
      const candidate = `${prefix ? `${prefix}/` : ''}${suggestedToken}`;
      alternatives.add(leadingSlash ? `/${candidate}` : candidate);
    }
  }

  return [...alternatives].sort((left, right) => left.localeCompare(right));
}

/** Match the old typeahead's starts-with filter and ten-result limit. */
export function getAutocompleteOptions(
  indices: readonly string[],
  path: string,
): string[] {
  return autocompleteCandidates(indices, path)
    .filter((candidate) => candidate.startsWith(path))
    .slice(0, 10);
}

export function responseText(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

export function errorResponse(error: unknown): unknown {
  if (typeof error === 'object' && error !== null) {
    if ('error' in error) {
      return (error as { readonly error: unknown }).error;
    }
    if ('body' in error) {
      return (error as { readonly body: unknown }).body;
    }
  }
  return error;
}
