import { describe, expect, it } from 'vitest';
import { scoreCommand } from './command-palette.component';

describe('command palette scoring', () => {
  it('ranks exact and prefix matches above fuzzy ones', () => {
    const exact = scoreCommand('Nodes', '', 'nodes');
    const prefix = scoreCommand('Nodes', '', 'no');
    const word = scoreCommand('Cluster settings', '', 'set');
    const keyword = scoreCommand('Overview', 'shards allocation', 'shards');
    const fuzzy = scoreCommand('Cluster settings', '', 'clst');

    expect(exact).toBeGreaterThan(prefix);
    expect(prefix).toBeGreaterThan(word);
    expect(word).toBeGreaterThan(keyword);
    expect(keyword).toBeGreaterThan(fuzzy);
    expect(fuzzy).toBeGreaterThan(0);
    expect(scoreCommand('Nodes', '', 'xyz')).toBe(0);
  });
});
