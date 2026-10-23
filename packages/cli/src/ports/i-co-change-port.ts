import type { CoChangeEntry } from '../core/types.js';

/**
 * Read access to the co-change matrix (`co-changes.json`), shaped for lookups: every file maps to the
 * entries it takes part in, so each entry is listed under both of its files.
 *
 * Returns `undefined` when there is no usable matrix (the project was never indexed, or the file is
 * invalid); callers then work from the dependency graph alone. The map is shared between calls, so a
 * caller must treat it, and the lists in it, as read-only.
 */
export interface ICoChangePort {
  readCoChangeMap(): Map<string, CoChangeEntry[]> | undefined;
}
