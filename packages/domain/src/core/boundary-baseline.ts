import type { RangeCommit } from '@ctxo/cli/internal';
import type { BoundaryViolationRecord } from './boundaries.js';

/**
 * `new-only` boundary mode (#156): which boundary violations of the branch are new against its base.
 *
 * A violation's key is its source context, target context, source symbol ID, edge kind and target symbol ID. Symbol
 * IDs are `<file>::<name>::<kind>`, so the key holds no line number: a violation that moves within its file, or an
 * unrelated change elsewhere, keeps its key. A file renamed (or moved) on the branch keeps its violations' keys too:
 * the base's symbol IDs are rewritten through the branch's renames before they are compared. A violation whose
 * context pair changed (its file moved into another context) or whose symbol was renamed is new.
 */

const SEPARATOR = '\u0000';

export function violationKey(violation: Pick<BoundaryViolationRecord, 'from' | 'to' | 'edgeKind'>): string {
  return [violation.from.context, violation.to.context, violation.from.symbolId, violation.edgeKind, violation.to.symbolId].join(SEPARATOR);
}

/**
 * The renames of the branch, base path to head path, project-relative: the renames (git `R`) of the non-merge
 * commits of `base..HEAD`, composed oldest first, so `a -> b` then `b -> c` maps `a` to `c`. `prefix` is the project
 * directory inside the repository (`sub/dir/` or ''); a rename outside it is left out. A path renamed and then
 * renamed back maps to itself and is dropped.
 */
export function branchRenames(commits: readonly RangeCommit[], prefix = ''): ReadonlyMap<string, string> {
  const strip = (path: string): string | undefined => (path.startsWith(prefix) ? path.slice(prefix.length) : undefined);
  // origin (base path) -> current path, and current path -> origin, kept in step.
  const current = new Map<string, string>();
  const origin = new Map<string, string>();
  for (const commit of [...commits].reverse()) {
    for (const change of commit.changes) {
      if (change.status !== 'R' || change.oldPath === undefined) continue;
      const from = strip(change.oldPath);
      const to = strip(change.path);
      if (from === undefined || to === undefined) continue;
      const base = origin.get(from) ?? from;
      origin.delete(from);
      current.set(base, to);
      origin.set(to, base);
    }
  }
  for (const [base, path] of current) if (base === path) current.delete(base);
  return current;
}

/** A symbol ID with its file part rewritten through `renames`. */
function renamed(symbolId: string, renames: ReadonlyMap<string, string>): string {
  const cut = symbolId.indexOf('::');
  if (cut < 0) return symbolId;
  const file = renames.get(symbolId.slice(0, cut));
  return file === undefined ? symbolId : `${file}${symbolId.slice(cut)}`;
}

/** The keys of the base's violations, their symbol IDs rewritten through the branch's renames. */
export function baselineKeys(base: readonly BoundaryViolationRecord[], renames: ReadonlyMap<string, string>): ReadonlySet<string> {
  const keys = new Set<string>();
  for (const v of base) {
    keys.add(
      violationKey({
        from: { ...v.from, symbolId: renamed(v.from.symbolId, renames) },
        to: { ...v.to, symbolId: renamed(v.to.symbolId, renames) },
        edgeKind: v.edgeKind,
      }),
    );
  }
  return keys;
}

/**
 * The branch's violations, each marked `new` or `existing` against the base's keys. An existing violation is a
 * warning whatever its rung: only new ones keep the error a blocking rung gives. New ones come first, each group in
 * the input order.
 */
export function classifyViolations(
  violations: readonly BoundaryViolationRecord[],
  baseKeys: ReadonlySet<string>,
): BoundaryViolationRecord[] {
  const fresh: BoundaryViolationRecord[] = [];
  const existing: BoundaryViolationRecord[] = [];
  for (const v of violations) {
    if (baseKeys.has(violationKey(v))) existing.push({ ...v, severity: 'warning', baseline: 'existing' });
    else fresh.push({ ...v, baseline: 'new' });
  }
  return [...fresh, ...existing];
}
