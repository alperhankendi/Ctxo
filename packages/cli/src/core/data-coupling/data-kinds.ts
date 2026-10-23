import { DATA_RESOURCE_KINDS, type DataResourceKind } from '@ctxo/plugin-api';
import type { EdgeKind } from '../types.js';

/** Edge kinds that couple code to data resources (protocol v2). */
export const DATA_EDGE_KINDS: ReadonlySet<EdgeKind> = new Set<EdgeKind>(['reads', 'writes', 'executes']);

const PROCEDURE_KINDS: readonly string[] = ['procedure'];

export function isDataResourceKind(kind: string): kind is DataResourceKind {
  return (DATA_RESOURCE_KINDS as readonly string[]).includes(kind);
}

/**
 * The definition kinds a data reference of `kind` matches, or undefined when `kind` names no data object. A
 * table or view reference matches both, because a 2-part `::table` reference may name a view; a procedure
 * reference matches procedures only.
 */
export function dataReferenceKinds(kind: string): readonly string[] | undefined {
  if (isDataResourceKind(kind)) return DATA_RESOURCE_KINDS;
  if (kind === 'procedure') return PROCEDURE_KINDS;
  return undefined;
}
