export type AnalysisMode = 'field' | 'analyzer';

/** One entry of the `_analyze` API's `tokens` array. */
export interface AnalysisToken {
  readonly token: string;
  readonly position: number;
  readonly start_offset: number;
  readonly end_offset: number;
  readonly type?: string;
}

/** A finished analysis, kept together with the request that produced it. */
export interface AnalysisRun {
  readonly index: string;
  readonly target: string;
  readonly text: string;
  readonly tokens: readonly AnalysisToken[];
  /** The response exactly as returned (may carry extra token attributes). */
  readonly raw: unknown;
}

/** Index and field/analyzer remembered per panel (never the text). */
export interface AnalysisSelection {
  readonly index: string;
  readonly target: string;
}

export interface OptionGroup {
  /** Empty for a flat list without an `<optgroup>`. */
  readonly label: string;
  readonly options: readonly string[];
}

/** A run of the analyzed text and the tokens whose offsets cover it. */
export interface TextSegment {
  readonly text: string;
  readonly start: number;
  readonly end: number;
  readonly tokens: readonly number[];
}

export interface TokenSummary {
  readonly count: number;
  readonly unique: number;
  readonly positions: number;
}

/** Analyzers every index can use without defining them. */
export const BUILT_IN_ANALYZERS: readonly string[] = [
  'standard',
  'simple',
  'whitespace',
  'stop',
  'keyword',
  'pattern',
  'fingerprint',
];

export const LANGUAGE_ANALYZERS: readonly string[] = [
  'arabic',
  'armenian',
  'basque',
  'bengali',
  'brazilian',
  'bulgarian',
  'catalan',
  'cjk',
  'czech',
  'danish',
  'dutch',
  'english',
  'estonian',
  'finnish',
  'french',
  'galician',
  'german',
  'greek',
  'hindi',
  'hungarian',
  'indonesian',
  'irish',
  'italian',
  'latvian',
  'lithuanian',
  'norwegian',
  'persian',
  'portuguese',
  'romanian',
  'russian',
  'serbian',
  'sorani',
  'spanish',
  'swedish',
  'thai',
  'turkish',
];
