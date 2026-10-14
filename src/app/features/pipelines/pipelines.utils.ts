import { elasticsearchReason } from '../../core/errors';
import { pluralize } from '../../core/format';
import { JsonRecord, isRecord } from '../../core/json';
import { invalidCharacters } from '../../core/names';
import {
  FieldChange,
  PipelineBody,
  PipelineBodyState,
  PipelineSummary,
  PipelinesResponse,
  ProcessorField,
  ProcessorResultBody,
  ProcessorView,
  SampleDocsState,
  SimulateDoc,
  SimulateResponse,
  SimulationResult,
  SimulationStep,
} from './pipelines.models';

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

/** Short single-line rendering of any option value. */
export function inlineValue(value: unknown, max = 80): string {
  let result: string;
  if (typeof value === 'string') {
    result = value;
  } else if (Array.isArray(value) && value.every((item) => typeof item === 'string' || typeof item === 'number')) {
    result = value.join(', ');
  } else {
    result = JSON.stringify(value) ?? String(value);
  }
  result = result.replace(/\s+/g, ' ').trim();
  return result.length > max ? `${result.slice(0, max - 1)}…` : result;
}

// ---------------------------------------------------------------------------
// Pipelines
// ---------------------------------------------------------------------------

/** Built-in pipelines: flagged with _meta.managed or named with a leading dot. */
export function isManagedPipeline(id: string, pipeline: PipelineBody | undefined): boolean {
  return id.startsWith('.') || pipeline?._meta?.['managed'] === true;
}

export function normalizePipelines(response: PipelinesResponse | null | undefined): PipelineSummary[] {
  if (!isRecord(response)) {
    return [];
  }
  return Object.entries(response)
    .filter((pair): pair is [string, PipelineBody] => isRecord(pair[1]))
    .map(([id, pipeline]) => ({
      id,
      description: text(pipeline.description),
      processorCount: Array.isArray(pipeline.processors) ? pipeline.processors.length : 0,
      hasOnFailure: Array.isArray(pipeline.on_failure) && pipeline.on_failure.length > 0,
      managed: isManagedPipeline(id, pipeline),
      deprecated: pipeline.deprecated === true,
      version: typeof pipeline.version === 'number' ? pipeline.version : null,
      pipeline,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

/** Case-insensitive search over id and description; managed pipelines only on request. */
export function filterPipelines(
  pipelines: readonly PipelineSummary[],
  query: string,
  showManaged: boolean,
  keep: string | null = null,
): PipelineSummary[] {
  const needle = query.trim().toLocaleLowerCase();
  return pipelines.filter((pipeline) => {
    if (!showManaged && pipeline.managed && pipeline.id !== keep) {
      return false;
    }
    return (
      !needle ||
      pipeline.id.toLocaleLowerCase().includes(needle) ||
      (pipeline.description ?? '').toLocaleLowerCase().includes(needle)
    );
  });
}

// ---------------------------------------------------------------------------
// Processors
// ---------------------------------------------------------------------------

/** Options every processor accepts; shown separately from its own options. */
const COMMON_OPTIONS = new Set(['if', 'tag', 'description', 'ignore_failure', 'on_failure']);

interface Summary {
  readonly text: string | null;
  readonly used: readonly string[];
}

function fieldList(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map((item) => String(item)).join(', ');
  return null;
}

/** One line description of what a processor does, plus the options it covers. */
export function processorSummary(type: string, config: JsonRecord): Summary {
  const field = fieldList(config['field']);
  const target = text(config['target_field']);
  const withTarget = (used: string[] = []): Summary =>
    field
      ? { text: target ? `${field} → ${target}` : field, used: ['field', 'target_field', ...used] }
      : { text: null, used: [] };

  switch (type) {
    case 'set':
      if (config['copy_from'] !== undefined) {
        return { text: `${field ?? '?'} ← ${inlineValue(config['copy_from'])}`, used: ['field', 'copy_from'] };
      }
      return { text: `${field ?? '?'} = ${inlineValue(config['value'], 60)}`, used: ['field', 'value'] };
    case 'append':
      return { text: `${field ?? '?'} += ${inlineValue(config['value'], 60)}`, used: ['field', 'value'] };
    case 'remove':
      return config['keep'] !== undefined
        ? { text: `keep only ${fieldList(config['keep']) ?? '?'}`, used: ['keep'] }
        : { text: field, used: ['field'] };
    case 'convert':
      return {
        text: `${field ?? '?'}${target ? ` → ${target}` : ''} as ${inlineValue(config['type'])}`,
        used: ['field', 'target_field', 'type'],
      };
    case 'pipeline':
      return { text: `run pipeline ${inlineValue(config['name'])}`, used: ['name'] };
    case 'script': {
      const source = text(config['source']);
      if (source) {
        return { text: inlineValue(source, 70), used: ['source'] };
      }
      return { text: config['id'] !== undefined ? `stored script ${inlineValue(config['id'])}` : null, used: ['id'] };
    }
    case 'grok': {
      const patterns = Array.isArray(config['patterns']) ? config['patterns'] : [];
      const first = patterns.length > 0 ? inlineValue(patterns[0], 60) : '?';
      const more = patterns.length > 1 ? ` (+${patterns.length - 1} more)` : '';
      return { text: `${field ?? '?'}: ${first}${more}`, used: ['field', 'patterns'] };
    }
    case 'dissect':
      return { text: `${field ?? '?'}: ${inlineValue(config['pattern'], 60)}`, used: ['field', 'pattern'] };
    case 'gsub':
      return {
        text: `${field ?? '?'}: /${inlineValue(config['pattern'], 30)}/ → "${inlineValue(config['replacement'], 20)}"`,
        used: ['field', 'pattern', 'replacement'],
      };
    case 'split':
      return {
        text: `${field ?? '?'}${target ? ` → ${target}` : ''} by "${inlineValue(config['separator'])}"`,
        used: ['field', 'target_field', 'separator'],
      };
    case 'date': {
      const formats = fieldList(config['formats']);
      return {
        text: `${field ?? '?'} → ${target ?? '@timestamp'}${formats ? ` (${formats})` : ''}`,
        used: ['field', 'target_field', 'formats'],
      };
    }
    case 'drop':
      return { text: 'drop the document', used: [] };
    case 'fail':
      return { text: config['message'] !== undefined ? `fail: ${inlineValue(config['message'])}` : 'fail', used: ['message'] };
    case 'foreach': {
      const inner = isRecord(config['processor']) ? Object.keys(config['processor'])[0] : undefined;
      return { text: `each of ${field ?? '?'}${inner ? `: ${inner}` : ''}`, used: ['field', 'processor'] };
    }
    case 'enrich':
      return {
        text: `${field ?? '?'} via ${inlineValue(config['policy_name'])}${target ? ` → ${target}` : ''}`,
        used: ['field', 'policy_name', 'target_field'],
      };
    case 'reroute': {
      const destination = text(config['destination']);
      if (destination) {
        return { text: `to ${destination}`, used: ['destination'] };
      }
      const parts = ['dataset', 'namespace']
        .filter((key) => config[key] !== undefined)
        .map((key) => `${key} ${inlineValue(config[key])}`);
      return { text: parts.length > 0 ? parts.join(', ') : null, used: ['dataset', 'namespace'] };
    }
    default:
      return withTarget();
  }
}

function processorList(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

/** Readable, ordered view of a processor list. */
export function processorViews(processors: unknown): ProcessorView[] {
  return processorList(processors).map((entry, index) => {
    const keys = isRecord(entry) ? Object.keys(entry) : [];
    const type = keys[0] ?? 'unknown';
    const raw = isRecord(entry) ? entry[type] : undefined;
    const config: JsonRecord = isRecord(raw) ? raw : {};
    const summary = processorSummary(type, config);
    const fields: ProcessorField[] = Object.entries(config)
      .filter(([key]) => !COMMON_OPTIONS.has(key) && !summary.used.includes(key))
      .slice(0, 6)
      .map(([key, value]) => ({ label: key, value: inlineValue(value, 60) }));
    return {
      position: index + 1,
      type,
      tag: text(config['tag']),
      description: text(config['description']),
      summary: summary.text,
      fields,
      condition: text(config['if']),
      ignoreFailure: config['ignore_failure'] === true,
      onFailureCount: processorList(config['on_failure']).length,
      invalid: keys.length !== 1 || !isRecord(raw),
    };
  });
}

// ---------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------

export const NEW_PIPELINE_BODY = JSON.stringify(
  {
    description: 'Describe what this pipeline does',
    processors: [
      { lowercase: { field: 'level', ignore_missing: true } },
      { set: { field: 'ingested_at', value: '{{_ingest.timestamp}}' } },
    ],
  },
  null,
  2,
);

export function pipelineSource(pipeline: PipelineBody): string {
  return JSON.stringify(pipeline, null, 2);
}

/** Parses the editor content without throwing. */
export function analyzePipelineBody(source: string): PipelineBodyState {
  if (!source.trim()) {
    return { ok: false, message: 'The pipeline body is required' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch (error: unknown) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
  if (!isRecord(parsed)) {
    return { ok: false, message: 'The pipeline must be a JSON object' };
  }
  for (const key of ['processors', 'on_failure']) {
    if (parsed[key] !== undefined && !Array.isArray(parsed[key])) {
      return { ok: false, message: `"${key}" must be an array of processors` };
    }
  }
  return { ok: true, value: parsed as PipelineBody };
}

/** Non-blocking advice about a parsed pipeline. */
export function pipelineWarnings(pipeline: PipelineBody): string[] {
  const warnings: string[] = [];
  if (!Array.isArray(pipeline.processors) || pipeline.processors.length === 0) {
    warnings.push('The pipeline has no processors');
  }
  const invalid = [...processorViews(pipeline.processors), ...processorViews(pipeline.on_failure)].filter(
    (processor) => processor.invalid,
  ).length;
  if (invalid > 0) {
    warnings.push(`${pluralize(invalid, 'processor is', 'processors are')} not a single {"type": {…}} object`);
  }
  return warnings;
}

/**
 * Writes the description into the pipeline JSON, keeping its other keys in
 * place. Returns null when the JSON cannot be parsed.
 */
export function withDescription(source: string, description: string): string | null {
  const state = analyzePipelineBody(source);
  if (!state.ok) {
    return null;
  }
  const next: Record<string, unknown> = { ...state.value, description };
  if (!description) {
    delete next['description'];
  } else if (!('description' in state.value)) {
    // A new description goes first, where people expect it.
    return pipelineSource({ description, ...state.value });
  }
  return pipelineSource(next);
}

export type SaveMode = 'create' | 'update' | 'overwrite' | 'copy';

/**
 * What saving does: create a new pipeline, update the one being edited,
 * overwrite another existing pipeline with the typed id, or copy the edited
 * pipeline under a new id.
 */
export function saveMode(id: string, selected: string | null, existing: readonly string[]): SaveMode {
  if (selected !== null && id === selected) {
    return 'update';
  }
  if (existing.includes(id)) {
    return 'overwrite';
  }
  return selected === null ? 'create' : 'copy';
}

/** Characters that would break the `_ingest/pipeline/<id>` URL. */
const PIPELINE_ID_RESERVED_CHARACTERS: readonly string[] = ['/', '\\', '?', '#'];

/** Pipeline ids are part of the URL: keep them free of spaces and reserved prefixes. */
export function validatePipelineId(id: string): string | null {
  if (!id) {
    return 'Enter an id for the pipeline';
  }
  if (/\s/.test(id)) {
    return 'Pipeline ids cannot contain spaces';
  }
  if (id.startsWith('_')) {
    return 'Pipeline ids cannot start with "_"';
  }
  const invalid = invalidCharacters(id, PIPELINE_ID_RESERVED_CHARACTERS);
  if (invalid.length > 0) {
    return `Pipeline ids cannot contain ${invalid.map((character) => `"${character}"`).join(', ')}`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Sample documents
// ---------------------------------------------------------------------------

const SAMPLE_VALUES: Readonly<Record<string, readonly [unknown, unknown]>> = {
  '@timestamp': ['2026-10-14T09:15:00.000Z', '2026-10-14T09:16:30.000Z'],
  timestamp: ['2026-10-14T09:15:00.000Z', '2026-10-14T09:16:30.000Z'],
  level: ['INFO', 'ERROR'],
  'log.level': ['INFO', 'ERROR'],
  msg: ['User signed in', 'Payment failed: card declined'],
  message: ['User signed in', 'Payment failed: card declined'],
  host: ['web-01', 'web-02'],
  'host.name': ['web-01', 'web-02'],
  hostname: ['web-01', 'web-02'],
  user: ['alice', 'bob'],
  'user.name': ['alice', 'bob'],
  status: [200, 500],
  'http.response.status_code': [200, 500],
  ip: ['203.0.113.10', '198.51.100.7'],
  'client.ip': ['203.0.113.10', '198.51.100.7'],
  'source.ip': ['203.0.113.10', '198.51.100.7'],
  user_agent: ['Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 Safari/605.1.15', 'curl/8.4.0'],
  'user_agent.original': ['Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 Safari/605.1.15', 'curl/8.4.0'],
  url: ['https://shop.example.com/cart?item=42', 'https://shop.example.com/checkout'],
  'url.original': ['https://shop.example.com/cart?item=42', 'https://shop.example.com/checkout'],
  duration: [125, 2048],
  tags: [['web'], ['web', 'payments']],
};

/** Fields a pipeline reads (not the ones it only writes). */
export function inputFields(pipeline: PipelineBody | undefined): string[] {
  const fields = new Set<string>();
  const writers = new Set(['set', 'append']);
  for (const processor of processorViews(pipeline?.processors)) {
    if (processor.invalid || writers.has(processor.type)) {
      continue;
    }
    const entry = processorList(pipeline?.processors)[processor.position - 1];
    const config = isRecord(entry) && isRecord(entry[processor.type]) ? (entry[processor.type] as JsonRecord) : {};
    const value = config['field'];
    const names = typeof value === 'string' ? [value] : Array.isArray(value) ? value : [];
    for (const name of names) {
      if (typeof name === 'string' && name && !name.includes('{{') && !name.startsWith('_')) {
        fields.add(name);
      }
    }
  }
  return [...fields];
}

function setPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.');
  let current: Record<string, unknown> = target;
  for (const part of parts.slice(0, -1)) {
    const next = current[part];
    if (next === undefined) {
      const created: Record<string, unknown> = {};
      current[part] = created;
      current = created;
    } else if (isRecord(next)) {
      current = next as Record<string, unknown>;
    } else {
      return;
    }
  }
  const leaf = parts[parts.length - 1] ?? path;
  if (current[leaf] === undefined) {
    current[leaf] = value;
  }
}

/** Two example documents that exercise the fields the pipeline reads. */
export function sampleDocsFor(pipeline: PipelineBody | undefined): string {
  const fields = inputFields(pipeline);
  const wanted = fields.length > 0 ? ['@timestamp', ...fields] : ['@timestamp', 'level', 'message'];
  const docs = [0, 1].map((variant) => {
    const source: Record<string, unknown> = {};
    for (const field of wanted) {
      const known = SAMPLE_VALUES[field];
      const leaf = field.split('.').pop() ?? field;
      setPath(source, field, known ? known[variant] : variant === 0 ? `example ${leaf}` : `another ${leaf}`);
    }
    return source;
  });
  return JSON.stringify(docs, null, 2);
}

/**
 * Accepts a JSON array of `_source` objects (or of `{_index, _id, _source}`
 * documents), or a single object.
 */
export function parseSampleDocs(source: string): SampleDocsState {
  if (!source.trim()) {
    return { ok: false, message: 'Add at least one sample document' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch (error: unknown) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
  const items = Array.isArray(parsed) ? parsed : [parsed];
  if (items.length === 0) {
    return { ok: false, message: 'Add at least one sample document' };
  }
  const docs: SimulateDoc[] = [];
  for (const [index, item] of items.entries()) {
    if (!isRecord(item)) {
      return { ok: false, message: `Document ${index + 1} must be a JSON object` };
    }
    if (isRecord(item['_source'])) {
      docs.push({
        ...(typeof item['_index'] === 'string' ? { _index: item['_index'] } : {}),
        ...(typeof item['_id'] === 'string' ? { _id: item['_id'] } : {}),
        _source: item['_source'],
      });
    } else {
      docs.push({ _source: item });
    }
  }
  return { ok: true, docs };
}

export function buildSimulatePayload(
  pipeline: PipelineBody,
  docs: readonly SimulateDoc[],
  verbose: boolean,
): Record<string, unknown> {
  return { pipeline, docs, verbose };
}

// ---------------------------------------------------------------------------
// Simulation results
// ---------------------------------------------------------------------------

function flatten(value: unknown, prefix: string, into: Map<string, string>): void {
  if (isRecord(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0 && prefix) {
      into.set(prefix, '{}');
    }
    for (const [key, child] of entries) {
      flatten(child, prefix ? `${prefix}.${key}` : key, into);
    }
    return;
  }
  if (prefix) {
    into.set(prefix, JSON.stringify(value) ?? 'undefined');
  }
}

/** Leaf fields added, removed or changed between two versions of a document. */
export function diffSources(before: unknown, after: unknown): FieldChange[] {
  const left = new Map<string, string>();
  const right = new Map<string, string>();
  flatten(before, '', left);
  flatten(after, '', right);
  const changes: FieldChange[] = [];
  for (const [path, value] of right) {
    if (!left.has(path)) {
      changes.push({ path, kind: 'added' });
    } else if (left.get(path) !== value) {
      changes.push({ path, kind: 'changed' });
    }
  }
  for (const path of left.keys()) {
    if (!right.has(path)) {
      changes.push({ path, kind: 'removed' });
    }
  }
  return changes.sort((a, b) => a.path.localeCompare(b.path));
}

function documentParts(doc: unknown): {
  source: JsonRecord | null;
  metadata: JsonRecord | null;
} {
  if (!isRecord(doc)) {
    return { source: null, metadata: null };
  }
  const { _source: source, ...metadata } = doc;
  return { source: isRecord(source) ? source : null, metadata };
}

function stepError(step: ProcessorResultBody): string | null {
  if (step.error !== undefined) {
    return elasticsearchReason(step.error) ?? 'Unknown error';
  }
  if (step.ignored_error !== undefined) {
    return elasticsearchReason(step.ignored_error);
  }
  return null;
}

function processorLabel(step: SimulationStep): string {
  return step.tag ? `${step.type} (${step.tag})` : step.type;
}

/** Index name the simulate API reports for a document that did not set one. */
const DEFAULT_SIMULATE_INDEX = '_index';

function inputIndex(input: SimulateDoc | undefined): string {
  return input?._index ?? DEFAULT_SIMULATE_INDEX;
}

/** The index the document would be written to, when the pipeline changed it. */
function rerouted(metadata: JsonRecord | null, input: SimulateDoc | undefined): string | null {
  const index = text(metadata?.['_index']);
  return index !== null && index !== inputIndex(input) ? index : null;
}

function normalizeVerbose(
  position: number,
  results: readonly unknown[],
  input: SimulateDoc | undefined,
  raw: unknown,
): SimulationResult {
  let current: JsonRecord | null = input?._source ?? null;
  let currentIndex = inputIndex(input);
  let metadata: JsonRecord | null = null;
  const steps: SimulationStep[] = results.filter(isRecord).map((entry, index) => {
    const step = entry as ProcessorResultBody;
    const { source, metadata: meta } = documentParts(step.doc);
    const changes = source ? diffSources(current ?? {}, source) : [];
    const stepIndex = text(meta?.['_index']);
    if (stepIndex !== null && stepIndex !== currentIndex) {
      changes.unshift({ path: '_index', kind: 'changed' });
      currentIndex = stepIndex;
    }
    if (source) {
      current = source;
      metadata = meta;
    }
    return {
      position: index + 1,
      type: text(step.processor_type) ?? 'processor',
      status: text(step.status) ?? 'success',
      tag: text(step.tag),
      condition: text(step.if?.condition),
      error: stepError(step),
      source,
      changes,
    };
  });
  const last = steps[steps.length - 1];
  const dropped = steps.some((step) => step.status === 'dropped');
  const failed = last?.status === 'error';
  return {
    position,
    outcome: failed ? 'error' : dropped ? 'dropped' : 'ok',
    error: failed ? last.error : null,
    failedProcessor: failed && last ? processorLabel(last) : null,
    source: failed || dropped ? null : current,
    metadata,
    targetIndex: failed || dropped ? null : rerouted(metadata, input),
    steps,
    raw,
  };
}

/**
 * Per document outcome of POST _ingest/pipeline/_simulate, in either mode.
 * `inputs` are the submitted sources, used to show what each step changed.
 */
export function normalizeSimulation(
  response: SimulateResponse | null | undefined,
  inputs: readonly SimulateDoc[] = [],
): SimulationResult[] {
  const docs = Array.isArray(response?.docs) ? response.docs : [];
  return docs.map((entry, index): SimulationResult => {
    const position = index + 1;
    const input = inputs[index];
    const empty = { error: null, failedProcessor: null, source: null, metadata: null, targetIndex: null, steps: null };
    if (!isRecord(entry)) {
      // Non-verbose simulations report dropped documents as null.
      return { ...empty, position, outcome: 'dropped', raw: entry };
    }
    if (Array.isArray(entry['processor_results'])) {
      return normalizeVerbose(position, entry['processor_results'], input, entry);
    }
    if (entry['error'] !== undefined) {
      return { ...empty, position, outcome: 'error', error: elasticsearchReason(entry['error']) ?? 'Unknown error', raw: entry };
    }
    const { source, metadata } = documentParts(entry['doc']);
    return { ...empty, position, outcome: 'ok', source, metadata, targetIndex: rerouted(metadata, input), raw: entry };
  });
}

/** One sentence summary of a run, announced to screen readers. */
export function simulationAnnouncement(results: readonly SimulationResult[]): string {
  if (results.length === 0) {
    return 'The simulation returned no documents.';
  }
  const ok = results.filter((result) => result.outcome === 'ok').length;
  const failed = results.filter((result) => result.outcome === 'error').length;
  const dropped = results.filter((result) => result.outcome === 'dropped').length;
  const parts = [
    ok > 0 ? `${ok} processed` : '',
    failed > 0 ? `${failed} failed` : '',
    dropped > 0 ? `${dropped} dropped` : '',
  ].filter(Boolean);
  return `Simulation finished for ${pluralize(results.length, 'document')}: ${parts.join(', ')}.`;
}

/** Changes made to a document by the whole pipeline (non-verbose mode). */
export function overallChanges(result: SimulationResult, input: SimulateDoc | undefined): FieldChange[] {
  return result.source && input ? diffSources(input._source, result.source) : [];
}
