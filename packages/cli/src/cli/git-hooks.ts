import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';

/* ------------------------------------------------------------------ */
/*  ctxo git hook blocks                                               */
/*                                                                     */
/*  Pure helpers shared by `ctxo init`, `ctxo doctor --fix` and the    */
/*  `git_hooks` doctor check. No prompt or install modules in here.    */
/* ------------------------------------------------------------------ */

const CTXO_START = '# ctxo-start';
const CTXO_END = '# ctxo-end';

/**
 * Version of the post-commit block this build writes. The marker line carries it (`# ctxo-start v2`)
 * so a newer build can tell an outdated block from a current one and replace it in place.
 * Blocks written before versioning have a bare `# ctxo-start` and count as version 1.
 */
export const POST_COMMIT_HOOK_VERSION = 2;

// The block text is LF-only whatever the line endings of this source file. Template literals
// normalise CRLF as well; the explicit join just makes that obvious.
//
// Both blocks are guarded on a `.ctxo` directory: git runs hooks from the work-tree root, so the
// relative test only passes in a repository that uses ctxo. That keeps a block pasted into a hooks
// directory shared by many repositories harmless everywhere else.
export const POST_COMMIT_CONTENT = [
  `${CTXO_START} v${POST_COMMIT_HOOK_VERSION}`,
  '# Incremental re-index of the files changed by this commit (one run per commit)',
  'if [ -d .ctxo ] && command -v ctxo >/dev/null 2>&1; then',
  '  ctxo index --commit HEAD >/dev/null 2>&1 || true',
  'fi',
  CTXO_END,
].join('\n');

export const POST_MERGE_CONTENT = [
  CTXO_START,
  '# Rebuild SQLite cache after merge (index updated via git pull)',
  'if [ -d .ctxo ] && command -v ctxo >/dev/null 2>&1; then',
  '  ctxo sync 2>/dev/null || true',
  'fi',
  CTXO_END,
].join('\n');

/**
 * One complete ctxo block: a `# ctxo-start` line (optionally `vN`) through the next `# ctxo-end`
 * line. The body may not contain another start line, so a dangling start marker without an end can
 * never swallow the user lines up to a later, complete block. Marker lines are matched whole
 * (`# ctxo-end-of-my-section` is not an end marker). Global, so `matchAll` finds every block.
 */
const START_LINE = `${CTXO_START}(?:[ \\t]+v\\d+)?[ \\t]*$`;
const CTXO_BLOCK_PATTERN = new RegExp(
  `^${START_LINE}\\r?\\n(?:(?!^${START_LINE})[\\s\\S])*?^${CTXO_END}[ \\t]*$`,
  'gm',
);

const CTXO_BLOCK_VERSION_PATTERN = new RegExp(`^${CTXO_START}(?:[ \\t]+v(\\d+))?`);

interface CtxoBlockSpan {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

function findCtxoBlocks(content: string): CtxoBlockSpan[] {
  return [...content.matchAll(CTXO_BLOCK_PATTERN)].map((match) => ({
    start: match.index,
    end: match.index + match[0].length,
    text: match[0],
  }));
}

/**
 * Versions of every complete ctxo block in a hook file, in file order: 1 for an unversioned
 * block, N for `# ctxo-start vN`. Empty when the file holds no complete block.
 */
export function readCtxoBlockVersions(hookContent: string): number[] {
  return findCtxoBlocks(hookContent).map((block) => {
    const versionMatch = CTXO_BLOCK_VERSION_PATTERN.exec(block.text);
    return versionMatch?.[1] ? Number(versionMatch[1]) : 1;
  });
}

/**
 * Puts `blockContent` into a hook file. The first existing ctxo block (unversioned v1 included) is
 * replaced where it stands, so the lines before and after it survive byte for byte. Any further
 * complete ctxo block is removed (with its line break): replacing each one by the new block would
 * leave the hook running ctxo once per copy. Without a block, the new one is appended.
 */
export function upsertCtxoBlock(existing: string, blockContent: string): string {
  const [first, ...duplicates] = findCtxoBlocks(existing);
  if (!first) {
    return existing.endsWith('\n')
      ? existing + '\n' + blockContent + '\n'
      : existing + '\n\n' + blockContent + '\n';
  }

  // Back to front: every offset is taken from `existing`, and removing a later block never moves an earlier one.
  let result = existing;
  for (const block of duplicates.reverse()) {
    const lineBreak = existing.startsWith('\r\n', block.end) ? 2 : existing.startsWith('\n', block.end) ? 1 : 0;
    result = result.slice(0, block.start) + result.slice(block.end + lineBreak);
  }
  return result.slice(0, first.start) + blockContent + result.slice(first.end);
}

/* ------------------------------------------------------------------ */
/*  Hooks directory                                                    */
/* ------------------------------------------------------------------ */

/**
 * The directory git runs hooks from: `git rev-parse --git-path hooks`, so `core.hooksPath` and
 * linked worktrees resolve the way git itself resolves them. Git may answer relative to its cwd,
 * which is the project root, so a relative answer is resolved against it. Falls back to
 * `<projectRoot>/.git/hooks` whenever git cannot answer.
 */
export function resolveHooksDir(projectRoot: string): string {
  const fallback = join(projectRoot, '.git', 'hooks');
  try {
    const answer = execFileSync('git', ['rev-parse', '--git-path', 'hooks'], {
      cwd: projectRoot,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return answer ? resolve(projectRoot, answer) : fallback;
  } catch {
    return fallback;
  }
}

/** Where git config scopes sit relative to one repository: only these two are shared with other repositories. */
export type SharedHooksScope = 'global' | 'system';

/**
 * Set when the effective `core.hooksPath` comes from the user's global or the system git config
 * (`git config --show-scope --get core.hooksPath`, run in the project root). Such a directory is
 * shared by every repository on the machine, so ctxo must not write into it. A local or worktree
 * `core.hooksPath` (or none at all) gives `undefined`, as does git being unable to answer.
 */
export function sharedHooksScope(projectRoot: string): SharedHooksScope | undefined {
  try {
    const answer = execFileSync('git', ['config', '--show-scope', '--get', 'core.hooksPath'], {
      cwd: projectRoot,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    const scope = answer.split('\t')[0];
    return scope === 'global' || scope === 'system' ? scope : undefined;
  } catch {
    return undefined;
  }
}

/** Forward slashes for messages, so a Windows path reads (and compares) the same as a POSIX one. */
export function forwardSlashes(path: string): string {
  return path.replace(/\\/g, '/');
}

/**
 * What `ctxo init` and `ctxo doctor --fix` print instead of installing into a shared hooks
 * directory: why, and the two blocks to add by hand.
 */
export function sharedHooksWarning(hooksDir: string, scope: SharedHooksScope): string {
  const dir = forwardSlashes(hooksDir);
  return [
    `[ctxo] Skipped git hooks: core.hooksPath in your ${scope} git config points at ${dir}.`,
    '[ctxo] That hooks directory is shared by every repository on this machine, so ctxo does not write into it.',
    `[ctxo] To keep the index current anyway, add these blocks by hand to ${dir}/post-commit and ${dir}/post-merge`,
    '[ctxo] (each one only acts in a repository that has a .ctxo directory), or give this repository its own',
    '[ctxo] hooks path with "git config --local core.hooksPath <dir>" and run "ctxo init" again.',
    '',
    `--- ${dir}/post-commit ---`,
    POST_COMMIT_CONTENT,
    '',
    `--- ${dir}/post-merge ---`,
    POST_MERGE_CONTENT,
    '',
  ].join('\n');
}
