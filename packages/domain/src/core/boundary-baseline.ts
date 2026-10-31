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
 *
 * Identity is per symbol pair and edge kind, not per call site: a second call from the same symbol to the same
 * target is not a new violation, while an `imports` and a `calls` edge between the same symbols are two.
 */

const SEPARATOR = '\u0000';

export function violationKey(violation: Pick<BoundaryViolationRecord, 'from' | 'to' | 'edgeKind'>): string {
  return [violation.from.context, violation.to.context, violation.from.symbolId, violation.edgeKind, violation.to.symbolId].join(SEPARATOR);
}

/**
 * The renames of the branch, base path to head path, project-relative: the renames (git `R`) of the non-merge
 * commits of `base..HEAD`, composed oldest first, so `a -> b` then `b -> c` maps `a` to `c`. `prefix` is the project
 * directory inside the repository (`sub/dir/` or ''); a rename outside it is left out. A path renamed and then
 * renamed back maps to itself and is dropped. When in doubt a path is not a base path's successor: a file the branch
 * added (or copied), and a file at a base path that had already moved or been deleted, start no chain, so a base
 * file `A` renamed to `B` keeps mapping to `B` when a new `A` is later renamed to `C`. A deleted base path maps to
 * `GONE`.
 */
export function branchRenames(commits: readonly RangeCommit[], prefix = ''): ReadonlyMap<string, string> {
  const strip = (path: string): string | undefined => (path.startsWith(prefix) ? path.slice(prefix.length) : undefined);
  // origin (base path) -> current path, and current path -> origin, kept in step.
  const current = new Map<string, string>();
  const origin = new Map<string, string>();
  // Paths the branch created (added, copied, or renamed from such a path): never a base path's successor.
  const created = new Set<string>();
  // Base paths whose file the branch deleted: they map to nothing.
  const gone = new Set<string>();
  /**
   * The base path a current path stands for, or undefined when it is a file the branch made. A path that is neither
   * tracked nor created can only be a base path still in place, unless that base path already moved or was deleted:
   * then the file at the old name is new (merge commits list no changes, so its add can be missing).
   */
  const baseOf = (path: string): string | undefined => {
    if (created.has(path)) return undefined;
    const known = origin.get(path);
    if (known !== undefined) return known;
    if (current.has(path) || gone.has(path)) return undefined;
    return path;
  };
  for (const commit of [...commits].reverse()) {
    for (const change of commit.changes) {
      const to = strip(change.path);
      const from = change.oldPath === undefined ? undefined : strip(change.oldPath);
      if (change.status === 'A' || change.status === 'C') {
        if (to !== undefined) created.add(to);
        continue;
      }
      if (change.status === 'D') {
        if (to === undefined) continue;
        const base = baseOf(to);
        created.delete(to);
        origin.delete(to);
        if (base !== undefined) {
          current.delete(base);
          gone.add(base);
        }
        continue;
      }
      if (change.status !== 'R' || change.oldPath === undefined) continue;
      if (from === undefined || to === undefined) {
        // Into or out of the project folder: the file leaves the comparison.
        if (from !== undefined) {
          const base = baseOf(from);
          if (base !== undefined) {
            current.delete(base);
            gone.add(base);
          }
          origin.delete(from);
          created.delete(from);
        }
        if (to !== undefined) created.add(to);
        continue;
      }
      const base = baseOf(from);
      origin.delete(from);
      created.delete(from);
      if (base === undefined) {
        created.add(to);
        continue;
      }
      current.set(base, to);
      origin.set(to, base);
    }
  }
  for (const [base, path] of current) if (base === path) current.delete(base);
  // A deleted base path maps to '' (`GONE`): its violations are dropped from the baseline, so a file made again at
  // that path on the branch has only new violations.
  for (const base of gone) if (!current.has(base)) current.set(base, GONE);
  return current;
}

/** The rename target of a base path the branch deleted (or moved out of the project folder). */
export const GONE = '';

/** A symbol ID with its file part rewritten through `renames`; undefined when the branch deleted its file. */
function renamed(symbolId: string, renames: ReadonlyMap<string, string>): string | undefined {
  const cut = symbolId.indexOf('::');
  if (cut < 0) return symbolId;
  const file = renames.get(symbolId.slice(0, cut));
  if (file === GONE) return undefined;
  return file === undefined ? symbolId : `${file}${symbolId.slice(cut)}`;
}

/**
 * The keys of the base's violations, their symbol IDs rewritten through the branch's renames. A violation with an end
 * in a file the branch deleted has no key: when in doubt, a violation counts as new.
 */
export function baselineKeys(base: readonly BoundaryViolationRecord[], renames: ReadonlyMap<string, string>): ReadonlySet<string> {
  const keys = new Set<string>();
  for (const v of base) {
    const from = renamed(v.from.symbolId, renames);
    const to = renamed(v.to.symbolId, renames);
    if (from === undefined || to === undefined) continue;
    keys.add(violationKey({ from: { ...v.from, symbolId: from }, to: { ...v.to, symbolId: to }, edgeKind: v.edgeKind }));
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
