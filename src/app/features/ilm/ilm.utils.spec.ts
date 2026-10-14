import { describe, expect, it } from 'vitest';
import { ClusterApiError } from '../../core/api-envelope';
import { ExplainRow, IlmPoliciesResponse } from './ilm.models';
import {
  NEW_POLICY_BODY,
  analyzePolicyBody,
  describeAction,
  errorReason,
  filterExplain,
  filterPolicies,
  formatSizeValue,
  isManagedPolicy,
  normalizeExplain,
  normalizeExplainEntry,
  normalizePolicies,
  parseTimeValue,
  phaseViews,
  policySource,
  policyUsage,
  policyWarnings,
  saveMode,
  sortExplain,
  startsImmediately,
  summarizeExplain,
  usageExplainTarget,
  MAX_EXPLAIN_TARGET_LENGTH,
  needsAttention,
  usageLabel,
  validatePolicyName,
} from './ilm.utils';

const POLICIES: IlmPoliciesResponse = {
  'app-events-policy': {
    version: 1,
    modified_date: '2026-10-14T16:08:41.111Z',
    policy: {
      phases: {
        delete: { min_age: '30d', actions: { delete: { delete_searchable_snapshot: true } } },
        warm: {
          min_age: '7d',
          actions: {
            forcemerge: { max_num_segments: 1 },
            shrink: { number_of_shards: 1, allow_write_after_shrink: false },
          },
        },
        hot: {
          min_age: '0ms',
          actions: {
            rollover: { max_age: '1d', max_primary_shard_size: '10gb' },
            set_priority: { priority: 100 },
          },
        },
      },
      _meta: { description: 'Demo policy for application events' },
    },
    in_use_by: {
      indices: ['.ds-app-events-web-2', '.ds-app-events-web-1'],
      data_streams: ['app-events-web'],
      composable_templates: ['app-events'],
    },
  },
  '30-days-default': {
    version: 1,
    policy: {
      phases: { hot: { min_age: '0ms', actions: { rollover: { max_age: '30d' } } } },
      _meta: { managed: true, description: 'built-in' },
      deprecated: true,
    },
    in_use_by: { indices: [], data_streams: [], composable_templates: [] },
  },
  '.monitoring-8-ilm-policy': {
    policy: { phases: {} },
  },
};

describe('values', () => {
  it('parses Elasticsearch time values', () => {
    expect(parseTimeValue('0ms')).toBe(0);
    expect(parseTimeValue('7d')).toBe(7 * 86_400_000);
    expect(parseTimeValue('4.5m')).toBe(270_000);
    expect(parseTimeValue('12s')).toBe(12_000);
    expect(parseTimeValue('3h')).toBe(10_800_000);
    expect(parseTimeValue('1500micros')).toBe(1.5);
    expect(parseTimeValue('250')).toBe(250);
    expect(parseTimeValue(42)).toBe(42);
    expect(parseTimeValue('soon')).toBeNull();
    expect(parseTimeValue(undefined)).toBeNull();
  });

  it('formats byte size values', () => {
    expect(formatSizeValue('10gb')).toBe('10 GB');
    expect(formatSizeValue('1.5tb')).toBe('1.5 TB');
    expect(formatSizeValue('512b')).toBe('512 B');
    expect(formatSizeValue(2048)).toBe('2,048 B');
    expect(formatSizeValue('weird')).toBe('weird');
  });

  it('knows when a phase starts right away', () => {
    expect(startsImmediately(undefined)).toBe(true);
    expect(startsImmediately(null)).toBe(true);
    expect(startsImmediately('0ms')).toBe(true);
    expect(startsImmediately('0d')).toBe(true);
    expect(startsImmediately('1d')).toBe(false);
  });
});

describe('describeAction', () => {
  it('describes rollover conditions in plain language', () => {
    expect(describeAction('rollover', { max_age: '1d', max_primary_shard_size: '10gb' }).label).toBe(
      'Roll over at 1d or 10 GB primary shard',
    );
    const withMinimum = describeAction('rollover', { max_docs: 1_000_000, min_docs: 1 });
    expect(withMinimum.label).toBe('Roll over at 1M documents');
    expect(withMinimum.detail).toBe('Only once the index is at least 1 document');
    expect(describeAction('rollover', {}).label).toBe('Roll over');
    expect(describeAction('rollover', { max_docs: 1 }).label).toBe('Roll over at 1 document');
    expect(describeAction('rollover', { max_size: '50gb' }).label).toBe('Roll over at 50 GB total size');
  });

  it('describes the common actions', () => {
    expect(describeAction('forcemerge', { max_num_segments: 1 }).label).toBe('Force merge to 1 segment');
    expect(describeAction('forcemerge', { max_num_segments: 2, index_codec: 'best_compression' })).toMatchObject({
      label: 'Force merge to 2 segments',
      detail: 'Recompress with the best_compression codec',
    });
    expect(describeAction('shrink', { number_of_shards: 1 }).label).toBe('Shrink to 1 shard');
    expect(describeAction('shrink', { max_primary_shard_size: '50gb' }).label).toBe(
      'Shrink to primary shards of at most 50 GB',
    );
    expect(describeAction('delete', {}).label).toBe('Delete the index');
    expect(describeAction('delete', { delete_searchable_snapshot: false }).detail).toBe('Keeps the searchable snapshot');
    expect(describeAction('set_priority', { priority: 50 }).label).toBe('Set recovery priority to 50');
    expect(describeAction('set_priority', { priority: null }).label).toBe('Reset recovery priority');
    expect(describeAction('readonly', {}).label).toBe('Make the index read-only');
    expect(describeAction('migrate', {}, 'warm').label).toBe('Move to the warm data tier');
    expect(describeAction('migrate', { enabled: false }, 'warm').label).toBe('Stay on the current data tier');
    expect(describeAction('wait_for_snapshot', { policy: 'nightly' }).label).toBe('Wait for snapshot policy nightly');
    expect(describeAction('searchable_snapshot', { snapshot_repository: 'backups' }).label).toBe(
      'Convert to a searchable snapshot in backups',
    );
    expect(describeAction('downsample', { fixed_interval: '1h' }).label).toBe('Downsample to 1h intervals');
  });

  it('describes allocation rules', () => {
    const view = describeAction('allocate', {
      number_of_replicas: 1,
      require: { data: 'warm' },
      exclude: { box: 'small' },
    });
    expect(view.label).toBe('Allocate with 1 replica');
    expect(view.detail).toBe('require data: warm · exclude box: small');
    expect(describeAction('allocate', { include: { zone: 'a' } }).label).toBe('Change shard allocation');
  });

  it('falls back to the raw options for unknown actions', () => {
    const view = describeAction('custom_thing', { level: 3, nested: { a: 1 } });
    expect(view.label).toBe('custom thing');
    expect(view.detail).toBe('level: 3 · nested: {"a":1}');
    expect(describeAction('other', 'not an object').detail).toBeNull();
  });
});

describe('policies', () => {
  it('detects managed policies', () => {
    expect(isManagedPolicy('.monitoring', {})).toBe(true);
    expect(isManagedPolicy('logs', { _meta: { managed: true } })).toBe(true);
    expect(isManagedPolicy('mine', { _meta: { managed: 'yes' } })).toBe(false);
    expect(isManagedPolicy('mine', undefined)).toBe(false);
  });

  it('orders phases and labels their start', () => {
    const phases = phaseViews(POLICIES['app-events-policy']?.policy);
    expect(phases.map((phase) => phase.name)).toEqual(['hot', 'warm', 'delete']);
    expect(phases.map((phase) => phase.startLabel)).toEqual(['Immediately', '7d after rollover', '30d after rollover']);
    expect(phases[0]?.minAge).toBeNull();
    expect(phases[1]?.minAge).toBe('7d');
    expect(phases[0]?.actions.map((action) => action.label)).toEqual([
      'Roll over at 1d or 10 GB primary shard',
      'Set recovery priority to 100',
    ]);
    expect(phases[2]?.tone).toBe('delete');
  });

  it('counts from creation without rollover and sorts unknown phases last', () => {
    const phases = phaseViews({
      phases: { custom: {}, delete: { min_age: '5d', actions: { delete: {} } }, cold: { min_age: '1d' } },
    });
    expect(phases.map((phase) => phase.name)).toEqual(['cold', 'delete', 'custom']);
    expect(phases[0]?.startLabel).toBe('1d after creation');
    expect(phases[2]?.tone).toBe('other');
    expect(phases[0]?.actions).toEqual([]);
    expect(phaseViews(undefined)).toEqual([]);
  });

  it('normalizes the policy list', () => {
    const policies = normalizePolicies(POLICIES);
    expect(policies.map((policy) => policy.name)).toEqual(['.monitoring-8-ilm-policy', '30-days-default', 'app-events-policy']);
    const app = policies[2];
    expect(app?.description).toBe('Demo policy for application events');
    expect(app?.managed).toBe(false);
    expect(app?.version).toBe(1);
    expect(app?.usage.indices).toEqual(['.ds-app-events-web-1', '.ds-app-events-web-2']);
    expect(app?.usage.total).toBe(4);
    expect(policies[1]).toMatchObject({ managed: true, deprecated: true });
    expect(policies[0]).toMatchObject({ managed: true, version: null, description: null });
    expect(normalizePolicies(null)).toEqual([]);
  });

  it('filters by name and description and hides managed policies', () => {
    const policies = normalizePolicies(POLICIES);
    expect(filterPolicies(policies, '', false).map((policy) => policy.name)).toEqual(['app-events-policy']);
    expect(filterPolicies(policies, '', true)).toHaveLength(3);
    expect(filterPolicies(policies, 'DEMO', false).map((policy) => policy.name)).toEqual(['app-events-policy']);
    expect(filterPolicies(policies, 'built', true).map((policy) => policy.name)).toEqual(['30-days-default']);
    // The selected managed policy stays visible.
    expect(filterPolicies(policies, '', false, '30-days-default').map((policy) => policy.name)).toEqual([
      '30-days-default',
      'app-events-policy',
    ]);
  });

  it('summarizes usage', () => {
    expect(usageLabel(policyUsage({ in_use_by: { indices: ['a', 'b', 'c'], data_streams: ['d'] } }))).toBe(
      '3 indices · 1 data stream',
    );
    expect(usageLabel(policyUsage({ in_use_by: { composable_templates: ['t1', 't2'] } }))).toBe('2 templates');
    expect(usageLabel(policyUsage({}))).toBe('Not in use');
  });

  it('builds the explain target for a policy without duplicating backing indices', () => {
    const usage = policyUsage({
      in_use_by: {
        indices: ['.ds-web-2026.10.14-000001', '.ds-web-2026.10.14-000002', '.ds-webhooks-2026.10.14-000001', 'i1'],
        data_streams: ['web'],
      },
    });
    expect(usageExplainTarget(usage, 'p')).toEqual({ target: 'web,.ds-webhooks-2026.10.14-000001,i1', query: '' });
    expect(usageExplainTarget(policyUsage({ in_use_by: { composable_templates: ['t'] } }), 'p')).toBeNull();
  });

  it('falls back to every index filtered by policy when the target gets too long', () => {
    const indices = Array.from({ length: 365 }, (_, day) => `logs-application-${String(day).padStart(3, '0')}-2026.10.14`);
    const result = usageExplainTarget(policyUsage({ in_use_by: { indices } }), 'logs-1y');
    expect(result).toEqual({ target: '*,.ds-*', query: 'logs-1y' });
    const short = usageExplainTarget(policyUsage({ in_use_by: { indices: indices.slice(0, 10) } }), 'logs-1y');
    expect(short?.target.length).toBeLessThanOrEqual(MAX_EXPLAIN_TARGET_LENGTH);
    expect(short?.query).toBe('');
  });
});

describe('editor', () => {
  it('parses a valid policy body', () => {
    const state = analyzePolicyBody(NEW_POLICY_BODY);
    expect(state.ok).toBe(true);
    if (state.ok) {
      expect(Object.keys(state.value.phases ?? {})).toEqual(['hot', 'warm', 'delete']);
      expect(policyWarnings(state.value)).toEqual([]);
    }
  });

  it('rejects invalid bodies with a clear message', () => {
    expect(analyzePolicyBody('  ')).toEqual({ ok: false, message: 'The policy body is required' });
    expect(analyzePolicyBody('[]')).toEqual({ ok: false, message: 'The policy must be a JSON object' });
    expect(analyzePolicyBody('{"phases": []}')).toEqual({ ok: false, message: '"phases" must be an object' });
    expect(analyzePolicyBody('{"policy": {"phases": {}}}').ok).toBe(false);
    const broken = analyzePolicyBody('{"phases": ');
    expect(broken.ok).toBe(false);
  });

  it('warns about empty, unknown and out of order phases', () => {
    expect(policyWarnings({ phases: {} })).toEqual(['The policy has no phases, so it does nothing']);
    expect(policyWarnings({ phases: { lukewarm: {} } })).toEqual(['Unknown phase "lukewarm"']);
    expect(
      policyWarnings({ phases: { hot: { min_age: '0ms' }, warm: { min_age: '10d' }, delete: { min_age: '5d' } } }),
    ).toEqual(['The delete phase starts before the warm phase (min_age 5d)']);
  });

  it('pretty prints policies', () => {
    expect(policySource({ phases: {} })).toBe('{\n  "phases": {}\n}');
  });

  it('validates policy names like Elasticsearch', () => {
    expect(validatePolicyName('')).toBe('Enter a name for the policy');
    expect(validatePolicyName('a b')).toBe('Policy names cannot contain spaces');
    expect(validatePolicyName('_x')).toBe('Policy names cannot start with "_"');
    expect(validatePolicyName('Logs-30@lifecycle')).toBeNull();
  });

  it('works out what saving does', () => {
    expect(saveMode('new', null, ['a'])).toBe('create');
    expect(saveMode('a', null, ['a'])).toBe('overwrite');
    expect(saveMode('a', 'a', ['a'])).toBe('update');
    expect(saveMode('b', 'a', ['a'])).toBe('copy');
    expect(saveMode('c', 'a', ['a', 'c'])).toBe('overwrite');
  });
});

describe('lifecycle status', () => {
  const RESPONSE = {
    indices: {
      'tmp-broken': {
        index: 'tmp-broken',
        managed: true,
        policy: 'broken',
        phase: 'hot',
        action: 'rollover',
        step: 'ERROR',
        age: '20.37s',
        failed_step: 'check-rollover-ready',
        is_auto_retryable_error: true,
        failed_step_retry_count: 3,
        step_info: {
          type: 'illegal_argument_exception',
          reason: 'setting [index.lifecycle.rollover_alias] for index [tmp-broken] is empty or not defined',
        },
      },
      '.ds-web-1': {
        index: '.ds-web-1',
        managed: true,
        policy: 'app-events-policy',
        phase: 'warm',
        action: 'forcemerge',
        step: 'forcemerge',
        age: '8d',
      },
      products: { index: 'products', managed: false },
      'logs-new': {
        index: 'logs-new',
        managed: true,
        policy: 'app-events-policy',
        phase: 'hot',
        action: 'rollover',
        step: 'check-rollover-ready',
        age: '4.62m',
        step_info: { message: 'Waiting for all shard copies to be active' },
      },
      'tmp-retrying': {
        index: 'tmp-retrying',
        managed: true,
        policy: 'broken',
        phase: 'hot',
        action: 'rollover',
        step: 'check-rollover-ready',
        age: '2m',
        is_auto_retryable_error: true,
        failed_step_retry_count: 2,
      },
    },
  };

  it('normalizes explain rows and highlights failures', () => {
    const rows = normalizeExplain(RESPONSE);
    expect(rows.map((row) => row.index)).toEqual(['.ds-web-1', 'logs-new', 'products', 'tmp-broken', 'tmp-retrying']);
    const broken = rows[3];
    expect(broken).toMatchObject({
      failed: true,
      failedStep: 'check-rollover-ready',
      retryable: true,
      retryCount: 3,
      ageMillis: 20_370,
      phaseTone: 'hot',
    });
    expect(broken?.info).toContain('rollover_alias');
    expect(rows[1]?.info).toBe('Waiting for all shard copies to be active');
    expect(rows[1]?.failed).toBe(false);
    expect(rows[1]?.retrying).toBe(false);
    expect(broken?.retrying).toBe(false);
    expect(rows[2]).toMatchObject({ managed: false, policy: null, phase: null, ageMillis: null, info: null });
    expect(normalizeExplain({})).toEqual([]);
    expect(normalizeExplain(null)).toEqual([]);
  });

  it('flags indices in an automatic retry loop', () => {
    const retrying = normalizeExplain(RESPONSE).find((row) => row.index === 'tmp-retrying');
    expect(retrying).toMatchObject({ failed: false, retrying: true, retryCount: 2, retryable: true, step: 'check-rollover-ready' });
    expect(retrying && needsAttention(retrying)).toBe(true);
    const healthy = normalizeExplainEntry('x', { step: 'check-rollover-ready', failed_step_retry_count: 0 });
    expect(healthy.retrying).toBe(false);
    expect(needsAttention(healthy)).toBe(false);
  });

  it('filters by state and text', () => {
    const rows = normalizeExplain(RESPONSE);
    expect(filterExplain(rows, 'managed')).toHaveLength(4);
    expect(filterExplain(rows, 'errors').map((row) => row.index)).toEqual(['tmp-broken', 'tmp-retrying']);
    expect(filterExplain(rows, 'all', 'APP-EVENTS').map((row) => row.index)).toEqual(['.ds-web-1', 'logs-new']);
  });

  it('sorts by phase, age and policy keeping empty values last', () => {
    const rows = normalizeExplain(RESPONSE);
    const names = (sorted: ExplainRow[]): string[] => sorted.map((row) => row.index);
    expect(names(sortExplain(rows, 'phase', false))).toEqual(['logs-new', 'tmp-broken', 'tmp-retrying', '.ds-web-1', 'products']);
    expect(names(sortExplain(rows, 'phase', true))).toEqual(['.ds-web-1', 'logs-new', 'tmp-broken', 'tmp-retrying', 'products']);
    expect(names(sortExplain(rows, 'age', true))).toEqual(['.ds-web-1', 'logs-new', 'tmp-retrying', 'tmp-broken', 'products']);
    expect(names(sortExplain(rows, 'age', false))).toEqual(['tmp-broken', 'tmp-retrying', 'logs-new', '.ds-web-1', 'products']);
    expect(names(sortExplain(rows, 'policy', false))).toEqual(['.ds-web-1', 'logs-new', 'tmp-broken', 'tmp-retrying', 'products']);
    expect(names(sortExplain(rows, 'index', true))).toEqual(['tmp-retrying', 'tmp-broken', 'products', 'logs-new', '.ds-web-1']);
  });

  it('summarizes phases, managed indices and failures', () => {
    const summary = summarizeExplain(normalizeExplain(RESPONSE));
    expect(summary).toEqual({
      total: 5,
      managed: 4,
      errors: 2,
      retrying: 1,
      phases: [
        { name: 'hot', tone: 'hot', count: 3 },
        { name: 'warm', tone: 'warm', count: 1 },
      ],
    });
  });
});

describe('errorReason', () => {
  it('prefers the root cause and strips parser positions', () => {
    const error = new ClusterApiError(400, {
      error: {
        root_cause: [{ type: 'named_object_not_found_exception', reason: '[1:40] unknown field [rolover]' }],
        type: 'x_content_parse_exception',
        reason: '[1:40] [put_lifecycle_request] failed to parse field [policy]',
      },
      status: 400,
    });
    expect(errorReason(error)).toBe('unknown field [rolover]');
  });

  it('explains why an in-use policy cannot be deleted', () => {
    expect(
      errorReason({
        error: {
          type: 'illegal_argument_exception',
          reason: 'Cannot delete policy [p]. It is in use by one or more indices: [i]',
        },
      }),
    ).toBe('Cannot delete policy [p]. It is in use by one or more indices: [i]');
  });

  it('handles strings, errors and empty values', () => {
    expect(errorReason('  plain  ')).toBe('plain');
    expect(errorReason(new Error('boom'))).toBe('boom');
    expect(errorReason(null)).toBeNull();
    expect(errorReason({})).toBeNull();
    expect(errorReason(42)).toBeNull();
  });
});
