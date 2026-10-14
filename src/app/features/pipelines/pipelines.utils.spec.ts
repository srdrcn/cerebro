import { describe, expect, it } from 'vitest';
import { PipelinesResponse, SimulateResponse } from './pipelines.models';
import {
  NEW_PIPELINE_BODY,
  analyzePipelineBody,
  buildSimulatePayload,
  diffSources,
  filterPipelines,
  inlineValue,
  inputFields,
  isManagedPipeline,
  normalizePipelines,
  normalizeSimulation,
  overallChanges,
  parseSampleDocs,
  pipelineSource,
  pipelineWarnings,
  processorSummary,
  processorViews,
  sampleDocsFor,
  simulationAnnouncement,
  validatePipelineId,
  withDescription,
} from './pipelines.utils';

const PIPELINES: PipelinesResponse = {
  'app-enrich': {
    description: 'Normalises application events',
    processors: [
      { lowercase: { field: 'level', ignore_missing: true } },
      { set: { field: 'ingested_at', value: '{{_ingest.timestamp}}' } },
      { rename: { field: 'msg', target_field: 'message', ignore_missing: true } },
    ],
  },
  'logs@default-pipeline': {
    processors: [{ set: { field: 'event.ingested', value: '{{_ingest.timestamp}}' } }],
    _meta: { managed: true },
    version: 3,
  },
  '.hidden': { processors: [], on_failure: [{ set: { field: 'error', value: 'x' } }] },
};

describe('pipelines', () => {
  it('detects managed pipelines', () => {
    expect(isManagedPipeline('.fleet', {})).toBe(true);
    expect(isManagedPipeline('logs', { _meta: { managed: true } })).toBe(true);
    expect(isManagedPipeline('mine', { _meta: { managed: false } })).toBe(false);
    expect(isManagedPipeline('mine', undefined)).toBe(false);
  });

  it('normalizes the list', () => {
    const list = normalizePipelines(PIPELINES);
    expect(list.map((item) => item.id)).toEqual(['.hidden', 'app-enrich', 'logs@default-pipeline']);
    expect(list[1]).toMatchObject({ description: 'Normalises application events', processorCount: 3, managed: false, version: null });
    expect(list[2]).toMatchObject({ managed: true, version: 3, description: null });
    expect(list[0]).toMatchObject({ managed: true, hasOnFailure: true, processorCount: 0 });
    expect(normalizePipelines(undefined)).toEqual([]);
  });

  it('filters by id and description and hides managed pipelines', () => {
    const list = normalizePipelines(PIPELINES);
    expect(filterPipelines(list, '', false).map((item) => item.id)).toEqual(['app-enrich']);
    expect(filterPipelines(list, '', true)).toHaveLength(3);
    expect(filterPipelines(list, 'NORMALISES', false).map((item) => item.id)).toEqual(['app-enrich']);
    expect(filterPipelines(list, 'logs', true).map((item) => item.id)).toEqual(['logs@default-pipeline']);
    expect(filterPipelines(list, '', false, 'logs@default-pipeline').map((item) => item.id)).toEqual([
      'app-enrich',
      'logs@default-pipeline',
    ]);
  });
});

describe('processors', () => {
  it('summarizes common processors', () => {
    expect(processorSummary('set', { field: 'a', value: 'b' }).text).toBe('a = b');
    expect(processorSummary('set', { field: 'a', copy_from: 'b' }).text).toBe('a ← b');
    expect(processorSummary('rename', { field: 'msg', target_field: 'message' }).text).toBe('msg → message');
    expect(processorSummary('lowercase', { field: 'level' }).text).toBe('level');
    expect(processorSummary('remove', { field: ['a', 'b'] }).text).toBe('a, b');
    expect(processorSummary('remove', { keep: ['a'] }).text).toBe('keep only a');
    expect(processorSummary('convert', { field: 'n', type: 'integer' }).text).toBe('n as integer');
    expect(processorSummary('pipeline', { name: 'other' }).text).toBe('run pipeline other');
    expect(processorSummary('grok', { field: 'message', patterns: ['%{IP:ip}', '%{WORD:w}'] }).text).toBe(
      'message: %{IP:ip} (+1 more)',
    );
    expect(processorSummary('date', { field: 'ts', formats: ['ISO8601'] }).text).toBe('ts → @timestamp (ISO8601)');
    expect(processorSummary('drop', {}).text).toBe('drop the document');
    expect(processorSummary('fail', { message: 'boom' }).text).toBe('fail: boom');
    expect(processorSummary('foreach', { field: 'tags', processor: { uppercase: { field: '_ingest._value' } } }).text).toBe(
      'each of tags: uppercase',
    );
    expect(processorSummary('script', { source: 'ctx.a =\n  1' }).text).toBe('ctx.a = 1');
    expect(processorSummary('script', { id: 'stored' }).text).toBe('stored script stored');
    expect(processorSummary('reroute', { dataset: 'web', namespace: 'prod' }).text).toBe('dataset web, namespace prod');
    expect(processorSummary('unknown_type', {}).text).toBeNull();
  });

  it('builds readable processor views with flags', () => {
    const views = processorViews([
      { rename: { field: 'msg', target_field: 'message', ignore_missing: true, tag: 'r1' } },
      { set: { field: 'x', value: 1, if: 'ctx.y != null', ignore_failure: true, on_failure: [{ set: {} }] } },
      { bad: 'shape' },
      { a: {}, b: {} },
    ]);
    expect(views[0]).toMatchObject({
      position: 1,
      type: 'rename',
      tag: 'r1',
      summary: 'msg → message',
      fields: [{ label: 'ignore_missing', value: 'true' }],
      invalid: false,
    });
    expect(views[1]).toMatchObject({ condition: 'ctx.y != null', ignoreFailure: true, onFailureCount: 1, fields: [] });
    expect(views[2]?.invalid).toBe(true);
    expect(views[3]?.invalid).toBe(true);
    expect(processorViews(undefined)).toEqual([]);
  });

  it('shortens inline values', () => {
    expect(inlineValue(['a', 'b'])).toBe('a, b');
    expect(inlineValue({ a: 1 })).toBe('{"a":1}');
    expect(inlineValue('x'.repeat(100), 10)).toBe(`${'x'.repeat(9)}…`);
  });
});

describe('editor', () => {
  it('parses and validates pipeline bodies', () => {
    const state = analyzePipelineBody(NEW_PIPELINE_BODY);
    expect(state.ok).toBe(true);
    if (state.ok) {
      expect(pipelineWarnings(state.value)).toEqual([]);
    }
    expect(analyzePipelineBody('')).toEqual({ ok: false, message: 'The pipeline body is required' });
    expect(analyzePipelineBody('[1]')).toEqual({ ok: false, message: 'The pipeline must be a JSON object' });
    expect(analyzePipelineBody('{"processors": {}}')).toEqual({
      ok: false,
      message: '"processors" must be an array of processors',
    });
    expect(analyzePipelineBody('{').ok).toBe(false);
  });

  it('warns about empty and malformed processors', () => {
    expect(pipelineWarnings({})).toEqual(['The pipeline has no processors']);
    expect(pipelineWarnings({ processors: [{ set: {} }, { a: {}, b: {} }] })).toEqual([
      '1 processor is not a single {"type": {…}} object',
    ]);
  });

  it('writes the description into the JSON', () => {
    const source = pipelineSource({ processors: [] });
    expect(JSON.parse(withDescription(source, 'Hello') ?? '')).toEqual({ description: 'Hello', processors: [] });
    expect(Object.keys(JSON.parse(withDescription(source, 'Hello') ?? '{}'))).toEqual(['description', 'processors']);
    const described = pipelineSource({ processors: [], description: 'old' });
    expect(Object.keys(JSON.parse(withDescription(described, 'new') ?? '{}'))).toEqual(['processors', 'description']);
    expect(JSON.parse(withDescription(described, '') ?? '')).toEqual({ processors: [] });
    expect(withDescription('{broken', 'x')).toBeNull();
  });

  it('validates pipeline ids', () => {
    expect(validatePipelineId('')).toBe('Enter an id for the pipeline');
    expect(validatePipelineId('a b')).toBe('Pipeline ids cannot contain spaces');
    expect(validatePipelineId('_simulate')).toBe('Pipeline ids cannot start with "_"');
    expect(validatePipelineId('a/b')).toBe('Pipeline ids cannot contain "/"');
    expect(validatePipelineId('a#b?c')).toBe('Pipeline ids cannot contain "?", "#"');
    expect(validatePipelineId('logs@custom')).toBeNull();
  });
});

describe('sample documents', () => {
  it('collects the fields a pipeline reads', () => {
    expect(inputFields(PIPELINES['app-enrich'])).toEqual(['level', 'msg']);
    expect(inputFields({ processors: [{ remove: { field: ['a', '{{x}}', '_tmp'] } }] })).toEqual(['a']);
    expect(inputFields(undefined)).toEqual([]);
  });

  it('builds sensible examples', () => {
    const docs = JSON.parse(sampleDocsFor(PIPELINES['app-enrich'])) as Record<string, unknown>[];
    expect(docs).toHaveLength(2);
    expect(docs[0]).toMatchObject({ level: 'INFO', msg: 'User signed in' });
    expect(docs[1]).toMatchObject({ level: 'ERROR' });
    expect(docs[0]).toHaveProperty('@timestamp');
    const nested = JSON.parse(sampleDocsFor({ processors: [{ lowercase: { field: 'host.name' } }, { trim: { field: 'custom' } }] }));
    expect(nested[0]).toMatchObject({ host: { name: 'web-01' }, custom: 'example custom' });
    expect(JSON.parse(sampleDocsFor(undefined))[0]).toMatchObject({ level: 'INFO', message: 'User signed in' });
  });

  it('parses sample documents in both shapes', () => {
    expect(parseSampleDocs('[{"a": 1}, {"_index": "i", "_id": "1", "_source": {"b": 2}}]')).toEqual({
      ok: true,
      docs: [{ _source: { a: 1 } }, { _index: 'i', _id: '1', _source: { b: 2 } }],
    });
    expect(parseSampleDocs('{"a": 1}')).toEqual({ ok: true, docs: [{ _source: { a: 1 } }] });
    expect(parseSampleDocs('[]')).toEqual({ ok: false, message: 'Add at least one sample document' });
    expect(parseSampleDocs(' ')).toEqual({ ok: false, message: 'Add at least one sample document' });
    expect(parseSampleDocs('[1]')).toEqual({ ok: false, message: 'Document 1 must be a JSON object' });
    expect(parseSampleDocs('[').ok).toBe(false);
  });

  it('builds the simulate payload', () => {
    expect(buildSimulatePayload({ processors: [] }, [{ _source: { a: 1 } }], true)).toEqual({
      pipeline: { processors: [] },
      docs: [{ _source: { a: 1 } }],
      verbose: true,
    });
  });
});

describe('simulation results', () => {
  const doc = (source: Record<string, unknown>, index = '_index') => ({
    _index: index,
    _id: '_id',
    _version: '-3',
    _source: source,
    _ingest: { timestamp: '2026-10-14T16:14:00Z' },
  });

  it('diffs documents field by field', () => {
    expect(diffSources({ a: 1, b: { c: 2 }, d: 'x' }, { a: 1, b: { c: 3 }, e: true })).toEqual([
      { path: 'b.c', kind: 'changed' },
      { path: 'd', kind: 'removed' },
      { path: 'e', kind: 'added' },
    ]);
    expect(diffSources({ host: 'web' }, { host: { name: 'web' } })).toEqual([
      { path: 'host', kind: 'removed' },
      { path: 'host.name', kind: 'added' },
    ]);
    expect(diffSources({ tags: ['a'] }, { tags: ['a', 'b'] })).toEqual([{ path: 'tags', kind: 'changed' }]);
    expect(diffSources({}, {})).toEqual([]);
  });

  it('normalizes plain results: processed, failed and dropped', () => {
    const response: SimulateResponse = {
      docs: [
        { doc: doc({ level: 'info' }) },
        { error: { root_cause: [{ type: 'fail_processor_exception', reason: 'boom' }], type: 'fail_processor_exception', reason: 'boom' } },
        null,
        { doc: doc({ level: 'warn' }, 'failed-logs') },
      ],
    };
    const inputs = [{ _source: { level: 'INFO' } }, { _source: {} }, { _source: {} }, { _source: { level: 'warn' } }];
    const results = normalizeSimulation(response, inputs);
    expect(results.map((result) => result.outcome)).toEqual(['ok', 'error', 'dropped', 'ok']);
    expect(results[0]?.source).toEqual({ level: 'info' });
    expect(results[0]?.metadata).toMatchObject({ _index: '_index', _id: '_id' });
    expect(results[0]?.targetIndex).toBeNull();
    expect(results[1]?.error).toBe('boom');
    expect(results[3]?.targetIndex).toBe('failed-logs');
    expect(overallChanges(results[0]!, inputs[0])).toEqual([{ path: 'level', kind: 'changed' }]);
    expect(overallChanges(results[1]!, inputs[1])).toEqual([]);
    expect(normalizeSimulation(undefined)).toEqual([]);
  });

  it('normalizes verbose steps with per-step changes', () => {
    const response: SimulateResponse = {
      docs: [
        {
          processor_results: [
            { processor_type: 'lowercase', status: 'success', doc: doc({ level: 'info' }) },
            { processor_type: 'set', status: 'success', tag: 't', doc: doc({ level: 'info', x: 'info' }) },
            { processor_type: 'fail', status: 'skipped', if: { condition: 'ctx.level == "error"', result: false } },
            {
              processor_type: 'rename',
              status: 'error_ignored',
              ignored_error: { error: { type: 'illegal_argument_exception', reason: "field [nope] doesn't exist" } },
              doc: doc({ level: 'info', x: 'info' }),
            },
          ],
        },
        {
          processor_results: [
            { processor_type: 'lowercase', status: 'success', doc: doc({ level: 'error' }) },
            {
              processor_type: 'fail',
              status: 'error',
              tag: 'stop',
              error: { root_cause: [{ type: 'fail_processor_exception', reason: 'boom' }], type: 'x', reason: 'boom' },
            },
          ],
        },
        {
          processor_results: [
            { processor_type: 'drop', status: 'dropped', if: { condition: 'true', result: true } },
          ],
        },
        {
          processor_results: [
            { processor_type: 'fail', status: 'error', error: { reason: 'bad status' } },
            { processor_type: 'set', status: 'success', doc: doc({ a: 1 }, 'failed-_index') },
          ],
        },
      ],
    };
    const inputs = [{ _source: { level: 'INFO' } }, { _source: { level: 'ERROR' } }, { _source: {} }, { _source: { a: 1 } }];
    const [ok, failed, dropped, handled] = normalizeSimulation(response, inputs);

    expect(ok?.outcome).toBe('ok');
    expect(ok?.steps?.map((step) => step.status)).toEqual(['success', 'success', 'skipped', 'error_ignored']);
    expect(ok?.steps?.[0]?.changes).toEqual([{ path: 'level', kind: 'changed' }]);
    expect(ok?.steps?.[1]?.changes).toEqual([{ path: 'x', kind: 'added' }]);
    expect(ok?.steps?.[1]?.tag).toBe('t');
    expect(ok?.steps?.[2]).toMatchObject({ condition: 'ctx.level == "error"', source: null, changes: [] });
    expect(ok?.steps?.[3]?.error).toBe("field [nope] doesn't exist");
    expect(ok?.source).toEqual({ level: 'info', x: 'info' });

    expect(failed).toMatchObject({ outcome: 'error', error: 'boom', failedProcessor: 'fail (stop)', source: null });
    expect(dropped).toMatchObject({ outcome: 'dropped', source: null });

    // A failure handled by on_failure: the document is still processed.
    expect(handled).toMatchObject({ outcome: 'ok', error: null, targetIndex: 'failed-_index' });
    expect(handled?.steps?.[1]?.changes).toEqual([{ path: '_index', kind: 'changed' }]);
  });

  it('reports _index only when the pipeline changed it', () => {
    const inputs = [
      { _index: 'logs-web', _source: { a: 1 } },
      { _index: 'logs-web', _source: { a: 1 } },
      { _source: { a: 1 } },
    ];
    const results = normalizeSimulation(
      { docs: [{ doc: doc({ a: 1 }, 'logs-web') }, { doc: doc({ a: 1 }, 'logs-archive') }, { doc: doc({ a: 1 }) }] },
      inputs,
    );
    expect(results.map((result) => result.targetIndex)).toEqual([null, 'logs-archive', null]);
  });

  it('keeps a verbose run ok when on_failure handles a failing processor', () => {
    const [handled] = normalizeSimulation(
      {
        docs: [
          {
            processor_results: [
              { processor_type: 'rename', status: 'error', error: { type: 'illegal_argument_exception', reason: 'field [x] does not exist' } },
              { processor_type: 'set', status: 'success', doc: doc({ a: 1, error: 'field [x] does not exist' }) },
              { processor_type: 'append', status: 'success', doc: doc({ a: 1, error: 'field [x] does not exist', tags: ['failed'] }) },
            ],
          },
        ],
      },
      [{ _source: { a: 1 } }],
    );
    expect(handled).toMatchObject({ outcome: 'ok', error: null, failedProcessor: null, targetIndex: null });
    expect(handled?.steps?.[0]).toMatchObject({ status: 'error', error: 'field [x] does not exist' });
    expect(handled?.source).toEqual({ a: 1, error: 'field [x] does not exist', tags: ['failed'] });
  });

  it('summarizes a run for screen readers', () => {
    const results = normalizeSimulation({ docs: [{ doc: doc({}) }, { doc: doc({}) }, { error: { reason: 'x' } }, null] });
    expect(simulationAnnouncement(results)).toBe('Simulation finished for 4 documents: 2 processed, 1 failed, 1 dropped.');
    expect(simulationAnnouncement(results.slice(0, 1))).toBe('Simulation finished for 1 document: 1 processed.');
    expect(simulationAnnouncement([])).toBe('The simulation returned no documents.');
  });
});
