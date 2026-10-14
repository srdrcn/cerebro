import { describe, expect, it } from 'vitest';
import { saveMode } from './save-mode';

describe('saveMode', () => {
  const existing = ['logs', 'metrics'];

  it('updates the selected item when the name is unchanged', () => {
    expect(saveMode('logs', 'logs', existing)).toBe('update');
  });

  it('creates a new item when nothing is selected', () => {
    expect(saveMode('traces', null, existing)).toBe('create');
  });

  it('overwrites another existing item with the typed name', () => {
    expect(saveMode('metrics', 'logs', existing)).toBe('overwrite');
    expect(saveMode('metrics', null, existing)).toBe('overwrite');
  });

  it('copies the selected item under a new name', () => {
    expect(saveMode('logs-copy', 'logs', existing)).toBe('copy');
  });
});
