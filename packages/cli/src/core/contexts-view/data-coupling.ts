import type { DataResourceKind } from '@ctxo/plugin-api';

import { compareCodepoint } from '../compare-codepoint.js';
import { DATA_EDGE_KINDS, isDataResourceKind } from '../data-coupling/data-kinds.js';
import type { SymbolGraph } from '../graph/symbol-graph.js';
import type { SymbolNode } from '../types.js';

export type DataAccessMode = 'reads' | 'writes';

/** How one candidate accesses a resource; `modes` lists `reads` before `writes`. */
export interface CandidateDataAccess {
  readonly candidate: number;
  readonly modes: readonly DataAccessMode[];
}

/** A table or view that at least one candidate reads or writes. */
export interface DataResourceUsage {
  /** Canonical `schema.name`. */
  readonly name: string;
  /** Absent when external. */
  readonly kind?: DataResourceKind;
  /** No indexed table or view defines it. */
  readonly external: boolean;
  /** By candidate id. */
  readonly accesses: readonly CandidateDataAccess[];
  /** Candidates that write it, by id; more than one means several writers. */
  readonly writers: readonly number[];
  /** The only writer. */
  readonly owner?: number;
}

/** A resource this candidate and at least one other candidate access. */
export interface CandidateSharedTable {
  readonly name: string;
  /** Absent when external. */
  readonly kind?: DataResourceKind;
  readonly external: boolean;
  readonly accesses: readonly CandidateDataAccess[];
  readonly owner?: number;
}

export interface DataCouplingInput {
  /** The symbol graph of the index, from `buildIndexGraph`. */
  readonly graph: SymbolGraph;
  /** The candidate of each member file and of each assigned hub; other files are left out. */
  readonly fileCandidate: ReadonlyMap<string, number>;
}

export interface DataCoupling {
  /** Every resource with at least one access, by name. */
  readonly resources: readonly DataResourceUsage[];
  /** Per candidate id (ascending), the resources of two or more candidates, by name; candidates without any are absent. */
  readonly sharedTables: ReadonlyMap<number, readonly CandidateSharedTable[]>;
}

const MODES: readonly DataAccessMode[] = ['reads', 'writes'];

function fileOf(symbolId: string): string {
  const at = symbolId.indexOf('::');
  return at < 0 ? symbolId : symbolId.slice(0, at);
}

/** The name part of `<file>::<name>::<kind>` or of a 2-part reference `<name>::<kind>`. */
function nameOf(id: string): string | undefined {
  const parts = id.split('::');
  if (parts.length === 3) return parts[1];
  if (parts.length === 2) return parts[0];
  return undefined;
}

function kindOf(id: string): string {
  return id.slice(id.lastIndexOf('::') + 2);
}

/**
 * The seeds (vertices for which `isSeed` holds) that no seed outside their own strongly connected component
 * reaches, in the graph `successors` spans over `vertices`. Paths may run through vertices that are not
 * seeds. `successors` must only name vertices of `vertices`.
 *
 * One iterative Tarjan pass, which numbers the components in reverse topological order, then one pass over
 * the components in topological order that marks every component a seed reaches from another component.
 * Linear in vertices plus edges; the result does not depend on the order of `vertices`.
 */
function unenteredSeeds(
  vertices: readonly string[],
  successors: (vertex: string) => readonly string[],
  isSeed: (vertex: string) => boolean,
): Set<string> {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const component = new Map<string, number>();
  const members: string[][] = [];
  const stack: string[] = [];
  const onStack = new Set<string>();
  let nextIndex = 0;

  for (const start of vertices) {
    if (index.has(start)) continue;
    const frames: Array<{ vertex: string; next: readonly string[]; at: number }> = [];
    const open = (vertex: string): void => {
      index.set(vertex, nextIndex);
      low.set(vertex, nextIndex);
      nextIndex++;
      stack.push(vertex);
      onStack.add(vertex);
      frames.push({ vertex, next: successors(vertex), at: 0 });
    };
    open(start);
    while (frames.length > 0) {
      const frame = frames[frames.length - 1]!;
      if (frame.at < frame.next.length) {
        const successor = frame.next[frame.at++]!;
        if (!index.has(successor)) open(successor);
        else if (onStack.has(successor)) low.set(frame.vertex, Math.min(low.get(frame.vertex)!, index.get(successor)!));
        continue;
      }
      frames.pop();
      if (low.get(frame.vertex) === index.get(frame.vertex)) {
        const id = members.length;
        const list: string[] = [];
        let member: string;
        do {
          member = stack.pop()!;
          onStack.delete(member);
          component.set(member, id);
          list.push(member);
        } while (member !== frame.vertex);
        members.push(list);
      }
      const parent = frames[frames.length - 1];
      if (parent) low.set(parent.vertex, Math.min(low.get(parent.vertex)!, low.get(frame.vertex)!));
    }
  }

  // An edge between two components always goes to a lower id, so the highest id comes first in
  // topological order, and a component is final once every higher id is done.
  const entered = members.map(() => false);
  for (let id = members.length - 1; id >= 0; id--) {
    if (!entered[id] && !members[id]!.some(isSeed)) continue;
    for (const vertex of members[id]!) {
      for (const successor of successors(vertex)) {
        const target = component.get(successor)!;
        if (target !== id) entered[target] = true;
      }
    }
  }
  return new Set(vertices.filter((vertex) => isSeed(vertex) && !entered[component.get(vertex)!]));
}

/**
 * Data coupling between candidates (spec 8.6): which candidate reads or writes which table or view.
 *
 * - A `reads` or `writes` edge from a symbol in a candidate file records that candidate and mode for its
 *   target, unless the symbol is a procedure: procedure bodies count through `executes` instead, so the
 *   candidate that holds a procedure script does not read and write every table its procedures touch.
 * - Procedures are executed by canonical name (`SymbolGraph.dataResourceIdentity`). An `executes` edge to a
 *   resolved procedure points at the winning definition of the name, and executes the name's counted
 *   definitions: every production copy (in neither a test file nor a documentation folder), or the winner
 *   alone when no copy is production. The executing candidate takes on the reads and writes of their
 *   bodies, following their further `executes` edges transitively; an unresolved procedure adds nothing.
 *   A production copy that lost resolution is therefore executed whenever its name is, and the other docs
 *   and test copies add nothing at all.
 * - A procedure name that no candidate-attributed symbol executes, directly or through a chain, credits the
 *   candidate of each file that holds a counted definition of it, as if that candidate executed it. A name
 *   that is executed never credits the candidates of the files that define it. Executors outside the view
 *   (unclustered files, test files) do not count as executing. Among such names, one that another of them
 *   with a counted definition in a candidate file reaches, from outside its own cycle, counts through that
 *   chain instead; names that only execute each other, with nothing outside the cycle executing them, each
 *   credit their own candidates. This is one strongly connected component pass, linear in procedures plus
 *   executes edges.
 * - Reading a view does not expand to its tables.
 * - A target that no indexed table or view defines is external and has no kind. Resources are keyed by
 *   canonical name; when several definitions share a name, the kind is that of the definition SymbolGraph
 *   resolves the 2-part reference to.
 *
 * Pure and deterministic: the result does not depend on the order of the graph or the map.
 */
export function computeDataCoupling(input: DataCouplingInput): DataCoupling {
  const { graph, fileCandidate } = input;

  const nodes = new Map<string, SymbolNode>();
  for (const node of graph.allNodes()) nodes.set(node.symbolId, node);

  /** The kind of the definition a 2-part reference to `name` resolves to, or undefined when none defines it. */
  const definitionKind = (name: string): DataResourceKind | undefined => {
    const node = graph.getNode(`${name}::table`);
    return node && isDataResourceKind(node.kind) ? node.kind : undefined;
  };

  /** The resource name of an edge target, or undefined when the target is no table or view. */
  const resourceOf = (target: string): string | undefined => {
    const node = nodes.get(target);
    if (node) return isDataResourceKind(node.kind) ? nameOf(node.symbolId) : undefined;
    return isDataResourceKind(kindOf(target)) ? nameOf(target) : undefined;
  };
  const isProcedure = (target: string): boolean => nodes.get(target)?.kind === 'procedure';

  // Procedures by canonical name: each procedure node maps to its `name::procedure`, each name to its counted
  // definitions (tie-break order): every production copy, or the winner alone when no copy is production.
  const procedureName = new Map<string, string>();
  const countedOf = new Map<string, readonly string[]>();
  for (const node of nodes.values()) {
    if (node.kind !== 'procedure' || procedureName.has(node.symbolId)) continue;
    const identity = graph.dataResourceIdentity(node.symbolId);
    if (!identity) continue;
    for (const definition of identity.definitions) procedureName.set(definition.symbolId, identity.canonicalId);
    const counted = identity.production.length > 0 ? identity.production : [identity.winner];
    countedOf.set(identity.canonicalId, counted.map((definition) => definition.symbolId));
  }

  /** Per procedure name, the resolved procedure names the bodies of its counted definitions execute. */
  const executesNames = new Map<string, readonly string[]>();
  for (const [name, definitions] of countedOf) {
    const targets = new Set<string>();
    for (const definition of definitions) {
      for (const edge of graph.getForwardEdges(definition)) {
        const target = edge.kind === 'executes' ? procedureName.get(edge.to) : undefined;
        if (target !== undefined) targets.add(target);
      }
    }
    executesNames.set(name, [...targets]);
  }
  /** The procedure names reachable from `starts` through `executes` edges, `starts` included. */
  const closure = (starts: Iterable<string>): Set<string> => {
    const visited = new Set<string>();
    const stack = [...starts];
    while (stack.length > 0) {
      const name = stack.pop()!;
      if (visited.has(name)) continue;
      visited.add(name);
      for (const next of executesNames.get(name) ?? []) if (!visited.has(next)) stack.push(next);
    }
    return visited;
  };

  const usage = new Map<string, Map<number, Set<DataAccessMode>>>();
  const record = (candidate: number, target: string, mode: DataAccessMode): void => {
    const name = resourceOf(target);
    if (name === undefined) return;
    const byCandidate = usage.get(name) ?? new Map<number, Set<DataAccessMode>>();
    const modes = byCandidate.get(candidate) ?? new Set<DataAccessMode>();
    modes.add(mode);
    byCandidate.set(candidate, modes);
    usage.set(name, byCandidate);
  };

  /** Per candidate, the procedure names whose bodies it takes on (with everything they execute). */
  const executed = new Map<number, string[]>();
  const execute = (candidate: number, name: string): void => {
    const list = executed.get(candidate);
    if (list) list.push(name);
    else executed.set(candidate, [name]);
  };

  for (const edge of graph.allEdges()) {
    if (!DATA_EDGE_KINDS.has(edge.kind) || isProcedure(edge.from)) continue;
    const candidate = fileCandidate.get(fileOf(edge.from));
    if (candidate === undefined) continue;
    if (edge.kind === 'executes') {
      const name = procedureName.get(edge.to);
      if (name !== undefined) execute(candidate, name);
      continue;
    }
    record(candidate, edge.to, edge.kind === 'writes' ? 'writes' : 'reads');
  }

  // The procedure names that no non-procedure symbol of a candidate file reaches. A name that another of them
  // with a counted definition in a candidate file reaches, from outside its own cycle, counts through that
  // chain; the rest credit the candidate of each file that holds a counted definition of them. A cycle with
  // no way in from outside credits each member's candidates.
  const reached = closure([...executed.values()].flat());
  const unreached = [...countedOf.keys()].filter((name) => !reached.has(name));
  const inCandidateFile = (name: string): boolean => countedOf.get(name)!.some((definition) => fileCandidate.has(fileOf(definition)));
  const unreachedSet = new Set(unreached);
  const executesUnreached = (from: string): string[] => executesNames.get(from)!.filter((name) => unreachedSet.has(name));
  for (const name of unenteredSeeds(unreached, executesUnreached, inCandidateFile)) {
    for (const definition of countedOf.get(name)!) {
      const candidate = fileCandidate.get(fileOf(definition));
      if (candidate !== undefined) execute(candidate, name);
    }
  }

  // One walk per candidate over the procedure names it executes, directly or through other procedures, and
  // the body of every counted definition of each.
  for (const [candidate, starts] of executed) {
    for (const name of closure(starts)) {
      for (const definition of countedOf.get(name)!) {
        for (const edge of graph.getForwardEdges(definition)) {
          if (edge.kind === 'reads' || edge.kind === 'writes') record(candidate, edge.to, edge.kind);
        }
      }
    }
  }

  const resources = [...usage.entries()]
    .sort(([x], [y]) => compareCodepoint(x, y))
    .map(([name, byCandidate]): DataResourceUsage => {
      const accesses = [...byCandidate.entries()]
        .sort(([x], [y]) => x - y)
        .map(([candidate, modes]): CandidateDataAccess => ({ candidate, modes: MODES.filter((mode) => modes.has(mode)) }));
      const writers = accesses.filter((access) => access.modes.includes('writes')).map((access) => access.candidate);
      const kind = definitionKind(name);
      return {
        name,
        ...(kind !== undefined ? { kind } : {}),
        external: kind === undefined,
        accesses,
        writers,
        ...(writers.length === 1 ? { owner: writers[0]! } : {}),
      };
    });

  const shared = new Map<number, CandidateSharedTable[]>();
  for (const resource of resources) {
    if (resource.accesses.length < 2) continue;
    const entry: CandidateSharedTable = {
      name: resource.name,
      ...(resource.kind !== undefined ? { kind: resource.kind } : {}),
      external: resource.external,
      accesses: resource.accesses,
      ...(resource.owner !== undefined ? { owner: resource.owner } : {}),
    };
    for (const access of resource.accesses) {
      const list = shared.get(access.candidate);
      if (list) list.push(entry);
      else shared.set(access.candidate, [entry]);
    }
  }
  const sharedTables = new Map([...shared.entries()].sort(([x], [y]) => x - y));

  return { resources, sharedTables };
}
