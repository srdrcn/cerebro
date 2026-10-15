import { describe, expect, it } from 'vitest';
import {
  ALIAS_ROWS,
  CAT_SHARDS,
  CLUSTER_SETTINGS_DISK,
  DATA_STREAMS,
  DETAIL_BACKING_INDEX,
  DETAIL_CLOSED,
  DETAIL_PREPARED,
  DETAIL_RELOCATING,
  DETAIL_ROLLOVER_WRITE_INDEX,
  DETAIL_SHRUNK_TWO,
  DETAIL_SPREAD,
  DETAIL_TARGET_INITIALIZING,
  LOOKUP_CLOSED,
  LOOKUP_INDICES,
  NODES,
  ROLLOVER_DATA_STREAM_DRY_RUN,
  ROLLOVER_DRY_RUN,
  TASK_CANCELLED,
  TASK_CONFLICTS,
  TASK_DONE,
  TASK_RUNNING,
  TASK_SIX_SLICES,
  TASK_SIX_SLICES_CHILDREN,
  TASK_SLICED_RUNNING,
} from './index-ops.fixtures';
import {
  Check,
  DiskWatermarks,
  NodeOption,
  RawAliasRow,
  RawListedTask,
  RawNode,
  ReindexOptions,
  ShardCopy,
  SourceIndex,
  TaskGetResponse,
  Watermark,
} from './index-ops.models';
import {
  DEFAULT_REINDEX_OPTIONS,
  EMPTY_CONDITIONS,
  MAX_DOCS_PER_SHARD,
  ROLLOVER_CONDITIONS,
  allocationExclusion,
  allocationSettings,
  autoSlices,
  blankSource,
  catShardRows,
  conditionSupported,
  describedReindex,
  diskLevel,
  diskWatermarks,
  explicitWriteIndexRequest,
  flattenSettings,
  groupFailures,
  minNodeVersion,
  parseByteSize,
  parseLookupRows,
  copySourceIndex,
  parseVersion,
  preferredTier,
  parseWatermark,
  refreshSource,
  readableSources,
  requiredFree,
  steadyProgress,
  tierExclusion,
  tierNote,
  withBlocks,
  buildReindexRequest,
  buildResizeRequest,
  buildRolloverRequest,
  colocatedNodes,
  colocation,
  conditionCurrent,
  conditionErrors,
  conditionsBody,
  dataStreamMembership,
  defaultRoutingShards,
  foreignRestrictions,
  divisors,
  interpretRollover,
  maxDocsPerTargetShard,
  needsSliceChildren,
  newIndexNameError,
  nextRolloverName,
  nodeOptions,
  parseAliasList,
  targetAliasesError,
  parseCount,
  parseIndices,
  parseQuery,
  prepareShrinkRequest,
  reindexChecks,
  reindexErrors,
  reindexProgress,
  recordChanges,
  releaseSourceRequest,
  remainingChanges,
  requestText,
  resizeChecks,
  rolloverChecks,
  rolloverTargets,
  routingShardsOf,
  settingValue,
  shardCopies,
  shardCountCompatibility,
  shrinkChoices,
  shrinkDiskNeed,
  sourceExpressions,
  splitChoices,
  suggestTargetName,
  suggestedShrinkNode,
  summarizeChecks,
  targetRecovery,
  writeBlockRequest,
  writeIndexFacts,
} from './index-ops.utils';

function only(response: Parameters<typeof parseIndices>[0]): SourceIndex {
  const [index] = parseIndices(response);
  if (!index) {
    throw new Error('fixture has no index');
  }
  return index;
}

function statusOf(checks: readonly Check[], id: string): Check['status'] | undefined {
  return checks.find((check) => check.id === id)?.status;
}

const spread = only(DETAIL_SPREAD);
const relocating = only(DETAIL_RELOCATING);
const prepared = only(DETAIL_PREPARED);
const nodes = nodeOptions(NODES, prepared.shards);
const noNames = { indices: [], aliases: [], dataStreams: [] };

describe('settingValue', () => {
  it('reads nested, flat and mixed settings', () => {
    expect(settingValue({ index: { blocks: { write: 'true' } } }, 'index.blocks.write')).toBe('true');
    expect(settingValue({ 'index.blocks.write': true }, 'index.blocks.write')).toBe(true);
    expect(settingValue({ index: { 'blocks.write': 'false' } }, 'index.blocks.write')).toBe('false');
    expect(settingValue({ index: { routing: { allocation: { require: { _name: 'es-node-1' } } } } }, 'index.routing.allocation.require._name')).toBe(
      'es-node-1',
    );
    expect(settingValue({ index: {} }, 'index.blocks.write')).toBeUndefined();
    expect(settingValue(null, 'index.blocks.write')).toBeUndefined();
  });

  it('keeps the explicit null a resize leaves behind', () => {
    expect(settingValue({ index: { blocks: { write: null } } }, 'index.blocks.write')).toBeNull();
  });
});

describe('parseCount', () => {
  it('accepts whole numbers above 0 only', () => {
    expect(parseCount(' 12 ')).toBe(12);
    expect(parseCount('0')).toBeNull();
    expect(parseCount('1.5')).toBeNull();
    expect(parseCount('')).toBeNull();
    expect(parseCount('-3')).toBeNull();
  });
});

describe('shardCopies', () => {
  it('reads relocating copies as staying on the source node', () => {
    const copies = shardCopies(DETAIL_RELOCATING.shards);
    const moving = copies.filter((copy) => copy.state === 'relocating');
    expect(moving).toHaveLength(2);
    expect(moving[0]).toMatchObject({ shard: 0, primary: false, node: 'es-node-2', relocatingTo: 'es-node-1', docs: 779, size: 30159 });
  });

  it('reads unassigned copies without a node', () => {
    const copies = shardCopies(DETAIL_TARGET_INITIALIZING.shards);
    expect(copies.filter((copy) => copy.state === 'unassigned').every((copy) => copy.node === null && copy.docs === null)).toBe(true);
  });

  it('accepts a missing shard list', () => {
    expect(shardCopies(null)).toEqual([]);
  });
});

describe('routing shards', () => {
  it('computes the default of Elasticsearch 7+', () => {
    // Values read from the cluster state of the demo cluster.
    expect(defaultRoutingShards(4)).toBe(1024); // orders-v2
    expect(defaultRoutingShards(5)).toBe(640); // search-sessions
    expect(defaultRoutingShards(3)).toBe(768); // logs-2026.10.12
    expect(defaultRoutingShards(2)).toBe(1024); // audit-trail
    expect(defaultRoutingShards(1)).toBe(1024);
    expect(defaultRoutingShards(1024)).toBe(2048);
  });

  it('prefers an explicit setting', () => {
    expect(routingShardsOf({ index: { number_of_routing_shards: '30' } }, 5)).toEqual({ value: 30, origin: 'setting' });
    expect(routingShardsOf({}, 1)).toEqual({ value: 1024, origin: 'single-shard' });
    expect(routingShardsOf({ index: { version: { created: '8512000' } } }, 3)).toEqual({ value: 768, origin: 'default' });
    expect(routingShardsOf({ index: { version: { created: '6080099' } } }, 3)).toEqual({ value: 3, origin: 'default' });
    expect(routingShardsOf({}, null)).toBeNull();
  });

  it('takes the exact value of the cluster state when there is one', () => {
    const version = { index: { version: { created: '8512000' } } };
    // A 2-shard index shrunk from 6 shards keeps their 768 routing shards; the estimate says 1,024.
    expect(routingShardsOf(version, 2, 768)).toEqual({ value: 768, origin: 'metadata' });
    expect(routingShardsOf({ index: { number_of_routing_shards: '30' } }, 5, 30)).toEqual({ value: 30, origin: 'setting' });
    expect(routingShardsOf({ index: { number_of_routing_shards: '30' } }, 5, 60)).toEqual({ value: 60, origin: 'metadata' });
    // A one-shard index splits into anything, whatever the cluster state says.
    expect(routingShardsOf(version, 1, 1024)).toEqual({ value: 1024, origin: 'single-shard' });
  });

  it('reads routing_num_shards from index_detail for the index that was asked for', () => {
    const two = only(DETAIL_SHRUNK_TWO);
    expect(two).toMatchObject({ name: 'tmp-index-ops-two', primaries: 2, routingShards: { value: 768, origin: 'metadata' }, resizedFrom: null });
    expect(only(DETAIL_SPREAD).routingShards).toEqual({ value: 1024, origin: 'metadata' });
    // Without it (older backend, refused cluster state): the estimate.
    expect(only({ ...DETAIL_SHRUNK_TWO, routing_num_shards: null }).routingShards).toEqual({ value: 1024, origin: 'default' });
    // An alias of several indices gets none: the value belongs to one name.
    const both = parseIndices({ ...DETAIL_SPREAD, settings: { ...DETAIL_SPREAD.settings, ...DETAIL_PREPARED.settings }, routing_num_shards: 40 });
    expect(both.map((index) => index.routingShards)).toEqual([
      { value: 1024, origin: 'default' },
      { value: 1024, origin: 'default' },
    ]);
    expect(parseIndices({ ...DETAIL_SPREAD, routing_num_shards: 0 })[0]?.routingShards?.origin).toBe('default');
  });
});

describe('parseIndices', () => {
  it('summarizes an open index', () => {
    expect(spread).toMatchObject({
      name: 'orders-v2',
      primaries: 4,
      replicas: 1,
      docs: 9000,
      health: 'green',
      open: true,
      writeBlock: false,
      writeBlocked: false,
      requiredNode: null,
      routingShards: { value: 1024, origin: 'metadata' },
      aliases: ['orders'],
      writeAliases: [],
      dataStream: null,
      dataStreamWriteIndex: false,
      shardsKnown: true,
    });
    expect(spread.shards).toHaveLength(8);
    expect(spread.primarySize).toBeGreaterThan(0);
  });

  it('reads the preparation settings', () => {
    expect(prepared).toMatchObject({
      name: 'tmp-index-ops-src',
      primaries: 4,
      writeBlock: true,
      writeBlocked: true,
      blockSettings: ['index.blocks.write'],
      requiredNode: 'es-node-1',
      docs: 3000,
    });
  });

  it('treats the nulls a resize leaves behind as unset', () => {
    const target = only(DETAIL_TARGET_INITIALIZING);
    expect(target).toMatchObject({ requiredNode: null, writeBlocked: false, blockSettings: [], health: 'yellow', primaries: 2 });
  });

  it('tells closed indices from missing statistics', () => {
    const [archive, customers] = parseIndices(DETAIL_CLOSED);
    // Closed indices have no statistics; their replicated copies still tell the health.
    expect(archive).toMatchObject({ name: 'archive-2025', open: false, health: 'green', docs: 700, primaries: 1 });
    expect(customers).toMatchObject({ name: 'customers', open: null, docs: 1800 });
  });

  it('marks data stream backing indices', () => {
    const membership = dataStreamMembership(DATA_STREAMS);
    expect(membership.get('.ds-app-events-web-2026.10.14-000002')).toEqual({ dataStream: 'app-events-web', writeIndex: true });
    expect(membership.get('.ds-app-events-web-2026.10.14-000001')).toEqual({ dataStream: 'app-events-web', writeIndex: false });
    const response = { ...DETAIL_ROLLOVER_WRITE_INDEX };
    const [index] = parseIndices(response, new Map([['tmp-index-ops-roll-000001', { dataStream: 'x', writeIndex: true }]]));
    expect(index).toMatchObject({ dataStream: 'x', dataStreamWriteIndex: true, writeAliases: ['tmp-index-ops-roll'] });
  });

  it('returns nothing for an empty answer', () => {
    expect(parseIndices(null)).toEqual([]);
    expect(parseIndices({ settings: {}, stats: null, aliases: null, shards: null })).toEqual([]);
  });
});

describe('nodes and colocation', () => {
  it('lists data nodes with the shards they hold', () => {
    expect(nodes.map((node) => [node.name, node.shardsHere])).toEqual([
      ['es-node-1', 4],
      ['es-node-2', 1],
      ['es-node-3', 3],
    ]);
    expect(nodes[0]?.diskAvailable).toBe(NODES.find((node) => node.name === 'es-node-1')?.disk?.available);
  });

  it('suggests the node that needs the fewest moves', () => {
    expect(suggestedShrinkNode(nodes)?.name).toBe('es-node-1');
    // orders-v2: es-node-2 and es-node-3 hold three shards each, same disk.
    expect(suggestedShrinkNode(nodeOptions(NODES, spread.shards))?.name).toBe('es-node-2');
    expect(suggestedShrinkNode([])).toBeNull();
  });

  it('finds nodes holding every shard', () => {
    expect(colocatedNodes(spread.shards, 4)).toEqual([]);
    expect(colocatedNodes(prepared.shards, 4)).toEqual(['es-node-1']);
  });

  it('follows the copies moving to the node', () => {
    expect(colocation(relocating.shards, 4, 'es-node-1')).toEqual({
      node: 'es-node-1',
      covered: 2,
      total: 4,
      moving: 2,
      unsettled: 2,
      done: false,
    });
    expect(colocation(prepared.shards, 4, 'es-node-1')).toMatchObject({ covered: 4, moving: 0, done: true });
  });

  it('estimates the disk a shrink needs', () => {
    expect(shrinkDiskNeed(prepared, 'es-node-1')).toEqual({ toMove: 0, need: prepared.primarySize });
    const shardOne = spread.shards.find((copy) => copy.shard === 1 && copy.primary)?.size ?? 0;
    expect(shrinkDiskNeed(spread, 'es-node-2')).toEqual({ toMove: shardOne, need: shardOne + (spread.primarySize ?? 0) });
  });
});

describe('shard counts', () => {
  it('lists divisors and shrink choices', () => {
    expect(divisors(12)).toEqual([1, 2, 3, 4, 6, 12]);
    expect(divisors(0)).toEqual([]);
    expect(shrinkChoices(4)).toEqual([1, 2]);
    expect(shrinkChoices(7)).toEqual([1]);
    expect(shrinkChoices(1)).toEqual([]);
  });

  it('lists split choices allowed by the routing shards', () => {
    expect(splitChoices(4, { value: 1024, origin: 'default' })).toEqual([8, 16, 32, 64, 128, 256, 512, 1024]);
    expect(splitChoices(3, { value: 768, origin: 'default' })).toEqual([6, 12, 24, 48, 96, 192, 384, 768]);
    expect(splitChoices(5, { value: 30, origin: 'setting' })).toEqual([10, 15, 30]);
    expect(splitChoices(1, { value: 1024, origin: 'single-shard' })).toContain(3);
    expect(splitChoices(0, null)).toEqual([]);
  });

  it('lists the exact split choices of the cluster state', () => {
    const two = only(DETAIL_SHRUNK_TWO);
    // Multiples of 2 that divide 768; the estimate (1,024) would offer 8 but not 6, 12 or 24.
    expect(splitChoices(2, two.routingShards)).toEqual([4, 6, 8, 12, 16, 24, 32, 48, 64, 96, 128, 192, 256, 384, 768]);
    expect(shardCountCompatibility('split', 2, 10, two.routingShards).reason).toBe(
      '10 does not divide the 768 routing shards of the source: choose 4, 6, 8, 12, 16, 24, 32, 48, 64 …',
    );
    // A new 2-shard index (the demo cluster's audit-trail): 2 × 2^9.
    expect(splitChoices(2, { value: 1024, origin: 'metadata' })).toEqual([4, 8, 16, 32, 64, 128, 256, 512, 1024]);
  });

  it('explains invalid shrink targets', () => {
    expect(shardCountCompatibility('shrink', 4, 2)).toEqual({ ok: true, reason: null });
    expect(shardCountCompatibility('shrink', 4, 3).reason).toBe('3 is not a factor of 4: choose 1 or 2');
    expect(shardCountCompatibility('shrink', 12, 5).reason).toBe('5 is not a factor of 12: choose 1, 2, 3, 4 or 6');
    expect(shardCountCompatibility('shrink', 7, 2).reason).toBe('2 is not a factor of 7: choose 1');
    expect(shardCountCompatibility('shrink', 4, 4).reason).toBe('A shrink needs fewer shards than the 4 of the source');
    expect(shardCountCompatibility('shrink', 4, null).reason).toBe('Choose the number of primary shards');
  });

  it('explains invalid split targets', () => {
    const routing = { value: 768, origin: 'default' } as const;
    expect(shardCountCompatibility('split', 3, 6, routing).ok).toBe(true);
    expect(shardCountCompatibility('split', 4, 6).reason).toBe('6 is not a multiple of 4');
    expect(shardCountCompatibility('split', 3, 9, routing).reason).toBe(
      '9 does not divide the 768 routing shards of the source: choose 6, 12, 24, 48, 96, 192, 384 or 768',
    );
    expect(shardCountCompatibility('split', 3, 3, routing).reason).toBe('A split needs more shards than the 3 of the source');
    expect(shardCountCompatibility('split', 1, 7, { value: 1024, origin: 'single-shard' }).ok).toBe(true);
    expect(shardCountCompatibility('split', 1, 2048).reason).toBe('An index cannot have more than 1,024 primary shards');
  });

  it('keeps the shard count of a clone', () => {
    expect(shardCountCompatibility('clone', 4, 4).ok).toBe(true);
    expect(shardCountCompatibility('clone', 4, 2).reason).toBe('A clone keeps the 4 shards of the source');
  });

  it('adds up the documents each shrunken shard receives', () => {
    // Shard 0 of tmp-index-ops-shrunk had 1,545 documents after the live shrink.
    expect(maxDocsPerTargetShard(prepared.shards, 4, 2)).toBe(1545);
    expect(maxDocsPerTargetShard(prepared.shards, 4, 1)).toBe(3000);
    expect(maxDocsPerTargetShard(prepared.shards, 4, 3)).toBeNull();
    expect(maxDocsPerTargetShard([], 4, 2)).toBeNull();
  });
});

describe('names', () => {
  it('refuses names in use', () => {
    const taken = { indices: ['logs'], aliases: ['catalog'], dataStreams: ['events'] };
    expect(newIndexNameError('logs', taken)).toBe('An index named "logs" already exists');
    expect(newIndexNameError('catalog', taken)).toBe('An alias named "catalog" already exists');
    expect(newIndexNameError('events', taken)).toBe('A data stream named "events" already exists');
    expect(newIndexNameError('fresh', taken)).toBeNull();
  });

  it('parses alias lists', () => {
    expect(parseAliasList(' a, b ,a,')).toEqual({ names: ['a', 'b'], error: null });
    expect(parseAliasList('ok, Bad').error).toBe('Alias names must be lowercase (Bad)');
  });

  it('refuses target aliases named like an index, a data stream or the new index', () => {
    const taken = { indices: ['products'], aliases: ['catalog'], dataStreams: ['events'] };
    expect(targetAliasesError('fresh, products', taken, 'copy')).toBe('"products" is an index: an alias cannot use its name');
    expect(targetAliasesError('events', taken, 'copy')).toBe('"events" is a data stream: an alias cannot use its name');
    expect(targetAliasesError('copy', taken, 'copy')).toBe('"copy" is the name of the new index: an alias cannot use it');
    expect(targetAliasesError('Bad', taken, 'copy')).toBe('Alias names must be lowercase (Bad)');
    // Joining an existing alias is fine.
    expect(targetAliasesError('catalog, fresh', taken, 'copy')).toBeNull();
  });

  it('suggests a free target name', () => {
    expect(suggestTargetName('logs', 'shrink', noNames)).toBe('logs-shrunk');
    expect(suggestTargetName('logs', 'split', { ...noNames, indices: ['logs-split', 'logs-split-2'] })).toBe('logs-split-3');
    expect(suggestTargetName('.hidden', 'clone', noNames)).toBe('hidden-clone');
  });
});

describe('resizeChecks', () => {
  it('reports what a spread, writable index lacks for a shrink', () => {
    const checks = resizeChecks({ kind: 'shrink', source: spread, targetShards: 2, nodes: nodeOptions(NODES, spread.shards) });
    expect(checks.map((check) => [check.id, check.status, check.fix])).toEqual([
      ['open', 'pass', undefined],
      ['write-block', 'fail', 'prepare'],
      ['colocation', 'fail', 'prepare'],
      ['health', 'pass', undefined],
      ['disk', 'warn', undefined],
      ['docs', 'pass', undefined],
    ]);
    expect(checks.find((check) => check.id === 'colocation')?.detail).toContain('3 nodes');
    expect(summarizeChecks(checks)).toEqual({ pass: 3, fail: 2, warn: 1, pending: 0, ready: false });
  });

  it('waits while the copies move', () => {
    const checks = resizeChecks({ kind: 'shrink', source: relocating, targetShards: 2, nodes });
    expect(statusOf(checks, 'colocation')).toBe('pending');
    expect(checks.find((check) => check.id === 'colocation')?.detail).toBe('2 of 4 shards have a copy there; 2 copies on the way.');
    expect(statusOf(checks, 'health')).toBe('pending');
    expect(summarizeChecks(checks).ready).toBe(false);
  });

  it('is ready once the source is prepared', () => {
    const checks = resizeChecks({ kind: 'shrink', source: prepared, targetShards: 2, nodes });
    expect(checks.every((check) => check.status === 'pass')).toBe(true);
    expect(checks.find((check) => check.id === 'docs')?.detail).toBe('At most 1,545 per target shard (the limit is 2,147,483,519).');
    expect(summarizeChecks(checks).ready).toBe(true);
  });

  it('fails when the node lacks disk or a shard gets too many documents', () => {
    const small = nodes.map((node) => ({ ...node, diskAvailable: 1000 }));
    expect(statusOf(resizeChecks({ kind: 'shrink', source: prepared, targetShards: 2, nodes: small }), 'disk')).toBe('fail');
    const huge: ShardCopy[] = prepared.shards.map((copy) => ({ ...copy, docs: copy.primary ? MAX_DOCS_PER_SHARD : copy.docs }));
    expect(statusOf(resizeChecks({ kind: 'shrink', source: { ...prepared, shards: huge }, targetShards: 1, nodes }), 'docs')).toBe('fail');
    expect(statusOf(resizeChecks({ kind: 'shrink', source: prepared, targetShards: null, nodes }), 'docs')).toBe('warn');
  });

  it('fails when the copies cannot reach the required node', () => {
    const stuck = { ...spread, requiredNode: 'es-node-1' };
    const check = resizeChecks({ kind: 'shrink', source: stuck, targetShards: 2, nodes }).find((item) => item.id === 'colocation');
    expect(check).toMatchObject({ status: 'fail', fix: 'prepare' });
  });

  it('resizes closed indices whose shards are known, and refuses data stream write indices', () => {
    const closed = { ...prepared, open: false };
    const checks = resizeChecks({ kind: 'clone', source: closed, targetShards: 4, nodes });
    expect(checks[0]).toMatchObject({ id: 'open', status: 'pass', detail: 'tmp-index-ops-src stays closed; the new index is created open.' });
    expect(summarizeChecks(checks).ready).toBe(true);
    // Before 7.2, or without a shard list, a closed index must be opened first.
    const legacy = { ...closed, versionCreated: 6_080_099 };
    expect(resizeChecks({ kind: 'clone', source: legacy, targetShards: 4, nodes })).toEqual([
      expect.objectContaining({ id: 'open', status: 'fail', fix: 'open-index' }),
    ]);
    const unknown = { ...closed, shardsKnown: false, shards: [] };
    expect(resizeChecks({ kind: 'clone', source: unknown, targetShards: 4, nodes }).map((check) => check.fix)).toEqual(['open-index']);
    // A closed shrink source cannot report its documents per shard.
    const closedShrink = { ...closed, shards: closed.shards.map((copy) => ({ ...copy, docs: null })) };
    expect(resizeChecks({ kind: 'shrink', source: closedShrink, targetShards: 2, nodes }).find((check) => check.id === 'docs')?.detail).toContain(
      'closed index does not report its documents',
    );
    const writeIndex = { ...prepared, dataStream: 'events', dataStreamWriteIndex: true };
    expect(statusOf(resizeChecks({ kind: 'clone', source: writeIndex, targetShards: 4, nodes }), 'data-stream')).toBe('fail');
  });

  it('offers the write block alone when one node already holds every shard', () => {
    const colocated = { ...prepared, writeBlock: false, writeBlocked: false, blockSettings: [], requiredNode: null };
    const check = resizeChecks({ kind: 'shrink', source: colocated, targetShards: 2, nodes }).find((item) => item.id === 'write-block');
    expect(check).toMatchObject({ status: 'fail', fix: 'write-block' });
    const colocation = resizeChecks({ kind: 'shrink', source: colocated, targetShards: 2, nodes }).find((item) => item.id === 'colocation');
    expect(colocation).toMatchObject({ status: 'pass', title: 'Every shard has a copy on es-node-1' });
  });

  it('fails when no shard count is possible', () => {
    const single = { ...prepared, primaries: 1, routingShards: { value: 1024, origin: 'single-shard' as const } };
    expect(resizeChecks({ kind: 'shrink', source: single, targetShards: null, nodes }).find((check) => check.id === 'shards')).toMatchObject({
      status: 'fail',
      title: 'Cannot be shrunk',
      detail: 'tmp-index-ops-src has a single primary shard.',
    });
    const locked = { ...prepared, primaries: 3, routingShards: { value: 3, origin: 'setting' as const } };
    expect(resizeChecks({ kind: 'split', source: locked, targetShards: null, nodes }).find((check) => check.id === 'shards')?.detail).toBe(
      'No multiple of 3 divides its 3 routing shards.',
    );
  });

  it('offers the write block for split and clone', () => {
    const checks = resizeChecks({ kind: 'split', source: spread, targetShards: 8, nodes });
    expect(checks.find((check) => check.id === 'write-block')?.fix).toBe('write-block');
    expect(checks.map((check) => check.id)).toEqual(['open', 'write-block', 'health', 'routing']);
  });

  it('checks a split against the routing shards of the cluster state', () => {
    const two = only(DETAIL_SHRUNK_TWO);
    const routing = resizeChecks({ kind: 'split', source: two, targetShards: 6, nodes: null }).find((check) => check.id === 'routing');
    expect(routing).toEqual({
      id: 'routing',
      status: 'pass',
      title: 'Routing shards allow the split',
      detail: '6 divides the 768 routing shards of tmp-index-ops-two (routing_num_shards in the cluster state).',
    });
    const wrong = resizeChecks({ kind: 'split', source: two, targetShards: 10, nodes: null }).find((check) => check.id === 'routing');
    expect(wrong).toMatchObject({ status: 'fail', title: 'Shard count not possible' });
    const resized = { ...two, resizedFrom: 'tmp-index-ops-six' };
    expect(resizeChecks({ kind: 'split', source: resized, targetShards: 6, nodes: null }).find((check) => check.id === 'routing')?.detail).toBe(
      '6 divides the 768 routing shards of tmp-index-ops-two (routing_num_shards in the cluster state, kept from tmp-index-ops-six).',
    );
  });

  it('checks the routing shards of a split', () => {
    expect(statusOf(resizeChecks({ kind: 'split', source: prepared, targetShards: 6, nodes }), 'routing')).toBe('fail');
    const ok = resizeChecks({ kind: 'split', source: prepared, targetShards: 8, nodes }).find((check) => check.id === 'routing');
    expect(ok?.status).toBe('pass');
    expect(ok?.detail).toContain('8 divides 1,024, the default routing shards of an index with 4 shards');
    expect(statusOf(resizeChecks({ kind: 'split', source: prepared, targetShards: null, nodes }), 'routing')).toBe('warn');
  });

  it('reports unassigned copies as a health failure', () => {
    const target = only(DETAIL_TARGET_INITIALIZING);
    const check = resizeChecks({ kind: 'clone', source: target, targetShards: 2, nodes }).find((item) => item.id === 'health');
    expect(check).toMatchObject({ status: 'fail', title: 'Health is yellow' });
  });
});

describe('resize requests', () => {
  it('builds the shrink request that clears the preparation on the target', () => {
    const request = buildResizeRequest('shrink', prepared, {
      target: 'tmp-index-ops-shrunk',
      shards: 2,
      replicas: 1,
      bestCompression: false,
      aliases: [],
    });
    expect(request.endpoint).toBe('index_ops/resize');
    expect(request.payload).toEqual({
      kind: 'shrink',
      index: 'tmp-index-ops-src',
      target: 'tmp-index-ops-shrunk',
      body: {
        settings: {
          'index.number_of_shards': 2,
          'index.number_of_replicas': 1,
          'index.routing.allocation.require._name': null,
          'index.blocks.write': null,
        },
      },
    });
    expect(request.preview).toMatchObject({ method: 'POST', path: '/tmp-index-ops-src/_shrink/tmp-index-ops-shrunk' });
  });

  it('adds compression and aliases', () => {
    const request = buildResizeRequest('split', { ...spread, blockSettings: ['index.blocks.read_only'] }, {
      target: 'orders-split',
      shards: 8,
      replicas: 0,
      bestCompression: true,
      aliases: ['orders-new'],
    });
    expect(request.payload['body']).toEqual({
      settings: {
        'index.number_of_shards': 8,
        'index.number_of_replicas': 0,
        'index.codec': 'best_compression',
        'index.blocks.read_only': null,
      },
      aliases: { 'orders-new': {} },
    });
  });

  it('keeps the shard count of a clone out of the body', () => {
    const request = buildResizeRequest('clone', prepared, { target: 'c', shards: 4, replicas: null, bestCompression: false, aliases: [] });
    expect(request.payload['body']).toEqual({
      settings: { 'index.routing.allocation.require._name': null, 'index.blocks.write': null },
    });
  });

  it('builds the settings requests around a resize', () => {
    expect(prepareShrinkRequest('src', 'es-node-1').payload).toEqual({
      index: 'src',
      settings: { 'index.blocks.write': true, 'index.routing.allocation.require._name': 'es-node-1' },
    });
    expect(writeBlockRequest('src').preview).toMatchObject({ method: 'PUT', path: '/src/_settings', body: { 'index.blocks.write': true } });
    const changes = { index: 'tmp-index-ops-src', writeBlock: true, requiredNode: 'es-node-1' };
    expect(releaseSourceRequest(prepared, changes)?.payload).toEqual({
      index: 'tmp-index-ops-src',
      settings: { 'index.blocks.write': null, 'index.routing.allocation.require._name': null },
    });
  });

  it('lifts only what the wizard set', () => {
    // Nothing recorded: the block and the pin were there before.
    expect(releaseSourceRequest(prepared, null)).toBeNull();
    expect(releaseSourceRequest(prepared, { index: 'other', writeBlock: true, requiredNode: null })).toBeNull();
    // The wizard only blocked writes: the node requirement someone else set stays.
    expect(releaseSourceRequest(prepared, { index: 'tmp-index-ops-src', writeBlock: true, requiredNode: null })?.payload).toEqual({
      index: 'tmp-index-ops-src',
      settings: { 'index.blocks.write': null },
    });
    // The pin moved elsewhere since: only the block is lifted.
    expect(
      releaseSourceRequest(prepared, { index: 'tmp-index-ops-src', writeBlock: true, requiredNode: 'es-node-2' })?.preview.body,
    ).toEqual({ 'index.blocks.write': null });
    // Read-only and flood-stage blocks are never lifted.
    const readOnly: SourceIndex = {
      ...prepared,
      writeBlock: false,
      blockSettings: ['index.blocks.read_only_allow_delete'],
      requiredNode: null,
    };
    expect(releaseSourceRequest(readOnly, { index: 'tmp-index-ops-src', writeBlock: true, requiredNode: null })).toBeNull();
    expect(foreignRestrictions(readOnly, null)).toEqual([
      expect.stringContaining('flood-stage disk watermark'),
    ]);
    expect(foreignRestrictions(prepared, { index: 'tmp-index-ops-src', writeBlock: true, requiredNode: null })).toEqual([
      'index.routing.allocation.require._name (es-node-1) was already set before this operation.',
    ]);
    expect(foreignRestrictions(prepared, { index: 'tmp-index-ops-src', writeBlock: true, requiredNode: 'es-node-1' })).toEqual([]);
  });

  it('records and forgets the wizard changes', () => {
    const blocked = recordChanges(null, 'src', { 'index.blocks.write': true });
    expect(blocked).toEqual({ index: 'src', writeBlock: true, requiredNode: null });
    const prepared = recordChanges(blocked, 'src', { 'index.blocks.write': true, 'index.routing.allocation.require._name': 'es-node-2' });
    expect(prepared).toEqual({ index: 'src', writeBlock: true, requiredNode: 'es-node-2' });
    // Another index starts a new record.
    expect(recordChanges(prepared, 'other', { 'index.blocks.write': true })).toEqual({ index: 'other', writeBlock: true, requiredNode: null });
    expect(remainingChanges(prepared, { 'index.blocks.write': null })).toEqual({ index: 'src', writeBlock: false, requiredNode: 'es-node-2' });
    expect(remainingChanges(prepared, { 'index.blocks.write': null, 'index.routing.allocation.require._name': null })).toBeNull();
    expect(remainingChanges(null, {})).toBeNull();
  });

  it('follows the recovery of the target', () => {
    const recovery = targetRecovery(shardCopies(DETAIL_TARGET_INITIALIZING.shards));
    expect(recovery).toEqual({
      total: 4,
      started: 2,
      initializing: 0,
      relocating: 0,
      unassigned: 2,
      primaries: 2,
      primariesStarted: 2,
      unassignedPrimaries: [],
      percent: 50,
      health: 'yellow',
      done: false,
    });
    expect(targetRecovery(prepared.shards)).toMatchObject({ done: true, health: 'green', percent: 100 });
    expect(targetRecovery([])).toMatchObject({ done: false, health: 'gray', percent: 0 });
  });
});

describe('rollover', () => {
  const targets = rolloverTargets(ALIAS_ROWS, DATA_STREAMS);

  it('lists aliases and data streams with their write index', () => {
    const byName = new Map(targets.map((target) => [target.name, target]));
    expect(byName.get('tmp-index-ops-roll')).toMatchObject({ kind: 'alias', writeIndex: 'tmp-index-ops-roll-000001', problem: null });
    expect(byName.get('logs-current')).toMatchObject({ writeIndex: 'logs-2026.10.14', problem: null });
    expect(byName.get('logs')).toMatchObject({
      writeIndex: null,
      problem: 'Points to 3 indices and none is the write index',
      indices: ['logs-2026.10.12', 'logs-2026.10.13', 'logs-2026.10.14'],
    });
    expect(byName.get('app-events-web')).toMatchObject({ kind: 'data-stream', writeIndex: '.ds-app-events-web-2026.10.14-000002' });
    expect(byName.get('.logs-deprecation.elasticsearch-default')?.hidden).toBe(true);
    expect(targets.findIndex((target) => target.kind === 'data-stream')).toBeGreaterThan(targets.findIndex((target) => target.name === 'tmp-index-ops-roll'));
  });

  it('predicts the generated name like Elasticsearch', () => {
    expect(nextRolloverName('tmp-index-ops-roll-000001')).toBe('tmp-index-ops-roll-000002');
    expect(nextRolloverName('my-index-3')).toBe('my-index-000004');
    expect(nextRolloverName('a-999999')).toBe('a-1000000');
    // Elasticsearch: index name [orders-v2] does not match pattern '^.*-\d+$'
    expect(nextRolloverName('orders-v2')).toBeNull();
    expect(nextRolloverName('logs-2026.10.14')).toBeNull();
  });

  it('validates and serializes the conditions', () => {
    const conditions = { ...EMPTY_CONDITIONS, maxAge: '7d', maxDocs: '1000', maxSize: '50GB', maxPrimaryShardSize: 'big', maxPrimaryShardDocs: '0' };
    expect(conditionErrors(conditions)).toEqual({
      maxPrimaryShardSize: 'Enter a size such as 50gb or 500mb',
      maxPrimaryShardDocs: 'Enter a whole number above 0',
    });
    expect(conditionErrors({ ...EMPTY_CONDITIONS, maxAge: '7 days' })).toEqual({ maxAge: 'Enter an age such as 30d, 12h or 90m' });
    expect(conditionsBody({ ...EMPTY_CONDITIONS, maxAge: '7d', maxDocs: '1000', maxSize: '50GB' })).toEqual({
      max_age: '7d',
      max_docs: 1000,
      max_size: '50gb',
    });
  });

  it('builds dry runs and the real request', () => {
    const dry = buildRolloverRequest('tmp-index-ops-roll', { ...EMPTY_CONDITIONS, maxDocs: '3' }, '', true);
    expect(dry.payload).toEqual({ alias: 'tmp-index-ops-roll', body: { conditions: { max_docs: 3 } }, dry_run: true });
    expect(dry.preview.path).toBe('/tmp-index-ops-roll/_rollover?dry_run=true');
    const real = buildRolloverRequest('orders', EMPTY_CONDITIONS, ' orders-v3 ', false);
    expect(real.payload).toEqual({ alias: 'orders', body: {}, dry_run: false, new_index: 'orders-v3' });
    expect(real.preview).toMatchObject({ path: '/orders/_rollover/orders-v3', body: null });
  });

  it('interprets a dry run', () => {
    const preview = interpretRollover(ROLLOVER_DRY_RUN);
    expect(preview).toMatchObject({
      oldIndex: 'tmp-index-ops-roll-000001',
      newIndex: 'tmp-index-ops-roll-000002',
      rolledOver: false,
      dryRun: true,
      metCount: 1,
      wouldRollOver: true,
    });
    expect(preview.conditions.map((condition) => [condition.key, condition.value, condition.met])).toEqual([
      ['max_age', '7d', false],
      ['max_docs', '3', true],
      ['max_size', '5gb', false],
      ['max_primary_shard_size', '1gb', false],
      ['max_primary_shard_docs', '100', false],
    ]);
    expect(preview.conditions[1]?.label).toBe('Maximum documents');
    const stream = interpretRollover(ROLLOVER_DATA_STREAM_DRY_RUN);
    expect(stream).toMatchObject({ newIndex: '.ds-app-events-web-2026.10.14-000003', metCount: 0, wouldRollOver: false });
    expect(interpretRollover({ conditions: {}, dry_run: true }).wouldRollOver).toBe(true);
    expect(interpretRollover({ conditions: { '[min_docs: 1]': true } }).conditions[0]?.label).toBe('Min docs');
  });

  it('reads the write index facts the conditions compare', () => {
    const facts = writeIndexFacts(only(DETAIL_ROLLOVER_WRITE_INDEX));
    expect(facts).toMatchObject({ index: 'tmp-index-ops-roll-000001', docs: 5, largestPrimaryDocs: 5 });
    expect(conditionCurrent('maxDocs', facts, 0)).toBe(5);
    expect(conditionCurrent('maxAge', facts, (facts.createdAt ?? 0) + 60_000)).toBe(60_000);
    expect(conditionCurrent('maxDocs', null, 0)).toBeNull();
  });

  it('checks a rollover before it runs', () => {
    const roll = targets.find((target) => target.name === 'tmp-index-ops-roll');
    const orders = targets.find((target) => target.name === 'orders');
    const logs = targets.find((target) => target.name === 'logs');
    if (!roll || !orders || !logs) {
      throw new Error('missing fixture targets');
    }
    const ready = rolloverChecks({
      target: roll,
      newIndex: '',
      newIndexError: null,
      conditionsValid: true,
      dryRun: { state: 'ready', preview: interpretRollover(ROLLOVER_DRY_RUN) },
    });
    expect(ready.map((check) => [check.id, check.status])).toEqual([
      ['write-index', 'pass'],
      ['new-index', 'pass'],
      ['dry-run', 'pass'],
    ]);
    expect(ready[1]?.detail).toBe('Elasticsearch names the new index tmp-index-ops-roll-000002.');
    expect(ready[2]?.detail).toBe('1 of 5 conditions met: it would roll over now.');

    // A single condition reads "the condition", not "1 of 1 condition".
    const preview = interpretRollover(ROLLOVER_DRY_RUN);
    const single = (met: boolean) =>
      rolloverChecks({
        target: roll,
        newIndex: '',
        newIndexError: null,
        conditionsValid: true,
        dryRun: {
          state: 'ready',
          preview: { ...preview, conditions: [{ key: 'max_docs', label: 'Maximum documents', value: '10', met }], metCount: met ? 1 : 0, wouldRollOver: met },
        },
      })[2]?.detail;
    expect(single(true)).toBe('The condition is met: it would roll over now.');
    expect(single(false)).toBe('The condition is not met yet: running it now changes nothing.');

    // orders-v2 is the only index of orders, without is_write_index: the alias moves; the name is missing, so no dry run yet.
    const unnamed = rolloverChecks({ target: orders, newIndex: '', newIndexError: null, conditionsValid: true, dryRun: { state: 'idle' } });
    expect(unnamed.map((check) => [check.id, check.status])).toEqual([
      ['write-index', 'pass'],
      ['alias-moves', 'warn'],
      ['new-index', 'fail'],
    ]);
    expect(unnamed[1]).toMatchObject({ fix: 'make-write-index' });
    expect(unnamed[1]?.detail).toContain('afterwards orders points only to the new index');
    const named = rolloverChecks({ target: orders, newIndex: 'orders-v3', newIndexError: null, conditionsValid: true, dryRun: { state: 'loading' } });
    expect(named.map((check) => check.status)).toEqual(['pass', 'warn', 'pass', 'pending']);

    const broken = rolloverChecks({ target: logs, newIndex: '', newIndexError: null, conditionsValid: false, dryRun: { state: 'idle' } });
    expect(broken.map((check) => [check.id, check.status])).toEqual([
      ['write-index', 'fail'],
      ['dry-run', 'warn'],
    ]);

    // An invalid name leaves the dry run out: the name check says what to fix.
    const invalid = rolloverChecks({ target: roll, newIndex: 'Bad', newIndexError: 'Index names must be lowercase', conditionsValid: true, dryRun: { state: 'idle' } });
    expect(invalid.map((check) => check.status)).toEqual(['pass', 'fail']);
    const failed = rolloverChecks({ target: roll, newIndex: '', newIndexError: null, conditionsValid: true, dryRun: { state: 'error', reason: 'Nope.' } });
    expect(failed.map((check) => check.status)).toEqual(['pass', 'pass', 'fail']);
  });
});

describe('reindex options', () => {
  const options: ReindexOptions = { ...DEFAULT_REINDEX_OPTIONS, sources: 'logs-*, customers,logs-*', dest: 'logs-all' };

  it('splits source expressions', () => {
    expect(sourceExpressions(options.sources)).toEqual(['logs-*', 'customers']);
  });

  it('parses the optional query', () => {
    expect(parseQuery('  ')).toEqual({ kind: 'empty' });
    expect(parseQuery('{"match_all":{}}')).toEqual({ kind: 'object', value: { match_all: {} } });
    expect(parseQuery('[]')).toMatchObject({ kind: 'invalid' });
    expect(parseQuery('{}')).toMatchObject({ kind: 'invalid' });
    expect(parseQuery('{').kind).toBe('invalid');
  });

  it('reports field errors', () => {
    expect(reindexErrors(options)).toEqual({});
    expect(
      reindexErrors({
        ...DEFAULT_REINDEX_OPTIONS,
        query: '{',
        dest: 'Logs',
        maxDocs: '-1',
        slicesMode: 'custom',
        slices: '1',
        throttled: true,
        requestsPerSecond: '0',
      }),
    ).toEqual({
      sources: 'Enter at least one source index, alias or pattern',
      query: expect.stringContaining('Invalid JSON') as unknown as string,
      dest: 'Index names must be lowercase',
      maxDocs: 'Enter a whole number above 0, or leave it empty to copy everything',
      slices: 'Enter a number of slices from 2 to 1,024',
      requestsPerSecond: 'Enter the documents per second, above 0',
    });
    expect(reindexErrors({ ...options, dest: 'customers' }).dest).toBe('The destination cannot be one of the sources');
  });

  it('builds a minimal request', () => {
    const request = buildReindexRequest({ ...DEFAULT_REINDEX_OPTIONS, sources: 'tmp-index-ops-src', dest: 'tmp-index-ops-dst' }, false);
    expect(request.payload).toEqual({ body: { source: { index: 'tmp-index-ops-src' }, dest: { index: 'tmp-index-ops-dst' } } });
    expect(request.preview).toMatchObject({ method: 'POST', path: '/_reindex?wait_for_completion=false' });
  });

  it('builds a request with every option', () => {
    const request = buildReindexRequest(
      {
        ...options,
        query: '{"term":{"level":"error"}}',
        conflicts: 'proceed',
        maxDocs: '500',
        slicesMode: 'auto',
        throttled: true,
        requestsPerSecond: '250.5',
        script: ' ctx._source.copied = true ',
      },
      true,
    );
    expect(request.payload).toEqual({
      body: {
        source: { index: ['logs-*', 'customers'], query: { term: { level: 'error' } } },
        dest: { index: 'logs-all', op_type: 'create' },
        conflicts: 'proceed',
        max_docs: 500,
        script: { source: 'ctx._source.copied = true', lang: 'painless' },
      },
      slices: 'auto',
      requests_per_second: '250.5',
    });
    expect(request.preview.path).toBe('/_reindex?wait_for_completion=false&slices=auto&requests_per_second=250.5');
    const custom = buildReindexRequest({ ...options, slicesMode: 'custom', slices: '4' }, false);
    expect(custom.payload['slices']).toBe('4');
  });

  it('only creates missing documents when existing ones are kept', () => {
    const request = buildReindexRequest({ ...options, existing: 'skip', conflicts: 'proceed' }, false);
    expect(request.payload['body']).toMatchObject({ dest: { index: 'logs-all', op_type: 'create' }, conflicts: 'proceed' });
  });
});

describe('reindexChecks', () => {
  const [archive, customers] = parseIndices(DETAIL_CLOSED);

  it('reports sources, closed sources and a missing destination', () => {
    const checks = reindexChecks({
      sources: { state: 'ready', indices: [archive as SourceIndex, customers as SourceIndex] },
      dest: { state: 'missing' },
      destName: 'tmp-index-ops-dst',
      destIsDataStream: false,
    });
    expect(checks.map((check) => [check.id, check.status, check.fix])).toEqual([
      ['sources', 'pass', undefined],
      ['sources-open', 'fail', undefined],
      ['dest', 'warn', 'create-destination'],
    ]);
    expect(checks[0]).toMatchObject({ title: '2 source indices', detail: '2,500 documents to copy.' });
    expect(checks[1]?.detail).toBe('archive-2025 is closed and cannot be read.');
  });

  it('warns before overwriting documents and refuses blocked or overlapping destinations', () => {
    const checks = reindexChecks({
      sources: { state: 'ready', indices: [prepared] },
      dest: { state: 'ready', indices: [prepared] },
      destName: 'tmp-index-ops-src',
      destIsDataStream: false,
    });
    expect(checks.map((check) => [check.id, check.status])).toEqual([
      ['sources', 'pass'],
      ['dest', 'warn'],
      ['dest-writable', 'fail'],
      ['dest-overlap', 'fail'],
    ]);
    expect(checks[1]?.detail).toBe('It already holds 3,000 documents; documents with the same id are overwritten.');
  });

  it('explains what happens to the documents the destination has', () => {
    const base = { sources: { state: 'ready' as const, indices: [spread] }, dest: { state: 'ready' as const, indices: [prepared] }, destName: 'tmp-index-ops-src', destIsDataStream: false };
    const skip = reindexChecks({ ...base, skipExisting: true, conflicts: 'proceed' }).find((check) => check.id === 'dest');
    expect(skip).toMatchObject({
      status: 'pass',
      detail: 'It already holds 3,000 documents; documents with an id it already has are skipped and counted as version conflicts.',
    });
    const abort = reindexChecks({ ...base, skipExisting: true, conflicts: 'abort' }).find((check) => check.id === 'dest');
    expect(abort?.status).toBe('warn');
    expect(abort?.detail).toContain('stops the reindex');
  });

  it('explains data stream destinations and lookups in flight', () => {
    const checks = reindexChecks({
      sources: { state: 'loading' },
      dest: { state: 'ready', indices: [] },
      destName: 'app-events-web',
      destIsDataStream: true,
    });
    expect(checks.map((check) => [check.id, check.status])).toEqual([
      ['sources', 'pending'],
      ['dest', 'pass'],
    ]);
    expect(reindexChecks({ sources: { state: 'error', reason: 'No such index [x].' }, dest: { state: 'idle' }, destName: '', destIsDataStream: false })).toEqual([
      { id: 'sources', status: 'fail', title: 'Sources not found', detail: 'No such index [x].' },
    ]);
    expect(reindexChecks({ sources: { state: 'ready', indices: [] }, dest: { state: 'idle' }, destName: 'x', destIsDataStream: false }).map((check) => check.status)).toEqual([
      'fail',
      'pending',
    ]);
  });
});

describe('reindexProgress', () => {
  it('reads a throttled reindex in flight', () => {
    const progress = reindexProgress(TASK_RUNNING);
    expect(progress).toMatchObject({
      outcome: 'running',
      completed: false,
      total: 3000,
      created: 600,
      processed: 600,
      percent: 20,
      batches: 3,
      requestsPerSecond: 500,
      slices: null,
      failures: [],
      error: null,
    });
    // 600 documents in 1.567 s.
    expect(progress.rate).toBeCloseTo(382.86, 1);
    expect(progress.etaMillis).toBeCloseTo(6268.5, 0);
  });

  it('bounds the time left by the throttle', () => {
    const fast = { ...TASK_RUNNING, task: { ...TASK_RUNNING.task, running_time_in_nanos: 500_000_000 } };
    // 600 documents in 0.5 s, but only 500 per second are allowed: 2,400 left take 4.8 s.
    expect(reindexProgress(fast).etaMillis).toBeCloseTo(4800, 0);
  });

    it('reads a finished reindex', () => {
    const progress = reindexProgress(TASK_DONE);
    expect(progress).toMatchObject({ outcome: 'succeeded', completed: true, processed: 3000, percent: 100, etaMillis: null, throttledMillis: 5999 });
    expect(progress.runningMillis).toBeCloseTo(7135.3, 1);
  });

  it('reports version conflicts that aborted the reindex', () => {
    const progress = reindexProgress(TASK_CONFLICTS);
    expect(progress).toMatchObject({ outcome: 'failed', versionConflicts: 1000, created: 0, processed: 1000, requestsPerSecond: null });
    expect(progress.failures).toEqual([
      { index: 'tmp-index-ops-dst', id: '11', reason: '[11]: version conflict, document already exists (current version [1])', status: 409 },
      { index: 'tmp-index-ops-dst', id: '5', reason: '[5]: version conflict, document already exists (current version [1])', status: 409 },
    ]);
  });

  it('adds the running slices of a sliced reindex', () => {
    expect(needsSliceChildren(TASK_SLICED_RUNNING)).toBe(true);
    expect(needsSliceChildren(TASK_RUNNING)).toBe(false);
    expect(needsSliceChildren(TASK_CANCELLED)).toBe(false);
    const alone = reindexProgress(TASK_SLICED_RUNNING);
    expect(alone).toMatchObject({ total: null, percent: null, slices: 4, pendingSlices: 4, rate: null, etaMillis: null });
    const parent = 'I7MELLk0RvSiAPhRW6211Q:96433';
    const children: RawListedTask[] = [
      { node: 'n', id: 1, action: 'indices:data/write/reindex', parent_task_id: parent, status: { total: 779, created: 100, batches: 1, requests_per_second: 75 } },
      { node: 'n', id: 2, action: 'indices:data/write/reindex', parent_task_id: parent, status: { total: 766, created: 100, batches: 1, requests_per_second: 75 } },
      { node: 'n', id: 3, action: 'indices:data/write/bulk', parent_task_id: 'other:1', status: { total: 5, created: 5 } },
    ];
    const combined = reindexProgress(TASK_SLICED_RUNNING, children, parent);
    // The parent reports requests_per_second 0 while its slices carry the throttle.
    expect(combined).toMatchObject({ total: 1545, processed: 200, batches: 2, pendingSlices: 2, requestsPerSecond: 150 });
    expect(combined.percent).toBeCloseTo(12.94, 1);
  });

  it('adds the slices listed by parent task (slices=auto over 6 shards)', () => {
    const parent = 'I7MELLk0RvSiAPhRW6211Q:511584';
    expect(needsSliceChildren(TASK_SIX_SLICES)).toBe(true);
    const progress = reindexProgress(TASK_SIX_SLICES, TASK_SIX_SLICES_CHILDREN.tasks, parent);
    expect(progress).toMatchObject({
      outcome: 'running',
      total: 600,
      created: 60,
      processed: 60,
      percent: 10,
      batches: 6,
      slices: 6,
      pendingSlices: 0,
      // Each slice gets its share of requests_per_second=6.
      requestsPerSecond: 6,
    });
    // A slice that finished between the two reads is counted once (the parent sums the finished slices).
    const finished = {
      ...TASK_SIX_SLICES,
      task: {
        ...TASK_SIX_SLICES.task,
        status: {
          ...TASK_SIX_SLICES.task?.status,
          total: 97,
          created: 97,
          batches: 10,
          slices: [{ slice_id: 0, total: 97, created: 97, batches: 10 }, null, null, null, null, null],
        },
      },
    };
    expect(reindexProgress(finished, TASK_SIX_SLICES_CHILDREN.tasks, parent)).toMatchObject({ total: 600, created: 147, pendingSlices: 0 });
  });

  it('reads a cancelled reindex', () => {
    expect(reindexProgress(TASK_CANCELLED)).toMatchObject({
      outcome: 'cancelled',
      cancelReason: 'by user request',
      created: 800,
      total: 3000,
      slices: 4,
      pendingSlices: 0,
    });
  });

  it('reports a task error', () => {
    const progress = reindexProgress({
      completed: true,
      task: { running_time_in_nanos: 1_000_000 },
      error: { type: 'index_not_found_exception', reason: 'no such index [x]' },
    });
    expect(progress).toMatchObject({ outcome: 'failed', error: 'No such index [x]', percent: 100, total: 0 });
  });
});

describe('requestText', () => {
  it('writes the request in console form', () => {
    expect(requestText({ method: 'PUT', path: '/a/_settings', body: { 'index.blocks.write': true }, title: '' })).toBe(
      'PUT /a/_settings\n{\n  "index.blocks.write": true\n}',
    );
    expect(requestText({ method: 'POST', path: '/a/_rollover', body: null, title: '' })).toBe('POST /a/_rollover');
  });
});

/* ---- Review follow-ups -------------------------------------------------------------------------- */

describe('settings helpers', () => {
  it('flattens nested settings and keeps the allocation filters that matter', () => {
    const settings = {
      index: {
        routing: {
          allocation: {
            require: { _name: 'es-node-1', _id: 'abc' },
            include: { _tier_preference: 'data_hot', zone: 'a,b' },
            exclude: { _host: 'old-*' },
            total_shards_per_node: '-1',
          },
        },
        hidden: 'true',
      },
    };
    expect(flattenSettings(settings)).toMatchObject({ 'index.routing.allocation.require._id': 'abc', 'index.hidden': 'true' });
    expect(allocationSettings(settings)).toEqual({
      'index.routing.allocation.require._id': 'abc',
      'index.routing.allocation.include.zone': 'a,b',
      'index.routing.allocation.exclude._host': 'old-*',
    });
    expect(allocationSettings({ 'index.routing.allocation.total_shards_per_node': '2' })).toEqual({
      'index.routing.allocation.total_shards_per_node': '2',
    });
  });

  it('parses human byte sizes', () => {
    expect(parseByteSize('1.5mb')).toBe(1_572_864);
    expect(parseByteSize('498b')).toBe(498);
    expect(parseByteSize('150GB')).toBe(150 * 1024 ** 3);
    expect(parseByteSize('12')).toBe(12);
    expect(parseByteSize(7)).toBe(7);
    expect(parseByteSize('-1')).toBeNull();
    expect(parseByteSize(null)).toBeNull();
  });

  it('reads backing indices, resized indices and the version', () => {
    const backing = only(DETAIL_BACKING_INDEX);
    expect(backing).toMatchObject({ hidden: true, lifecyclePolicy: 'app-events-policy', allocation: {}, versionCreated: 8_512_000, resizedFrom: null });
    const resized = routingShardsOf({ 'index.number_of_shards': '2', 'index.resize.source.name': 'orders-v1' }, 2);
    expect(resized).toEqual({ value: 1024, origin: 'resized' });
    expect(blankSource('x')).toMatchObject({ name: 'x', primaries: null, shards: [], shardsKnown: false });
  });
});

describe('light lookups', () => {
  const membership = dataStreamMembership(DATA_STREAMS);

  it('reads the rows of the index lookup (sizes in bytes)', () => {
    const indices = parseLookupRows(LOOKUP_INDICES, membership);
    expect(indices.map((index) => index.name)).toEqual([
      '.ds-app-events-web-2026.10.14-000001',
      '.ds-app-events-web-2026.10.14-000002',
      '.kibana-demo',
      'archive-2025',
      'logs-2026.10.13',
      'metrics-app',
    ]);
    expect(indices.find((index) => index.name === 'logs-2026.10.13')).toMatchObject({
      open: true,
      health: 'green',
      primaries: 3,
      replicas: 1,
      docs: 9956,
      deletedDocs: null,
      primarySize: 1_649_378,
      totalSize: 3_298_756,
    });
    expect(indices.find((index) => index.name === 'archive-2025')).toMatchObject({ open: false, docs: null, primarySize: null, totalSize: null });
    expect(indices[1]).toMatchObject({ dataStream: 'app-events-web', dataStreamWriteIndex: true });
    expect(indices[0]).toMatchObject({ dataStream: 'app-events-web', dataStreamWriteIndex: false });
    expect(parseLookupRows(null)).toEqual([]);
    expect(parseLookupRows([{ index: 'x', status: 'weird', 'pri.store.size': 'n/a' }])[0]).toMatchObject({ open: null, primarySize: null });
  });

  it('keeps the closed indices that are named and sets aside those only a pattern matched', () => {
    const indices = parseLookupRows(LOOKUP_INDICES, membership);
    const split = (expressions: string[], aliases: RawAliasRow[] = []): [string[], string[]] => {
      const { read, skipped } = readableSources(indices, expressions, aliases);
      return [read.map((index) => index.name), skipped.map((index) => index.name)];
    };
    // A search skips closed indices a pattern matches: the reindex does too.
    const [read, skipped] = split(['logs-*', 'metrics-app', 'archive*', 'app-events-web', '.kibana-demo']);
    expect(read).toEqual([
      '.ds-app-events-web-2026.10.14-000001',
      '.ds-app-events-web-2026.10.14-000002',
      '.kibana-demo',
      'logs-2026.10.13',
      'metrics-app',
    ]);
    expect(skipped).toEqual(['archive-2025']);
    // Named directly or through an alias, Elasticsearch refuses it: it stays for the closed check.
    expect(split(['*', 'archive-2025'])[1]).toEqual([]);
    expect(split(['old'], [{ alias: 'old', index: 'archive-2025' }])[0]).toContain('archive-2025');
    const closed = readableSources(parseLookupRows(LOOKUP_CLOSED), ['archive-2025']);
    expect(reindexChecks({ sources: { state: 'ready', indices: closed.read, skipped: closed.skipped }, dest: { state: 'idle' }, destName: '', destIsDataStream: false })
      .map((check) => check.id)).toEqual(['sources', 'sources-open']);
  });

  it('reports the closed indices a pattern skips', () => {
    const { read, skipped } = readableSources(parseLookupRows(LOOKUP_INDICES, membership), ['*']);
    const checks = reindexChecks({ sources: { state: 'ready', indices: read, skipped }, dest: { state: 'idle' }, destName: '', destIsDataStream: false });
    expect(checks.map((check) => [check.id, check.status])).toEqual([
      ['sources', 'pass'],
      ['sources-skipped', 'warn'],
    ]);
    expect(checks[0]).toMatchObject({ title: '5 source indices', detail: '12,459 documents to copy.' });
    expect(checks[1]).toMatchObject({
      title: 'A closed index is skipped',
      detail: 'archive-2025 matches a pattern but is closed: the reindex does not copy it. Open it first to include it.',
    });
    const only = readableSources(parseLookupRows(LOOKUP_CLOSED), ['archive*']);
    expect(reindexChecks({ sources: { state: 'ready', indices: only.read, skipped: only.skipped }, dest: { state: 'idle' }, destName: '', destIsDataStream: false })).toEqual([
      { id: 'sources', status: 'fail', title: 'No source index', detail: 'The patterns only match closed indices (archive-2025), which a reindex skips.' },
    ]);
  });

  it('copies the destination from the first regular source index, never a data stream backing index', () => {
    const indices = parseLookupRows(LOOKUP_INDICES, membership);
    const ready = (list: typeof indices) => ({ state: 'ready' as const, indices: list });
    // The dot-prefixed indices sort first; archive-2025 is next (closed, it still has settings and mappings).
    expect(copySourceIndex(ready(indices), [], [])).toBe('archive-2025');
    // A data stream resolves to its hidden .ds- indices: they are passed over, as are dot-prefixed indices.
    const backing = indices.filter((index) => index.dataStream !== null || index.name.startsWith('.'));
    expect(backing.map((index) => index.name)).toEqual(['.ds-app-events-web-2026.10.14-000001', '.ds-app-events-web-2026.10.14-000002', '.kibana-demo']);
    expect(copySourceIndex(ready(backing), ['app-events-web'], ['app-events-web'])).toBeNull();
    const metrics = indices.find((index) => index.name === 'metrics-app') as SourceIndex;
    expect(copySourceIndex(ready([...backing, metrics]), [], [])).toBe('metrics-app');
    expect(copySourceIndex(ready([{ ...metrics, hidden: true }]), [], [])).toBeNull();
    // Before the lookup answers: the first expression that plainly names an index.
    expect(copySourceIndex({ state: 'loading' }, ['app-events-web', 'logs-*', '.kibana', '-x', 'products', 'orders'], ['app-events-web'])).toBe('products');
    expect(copySourceIndex({ state: 'error', reason: 'x' }, ['logs-*'], [])).toBeNull();
  });

  it('adds the blocks of the destination from its settings', () => {
    const [dest] = parseLookupRows([{ index: 'tmp-index-ops-dst', status: 'open', health: 'green', pri: '1', rep: '0', 'docs.count': '3' }]);
    const settings = { 'tmp-index-ops-dst': { settings: { index: { blocks: { write: 'true', read_only_allow_delete: 'false' } } } } };
    expect(withBlocks(dest ? [dest] : [], settings)[0]).toMatchObject({
      writeBlock: true,
      writeBlocked: true,
      blockSettings: ['index.blocks.write'],
    });
    // Settings that were refused leave the blocks unknown (none).
    expect(withBlocks(dest ? [dest] : [], null)[0]).toMatchObject({ writeBlocked: false, blockSettings: [] });
  });

  it('reads _cat/shards rows and refreshes the source from them', () => {
    const rows = catShardRows(CAT_SHARDS);
    expect(rows[0]).toEqual({ index: 'orders-v2', shard: '0', prirep: 'r', state: 'STARTED', docs: '2301', store: String(Math.round(139.2 * 1024)), node: 'es-node-3' });
    const copies = shardCopies(rows);
    expect(copies[2]).toMatchObject({ shard: 1, primary: true, state: 'relocating', node: 'es-node-2', relocatingTo: 'es-node-1' });
    expect(copies[3]).toMatchObject({ state: 'unassigned', node: null, size: null });

    const refreshed = refreshSource(spread, rows, {
      index: { blocks: { write: 'true' }, routing: { allocation: { require: { _name: 'es-node-1' } } }, number_of_shards: '4' },
    });
    expect(refreshed).toMatchObject({
      name: 'orders-v2',
      writeBlock: true,
      writeBlocked: true,
      requiredNode: 'es-node-1',
      health: 'yellow',
      docs: spread.docs,
      primarySize: spread.primarySize,
      routingShards: spread.routingShards,
    });
    expect(refreshed.shards).toHaveLength(4);
  });
});

describe('disk watermarks', () => {
  const total = 270_553_174_016;
  const available = 25_116_098_560;

  it('reads the watermarks with their headroom', () => {
    const off = diskWatermarks(CLUSTER_SETTINGS_DISK);
    expect(off?.enabled).toBe(false);
    expect(off?.high).toEqual({ kind: 'ratio', used: 0.9, headroom: 150 * 1024 ** 3, text: '90%' });
    const on = diskWatermarks({
      ...CLUSTER_SETTINGS_DISK,
      persistent: { 'cluster.routing.allocation.disk.threshold_enabled': 'true', 'cluster.routing.allocation.disk.watermark.low': '80%' },
      transient: { 'cluster.routing.allocation.disk.watermark.flood_stage': '5gb' },
    });
    expect(on?.enabled).toBe(true);
    // An explicit watermark drops the default headroom.
    expect(on?.low).toEqual({ kind: 'ratio', used: 0.8, headroom: null, text: '80%' });
    expect(on?.flood).toEqual({ kind: 'bytes', free: 5 * 1024 ** 3, text: '5gb' });
    expect(diskWatermarks({ persistent: {} })).toBeNull();
    expect(diskWatermarks(null)).toBeNull();
    expect(parseWatermark('0.85')).toMatchObject({ kind: 'ratio', used: 0.85 });
    expect(parseWatermark('nonsense')).toBeNull();
  });

  it('places a node against the watermarks', () => {
    const marks = { ...(diskWatermarks(CLUSTER_SETTINGS_DISK) as DiskWatermarks), enabled: true };
    // 10% of 252 GB is less than the 150 GB headroom, so the percentage applies.
    expect(requiredFree(marks.high as Watermark, total)).toBeCloseTo(total * 0.1, 0);
    // On a 10 TB disk the headroom caps it.
    expect(requiredFree(marks.high as Watermark, 10 * 1024 ** 4)).toBe(150 * 1024 ** 3);
    expect(diskLevel(available, total, marks)).toBe('high');
    expect(diskLevel(total * 0.5, total, marks)).toBe('ok');
    expect(diskLevel(total * 0.12, total, marks)).toBe('low');
    expect(diskLevel(total * 0.01, total, marks)).toBe('flood');
    expect(diskLevel(available, total, { ...marks, enabled: false })).toBeNull();
    expect(diskLevel(null, total, marks)).toBeNull();
  });
});

describe('node choice', () => {
  const marks: DiskWatermarks = { ...(diskWatermarks(CLUSTER_SETTINGS_DISK) as DiskWatermarks), enabled: true };
  const roomy: RawNode[] = NODES.map((node, position) => ({
    ...node,
    host: `10.0.0.${position + 1}`,
    attributes: { zone: position === 2 ? 'b' : 'a' },
    disk: node.disk ? { ...node.disk, available: node.disk.total / 2, percent: 50 } : null,
  }));

  it('explains which nodes the allocation filters exclude', () => {
    const node = roomy[0] as RawNode;
    expect(allocationExclusion(node, {})).toBeNull();
    expect(allocationExclusion(node, { 'index.routing.allocation.exclude._name': 'es-node-1' })).toBe(
      'Excluded by index.routing.allocation.exclude._name: es-node-1',
    );
    expect(allocationExclusion(node, { 'index.routing.allocation.require.zone': 'b' })).toBe(
      'Excluded by index.routing.allocation.require.zone: b (it has a)',
    );
    expect(allocationExclusion(node, { 'index.routing.allocation.require.rack': 'r1' })).toBe(
      'Excluded by index.routing.allocation.require.rack: r1 (it has no rack)',
    );
    expect(allocationExclusion(node, { 'index.routing.allocation.include._name': 'es-node-2,es-node-*' })).toBeNull();
    // The node name and id are not repeated.
    expect(allocationExclusion(node, { 'index.routing.allocation.include._name': 'es-node-2' })).toBe(
      'Excluded by index.routing.allocation.include._name: es-node-2',
    );
    expect(allocationExclusion(node, { 'index.routing.allocation.require._id': 'other' })).toBe(
      'Excluded by index.routing.allocation.require._id: other',
    );
    // Filters on data the nodes endpoint does not carry are not judged: Elasticsearch matches _host
    // against the host address too, which the nodes endpoint does not report.
    expect(allocationExclusion(node, { 'index.routing.allocation.require._ip': '1.2.3.4' })).toBeNull();
    expect(allocationExclusion(node, { 'index.routing.allocation.include._host': '10.0.0.9' })).toBeNull();
    expect(allocationExclusion(node, { 'index.routing.allocation.require._host': '10.0.0.9' })).toBeNull();
    expect(allocationExclusion(node, { 'index.routing.allocation.exclude._host': '10.0.0.1' })).toBeNull();
    // Include filters match when any of them does: one that cannot be judged may be it.
    expect(allocationExclusion(node, { 'index.routing.allocation.include.zone': 'b' })).toBe(
      'Excluded by index.routing.allocation.include.zone: b (it has a)',
    );
    expect(allocationExclusion(node, { 'index.routing.allocation.include.zone': 'b', 'index.routing.allocation.include._host': '10.0.0.1' })).toBeNull();
  });

  it('marks nodes and suggests one that can take the copies', () => {
    const options = nodeOptions(roomy, spread.shards, { watermarks: marks, allocation: { 'index.routing.allocation.exclude._name': 'es-node-2' } });
    expect(options.map((option) => [option.name, option.diskLevel, option.excluded])).toEqual([
      ['es-node-1', 'ok', null],
      ['es-node-2', 'ok', 'Excluded by index.routing.allocation.exclude._name: es-node-2'],
      ['es-node-3', 'ok', null],
    ]);
    // es-node-2 holds as many shards as es-node-3 but is excluded.
    expect(suggestedShrinkNode(options)?.name).toBe('es-node-3');
    // Past the high watermark (the demo nodes, 91% used): last choice.
    const full = nodeOptions(NODES, spread.shards, { watermarks: marks });
    expect(full.every((option) => option.diskLevel === 'high')).toBe(true);
    const mixed = [...full.slice(0, 2), { ...(options[2] as NodeOption), shardsHere: 0 }];
    expect(suggestedShrinkNode(mixed)?.name).toBe('es-node-3');
    // Excluded nodes are never suggested, even as a last resort.
    expect(suggestedShrinkNode(options.map((option) => ({ ...option, excluded: 'Excluded by x: y' })))).toBeNull();
  });
});

describe('tier preference', () => {
  // The demo nodes are in every tier; these are re-roled copies of them.
  const roles = (node: RawNode, ...tiers: string[]): RawNode => ({ ...node, roles: [...tiers, 'ingest', 'master'] });
  const [one, two, three] = NODES as [RawNode, RawNode, RawNode];
  const hotWarm = [roles(one, 'data_content', 'data_hot'), roles(two, 'data_warm'), roles(three, 'data_warm')];

  it('picks the first tier of the list that has a node, like Elasticsearch', () => {
    expect(preferredTier(['data_warm', 'data_hot'], hotWarm)).toBe('data_warm');
    expect(preferredTier(['data_cold', 'data_hot'], hotWarm)).toBe('data_hot');
    expect(preferredTier(['data_cold', 'data_frozen'], hotWarm)).toBeNull();
    // The generic data role is in every tier (the demo cluster).
    expect(preferredTier(['data_cold'], NODES)).toBe('data_cold');
    expect(preferredTier([], hotWarm)).toBeUndefined();
    // Clusters that do not report roles (before 7.10) are not judged.
    expect(preferredTier(['data_warm'], hotWarm.map((node) => ({ ...node, roles: [] })))).toBeUndefined();
  });

  it('says which tier the nodes on offer are in', () => {
    expect(tierNote(['data_cold', 'data_warm'], hotWarm)).toEqual({ tier: 'data_warm', tierName: 'the warm tier', preference: 'data_cold,data_warm' });
    expect(tierNote(['data_hot'], hotWarm)).toEqual({ tier: 'data_hot', tierName: 'the hot tier', preference: null });
    expect(tierNote(['data_frozen'], hotWarm)).toBeNull();
    expect(tierNote([], hotWarm)).toBeNull();
  });

  it('says nothing when the tier preference leaves no data node out', () => {
    // Every 8.x index prefers data_content; the demo nodes have the generic data role.
    expect(tierNote(['data_content'], NODES)).toBeNull();
    expect(tierNote(['data_warm', 'data_hot'], NODES)).toBeNull();
    // Only nodes that hold data count: a dedicated master outside the tier changes nothing.
    const master: RawNode = { ...(hotWarm[0] as RawNode), id: 'm1', name: 'master-1', data: false, roles: ['master'] };
    expect(tierNote(['data_warm'], [hotWarm[1] as RawNode, hotWarm[2] as RawNode, master])).toBeNull();
    // A fallback to a later tier is worth saying even when every data node is in it.
    const allHot = hotWarm.map((node) => roles(node, 'data_hot'));
    expect(tierNote(['data_warm', 'data_hot'], allHot)).toEqual({ tier: 'data_hot', tierName: 'the hot tier', preference: 'data_warm,data_hot' });
  });

  it('explains why a node is not in the preferred tier', () => {
    const preference = ['data_cold', 'data_warm', 'data_hot'];
    expect(tierExclusion(hotWarm[0] as RawNode, preference, 'data_warm')).toBe(
      'Not in the warm tier (data_warm), where index.routing.allocation.include._tier_preference: data_cold,data_warm,data_hot places the shards (no node is in data_cold)',
    );
    expect(tierExclusion(hotWarm[1] as RawNode, preference, 'data_warm')).toBeNull();
    expect(tierExclusion(hotWarm[0] as RawNode, ['data_frozen'], null)).toBe(
      'No node is in data_frozen, the tiers index.routing.allocation.include._tier_preference asks for',
    );
    expect(tierExclusion(hotWarm[0] as RawNode, ['data_warm'], undefined)).toBeNull();
  });

  it('only offers the nodes of the preferred tier for a shrink, and says why in the checks', () => {
    const options = nodeOptions(hotWarm, spread.shards, { tierPreference: ['data_warm', 'data_hot'] });
    expect(options.map((option) => [option.name, option.excluded])).toEqual([
      ['es-node-1', 'Not in the warm tier (data_warm), where index.routing.allocation.include._tier_preference: data_warm,data_hot places the shards'],
      ['es-node-2', null],
      ['es-node-3', null],
    ]);
    // es-node-2 and es-node-3 hold three shards each; es-node-2 sorts first.
    expect(suggestedShrinkNode(options)?.name).toBe('es-node-2');
    const source = { ...spread, tierPreference: ['data_warm', 'data_hot'] };
    const nodesCheck = resizeChecks({ kind: 'shrink', source, targetShards: 2, nodes: options }).find((check) => check.id === 'nodes');
    expect(nodesCheck).toEqual({
      id: 'nodes',
      status: 'pass',
      title: '2 of 3 data nodes can gather the copies',
      detail:
        'Not offered: es-node-1: Not in the warm tier (data_warm), where index.routing.allocation.include._tier_preference: data_warm,data_hot places the shards.',
    });
    // The other filters still apply on top of the tier.
    const zone = nodeOptions(hotWarm, spread.shards, {
      tierPreference: ['data_warm', 'data_hot'],
      allocation: { 'index.routing.allocation.require.zone': 'zone-1' },
    });
    expect(zone.map((option) => option.excluded === null)).toEqual([false, false, true]);
    expect(zone[1]?.excluded).toBe('Excluded by index.routing.allocation.require.zone: zone-1 (it has zone-2)');
  });

  it('groups the nodes a filter excludes under the filter alone', () => {
    const options = nodeOptions(NODES, spread.shards, { allocation: { 'index.routing.allocation.require.rack': 'r1' } });
    expect(options.map((option) => option.excluded)).toEqual([
      null,
      'Excluded by index.routing.allocation.require.rack: r1 (it has r2)',
      'Excluded by index.routing.allocation.require.rack: r1 (it has r3)',
    ]);
    const nodesCheck = resizeChecks({ kind: 'shrink', source: spread, targetShards: 2, nodes: options }).find((check) => check.id === 'nodes');
    expect(nodesCheck?.detail).toBe('Not offered: es-node-2, es-node-3: Excluded by index.routing.allocation.require.rack: r1.');
  });

  it('leaves every node offered under a _host filter it cannot judge', () => {
    const options = nodeOptions(NODES, spread.shards, { allocation: { 'index.routing.allocation.include._host': '10.0.0.5' } });
    expect(options.every((option) => option.excluded === null)).toBe(true);
    expect(suggestedShrinkNode(options)).not.toBeNull();
    expect(resizeChecks({ kind: 'shrink', source: spread, targetShards: 2, nodes: options }).some((check) => check.id === 'nodes')).toBe(false);
  });

  it('fails a shrink no node can gather', () => {
    const options = nodeOptions(hotWarm, spread.shards, { tierPreference: ['data_frozen'] });
    expect(suggestedShrinkNode(options)).toBeNull();
    const checks = resizeChecks({ kind: 'shrink', source: { ...spread, tierPreference: ['data_frozen'] }, targetShards: 2, nodes: options });
    expect(checks.find((check) => check.id === 'nodes')).toEqual({
      id: 'nodes',
      status: 'fail',
      title: 'No node can gather the copies',
      detail:
        'es-node-1, es-node-2, es-node-3: No node is in data_frozen, the tiers index.routing.allocation.include._tier_preference asks for. Change the allocation settings of orders-v2 in Index settings first.',
    });
    expect(checks.find((check) => check.id === 'disk')).toMatchObject({ status: 'warn', title: 'Disk space not checked' });
  });

  it('explains copies that cannot reach a node outside the tier', () => {
    const options = nodeOptions(hotWarm, relocating.shards, { tierPreference: ['data_warm'] });
    const stuck = { ...relocating, tierPreference: ['data_warm'], shards: relocating.shards.map((copy) => ({ ...copy, state: 'started' as const, relocatingTo: null })) };
    const check = resizeChecks({ kind: 'shrink', source: stuck, targetShards: 2, nodes: options }).find((entry) => entry.id === 'colocation');
    expect(check?.status).toBe('fail');
    expect(check?.detail).toContain('Not in the warm tier (data_warm), where index.routing.allocation.include._tier_preference: data_warm places the shards: undo the preparation');
    // Once a node is required the choice is over: no node check.
    expect(resizeChecks({ kind: 'shrink', source: stuck, targetShards: 2, nodes: options }).some((entry) => entry.id === 'nodes')).toBe(false);
  });

  it('reads the tier preference of the source and the _tier filters of older clusters', () => {
    expect(only(DETAIL_SHRUNK_TWO).tierPreference).toEqual(['data_warm', 'data_hot']);
    expect(prepared.tierPreference).toEqual([]);
    const warm = hotWarm[1] as RawNode;
    expect(allocationExclusion(warm, { 'index.routing.allocation.require._tier': 'data_hot' })).toBe(
      'Excluded by index.routing.allocation.require._tier: data_hot',
    );
    expect(allocationExclusion(warm, { 'index.routing.allocation.include._tier': 'data_hot,data_warm' })).toBeNull();
    expect(allocationExclusion(warm, { 'index.routing.allocation.exclude._tier': 'data_warm' })).toBe(
      'Excluded by index.routing.allocation.exclude._tier: data_warm',
    );
    expect(allocationExclusion({ ...warm, roles: [] }, { 'index.routing.allocation.require._tier': 'data_hot' })).toBeNull();
  });
});

describe('resize checks after review', () => {
  const marks: DiskWatermarks = { ...(diskWatermarks(CLUSTER_SETTINGS_DISK) as DiskWatermarks), enabled: true };
  const off = diskWatermarks(CLUSTER_SETTINGS_DISK);
  const disk = (checks: readonly Check[]): Check | undefined => checks.find((check) => check.id === 'disk');

  it('checks the disk of the node a preparation would use', () => {
    const spreadNodes = nodeOptions(NODES, spread.shards, { watermarks: off });
    const before = disk(resizeChecks({ kind: 'shrink', source: spread, targetShards: 2, nodes: spreadNodes, candidateNode: 'es-node-2', watermarks: off }));
    expect(before).toMatchObject({ status: 'pass', title: 'Enough disk on es-node-2 (after preparation)' });
    expect(before?.detail).toContain('The disk watermarks are off');
    const none = disk(resizeChecks({ kind: 'shrink', source: spread, targetShards: 2, nodes: [], candidateNode: null }));
    expect(none).toMatchObject({ status: 'warn', title: 'Disk space not checked' });
  });

  it('fails a node the watermarks rule out', () => {
    const full = nodeOptions(NODES, prepared.shards, { watermarks: marks });
    const high = disk(resizeChecks({ kind: 'shrink', source: prepared, targetShards: 2, nodes: full, watermarks: marks }));
    expect(high).toMatchObject({ status: 'fail', title: 'es-node-1 would pass the high disk watermark' });
    expect(high?.detail).toContain('90% used');

    // Past the low watermark (88% used) with copies still to move there.
    const total = 1_000_000_000_000;
    const low: NodeOption[] = nodeOptions(NODES, spread.shards, { watermarks: marks }).map((option) => ({
      ...option,
      diskTotal: total,
      diskAvailable: total * 0.12,
    }));
    const lowCheck = disk(resizeChecks({ kind: 'shrink', source: spread, targetShards: 2, nodes: low, candidateNode: 'es-node-2', watermarks: marks }));
    expect(lowCheck).toMatchObject({ status: 'fail', title: 'es-node-2 is past the low disk watermark' });

    // Room left, but within 5% of the high watermark.
    const close: NodeOption[] = low.map((option) => ({ ...option, diskAvailable: total * 0.14 }));
    const closeCheck = disk(resizeChecks({ kind: 'shrink', source: prepared, targetShards: 2, nodes: close, watermarks: marks }));
    expect(closeCheck).toMatchObject({ status: 'warn', title: 'es-node-1 gets close to the high disk watermark' });
  });

  it('warns a split when the nodes of the source primaries are past the high watermark', () => {
    const full = nodeOptions(NODES, prepared.shards, { watermarks: marks });
    const checks = resizeChecks({ kind: 'split', source: prepared, targetShards: 8, nodes: full, watermarks: marks });
    expect(disk(checks)).toMatchObject({ status: 'warn', title: 'Nodes past the high disk watermark' });
    expect(disk(checks)?.detail).toContain('es-node-1 (91% used)');
    expect(disk(resizeChecks({ kind: 'clone', source: prepared, targetShards: 4, nodes: full, watermarks: off }))).toBeUndefined();
  });

  it('warns about inherited allocation settings and clears node requirements on the target', () => {
    const pinned: SourceIndex = { ...prepared, allocation: { 'index.routing.allocation.require._id': 'abc', 'index.routing.allocation.total_shards_per_node': '1' } };
    const check = resizeChecks({ kind: 'clone', source: pinned, targetShards: 4, nodes }).find((item) => item.id === 'allocation');
    expect(check).toMatchObject({ status: 'warn', title: 'Allocation settings on the source' });
    expect(check?.detail).toContain('the request clears the node requirements on the new index');
    const body = buildResizeRequest('shrink', pinned, { target: 't', shards: 2, replicas: null, bestCompression: false, aliases: [] }).preview.body;
    expect(body).toEqual({
      settings: {
        'index.number_of_shards': 2,
        'index.routing.allocation.require._name': null,
        'index.routing.allocation.require._id': null,
        'index.blocks.write': null,
      },
    });
  });

  it('warns that the copy of a backing index is outside its data stream', () => {
    const backing = parseIndices(DETAIL_BACKING_INDEX, dataStreamMembership(DATA_STREAMS))[0] as SourceIndex;
    expect(backing).toMatchObject({ dataStream: 'app-events-web', dataStreamWriteIndex: false });
    const check = resizeChecks({ kind: 'clone', source: backing, targetShards: 1, nodes }).find((item) => item.id === 'data-stream');
    expect(check).toMatchObject({ status: 'warn', title: 'Backing index of app-events-web' });
    expect(check?.detail).toContain('searches on the data stream do not see it');
    const request = buildResizeRequest('clone', backing, { target: 'events-copy', shards: 1, replicas: null, bestCompression: false, aliases: [] });
    expect(request.preview.body).toEqual({
      settings: { 'index.blocks.write': null, 'index.hidden': false, 'index.lifecycle.name': null },
    });
  });

  it('warns that the routing shards of a resized index are an estimate', () => {
    const resized: SourceIndex = { ...prepared, resizedFrom: 'orders-v1', routingShards: { value: 1024, origin: 'resized' } };
    const check = resizeChecks({ kind: 'split', source: resized, targetShards: 8, nodes }).find((item) => item.id === 'routing');
    expect(check).toMatchObject({ status: 'warn', title: 'Routing shards estimated' });
    expect(check?.detail).toContain('created from orders-v1');
  });

  it('lists the unassigned primaries of the target', () => {
    const copies: ShardCopy[] = [
      { shard: 0, primary: true, state: 'started', node: 'a', relocatingTo: null, docs: 1, size: 1 },
      { shard: 1, primary: true, state: 'unassigned', node: null, relocatingTo: null, docs: null, size: null },
      { shard: 1, primary: false, state: 'unassigned', node: null, relocatingTo: null, docs: null, size: null },
    ];
    expect(targetRecovery(copies)).toMatchObject({ unassignedPrimaries: [1], health: 'red', done: false });
  });
});

describe('rollover after review', () => {
  const targets = rolloverTargets(ALIAS_ROWS, DATA_STREAMS);
  const byName = new Map(targets.map((target) => [target.name, target]));

  it('tells aliases that move with the rollover', () => {
    expect(byName.get('orders')?.implicitWrite).toBe(true);
    expect(byName.get('logs-current')?.implicitWrite).toBe(true);
    expect(byName.get('tmp-index-ops-roll')?.implicitWrite).toBe(false);
    expect(byName.get('logs')?.implicitWrite).toBe(false);
    expect(byName.get('app-events-web')?.implicitWrite).toBe(false);
    expect(explicitWriteIndexRequest('orders', 'orders-v2')).toEqual({
      endpoint: 'aliases/update_aliases',
      payload: { changes: [{ add: { index: 'orders-v2', alias: 'orders', is_write_index: true } }] },
      preview: {
        method: 'POST',
        path: '/_aliases',
        body: { actions: [{ add: { index: 'orders-v2', alias: 'orders', is_write_index: true } }] },
        title: 'Make orders-v2 the explicit write index of orders',
      },
    });
  });

  it('offers only the conditions the cluster knows', () => {
    expect(parseVersion('8.15.0')).toEqual([8, 15]);
    expect(parseVersion('x')).toBeNull();
    expect(minNodeVersion([{ ...(NODES[0] as RawNode), version: '8.15.0' }, { ...(NODES[1] as RawNode), version: '7.17.3' }])).toEqual([7, 17]);
    expect(minNodeVersion(NODES)).toBeNull();
    const supported = (version: readonly [number, number] | null): string[] =>
      ROLLOVER_CONDITIONS.filter((condition) => conditionSupported(condition, version)).map((condition) => condition.param);
    expect(supported([7, 10])).toEqual(['max_age', 'max_docs', 'max_size']);
    expect(supported([7, 17])).toEqual(['max_age', 'max_docs', 'max_size', 'max_primary_shard_size']);
    expect(supported([8, 2])).toHaveLength(5);
    expect(supported(null)).toHaveLength(5);
  });
});

describe('reindex after review', () => {
  it('needs max_docs to cover the slices', () => {
    expect(reindexErrors({ ...DEFAULT_REINDEX_OPTIONS, sources: 'a', dest: 'b', slicesMode: 'custom', slices: '5', maxDocs: '2' }).maxDocs).toBe(
      'Enter at least 5: Elasticsearch needs as many documents as slices',
    );
    expect(reindexErrors({ ...DEFAULT_REINDEX_OPTIONS, sources: 'a', dest: 'b', slicesMode: 'custom', slices: '5', maxDocs: '5' }).maxDocs).toBeUndefined();
    const indices = parseLookupRows(LOOKUP_INDICES).filter((index) => index.open);
    expect(autoSlices(indices)).toBe(1);
    expect(autoSlices(indices.filter((index) => index.name.startsWith('logs')))).toBe(3);
    expect(autoSlices([{ ...blankSource('huge'), primaries: 64 }])).toBe(20);
    expect(autoSlices([])).toBeNull();
    const logs = indices.filter((index) => index.name.startsWith('logs'));
    const checks = reindexChecks({ sources: { state: 'ready', indices: logs }, dest: { state: 'missing' }, destName: 'x', destIsDataStream: false, slicesMode: 'auto', maxDocs: 2 });
    expect(checks.find((check) => check.id === 'max-docs')).toMatchObject({ status: 'fail' });
    expect(
      reindexChecks({ sources: { state: 'ready', indices: logs }, dest: { state: 'missing' }, destName: 'x', destIsDataStream: false, slicesMode: 'auto', maxDocs: 3 }).some(
        (check) => check.id === 'max-docs',
      ),
    ).toBe(false);
  });

  it('refuses a closed destination', () => {
    const closed = { ...blankSource('archive-2025'), open: false };
    const checks = reindexChecks({
      sources: { state: 'ready', indices: [{ ...blankSource('a'), open: true, docs: 1 }] },
      dest: { state: 'ready', indices: [closed] },
      destName: 'archive-2025',
      destIsDataStream: false,
    });
    expect(checks.find((check) => check.id === 'dest-open')).toMatchObject({ status: 'fail', title: 'Destination is closed' });
  });

  it('groups identical failures', () => {
    const groups = groupFailures(reindexProgress(TASK_CONFLICTS).failures);
    expect(groups).toEqual([
      { index: 'tmp-index-ops-dst', status: 409, reason: 'Version conflict, document already exists', count: 2, ids: ['11', '5'] },
    ]);
    const mixed = groupFailures([
      { index: 'a', id: '1', reason: 'Mapper parsing exception.', status: 400 },
      { index: 'a', id: '2', reason: '[2]: version conflict, document already exists (current version [3])', status: 409 },
      { index: 'a', id: '3', reason: '[3]: version conflict, document already exists (current version [1])', status: 409 },
    ]);
    expect(mixed.map((group) => [group.count, group.status])).toEqual([
      [2, 409],
      [1, 400],
    ]);
    expect(groupFailures([{ index: null, id: '1', reason: 'x', status: null }], 0)[0]?.ids).toEqual([]);
  });

  it('keeps sliced progress from going backwards', () => {
    const before = reindexProgress(TASK_RUNNING);
    const dip = { ...before, created: before.created - 100, processed: before.processed - 100 };
    const steady = steadyProgress(before, dip);
    expect(steady.processed).toBe(before.processed);
    expect(steady.created).toBe(before.created);
    expect(steadyProgress(null, dip)).toBe(dip);
    const done = reindexProgress(TASK_DONE);
    expect(steadyProgress(before, done)).toBe(done);
  });

  it('does not count a finished slice twice', () => {
    const parent = 'I7MELLk0RvSiAPhRW6211Q:96433';
    const status = { ...(TASK_SLICED_RUNNING.task?.status ?? {}), slices: [{ slice_id: 0, total: 700, created: 700, batches: 1 }, null, null, null] };
    const response: TaskGetResponse = { ...TASK_SLICED_RUNNING, task: { ...TASK_SLICED_RUNNING.task, status } };
    const children: RawListedTask[] = [
      // Read after the parent: slice 0 already finished but the list still shows it.
      { node: 'n', id: 1, action: 'indices:data/write/reindex', parent_task_id: parent, status: { slice_id: 0, total: 700, created: 650 } },
      { node: 'n', id: 2, action: 'indices:data/write/reindex', parent_task_id: parent, status: { slice_id: 1, total: 800, created: 100 } },
    ];
    expect(reindexProgress(response, children, parent)).toMatchObject({ created: 100, total: 800 });
  });

  it('reads sources and destination from a task description', () => {
    expect(describedReindex('reindex from [tmp-index-ops-src] to [tmp-index-ops-dst2]')).toEqual({ sources: 'tmp-index-ops-src', dest: 'tmp-index-ops-dst2' });
    expect(describedReindex('reindex from [a,b] to [c][_doc]')).toEqual({ sources: 'a, b', dest: 'c' });
    expect(describedReindex('something else')).toBeNull();
    expect(describedReindex(null)).toBeNull();
  });
});
