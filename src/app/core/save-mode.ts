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

/** The save button for a mode: "Create policy", "Save changes", "Overwrite policy", "Save as new policy". */
export function saveLabel(mode: SaveMode, noun: string): string {
  switch (mode) {
    case 'create':
      return `Create ${noun}`;
    case 'update':
      return 'Save changes';
    case 'overwrite':
      return `Overwrite ${noun}`;
    case 'copy':
      return `Save as new ${noun}`;
  }
}
