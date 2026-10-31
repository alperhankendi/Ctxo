import { posix } from 'node:path';

/**
 * Which files a full `ctxo index` run indexes, as pure functions over a project view, so the indexer (over the
 * working tree) and the base-index check of `verify-domain --boundaries new-only` (over a commit's tree) select
 * exactly the same files. Paths are project-relative with forward slashes; '' is the project root.
 */

/** What workspace resolution reads: the root `package.json` text and the folders of the project. */
export interface WorkspaceView {
  /** The text of `<project>/package.json`, or undefined when there is none. */
  readonly packageJson: string | undefined;
  /** The names of the subfolders of a project-relative folder ('' is the root); empty when it does not exist. */
  subdirectories(dir: string): readonly string[];
  /** Whether a project-relative folder exists. */
  directoryExists(dir: string): boolean;
}

export interface WorkspaceRoots {
  /** The folders a full run discovers files in; `['']` outside a monorepo. */
  readonly kept: readonly string[];
  /** The workspace folders that `index.ignoreProjects` leaves out. */
  readonly ignored: readonly string[];
  /** True when `package.json` workspaces decided `kept`. */
  readonly monorepo: boolean;
}

const ROOT_ONLY: WorkspaceRoots = { kept: [''], ignored: [], monorepo: false };

function normalise(dir: string): string {
  const joined = posix.normalize(dir.replace(/\\/g, '/'));
  const trimmed = joined.replace(/\/+$/, '');
  return trimmed === '.' ? '' : trimmed.replace(/^\.\//, '');
}

/**
 * The workspace folders of `package.json` (`workspaces` or `workspaces.packages`): `dir/*` lists the subfolders of
 * `dir`, any other entry is a literal folder kept when it exists. Without workspaces, or when none resolves, or when
 * `ignoreProject` leaves none, the project root is the one folder. A `package.json` that does not parse counts as none.
 */
export function resolveWorkspaceRoots(view: WorkspaceView, ignoreProject: (dir: string) => boolean): WorkspaceRoots {
  if (view.packageJson === undefined) return ROOT_ONLY;
  let workspaces: unknown;
  try {
    const pkg = JSON.parse(view.packageJson) as { workspaces?: unknown };
    workspaces = Array.isArray(pkg.workspaces) ? pkg.workspaces : (pkg.workspaces as { packages?: unknown } | undefined)?.packages;
  } catch {
    return ROOT_ONLY;
  }
  if (!Array.isArray(workspaces) || workspaces.length === 0) return ROOT_ONLY;

  const resolved: string[] = [];
  for (const ws of workspaces) {
    if (typeof ws !== 'string') continue;
    if (ws.endsWith('/*') || ws.endsWith('\\*')) {
      const parent = normalise(ws.slice(0, -2));
      for (const name of view.subdirectories(parent)) resolved.push(parent === '' ? name : `${parent}/${name}`);
    } else {
      const dir = normalise(ws);
      if (view.directoryExists(dir)) resolved.push(dir);
    }
  }
  if (resolved.length === 0) return ROOT_ONLY;

  const ignored: string[] = [];
  const kept = resolved.filter((dir) => {
    if (ignoreProject(dir)) {
      ignored.push(dir);
      return false;
    }
    return true;
  });
  if (kept.length === 0) return { kept: [''], ignored, monorepo: false };
  return { kept, ignored, monorepo: true };
}

/**
 * The files of `paths` a full run indexes: inside a kept workspace folder, with an extension a loaded plugin
 * handles (compared in lower case), and not matched by `index.ignore`. Codepoint order, no duplicates.
 */
export function selectIndexFiles(
  paths: Iterable<string>,
  kept: readonly string[],
  isSupportedExtension: (ext: string) => boolean,
  ignoreFile: (path: string) => boolean,
): string[] {
  const inside = (path: string): boolean => kept.some((dir) => dir === '' || path.startsWith(`${dir}/`));
  const selected = new Set<string>();
  for (const path of paths) {
    if (!inside(path) || !isSupportedExtension(posix.extname(path).toLowerCase()) || ignoreFile(path)) continue;
    selected.add(path);
  }
  return [...selected].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}
