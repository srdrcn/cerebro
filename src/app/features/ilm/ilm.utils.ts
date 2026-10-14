import { elasticsearchReason } from '../../core/errors';
import { formatCompact, formatNumber, plural, pluralize, sentence, textMatcher } from '../../core/format';
import { JsonRecord, isRecord, stringList } from '../../core/json';
import {
  ActionView,
  ExplainFilter,
  ExplainRow,
  ExplainSortField,
  ExplainSummary,
  IlmExplainEntry,
  IlmExplainResponse,
  IlmPhaseBody,
  IlmPoliciesResponse,
  IlmPolicyBody,
  IlmPolicyEntry,
  IlmPolicySummary,
  IlmUsage,
  PHASE_ORDER,
  PhaseTone,
  PhaseView,
  PolicyBodyState,
  UsageExplainTarget,
} from './ilm.models';

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

const TIME_UNITS: Readonly<Record<string, number>> = {
  nanos: 1e-6,
  micros: 1e-3,
  ms: 1,
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

/** Parses an Elasticsearch time value ("7d", "4.62m", "0ms") into milliseconds. */
export function parseTimeValue(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== 'string') {
    return null;
  }
  const match = /^\s*(-?\d+(?:\.\d+)?)\s*(nanos|micros|ms|s|m|h|d)?\s*$/i.exec(value);
  if (!match) {
    return null;
  }
  const amount = Number(match[1]);
  const unit = (match[2] ?? 'ms').toLowerCase();
  return amount * (TIME_UNITS[unit] ?? 1);
}

const SIZE_UNITS = ['b', 'kb', 'mb', 'gb', 'tb', 'pb'];

/** "10gb" → "10 GB"; anything else is returned unchanged. */
export function formatSizeValue(value: unknown): string {
  if (typeof value === 'number') {
    return `${formatNumber(value)} B`;
  }
  const text = String(value ?? '');
  const match = /^\s*(\d+(?:\.\d+)?)\s*([kmgtp]?b)\s*$/i.exec(text);
  if (!match || !SIZE_UNITS.includes((match[2] ?? '').toLowerCase())) {
    return text;
  }
  return `${match[1]} ${(match[2] ?? '').toUpperCase()}`;
}

function formatCount(value: unknown): string {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number)) {
    return String(value);
  }
  return number >= 10_000 ? formatCompact(number) : formatNumber(number);
}

/** Compact JSON for unknown option values shown inline. */
function inlineValue(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  const text = JSON.stringify(value) ?? String(value);
  return text.length > 60 ? `${text.slice(0, 57)}…` : text;
}

// ---------------------------------------------------------------------------
// Policies
// ---------------------------------------------------------------------------

/** Built-in policies: flagged with _meta.managed or named with a leading dot. */
export function isManagedPolicy(name: string, policy: IlmPolicyBody | undefined): boolean {
  return name.startsWith('.') || policy?._meta?.['managed'] === true;
}

export function phaseTone(name: string | null | undefined): PhaseTone {
  return PHASE_ORDER.includes(name as never) ? (name as PhaseTone) : 'other';
}

/** True when the phase starts right away (no min_age, or a zero min_age). */
export function startsImmediately(minAge: string | null | undefined): boolean {
  if (minAge === null || minAge === undefined || minAge === '') {
    return true;
  }
  return parseTimeValue(minAge) === 0;
}

function hasRollover(phases: Readonly<Record<string, IlmPhaseBody>>): boolean {
  return Object.values(phases).some((phase) => isRecord(phase?.actions) && 'rollover' in phase.actions);
}

const ROLLOVER_MAX: readonly (readonly [string, (value: unknown) => string])[] = [
  ['max_age', (value) => String(value)],
  ['max_primary_shard_size', (value) => `${formatSizeValue(value)} primary shard`],
  ['max_size', (value) => `${formatSizeValue(value)} total size`],
  ['max_docs', (value) => `${formatCount(value)} ${plural(Number(value), 'document')}`],
  ['max_primary_shard_docs', (value) => `${formatCount(value)} documents in a primary shard`],
];

const ROLLOVER_MIN: readonly (readonly [string, (value: unknown) => string])[] = [
  ['min_age', (value) => `${String(value)} old`],
  ['min_docs', (value) => `${formatCount(value)} ${plural(Number(value), 'document')}`],
  ['min_size', (value) => `${formatSizeValue(value)} in total`],
  ['min_primary_shard_size', (value) => `${formatSizeValue(value)} in a primary shard`],
  ['min_primary_shard_docs', (value) => `${formatCount(value)} documents in a primary shard`],
];

function describeRollover(config: JsonRecord): Pick<ActionView, 'label' | 'detail'> {
  const max = ROLLOVER_MAX.filter(([key]) => config[key] !== undefined).map(([key, format]) => format(config[key]));
  const min = ROLLOVER_MIN.filter(([key]) => config[key] !== undefined).map(([key, format]) => format(config[key]));
  return {
    label: max.length > 0 ? `Roll over at ${max.join(' or ')}` : 'Roll over',
    detail: min.length > 0 ? `Only once the index is at least ${min.join(' and ')}` : null,
  };
}

function describeAllocate(config: JsonRecord): Pick<ActionView, 'label' | 'detail'> {
  const parts: string[] = [];
  if (typeof config['number_of_replicas'] === 'number') {
    parts.push(pluralize(config['number_of_replicas'], 'replica'));
  }
  if (typeof config['total_shards_per_node'] === 'number' && config['total_shards_per_node'] >= 0) {
    parts.push(`at most ${pluralize(config['total_shards_per_node'], 'shard')} per node`);
  }
  const rules: string[] = [];
  for (const kind of ['require', 'include', 'exclude'] as const) {
    const filters = config[kind];
    if (isRecord(filters)) {
      for (const [attribute, value] of Object.entries(filters)) {
        rules.push(`${kind} ${attribute}: ${inlineValue(value)}`);
      }
    }
  }
  return {
    label: parts.length > 0 ? `Allocate with ${parts.join(', ')}` : 'Change shard allocation',
    detail: rules.length > 0 ? rules.join(' · ') : null,
  };
}

/** Plain language description of one lifecycle action. */
export function describeAction(type: string, value: unknown, phase = ''): ActionView {
  const config: JsonRecord = isRecord(value) ? value : {};
  const view = (label: string, icon: string, detail: string | null = null): ActionView => ({
    type,
    label,
    detail,
    icon,
  });

  switch (type) {
    case 'rollover': {
      const { label, detail } = describeRollover(config);
      return view(label, 'bi-arrow-repeat', detail);
    }
    case 'set_priority':
      return typeof config['priority'] === 'number'
        ? view(`Set recovery priority to ${config['priority']}`, 'bi-sort-numeric-up')
        : view('Reset recovery priority', 'bi-sort-numeric-up');
    case 'forcemerge': {
      const segments = config['max_num_segments'];
      const codec = config['index_codec'];
      return view(
        typeof segments === 'number' ? `Force merge to ${pluralize(segments, 'segment')}` : 'Force merge',
        'bi-arrows-collapse',
        typeof codec === 'string' ? `Recompress with the ${codec} codec` : null,
      );
    }
    case 'shrink': {
      const shards = config['number_of_shards'];
      const size = config['max_primary_shard_size'];
      const label =
        typeof shards === 'number'
          ? `Shrink to ${pluralize(shards, 'shard')}`
          : size !== undefined
            ? `Shrink to primary shards of at most ${formatSizeValue(size)}`
            : 'Shrink';
      return view(label, 'bi-arrows-angle-contract', config['allow_write_after_shrink'] === true ? 'Writes stay allowed after shrinking' : null);
    }
    case 'allocate': {
      const { label, detail } = describeAllocate(config);
      return view(label, 'bi-diagram-3', detail);
    }
    case 'migrate':
      return config['enabled'] === false
        ? view('Stay on the current data tier', 'bi-signpost-split')
        : view(phase && phase !== 'hot' ? `Move to the ${phase} data tier` : 'Move to the matching data tier', 'bi-signpost-split');
    case 'readonly':
      return view('Make the index read-only', 'bi-lock');
    case 'delete':
      return view(
        'Delete the index',
        'bi-trash',
        config['delete_searchable_snapshot'] === false ? 'Keeps the searchable snapshot' : null,
      );
    case 'wait_for_snapshot':
      return view(
        typeof config['policy'] === 'string' ? `Wait for snapshot policy ${config['policy']}` : 'Wait for a snapshot',
        'bi-camera',
      );
    case 'searchable_snapshot':
      return view(
        typeof config['snapshot_repository'] === 'string'
          ? `Convert to a searchable snapshot in ${config['snapshot_repository']}`
          : 'Convert to a searchable snapshot',
        'bi-cloud-arrow-up',
        config['force_merge_index'] === false ? 'Without force merging first' : null,
      );
    case 'downsample':
      return view(
        config['fixed_interval'] !== undefined ? `Downsample to ${inlineValue(config['fixed_interval'])} intervals` : 'Downsample',
        'bi-bar-chart-steps',
      );
    case 'unfollow':
      return view('Turn the follower index into a regular index', 'bi-link-45deg');
    case 'freeze':
      return view('Freeze the index', 'bi-snow');
    default: {
      const options = Object.entries(config).map(([key, option]) => `${key}: ${inlineValue(option)}`);
      return view(type.replace(/_/g, ' '), 'bi-gear', options.length > 0 ? options.join(' · ') : null);
    }
  }
}

/** Phases of a policy in execution order, with their actions in plain language. */
export function phaseViews(policy: IlmPolicyBody | undefined): PhaseView[] {
  const phases = isRecord(policy?.phases) ? (policy.phases as Readonly<Record<string, IlmPhaseBody>>) : {};
  const rollover = hasRollover(phases);
  const names = Object.keys(phases).sort((left, right) => {
    const a = PHASE_ORDER.indexOf(left as never);
    const b = PHASE_ORDER.indexOf(right as never);
    return (a === -1 ? PHASE_ORDER.length : a) - (b === -1 ? PHASE_ORDER.length : b) || left.localeCompare(right);
  });
  return names.map((name) => {
    const raw: unknown = phases[name];
    const phase: IlmPhaseBody = isRecord(raw) ? (raw as IlmPhaseBody) : {};
    const minAge = typeof phase.min_age === 'string' ? phase.min_age : null;
    const immediate = startsImmediately(minAge);
    const actions = isRecord(phase.actions) ? phase.actions : {};
    return {
      name,
      label: sentence(name),
      tone: phaseTone(name),
      minAge: immediate ? null : minAge,
      startLabel: immediate
        ? 'Immediately'
        : `${minAge} after ${rollover && name !== 'hot' ? 'rollover' : 'creation'}`,
      actions: Object.entries(actions).map(([type, config]) => describeAction(type, config, name)),
    };
  });
}

export function policyUsage(entry: IlmPolicyEntry): IlmUsage {
  const indices = stringList(entry.in_use_by?.indices).sort((a, b) => a.localeCompare(b));
  const dataStreams = stringList(entry.in_use_by?.data_streams).sort((a, b) => a.localeCompare(b));
  const templates = stringList(entry.in_use_by?.composable_templates).sort((a, b) => a.localeCompare(b));
  return { indices, dataStreams, templates, total: indices.length + dataStreams.length + templates.length };
}

/** "3 indices · 2 data streams", or "Not in use". */
export function usageLabel(usage: IlmUsage): string {
  const parts = [
    usage.indices.length > 0 ? pluralize(usage.indices.length, 'index', 'indices') : '',
    usage.dataStreams.length > 0 ? pluralize(usage.dataStreams.length, 'data stream') : '',
    usage.templates.length > 0 ? pluralize(usage.templates.length, 'template') : '',
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : 'Not in use';
}

function parseModifiedDate(value: unknown): number | null {
  if (typeof value !== 'string') {
    return null;
  }
  const milliseconds = Date.parse(value);
  return Number.isNaN(milliseconds) ? null : milliseconds;
}

export function normalizePolicy(name: string, entry: IlmPolicyEntry): IlmPolicySummary {
  const policy: IlmPolicyBody = isRecord(entry.policy) ? entry.policy : {};
  const description = policy._meta?.['description'];
  return {
    name,
    version: typeof entry.version === 'number' ? entry.version : null,
    modifiedAt: parseModifiedDate(entry.modified_date),
    description: typeof description === 'string' && description.trim() ? description : null,
    managed: isManagedPolicy(name, policy),
    deprecated: policy.deprecated === true,
    phases: phaseViews(policy),
    usage: policyUsage(entry),
    policy,
    entry,
  };
}

export function normalizePolicies(response: IlmPoliciesResponse | null | undefined): IlmPolicySummary[] {
  if (!isRecord(response)) {
    return [];
  }
  return Object.entries(response)
    .filter((pair): pair is [string, IlmPolicyEntry] => isRecord(pair[1]))
    .map(([name, entry]) => normalizePolicy(name, entry))
    .sort((left, right) => left.name.localeCompare(right.name));
}

/** Case-insensitive search over name and description; managed policies only on request. */
export function filterPolicies(
  policies: readonly IlmPolicySummary[],
  query: string,
  showManaged: boolean,
  keep: string | null = null,
): IlmPolicySummary[] {
  const matches = textMatcher(query);
  return policies.filter((policy) => {
    if (!showManaged && policy.managed && policy.name !== keep) {
      return false;
    }
    return matches(policy.name) || (policy.description !== null && matches(policy.description));
  });
}

// ---------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------

/**
 * Starter of the New policy editor. It carries no `_meta.description`: a
 * placeholder sentence would be saved as the real description.
 */
export const NEW_POLICY_BODY = JSON.stringify(
  {
    phases: {
      hot: {
        min_age: '0ms',
        actions: {
          rollover: { max_age: '7d', max_primary_shard_size: '50gb' },
          set_priority: { priority: 100 },
        },
      },
      warm: {
        min_age: '7d',
        actions: {
          forcemerge: { max_num_segments: 1 },
          set_priority: { priority: 50 },
        },
      },
      delete: {
        min_age: '30d',
        actions: { delete: {} },
      },
    },
  },
  null,
  2,
);

/** Pretty JSON of the inner policy object, as edited and saved. */
export function policySource(policy: IlmPolicyBody): string {
  return JSON.stringify(policy, null, 2);
}

/** Parses the editor content without throwing. */
export function analyzePolicyBody(source: string): PolicyBodyState {
  if (!source.trim()) {
    return { ok: false, message: 'The policy body is required' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch (error: unknown) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
  if (!isRecord(parsed)) {
    return { ok: false, message: 'The policy must be a JSON object' };
  }
  if ('policy' in parsed && !('phases' in parsed)) {
    return { ok: false, message: 'Remove the outer "policy" key: edit the object that holds "phases"' };
  }
  if (parsed['phases'] !== undefined && !isRecord(parsed['phases'])) {
    return { ok: false, message: '"phases" must be an object' };
  }
  return { ok: true, value: parsed as IlmPolicyBody };
}

/** Non-blocking advice about a parsed policy. */
export function policyWarnings(policy: IlmPolicyBody): string[] {
  const warnings: string[] = [];
  const phases: Readonly<Record<string, unknown>> = isRecord(policy.phases) ? policy.phases : {};
  const names = Object.keys(phases);
  if (names.length === 0) {
    warnings.push('The policy has no phases, so it does nothing');
  }
  const unknown = names.filter((name) => !PHASE_ORDER.includes(name as never));
  if (unknown.length > 0) {
    warnings.push(`Unknown ${plural(unknown.length, 'phase')} ${unknown.map((name) => `"${name}"`).join(', ')}`);
  }
  let previousName: string | null = null;
  let previousAge = 0;
  for (const name of PHASE_ORDER) {
    const raw = phases[name];
    if (!isRecord(raw)) {
      continue;
    }
    const minAge = typeof raw['min_age'] === 'string' ? raw['min_age'] : '0ms';
    const age = parseTimeValue(minAge) ?? 0;
    if (previousName !== null && age < previousAge) {
      warnings.push(`The ${name} phase starts before the ${previousName} phase (min_age ${minAge})`);
    } else {
      previousName = name;
      previousAge = age;
    }
  }
  return warnings;
}

/** Mirrors the policy name rules enforced by Elasticsearch. */
export function validatePolicyName(name: string): string | null {
  if (!name) {
    return 'Enter a name for the policy';
  }
  if (/\s/.test(name)) {
    return 'Policy names cannot contain spaces';
  }
  if (name.startsWith('_')) {
    return 'Policy names cannot start with "_"';
  }
  return null;
}

// ---------------------------------------------------------------------------
// Lifecycle status (explain)
// ---------------------------------------------------------------------------

function stepInfoReason(info: unknown): string | null {
  if (!isRecord(info)) {
    return typeof info === 'string' && info.trim() ? info : null;
  }
  const reason = elasticsearchReason(info);
  if (reason) {
    return reason;
  }
  if (typeof info['message'] === 'string' && info['message'].trim()) {
    return info['message'];
  }
  return null;
}

export function normalizeExplainEntry(name: string, entry: IlmExplainEntry): ExplainRow {
  const text = (value: unknown): string | null => (typeof value === 'string' && value ? value : null);
  const step = text(entry.step);
  const failedStep = text(entry.failed_step);
  const failed = step === 'ERROR' || failedStep !== null;
  const retryCount = typeof entry.failed_step_retry_count === 'number' ? entry.failed_step_retry_count : null;
  const retrying = !failed && retryCount !== null && retryCount > 0;
  const phase = text(entry.phase);
  const age = text(entry.age);
  return {
    index: text(entry.index) ?? name,
    managed: entry.managed === true,
    policy: text(entry.policy),
    phase,
    phaseTone: phaseTone(phase),
    action: text(entry.action),
    step,
    age,
    ageMillis: parseTimeValue(age),
    failed,
    retrying,
    failedStep,
    info: stepInfoReason(entry.step_info),
    retryable: entry.is_auto_retryable_error === true,
    retryCount,
    raw: entry,
  };
}

export function normalizeExplain(response: IlmExplainResponse | null | undefined): ExplainRow[] {
  const indices = isRecord(response?.indices) ? response.indices : {};
  return Object.entries(indices)
    .filter((pair): pair is [string, IlmExplainEntry] => isRecord(pair[1]))
    .map(([name, entry]) => normalizeExplainEntry(name, entry))
    .sort((left, right) => left.index.localeCompare(right.index));
}

/** Failed, or failing and being retried automatically. */
export function needsAttention(row: ExplainRow): boolean {
  return row.failed || row.retrying;
}

/**
 * The index sits in the ERROR step, so `_ilm/retry` can move it back to the
 * failed step. Elasticsearch refuses the whole request when any index it
 * names is not in ERROR, so rows that ILM is already retrying are left out.
 */
export function canRetryStep(row: ExplainRow): boolean {
  return row.managed && row.step === 'ERROR';
}

export function filterExplain(rows: readonly ExplainRow[], filter: ExplainFilter, query = ''): ExplainRow[] {
  const matches = textMatcher(query);
  return rows.filter((row) => {
    if (filter === 'managed' && !row.managed) return false;
    if (filter === 'errors' && !needsAttention(row)) return false;
    return matches(row.index) || (row.policy !== null && matches(row.policy));
  });
}

function phaseRank(phase: string | null): number {
  if (phase === null) return PHASE_ORDER.length + 2;
  if (phase === 'new') return -1;
  const index = PHASE_ORDER.indexOf(phase as never);
  return index === -1 ? PHASE_ORDER.length + 1 : index;
}

/** Sorts explain rows; rows without a value go last in both directions. */
export function sortExplain(rows: readonly ExplainRow[], field: ExplainSortField, reverse: boolean): ExplainRow[] {
  const direction = reverse ? -1 : 1;
  const byIndex = (left: ExplainRow, right: ExplainRow): number => left.index.localeCompare(right.index);
  return [...rows].sort((left, right) => {
    let result = 0;
    switch (field) {
      case 'index':
        return byIndex(left, right) * direction;
      case 'policy': {
        if (left.policy === null || right.policy === null) {
          result = left.policy === right.policy ? 0 : left.policy === null ? 1 : -1;
          return result || byIndex(left, right);
        }
        result = left.policy.localeCompare(right.policy) * direction;
        break;
      }
      case 'phase': {
        if (left.phase === null || right.phase === null) {
          result = left.phase === right.phase ? 0 : left.phase === null ? 1 : -1;
          return result || byIndex(left, right);
        }
        result = (phaseRank(left.phase) - phaseRank(right.phase)) * direction;
        break;
      }
      case 'age': {
        if (left.ageMillis === null || right.ageMillis === null) {
          result = left.ageMillis === right.ageMillis ? 0 : left.ageMillis === null ? 1 : -1;
          return result || byIndex(left, right);
        }
        result = (left.ageMillis - right.ageMillis) * direction;
        break;
      }
    }
    return result || byIndex(left, right);
  });
}

export function summarizeExplain(rows: readonly ExplainRow[]): ExplainSummary {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (row.managed && row.phase) {
      counts.set(row.phase, (counts.get(row.phase) ?? 0) + 1);
    }
  }
  const phases = [...counts.entries()]
    .sort((left, right) => phaseRank(left[0]) - phaseRank(right[0]) || left[0].localeCompare(right[0]))
    .map(([name, count]) => ({ name, tone: phaseTone(name), count }));
  return {
    total: rows.length,
    managed: rows.filter((row) => row.managed).length,
    errors: rows.filter(needsAttention).length,
    retrying: rows.filter((row) => row.retrying).length,
    phases,
  };
}

/** Longest comma list sent as one explain target; Elasticsearch caps the request line at 4 KB. */
export const MAX_EXPLAIN_TARGET_LENGTH = 2000;

/**
 * Explain target that covers everything a policy is applied to. Backing
 * indices of listed data streams are covered by the stream name. When the list
 * would make the request line too long, every index is explained and the
 * returned query narrows the rows to the policy instead.
 */
export function usageExplainTarget(usage: IlmUsage, policyName: string): UsageExplainTarget | null {
  const prefixes = usage.dataStreams.map((stream) => `.ds-${stream}-`);
  const indices = usage.indices.filter((index) => !prefixes.some((prefix) => index.startsWith(prefix)));
  const names = [...usage.dataStreams, ...indices];
  if (names.length === 0) {
    return null;
  }
  const target = names.join(',');
  if (target.length > MAX_EXPLAIN_TARGET_LENGTH) {
    return { target: '*,.ds-*', query: policyName };
  }
  return { target, query: '' };
}
