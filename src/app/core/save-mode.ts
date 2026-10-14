/**
 * What saving an editor does with the typed name: update the selected item,
 * create a new one, overwrite another existing item with that name, or save
 * a copy of the selected item under a new name.
 */
export type SaveMode = 'create' | 'update' | 'overwrite' | 'copy';

export function saveMode(name: string, selected: string | null, existing: readonly string[]): SaveMode {
  if (selected !== null && name === selected) {
    return 'update';
  }
  if (existing.includes(name)) {
    return 'overwrite';
  }
  return selected === null ? 'create' : 'copy';
}
