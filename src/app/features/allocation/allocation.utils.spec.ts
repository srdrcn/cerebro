import { describe, expect, it } from 'vitest';
import { ClusterApiError } from '../../core/api-envelope';
import { NodeDecisionView, RawAllocationExplain } from './allocation.models';
import {
  blockingDeciders,
  buildExplainPayload,
  buildVerdict,
  commonBlockers,
  copiesOf,
  copyLabel,
  decisionMeta,
  deciderLabel,
  describeExplainError,
  describeStore,
  diskUsage,
  explainErrorDetails,
  explainQueryParams,
  friendlyNote,
  isNoUnassignedShards,
  lastAllocationStatusLabel,
  nodeDisplayName,
  nodeNamesById,
  normalizeExplanation,
  ordinal,
  parseExplainParams,
  parseShardCopies,
  requestFor,
  sameRequest,
  shardCount,
  shardSize,
  sortIndexNames,
  sortNodeDecisions,
  summarizeDecisions,
  unassignedGroups,
  visibleAttributes,
} from './allocation.utils';

/** Trimmed copy of the demo cluster's answer for overflow-test (3 replicas, 3 nodes). */
const UNASSIGNED: RawAllocationExplain = {
  note: 'No shard was specified in the explain API request, so this response explains a randomly chosen unassigned shard.',
  index: 'overflow-test',
  shard: 0,
  primary: false,
  current_state: 'unassigned',
  unassigned_info: {
    reason: 'CLUSTER_RECOVERED',
    at: '2026-10-14T15:54:10.085Z',
    last_allocation_status: 'no_attempt',
  },
  cluster_info: { nodes: {}, shard_sizes: {} },
  can_allocate: 'no',
  allocate_explanation: "Elasticsearch isn't allowed to allocate this shard to any of the nodes in the cluster.",
  node_allocation_decisions: [
    {
      node_id: 'n1',
      node_name: 'es-node-1',
      transport_address: '127.0.0.1:9300',
      node_attributes: { rack: 'r1', 'ml.config_version': '12.0.0', zone: 'zone-1', 'xpack.installed': 'true' },
      node_decision: 'no',
      deciders: [
        {
          decider: 'same_shard',
          decision: 'NO',
          explanation: 'a copy of this shard is already allocated to this node',
        },
      ],
    },
    {
      node_id: 'n3',
      node_name: 'es-node-3',
      transport_address: '127.0.0.1:9302',
      node_decision: 'no',
      deciders: [
        { decider: 'same_shard', decision: 'NO', explanation: 'a copy of this shard is already allocated to this node' },
        { decider: 'disk_threshold', decision: 'YES', explanation: 'enough disk' },
      ],
    },
  ],
};

/** Trimmed answer for a started primary of products. */
const ASSIGNED: RawAllocationExplain = {
  index: 'products',
  shard: 0,
  primary: true,
  current_state: 'started',
  current_node: { id: 'n1', name: 'es-node-1', transport_address: '127.0.0.1:9300', weight_ranking: 1 },
  cluster_info: {
    nodes: {
      n1: {
        node_name: 'es-node-1',
        least_available: { path: '/data', total_bytes: 1000, used_bytes: 870, free_bytes: 130, free_disk_percent: 13, used_disk_percent: 87 },
      },
    },
    shard_sizes: { '[products][0][p]': 387_000 },
  },
  can_remain_on_current_node: 'yes',
  can_rebalance_cluster: 'no',
  can_rebalance_cluster_decisions: [
    {
      decider: 'cluster_rebalance',
      decision: 'NO',
      explanation: 'the cluster has unassigned shards and cluster setting [cluster.routing.allocation.allow_rebalance] is set to [indices_all_active]',
    },
  ],
  can_rebalance_to_other_node: 'no',
  rebalance_explanation: 'Elasticsearch is not allowed to allocate or rebalance this shard to another node.',
  node_allocation_decisions: [
    { node_id: 'n3', node_name: 'es-node-3', node_decision: 'no', weight_ranking: 1, deciders: [{ decider: 'same_shard', decision: 'NO', explanation: 'copy' }] },
  ],
};

function node(name: string, decision: string, weightRanking: number | null): NodeDecisionView {
  return {
    id: name,
    name,
    address: '',
    decision,
    decisionLabel: decision,
    tone: 'gray',
    weightRanking,
    blockers: [],
    attributes: [],
    holdsCopy: false,
  };
}

/** The live ES 8.15 answer for products[0] primary while overflow-test has unassigned replicas. */
const PRODUCTS_PRIMARY: RawAllocationExplain = {
  index: 'products',
  shard: 0,
  primary: true,
  current_state: 'started',
  current_node: { id: 'I7MELLk0RvSiAPhRW6211Q', name: 'es-node-1', transport_address: '127.0.0.1:9300', weight_ranking: 1 },
  can_remain_on_current_node: 'yes',
  can_rebalance_cluster: 'no',
  can_rebalance_cluster_decisions: [
    {
      decider: 'cluster_rebalance',
      decision: 'NO',
      explanation: 'the cluster has unassigned shards and cluster setting [cluster.routing.allocation.allow_rebalance] is set to [indices_all_active]',
    },
  ],
  can_rebalance_to_other_node: 'no',
  rebalance_explanation:
    'Elasticsearch is not allowed to allocate or rebalance this shard to another node. If you expect this shard to be rebalanced to another node, find this node in the node-by-node explanation and address the reasons which prevent Elasticsearch from rebalancing this shard there.',
  node_allocation_decisions: [
    {
      node_id: 'wEqTWTA0T2CktRBr56viXg',
      node_name: 'es-node-2',
      node_decision: 'no',
      weight_ranking: 1,
      deciders: [
        {
          decider: 'same_shard',
          decision: 'NO',
          explanation: 'a copy of this shard is already allocated to this node [[products][0], node[wEqTWTA0T2CktRBr56viXg], [R], s[STARTED]]',
        },
      ],
    },
    {
      node_id: 'dmdk_a7-TrKWtlTZ9-ZHzQ',
      node_name: 'es-node-3',
      node_decision: 'no',
      weight_ranking: 2,
      deciders: [{ decider: 'cluster_rebalance', decision: 'NO', explanation: 'the cluster has unassigned shards' }],
    },
  ],
};

describe('text helpers', () => {
  it('builds ordinals', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 103].map(ordinal)).toEqual([
      '1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '103rd',
    ]);
  });

  it('hides built-in node attributes and sorts the rest', () => {
    expect(visibleAttributes({ zone: 'a', 'ml.x': '1', rack: 'r1', 'transform.y': '2' })).toEqual([
      ['rack', 'r1'],
      ['zone', 'a'],
    ]);
    expect(visibleAttributes(undefined)).toEqual([]);
  });

  it('lists regular indices before hidden ones', () => {
    expect(sortIndexNames(['b', '.ds-x', 'a', 'b', '.kibana'])).toEqual(['a', 'b', '.ds-x', '.kibana']);
  });
});

describe('decisions and deciders', () => {
  it('maps decisions to labels and tones regardless of case', () => {
    expect(decisionMeta('NO')).toEqual({ label: 'No', tone: 'red' });
    expect(decisionMeta('yes')).toEqual({ label: 'Yes', tone: 'green' });
    expect(decisionMeta('THROTTLE')).toEqual({ label: 'Throttled', tone: 'yellow' });
    expect(decisionMeta('worse_balance').label).toBe('Worse balance');
    expect(decisionMeta('something_new')).toEqual({ label: 'Something new', tone: 'gray' });
    expect(decisionMeta(undefined).label).toBe('Unknown');
  });

  it('labels known deciders and falls back to a readable name', () => {
    expect(deciderLabel('same_shard')).toBe('Same shard');
    expect(deciderLabel('disk_threshold')).toBe('Disk watermark');
    expect(deciderLabel('brand_new_decider')).toBe('Brand new decider');
  });

  it('keeps only the deciders that objected, with hints', () => {
    const blockers = blockingDeciders([
      { decider: 'same_shard', decision: 'NO', explanation: 'a copy is already here' },
      { decider: 'disk_threshold', decision: 'YES', explanation: 'fine' },
      { decider: 'throttling', decision: 'THROTTLE', explanation: 'busy' },
    ]);
    expect(blockers.map((decider) => [decider.decider, decider.decision])).toEqual([
      ['same_shard', 'no'],
      ['throttling', 'throttle'],
    ]);
    expect(blockers[0]?.explanation).toBe('A copy is already here');
    expect(blockers[0]?.hint).toContain('number_of_replicas');
  });
});

describe('unassigned info', () => {
  it('explains allocation statuses', () => {
    expect(lastAllocationStatusLabel('deciders_no')).toBe('Every node said no');
    expect(lastAllocationStatusLabel('brand_new')).toBe('Brand new');
    expect(lastAllocationStatusLabel(undefined)).toBeUndefined();
  });

  it('rewrites the "random shard" note', () => {
    expect(friendlyNote(UNASSIGNED.note)).toContain('explained an unassigned shard of its choice');
    expect(friendlyNote('something else')).toBe('something else');
    expect(friendlyNote(undefined)).toBeUndefined();
  });
});

describe('verdicts', () => {
  it('says an unassigned shard cannot be allocated', () => {
    const verdict = buildVerdict(UNASSIGNED);
    expect(verdict.title).toBe('Cannot be allocated');
    expect(verdict.tone).toBe('red');
    expect(verdict.text).toContain("isn't allowed");
  });

  it('covers the other unassigned outcomes', () => {
    const base: RawAllocationExplain = { current_state: 'unassigned' };
    expect(buildVerdict({ ...base, can_allocate: 'yes' }).title).toBe('Can be allocated');
    expect(buildVerdict({ ...base, can_allocate: 'throttled' }).title).toBe('Waiting to be allocated');
    expect(buildVerdict({ ...base, can_allocate: 'no_valid_shard_copy' }).tone).toBe('red');
    expect(buildVerdict({ ...base, can_allocate: 'awaiting_info' }).tone).toBe('blue');
    expect(buildVerdict({ ...base, can_allocate: 'no_attempt' }).title).toBe('Not attempted yet');
    const delayed = buildVerdict({
      ...base,
      can_allocate: 'allocation_delayed',
      allocate_explanation: 'waiting for the node to return',
      remaining_delay_in_millis: 45_000,
    });
    expect(delayed.title).toBe('Allocation delayed');
    expect(delayed.text).toBe('Waiting for the node to return About 45s remaining.');
    expect(buildVerdict(base).title).toBe('Unassigned');
  });

  it('names the node an assigned shard lives on', () => {
    expect(buildVerdict(ASSIGNED)).toMatchObject({ tone: 'green', title: 'Allocated to es-node-1' });
    expect(buildVerdict(ASSIGNED).text).not.toMatch(/not allowed/);
    expect(buildVerdict({ ...ASSIGNED, current_state: 'relocating' }).title).toBe('Relocating from es-node-1');
    expect(buildVerdict({ ...ASSIGNED, current_state: 'initializing' }).title).toBe('Initializing on es-node-1');
  });

  it('says in one clause whether an assigned shard will move', () => {
    const text = (patch: Partial<RawAllocationExplain>) => buildVerdict({ ...ASSIGNED, ...patch }).text;
    expect(text({ can_rebalance_to_other_node: 'worse_balance', can_rebalance_cluster: 'yes' })).toBe(
      'The shard is healthy on es-node-1 and can stay there. No other node would be a better fit.',
    );
    expect(text({ can_rebalance_to_other_node: 'no', can_rebalance_cluster: 'yes' })).toBe(
      'The shard is healthy on es-node-1 and can stay there. It is not being moved: no other node may take it.',
    );
    expect(text({ can_rebalance_to_other_node: 'yes', can_rebalance_cluster: 'yes' })).toMatch(/better-balanced node is available/);
    expect(text({ can_rebalance_to_other_node: 'throttle', can_rebalance_cluster: 'throttle' })).toMatch(/waiting for other recoveries/);
    expect(text({ can_rebalance_to_other_node: 'no', can_rebalance_cluster: 'no', can_rebalance_cluster_decisions: [] })).toMatch(
      /rebalancing is blocked\.$/,
    );
    expect(text({ can_rebalance_to_other_node: undefined, can_rebalance_cluster: undefined })).toBe(
      'The shard is healthy on es-node-1 and can stay there.',
    );
    expect(text({ current_state: 'initializing' })).toMatch(/being recovered onto es-node-1/);
  });

  it('flags a shard that must leave its node', () => {
    const stuck = buildVerdict({ ...ASSIGNED, can_remain_on_current_node: 'no', can_move_to_other_node: 'no' });
    expect(stuck).toMatchObject({ tone: 'red', title: 'Must leave es-node-1 but cannot move' });
    const moving = buildVerdict({ ...ASSIGNED, can_remain_on_current_node: 'no', can_move_to_other_node: 'yes', move_explanation: 'moving' });
    expect(moving).toMatchObject({ tone: 'yellow', title: 'Moving off es-node-1', text: 'Moving' });
    expect(buildVerdict({ ...ASSIGNED, can_remain_on_current_node: 'no', can_move_to_other_node: 'throttled' }).title).toBe(
      'Waiting to move off es-node-1',
    );
  });
});

describe('normalizeExplanation', () => {
  it('normalizes an unassigned replica', () => {
    const view = normalizeExplanation(UNASSIGNED);
    expect(view).toMatchObject({
      index: 'overflow-test',
      shard: 0,
      primary: false,
      state: 'unassigned',
      stateLabel: 'Unassigned',
      stateTone: 'yellow',
      assigned: false,
      shardSize: null,
    });
    expect(view.currentNode).toBeUndefined();
    expect(view.unassigned).toMatchObject({
      reasonLabel: 'Cluster recovered',
      at: Date.parse('2026-10-14T15:54:10.085Z'),
      failedAttempts: 0,
      lastStatusLabel: 'Not attempted yet',
      delayed: false,
    });
    expect(view.nodes.map((item) => [item.name, item.decision, item.blockers.length])).toEqual([
      ['es-node-1', 'no', 1],
      ['es-node-3', 'no', 1],
    ]);
    expect(view.nodes[0]?.attributes).toEqual([
      ['rack', 'r1'],
      ['zone', 'zone-1'],
    ]);
    expect(view.disks).toEqual([]);
    expect(view.checks).toEqual([]);
    expect(view.note).toBeDefined();
  });

  it('normalizes an assigned primary with facts, checks and disk usage', () => {
    const view = normalizeExplanation(ASSIGNED);
    expect(view.assigned).toBe(true);
    expect(view.currentNode).toEqual({ id: 'n1', name: 'es-node-1', address: '127.0.0.1:9300' });
    expect(view.facts.map((fact) => [fact.label, fact.value])).toEqual([
      ['Current node', 'es-node-1'],
      ['Weight ranking', '1st'],
      ['Shard size', '377.9 KB'],
    ]);
    expect(view.checks.map((check) => [check.label, check.decision, check.blockers.length])).toEqual([
      ['Can stay on es-node-1', 'yes', 0],
      ['Rebalancing allowed in the cluster', 'no', 1],
      ['Can rebalance to another node', 'no', 0],
    ]);
    expect(view.checks[1]?.blockers[0]?.label).toBe('Cluster rebalance');
    expect(view.disks).toEqual([
      { id: 'n1', name: 'es-node-1', usedPercent: 87, usedBytes: 870, freeBytes: 130, totalBytes: 1000, path: '/data' },
    ]);
  });

  it('names a requested node by id or name', () => {
    const view = normalizeExplanation(ASSIGNED);
    expect(nodeDisplayName('n1', view)).toBe('es-node-1');
    expect(nodeDisplayName('es-node-1', view)).toBe('es-node-1');
    expect(nodeDisplayName('I7MELLk0RvSiAPhRW6211Q', view)).toBe('I7MELLk0RvSiAPhRW6211Q');
    expect(nodeDisplayName('n1', undefined)).toBe('n1');
    const names = nodeNamesById([{ id: 'abc', name: 'es-node-9' }, { id: 1 }, null]);
    expect(names).toEqual(new Map([['abc', 'es-node-9']]));
    expect(nodeDisplayName('abc', view, names)).toBe('es-node-9');
    expect(nodeDisplayName('abc', undefined, names)).toBe('es-node-9');
    expect(nodeNamesById({})).toEqual(new Map());
  });

  it('treats blocked rebalancing of a healthy shard as information, not failure (live products[0])', () => {
    const view = normalizeExplanation(PRODUCTS_PRIMARY);
    expect(view.checks.map((check) => [check.label, check.decisionLabel, check.tone, check.icon])).toEqual([
      ['Can stay on es-node-1', 'Yes', 'green', 'bi-check-lg'],
      ['Rebalancing allowed in the cluster', 'No', 'gray', 'bi-pause-circle'],
      ['Can rebalance to another node', 'No', 'gray', 'bi-dash-lg'],
    ]);
    expect(view.checks.some((check) => check.tone === 'red')).toBe(false);
    // The raw rebalance explanation stays on its check row only.
    expect(view.checks[2]?.explanation).toMatch(/^Elasticsearch is not allowed to allocate or rebalance/);
    expect(view.verdict).toEqual({
      tone: 'green',
      icon: 'bi-check2-circle',
      title: 'Allocated to es-node-1',
      text: 'The shard is healthy on es-node-1 and can stay there. It is not being moved: rebalancing is blocked (Cluster rebalance).',
    });
  });

  it('maps every rebalance outcome to a calm label', () => {
    const label = (value: string) =>
      normalizeExplanation({ ...PRODUCTS_PRIMARY, can_rebalance_to_other_node: value }).checks[2];
    expect(label('worse_balance')).toMatchObject({ decisionLabel: 'No better node', tone: 'green' });
    expect(label('yes')).toMatchObject({ decisionLabel: 'Better node found', tone: 'blue' });
    expect(label('throttle')).toMatchObject({ decisionLabel: 'Throttled', tone: 'yellow', icon: 'bi-hourglass-split' });
    expect(
      normalizeExplanation({ ...PRODUCTS_PRIMARY, can_rebalance_cluster: 'yes', can_rebalance_cluster_decisions: [] }).checks[1],
    ).toMatchObject({ decisionLabel: 'Yes', tone: 'green' });
    // Only "cannot stay" is red.
    expect(
      normalizeExplanation({ ...PRODUCTS_PRIMARY, can_remain_on_current_node: 'no' }).checks[0],
    ).toMatchObject({ decisionLabel: 'No', tone: 'red', icon: 'bi-x-lg' });
  });

  it('marks nodes holding another copy and drops remedy hints for assigned shards', () => {
    const assigned = normalizeExplanation(PRODUCTS_PRIMARY);
    expect(assigned.nodes.map((item) => [item.name, item.holdsCopy])).toEqual([
      ['es-node-2', true],
      ['es-node-3', false],
    ]);
    expect(assigned.nodes.flatMap((item) => item.blockers).every((decider) => decider.hint === undefined)).toBe(true);
    const unassigned = normalizeExplanation(UNASSIGNED);
    expect(unassigned.nodes.some((item) => item.blockers.some((decider) => decider.hint !== undefined))).toBe(true);
  });

  it('adds the move check when the shard cannot stay', () => {
    const view = normalizeExplanation({
      ...ASSIGNED,
      can_remain_on_current_node: 'no',
      can_remain_decisions: [{ decider: 'filter', decision: 'NO', explanation: 'excluded' }],
      can_move_to_other_node: 'no',
      move_explanation: 'nowhere to go',
    });
    expect(view.checks.map((check) => check.label)).toContain('Can move to another node');
    expect(view.checks[0]?.blockers[0]?.label).toBe('Allocation filtering');
  });

  it('survives an almost empty response', () => {
    const view = normalizeExplanation({});
    expect(view.stateLabel).toBe('Unknown');
    expect(view.nodes).toEqual([]);
    expect(view.verdict.title).toBe('Unassigned');
  });
});

describe('disk and store helpers', () => {
  it('derives missing disk numbers', () => {
    expect(
      diskUsage({ nodes: { b: { least_available: { total_bytes: 200, free_bytes: 50 } }, a: { node_name: 'alpha', least_available: { total_bytes: 0 } } } }),
    ).toEqual([{ id: 'b', name: 'b', usedPercent: 75, usedBytes: 150, freeBytes: 50, totalBytes: 200 }]);
  });

  it('reads shard sizes with and without the _bytes suffix', () => {
    expect(shardSize({ shard_sizes: { '[a][1][r]_bytes': 10 } }, 'a', 1, false)).toBe(10);
    expect(shardSize({ shard_sizes: { '[a][1][p]': 12 } }, 'a', 1, true)).toBe(12);
    expect(shardSize(undefined, 'a', 1, true)).toBeNull();
  });

  it('describes what a node holds on disk', () => {
    expect(describeStore({ in_sync: true })).toBe('Holds an in-sync copy');
    expect(describeStore({ in_sync: false, found: true })).toBe('Holds a stale copy');
    expect(describeStore({ found: false })).toBe('No copy on disk');
    expect(describeStore({ store_exception: { type: 'x' } })).toBe('Copy on disk could not be read');
    expect(describeStore({ matching_size_in_bytes: 2048 })).toBe('2 KB of matching data');
    expect(describeStore({})).toBeUndefined();
    expect(describeStore(undefined)).toBeUndefined();
  });
});

describe('node decision sorting', () => {
  const nodes = [node('es-node-10', 'no', 2), node('es-node-2', 'yes', 3), node('es-node-1', 'throttled', null), node('es-node-3', 'no', 1)];

  it('puts the best decisions first, then the weight ranking', () => {
    expect(sortNodeDecisions(nodes, 'decision').map((item) => item.name)).toEqual([
      'es-node-2',
      'es-node-1',
      'es-node-3',
      'es-node-10',
    ]);
    expect(sortNodeDecisions(nodes, 'decision', true)[0]?.name).toBe('es-node-3');
  });

  it('sorts names naturally and keeps unranked nodes last', () => {
    expect(sortNodeDecisions(nodes, 'name').map((item) => item.name)).toEqual([
      'es-node-1',
      'es-node-2',
      'es-node-3',
      'es-node-10',
    ]);
    expect(sortNodeDecisions(nodes, 'weight').map((item) => item.name)).toEqual([
      'es-node-3',
      'es-node-10',
      'es-node-2',
      'es-node-1',
    ]);
    expect(sortNodeDecisions(nodes, 'weight', true).map((item) => item.name)).toEqual([
      'es-node-2',
      'es-node-10',
      'es-node-3',
      'es-node-1',
    ]);
  });

  it('summarizes decisions', () => {
    expect(summarizeDecisions(nodes)).toEqual({ yes: 1, throttled: 1, no: 2, other: 0 });
  });
});

describe('requests and URLs', () => {
  const params = (values: Record<string, string>) => (name: string) => values[name] ?? null;

  it('parses deep links', () => {
    expect(parseExplainParams(params({}))).toBeNull();
    expect(parseExplainParams(params({ index: '  ' }))).toBeNull();
    expect(parseExplainParams(params({ index: 'logs', shard: '2', primary: 'false', node: 'es-node-2' }))).toEqual({
      index: 'logs',
      shard: 2,
      primary: false,
      node: 'es-node-2',
    });
    expect(parseExplainParams(params({ index: 'logs', shard: 'x' }))).toEqual({ index: 'logs', shard: 0, primary: true });
    expect(parseExplainParams(params({ index: 'logs', shard: '-3', primary: 'true' }))).toEqual({ index: 'logs', shard: 0, primary: true });
  });

  it('builds query params and payloads', () => {
    expect(explainQueryParams(null)).toEqual({ index: null, shard: null, primary: null, node: null });
    expect(explainQueryParams({ index: 'a', shard: 1, primary: false })).toEqual({ index: 'a', shard: '1', primary: 'false', node: null });
    expect(buildExplainPayload(null)).toEqual({});
    expect(buildExplainPayload({ index: 'a', shard: 0, primary: false, node: 'n' })).toEqual({
      index: 'a',
      shard: 0,
      primary: false,
      current_node: 'n',
    });
  });

  it('compares requests', () => {
    expect(sameRequest(null, null)).toBe(true);
    expect(sameRequest(null, { index: 'a', shard: 0, primary: true })).toBe(false);
    expect(sameRequest({ index: 'a', shard: 0, primary: true }, { index: 'a', shard: 0, primary: true })).toBe(true);
    expect(sameRequest({ index: 'a', shard: 0, primary: false, node: 'x' }, { index: 'a', shard: 0, primary: false })).toBe(false);
  });

  it('re-runs the shard an explanation is about', () => {
    const view = normalizeExplanation(UNASSIGNED);
    expect(requestFor(view, null)).toEqual({ index: 'overflow-test', shard: 0, primary: false });
    expect(requestFor(view, { index: 'overflow-test', shard: 0, primary: false, node: 'es-node-2' })).toEqual({
      index: 'overflow-test',
      shard: 0,
      primary: false,
      node: 'es-node-2',
    });
  });
});

describe('errors', () => {
  const noUnassigned = new ClusterApiError(400, {
    error: {
      root_cause: [{ type: 'illegal_argument_exception', reason: 'unable to find any unassigned shards to explain [ClusterAllocationExplainRequest[useAnyUnassignedShard=true]]' }],
      type: 'illegal_argument_exception',
      reason: 'unable to find any unassigned shards to explain [ClusterAllocationExplainRequest[useAnyUnassignedShard=true]]',
    },
    status: 400,
  });

  it('recognizes the "no unassigned shards" answer of a healthy cluster', () => {
    expect(isNoUnassignedShards(noUnassigned)).toBe(true);
    expect(
      isNoUnassignedShards(new ClusterApiError(400, { error: { type: 'illegal_argument_exception', reason: 'No shard was specified in the request which means the response should explain a randomly-chosen unassigned shard, but there are no unassigned shards in this cluster.' } })),
    ).toBe(true);
    expect(isNoUnassignedShards(new ClusterApiError(404, { error: { type: 'index_not_found_exception', reason: 'no such index [x]' } }))).toBe(false);
    expect(isNoUnassignedShards(new Error('boom'))).toBe(false);
  });

  it('extracts Elasticsearch error details', () => {
    expect(explainErrorDetails(new ClusterApiError(404, { error: { root_cause: [{ type: 't', reason: 'r', index: 'i', shard: '9' }] } }))).toEqual({
      status: 404,
      type: 't',
      reason: 'r',
      index: 'i',
      shard: '9',
    });
    expect(explainErrorDetails(new ClusterApiError(500, { error: 'plain text' }))).toEqual({
      status: 500,
      reason: 'plain text',
      unreachable: true,
    });
    expect(explainErrorDetails(new ClusterApiError(502, 'Bad gateway'))).toEqual({ status: 502, reason: 'Bad gateway' });
    expect(explainErrorDetails('oops')).toEqual({ reason: 'oops' });
    expect(explainErrorDetails(null)).toEqual({});
  });

  it('describes failures in plain language', () => {
    expect(
      describeExplainError(new ClusterApiError(404, { error: { type: 'index_not_found_exception', reason: 'no such index [nope]', index: 'nope' } }), null),
    ).toEqual({ title: 'Index not found', message: 'There is no index named "nope".' });
    expect(
      describeExplainError(
        new ClusterApiError(404, { error: { type: 'shard_not_found_exception', reason: 'no such shard', index: 'products', shard: '9' } }),
        { index: 'products', shard: 9, primary: true },
      ),
    ).toEqual({ title: 'Shard not found', message: 'Index "products" has no shard 9. Shard numbers start at 0.' });
    expect(
      describeExplainError(
        new ClusterApiError(400, { error: { type: 'illegal_argument_exception', reason: 'unable to find a replica shard assigned to node [es-node-1]' } }),
        null,
      ),
    ).toEqual({
      title: 'Elasticsearch could not explain this shard',
      message: 'Unable to find a replica shard assigned to node [es-node-1]',
    });
    expect(
      describeExplainError(
        new ClusterApiError(400, {
          error: {
            root_cause: [{ type: 'illegal_argument_exception', reason: 'failed to resolve [es-node-9], no matching nodes' }],
            type: 'illegal_argument_exception',
            reason: 'failed to resolve [es-node-9], no matching nodes',
          },
          status: 400,
        }),
        { index: 'products', shard: 0, primary: false, node: 'es-node-9' },
      ),
    ).toEqual({
      title: 'Node not found',
      message: 'No node named "es-node-9" is in the cluster. It may have left; explain the shard without a node instead.',
      unknownNode: 'es-node-9',
    });
    expect(describeExplainError(new ClusterApiError(403, {}), null).title).toBe('Not allowed');
    expect(describeExplainError(new Error('network'), null).title).toBe('Could not reach the cluster');
    expect(
      describeExplainError(new ClusterApiError(500, { error: 'Connection refused: localhost/127.0.0.1:9299' }), null),
    ).toEqual({
      title: 'Could not reach the cluster',
      message: 'Connection refused: localhost/127.0.0.1:9299',
      unreachable: true,
    });
    expect(describeExplainError(new ClusterApiError(500, {}), null).message).toBe('The request failed with status 500.');
  });
});

describe('shard copies', () => {
  const copies = parseShardCopies([
    { index: 'overflow-test', shard: '0', prirep: 'r', state: 'STARTED', node: 'es-node-3' },
    { index: 'overflow-test', shard: '0', prirep: 'p', state: 'STARTED', node: 'es-node-1' },
    { index: 'overflow-test', shard: '0', prirep: 'r', state: 'UNASSIGNED', node: null },
    { index: 'overflow-test', shard: '1', prirep: 'r', state: 'UNASSIGNED', node: null },
    { index: '.ds-hidden', shard: '0', prirep: 'p', state: 'UNASSIGNED', node: null },
    { index: 'moving', shard: '0', prirep: 'p', state: 'RELOCATING', node: 'es-node-1 -> 127.0.0.1 abc es-node-2' },
    { index: 'broken', shard: 'x' },
    'garbage',
  ]);

  it('parses _cat/shards rows', () => {
    expect(copies).toHaveLength(6);
    expect(copies.find((copy) => copy.index === 'moving')?.node).toBe('es-node-1');
    expect(parseShardCopies({ not: 'an array' })).toEqual([]);
  });

  it('orders the copies of one shard', () => {
    expect(copiesOf(copies, 'overflow-test', 0).map((copy) => [copy.primary, copy.node])).toEqual([
      [true, 'es-node-1'],
      [false, 'es-node-3'],
      [false, null],
    ]);
    expect(shardCount(copies, 'overflow-test')).toBe(2);
    expect(shardCount(copies, 'missing')).toBe(0);
  });

  it('groups unassigned copies by index, hidden indices last', () => {
    expect(unassignedGroups(copies).map((group) => [group.index, group.copies.map((copy) => copy.shard)])).toEqual([
      ['overflow-test', [0, 1]],
      ['.ds-hidden', [0]],
    ]);
  });

  it('labels copies for screen readers', () => {
    expect(copyLabel(copies[1]!)).toBe('Primary of shard 0, started on es-node-1');
    expect(copyLabel(copies[2]!)).toBe('Replica of shard 0, unassigned');
  });
});

describe('commonBlockers', () => {
  it('aggregates the deciders that refused, most widespread first', () => {
    const view = normalizeExplanation({
      ...UNASSIGNED,
      node_allocation_decisions: [
        ...(UNASSIGNED.node_allocation_decisions ?? []),
        {
          node_id: 'n2',
          node_name: 'es-node-2',
          node_decision: 'no',
          deciders: [
            { decider: 'same_shard', decision: 'NO', explanation: 'x' },
            { decider: 'awareness', decision: 'NO', explanation: 'y' },
          ],
        },
        { node_id: 'n4', node_name: 'es-node-4', node_decision: 'yes', deciders: [] },
      ],
    });
    const blockers = commonBlockers(view.nodes);
    expect(blockers.map((blocker) => [blocker.decider, blocker.nodes])).toEqual([
      ['same_shard', ['es-node-1', 'es-node-3', 'es-node-2']],
      ['awareness', ['es-node-2']],
    ]);
    expect(blockers[0]?.label).toBe('Same shard');
    expect(blockers[0]?.hint).toBeDefined();
    expect(commonBlockers([])).toEqual([]);
  });
});
