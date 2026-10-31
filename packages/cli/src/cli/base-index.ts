import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, rmSync } from 'node:fs';
import { extname, join, posix } from 'node:path';
import { indexIgnorePatterns, loadConfig, makeGlobMatcher } from '../core/config/load-config.js';
import { ContentHasher } from '../core/staleness/content-hasher.js';
import { createLogger } from '../core/logger.js';
import type { FileIndex } from '../core/types.js';
import type { IndexAtCommit } from '../ports/i-ctxo-module.js';
import { COMMUNITY_HISTORY_DIR, INDEX_ARTIFACT_FILES, JsonIndexReader, parseIndexEntry } from '../adapters/storage/json-index-reader.js';
import { decodeSourceText } from './read-source.js';

/**
 * The index of another commit, for a comparison with the current one (`verify-domain --boundaries new-only`):
 * the committed `.ctxo/index` read from git at that commit (no checkout), or a fresh index built in a temporary
 * git worktree that is created and removed here. The user's working tree, git index and branch are never touched.
 */

const log = createLogger('ctxo:base-index');

/** How many reasons a stale committed index reports; the rest are counted. */
const STALE_REASON_LIMIT = 5;

/** A `git` run in `cwd`: stdout as bytes, or an error naming the command and git's stderr. */
function runGit(cwd: string, args: readonly string[], input?: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => out.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => err.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(Buffer.concat(out));
      else reject(new Error(`git ${args[0] === '-c' ? args[2] : args[0]} failed: ${Buffer.concat(err).toString('utf-8').trim() || `exit ${code}`}`));
    });
    child.stdin.on('error', () => undefined);
    child.stdin.end(input ?? '');
  });
}

function assertRevision(commit: string): void {
  if (commit === '' || commit.startsWith('-') || /\s/.test(commit)) throw new Error(`invalid revision "${commit}"`);
}

/** The project directory's path inside the repository ('' at the root, else `sub/dir/`). */
async function projectPrefix(projectRoot: string): Promise<string> {
  return (await runGit(projectRoot, ['rev-parse', '--show-prefix'])).toString('utf-8').trim();
}

/** Repo-relative paths of the blobs under the project directory at `commit`. */
async function listTree(projectRoot: string, commit: string): Promise<string[]> {
  const out = await runGit(projectRoot, ['ls-tree', '-r', '-z', '--full-name', '--name-only', commit, '--', '.']);
  return out.toString('utf-8').split('\0').filter((path) => path !== '');
}

/** The blobs at `commit` (`git cat-file --batch`), by repo-relative path; a missing path is left out. */
async function readBlobs(projectRoot: string, commit: string, paths: readonly string[]): Promise<Map<string, Buffer>> {
  const wanted = paths.filter((path) => !path.includes('\n'));
  const blobs = new Map<string, Buffer>();
  if (wanted.length === 0) return blobs;
  const out = await runGit(projectRoot, ['cat-file', '--batch'], wanted.map((path) => `${commit}:${path}\n`).join(''));
  let pos = 0;
  for (const path of wanted) {
    const newline = out.indexOf(0x0a, pos);
    if (newline < 0) break;
    const header = out.subarray(pos, newline).toString('utf-8');
    pos = newline + 1;
    if (header.endsWith(' missing') || header.endsWith(' ambiguous')) continue;
    const size = Number(header.split(' ')[2]);
    if (!Number.isFinite(size)) break;
    if (header.split(' ')[1] === 'blob') blobs.set(path, out.subarray(pos, pos + size));
    pos += size + 1;
  }
  return blobs;
}

function isIndexJson(relativeToIndex: string): boolean {
  if (!relativeToIndex.endsWith('.json')) return false;
  const parts = relativeToIndex.split('/');
  if (parts.includes(COMMUNITY_HISTORY_DIR)) return false;
  return !INDEX_ARTIFACT_FILES.includes(parts[parts.length - 1]!);
}

/**
 * The committed `.ctxo/index` of `commit`, read from git without a checkout; undefined when the commit has no
 * index entry. `current` says whether it describes that commit:
 *
 * - every entry has a content hash, and it equals the hash of its file at the commit (decoded as `ctxo index`
 *   decodes it), and
 * - no file at the commit lacks an entry when its extension is one the index holds and `index.ignore` (the
 *   current config) does not match it.
 */
export async function readIndexAtCommit(projectRoot: string, commit: string): Promise<IndexAtCommit | undefined> {
  assertRevision(commit);
  const prefix = await projectPrefix(projectRoot);
  const indexPrefix = `${prefix}.ctxo/index/`;
  const tree = await listTree(projectRoot, commit);
  const jsonPaths = tree.filter((path) => path.startsWith(indexPrefix) && isIndexJson(path.slice(indexPrefix.length)));
  if (jsonPaths.length === 0) return undefined;

  const jsonBlobs = await readBlobs(projectRoot, commit, jsonPaths);
  const indices: FileIndex[] = [];
  for (const path of jsonPaths) {
    const blob = jsonBlobs.get(path);
    if (blob === undefined) continue;
    const entry = parseIndexEntry(blob.toString('utf-8'), `${commit.slice(0, 7)}:${path}`);
    if (entry !== undefined) indices.push(entry);
  }
  if (indices.length === 0) return undefined;

  const reasons: string[] = [];
  let staleCount = 0;
  const stale = (reason: string): void => {
    staleCount++;
    if (reasons.length < STALE_REASON_LIMIT) reasons.push(reason);
  };

  const sourcePaths = tree.filter((path) => !path.startsWith(`${prefix}.ctxo/`)).map((path) => path.slice(prefix.length));
  const sourceSet = new Set(sourcePaths);
  const hashed = indices.filter((index) => index.contentHash !== undefined && sourceSet.has(index.file));
  const sourceBlobs = await readBlobs(projectRoot, commit, hashed.map((index) => `${prefix}${index.file}`));
  const hasher = new ContentHasher();
  for (const index of indices) {
    if (index.contentHash === undefined) {
      stale(`${index.file}: the entry has no content hash`);
      continue;
    }
    const blob = sourceBlobs.get(`${prefix}${index.file}`);
    if (blob === undefined) stale(`${index.file}: not in the commit`);
    else if (hasher.hash(decodeSourceText(blob)) !== index.contentHash) stale(`${index.file}: content hash differs`);
  }

  const indexed = new Set(indices.map((index) => index.file));
  const extensions = new Set(indices.map((index) => extname(index.file).toLowerCase()).filter((ext) => ext !== ''));
  const ignored = makeGlobMatcher(indexIgnorePatterns(loadConfig(join(projectRoot, '.ctxo')).config));
  for (const path of sourcePaths) {
    if (indexed.has(path) || !extensions.has(posix.extname(path).toLowerCase()) || ignored(path)) continue;
    stale(`${path}: not indexed`);
  }

  if (staleCount > reasons.length) reasons.push(`and ${staleCount - reasons.length} more`);
  return { indices, current: staleCount === 0, staleReasons: reasons };
}

/**
 * Indexes `commit` in a temporary git worktree and returns its index (`ctxo index --skip-history --skip-community`,
 * no module pass). The worktree lives under `<projectRoot>/.ctxo/.cache/base-worktrees/`, so the language plugins
 * resolve from the project's own `node_modules`; it is detached (no branch), checked out with no hooks, and removed
 * (with `git worktree prune` when the removal fails) whether the run succeeds or not. Throws when git or the index fails.
 */
export async function indexCommitInWorktree(projectRoot: string, commit: string): Promise<FileIndex[]> {
  assertRevision(commit);
  const prefix = await projectPrefix(projectRoot);
  const parent = join(projectRoot, '.ctxo', '.cache', 'base-worktrees');
  mkdirSync(parent, { recursive: true });
  const dir = join(parent, `${commit.slice(0, 8)}-${randomBytes(3).toString('hex')}`);
  // The hooks path is the (hook-free) parent folder: no post-checkout hook of the user's runs for this worktree.
  await runGit(projectRoot, ['-c', `core.hooksPath=${parent}`, 'worktree', 'add', '--detach', '--quiet', dir, commit]);
  try {
    const project = prefix === '' ? dir : join(dir, ...prefix.split('/').filter((part) => part !== ''));
    const { IndexCommand } = await import('./index-command.js');
    await new IndexCommand(project).run({ skipHistory: true, skipCommunity: true, skipSideEffects: true });
    const indices = new JsonIndexReader(join(project, '.ctxo')).readAll();
    if (indices.length === 0) throw new Error('the index of the base is empty (no language plugin indexed a file)');
    return indices;
  } finally {
    await removeWorktree(projectRoot, dir);
  }
}

async function removeWorktree(projectRoot: string, dir: string): Promise<void> {
  try {
    await runGit(projectRoot, ['worktree', 'remove', '--force', dir]);
    return;
  } catch (err) {
    log.warn(`git worktree remove failed (${(err as Error).message}); deleting ${dir}`);
  }
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch (err) {
    log.warn(`Cannot delete ${dir}: ${(err as Error).message}`);
  }
  try {
    await runGit(projectRoot, ['worktree', 'prune']);
  } catch (err) {
    log.warn(`git worktree prune failed: ${(err as Error).message}`);
  }
}
