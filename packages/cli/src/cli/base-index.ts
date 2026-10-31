import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { indexIgnorePatterns, indexIgnoreProjectPatterns, makeGlobMatcher, parseConfigText } from '../core/config/load-config.js';
import { DEFAULT_CONFIG } from '../core/config/config-schema.js';
import { resolveWorkspaceRoots, selectIndexFiles } from '../core/indexing/index-file-selection.js';
import { ContentHasher } from '../core/staleness/content-hasher.js';
import { createLogger } from '../core/logger.js';
import type { EdgeQuality, FileIndex } from '../core/types.js';
import type { IndexAtCommit, IndexedCommit } from '../ports/i-ctxo-module.js';
import { COMMUNITY_HISTORY_DIR, INDEX_ARTIFACT_FILES, JsonIndexReader, parseIndexEntry } from '../adapters/storage/json-index-reader.js';
import { loadPlugins } from './plugin-loader.js';
import { decodeSourceText } from './read-source.js';

/**
 * The index of another commit, for a comparison with the current one (`verify-domain --boundaries new-only`):
 * the committed `.ctxo/index` read from git (no checkout), or a fresh index built in a temporary git worktree that
 * is created and removed here. The user's working tree, git index and branch are never touched.
 */

const log = createLogger('ctxo:base-index');

/** How many reasons a stale committed index reports; the rest are counted. */
const STALE_REASON_LIMIT = 5;
/** A leftover base worktree without a live owner is swept after this long (a run that was killed). */
const LEFTOVER_AGE_MS = 10 * 60 * 1000;
/** Files compared through git's own filters, one process each, after the raw and CRLF forms did not match. */
const FILTER_LIMIT = 20;
/** How often a run refreshes its lock, so a sweep can tell it from a dead run whose pid was reused. */
const HEARTBEAT_MS = 60 * 1000;
const RESTORE_TIMEOUT_MS = 5 * 60 * 1000;
const RESTORE_PROJECT_LIMIT = 20;

/** A `git` run in `cwd`: stdout as bytes (for small outputs), or an error naming the command and git's stderr. */
function runGit(cwd: string, args: readonly string[], env?: NodeJS.ProcessEnv): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], ...(env ? { env } : {}) });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => out.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => err.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(Buffer.concat(out));
      else reject(new Error(`git ${subcommand(args)} failed: ${Buffer.concat(err).toString('utf-8').trim() || `exit ${code}`}`));
    });
  });
}

function subcommand(args: readonly string[]): string {
  let i = 0;
  while (args[i] === '-c') i += 2;
  return args[i] ?? '';
}

function assertRevision(commit: string): void {
  if (commit === '' || commit.startsWith('-') || /\s/.test(commit)) throw new Error(`invalid revision "${commit}"`);
}

/** The project directory's path inside the repository ('' at the root, else `sub/dir/`). */
async function projectPrefix(projectRoot: string): Promise<string> {
  return (await runGit(projectRoot, ['rev-parse', '--show-prefix'])).toString('utf-8').trim();
}

/**
 * Repo-relative paths of the regular files (modes 100644 and 100755) under the project directory at `commit`.
 * Symlinks and submodules are left out, as the on-disk index reader skips symlinks.
 */
async function listTree(projectRoot: string, commit: string): Promise<Tree> {
  const out = await runGit(projectRoot, ['ls-tree', '-r', '-z', '--full-name', commit, '--', '.']);
  const files = new Map<string, string>();
  for (const record of out.toString('utf-8').split('\0')) {
    const tab = record.indexOf('\t');
    if (tab < 0) continue;
    const [mode, type, oid] = record.slice(0, tab).split(' ');
    if (type === 'blob' && (mode === '100644' || mode === '100755') && oid !== undefined) files.set(record.slice(tab + 1), oid);
  }
  return files;
}

/** The regular files of a commit's tree under the project folder: repo-relative path to blob ID. */
type Tree = ReadonlyMap<string, string>;

/**
 * Streams the raw blobs of `paths` (repo-relative, in `tree`) through one `git cat-file --batch`. Each blob reaches
 * `onBlob` as it arrives and is not kept; a path missing from the tree reaches it as undefined, and so does a path with
 * a newline, which cannot be asked for. (`--batch --filters` cannot be streamed: git prints the unfiltered size in
 * the header and the filtered content after it, so `filteredBlob` reads a converted blob one at a time.)
 */
export function streamBlobs(
  projectRoot: string,
  tree: Tree,
  paths: readonly string[],
  onBlob: (path: string, bytes: Buffer | undefined) => void,
): Promise<void> {
  const askable = (path: string): boolean => !path.includes('\n') && tree.has(path);
  const wanted = paths.filter(askable);
  for (const path of paths) if (!askable(path)) onBlob(path, undefined);
  if (wanted.length === 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['cat-file', '--batch'], { cwd: projectRoot, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const err: Buffer[] = [];
    let next = 0;
    let header: Buffer[] = [];
    let body: Buffer[] | undefined;
    let need = 0;
    let isBlob = true;
    let failed: Error | undefined;
    const deliver = (bytes: Buffer | undefined): void => {
      const path = wanted[next++]!;
      try {
        onBlob(path, bytes);
      } catch (e) {
        failed ??= e as Error;
      }
    };
    child.stdout.on('data', (chunk: Buffer) => {
      let pos = 0;
      while (pos < chunk.length) {
        if (body !== undefined) {
          const take = Math.min(need, chunk.length - pos);
          body.push(chunk.subarray(pos, pos + take));
          need -= take;
          pos += take;
          if (need === 0) {
            // The blob and its trailing newline are in: drop the newline.
            const all = Buffer.concat(body);
            body = undefined;
            deliver(isBlob ? all.subarray(0, all.length - 1) : undefined);
          }
          continue;
        }
        const newline = chunk.indexOf(0x0a, pos);
        if (newline < 0) {
          header.push(chunk.subarray(pos));
          break;
        }
        header.push(chunk.subarray(pos, newline));
        pos = newline + 1;
        const line = Buffer.concat(header).toString('utf-8');
        header = [];
        const parts = line.split(' ');
        if (parts.length < 3 || parts[1] === 'missing' || parts[1] === 'ambiguous') {
          deliver(undefined);
          continue;
        }
        const size = Number(parts[2]);
        if (!Number.isFinite(size)) {
          failed ??= new Error(`git cat-file: unexpected header "${line}"`);
          deliver(undefined);
          continue;
        }
        // A tree or another non-blob object is read past and reported missing.
        isBlob = parts[1] === 'blob';
        need = size + 1;
        body = [];
      }
    });
    child.stderr.on('data', (chunk: Buffer) => err.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) reject(new Error(`git cat-file failed: ${Buffer.concat(err).toString('utf-8').trim() || `exit ${code}`}`));
      else if (failed !== undefined) reject(failed);
      else {
        while (next < wanted.length) deliver(undefined);
        resolve();
      }
    });
    child.stdin.on('error', () => undefined);
    child.stdin.end(wanted.map((path) => `${tree.get(path)!}\n`).join(''));
  });
}

/** A blob converted by git's own checkout filters for `path` on this machine (end of line, smudge filters). */
function filteredBlob(projectRoot: string, tree: Tree, path: string): Promise<Buffer> {
  return runGit(projectRoot, ['cat-file', '--filters', `--path=${path}`, tree.get(path)!]);
}

/** The CRLF form of a text (every LF not already after a CR), as `core.autocrlf=true` or `eol=crlf` checks it out. */
function withCrlf(text: string): string {
  return text.replace(/\r?\n/g, '\r\n');
}

function isIndexJson(relativeToIndex: string): boolean {
  if (!relativeToIndex.endsWith('.json')) return false;
  const parts = relativeToIndex.split('/');
  if (parts.includes(COMMUNITY_HISTORY_DIR)) return false;
  return !INDEX_ARTIFACT_FILES.includes(parts[parts.length - 1]!);
}

/** The project-relative folders of a list of project-relative files, with their direct subfolder names. */
function folderView(files: readonly string[]): { subdirectories(dir: string): string[]; directoryExists(dir: string): boolean } {
  const children = new Map<string, Set<string>>();
  for (const file of files) {
    const parts = file.split('/');
    for (let depth = 0; depth < parts.length - 1; depth++) {
      const parent = parts.slice(0, depth).join('/');
      let set = children.get(parent);
      if (set === undefined) children.set(parent, (set = new Set()));
      set.add(parts[depth]!);
    }
  }
  return {
    subdirectories: (dir) => [...(children.get(dir) ?? [])].sort(),
    directoryExists: (dir) => dir === '' || children.has(dir),
  };
}

/** The extensions the installed language plugins handle (lower case), from their manifests; no plugin is initialised. */
async function pluginExtensions(projectRoot: string, ignoreProjects: string[]): Promise<Set<string>> {
  const loaded = await loadPlugins(projectRoot, { ignoreProjects });
  return new Set(loaded.flatMap(({ plugin }) => plugin.extensions.map((ext) => ext.toLowerCase())));
}

/**
 * The committed `.ctxo/index` held by `indexCommit` (default `commit`), checked against the tree of `commit`, read
 * from git without a checkout; undefined when `indexCommit` holds no index entry. `current` says whether it describes
 * `commit`:
 *
 * - the files it covers are exactly the files a full `ctxo index` of `commit` selects: the same workspace roots
 *   (`package.json` workspaces at `commit`, `index.ignoreProjects`), `index.ignore` (the config at `commit`) and the
 *   extensions of the installed plugins (`core/indexing/index-file-selection.ts`, shared with the indexer), and
 * - every entry has a content hash equal to the hash of its file at `commit`, read through git's checkout filters.
 *
 * Reading the index of a later commit covers the post-commit hook, which commits the index of a commit with the next
 * one: that index is accepted for `commit` exactly when it passes the same check against `commit`'s tree.
 */
export async function readIndexAtCommit(
  projectRoot: string,
  commit: string,
  options: { readonly indexCommit?: string } = {},
): Promise<IndexAtCommit | undefined> {
  assertRevision(commit);
  const indexCommit = options.indexCommit ?? commit;
  assertRevision(indexCommit);
  const prefix = await projectPrefix(projectRoot);
  const indexPrefix = `${prefix}.ctxo/index/`;
  const indexTree = await listTree(projectRoot, indexCommit);
  const jsonPaths = [...indexTree.keys()].filter((path) => path.startsWith(indexPrefix) && isIndexJson(path.slice(indexPrefix.length)));
  if (jsonPaths.length === 0) return undefined;

  const indices: FileIndex[] = [];
  await streamBlobs(projectRoot, indexTree, jsonPaths, (path, blob) => {
    if (blob === undefined) return;
    const entry = parseIndexEntry(blob.toString('utf-8'), `${indexCommit.slice(0, 7)}:${path}`);
    if (entry !== undefined) indices.push(entry);
  });
  if (indices.length === 0) return undefined;

  const reasons: string[] = [];
  let staleCount = 0;
  const stale = (reason: string): void => {
    staleCount++;
    if (reasons.length < STALE_REASON_LIMIT) reasons.push(reason);
  };

  // The selection a full `ctxo index` of `commit` makes, from the tree and the config of `commit`.
  const tree = indexCommit === commit ? indexTree : await listTree(projectRoot, commit);
  const projectFiles = [...tree.keys()].filter((path) => path.startsWith(prefix)).map((path) => path.slice(prefix.length));
  const configPath = '.ctxo/config.yaml';
  let config = DEFAULT_CONFIG;
  if (projectFiles.includes(configPath)) {
    await streamBlobs(projectRoot, tree, [`${prefix}${configPath}`], (_path, blob) => {
      if (blob !== undefined) config = parseConfigText(blob.toString('utf-8'), `${commit.slice(0, 7)}:${configPath}`).config;
    });
  }
  let packageJson: string | undefined;
  if (projectFiles.includes('package.json')) {
    await streamBlobs(projectRoot, tree, [`${prefix}package.json`], (_path, blob) => {
      packageJson = blob?.toString('utf-8');
    });
  }
  const sources = projectFiles.filter((path) => !path.startsWith('.ctxo/'));
  const view = folderView(sources);
  const roots = resolveWorkspaceRoots({ packageJson, ...view }, makeGlobMatcher(indexIgnoreProjectPatterns(config)));
  const extensions = await pluginExtensions(projectRoot, indexIgnoreProjectPatterns(config));
  const selected = new Set(
    selectIndexFiles(sources, roots.kept, (ext) => extensions.has(ext), makeGlobMatcher(indexIgnorePatterns(config))),
  );

  const byFile = new Map<string, FileIndex>();
  for (const index of indices) byFile.set(index.file, index);
  for (const path of selected) if (!byFile.has(path)) stale(`${path}: not indexed`);
  for (const index of indices) {
    if (!selected.has(index.file)) stale(`${index.file}: not a file ctxo index selects at ${commit.slice(0, 7)}`);
    else if (index.contentHash === undefined) stale(`${index.file}: the entry has no content hash`);
  }

  // Hash each selected file as it streams in; no blob is kept. A file hashes equal when its raw blob or the blob's
  // CRLF form (a core.autocrlf or eol=crlf checkout) matches; any other file goes through git's own checkout filters
  // (smudge filters, other eol settings), one at a time and at most FILTER_LIMIT of them.
  const hasher = new ContentHasher();
  const toHash = [...selected].filter((path) => byFile.get(path)?.contentHash !== undefined);
  const unmatched: string[] = [];
  await streamBlobs(projectRoot, tree, toHash.map((path) => `${prefix}${path}`), (path, blob) => {
    const file = path.slice(prefix.length);
    const expected = byFile.get(file)!.contentHash;
    if (blob === undefined) {
      stale(`${file}: not in the commit`);
      return;
    }
    const text = decodeSourceText(blob);
    if (hasher.hash(text) === expected) return;
    if (text.includes('\n') && hasher.hash(withCrlf(text)) === expected) return;
    unmatched.push(path);
  });
  for (const [i, path] of unmatched.entries()) {
    const file = path.slice(prefix.length);
    if (i >= FILTER_LIMIT) {
      stale(`${file}: content hash differs`);
      continue;
    }
    const filtered = await filteredBlob(projectRoot, tree, path).catch(() => undefined);
    if (filtered === undefined || hasher.hash(decodeSourceText(filtered)) !== byFile.get(file)!.contentHash) {
      stale(`${file}: content hash differs`);
    }
  }

  if (staleCount > reasons.length) reasons.push(`and ${staleCount - reasons.length} more`);
  return { indices, current: staleCount === 0, staleReasons: reasons };
}

const QUALITY_RANK: Record<EdgeQuality, number> = { 'syntax-only': 0, mixed: 1, full: 2 };

/** `edgeQuality` of the project's own `communities.json` (HEAD's index), or undefined. */
function headEdgeQuality(projectRoot: string): EdgeQuality | undefined {
  try {
    const value = (JSON.parse(readFileSync(join(projectRoot, '.ctxo', 'index', 'communities.json'), 'utf-8')) as { edgeQuality?: unknown }).edgeQuality;
    return typeof value === 'string' && value in QUALITY_RANK ? (value as EdgeQuality) : undefined;
  } catch {
    return undefined;
  }
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** What a run's `<dir>.lock` holds: its pid, a random run ID and when it started. */
interface RunLock {
  readonly pid: number;
  readonly runId: string;
  readonly startedAt: number;
}

function readLock(path: string): RunLock | undefined {
  try {
    const data = JSON.parse(readFileSync(path, 'utf-8')) as Partial<RunLock>;
    if (typeof data.pid !== 'number' || typeof data.runId !== 'string' || typeof data.startedAt !== 'number') return undefined;
    return data as RunLock;
  } catch {
    return undefined;
  }
}

/**
 * Whether the run that owns a lock is still running. The owner refreshes the lock's modification time every
 * `HEARTBEAT_MS`; a lock is live while its pid runs and the heartbeat is younger than `LEFTOVER_AGE_MS`, so a pid the
 * system reused for an unrelated process does not keep a dead run's leftover forever. An unreadable lock counts as
 * live until it is older than `LEFTOVER_AGE_MS` (a run that is still writing it).
 */
export function lockIsLive(path: string, now = Date.now()): boolean {
  let mtime: number;
  try {
    mtime = statSync(path).mtimeMs;
  } catch {
    return false;
  }
  if (now - mtime > LEFTOVER_AGE_MS) return false;
  const lock = readLock(path);
  return lock === undefined ? true : pidAlive(lock.pid);
}

/** Removes a base worktree folder and its registration synchronously (signal handlers, the sweep). */
function removeWorktreeSync(projectRoot: string, dir: string): void {
  spawnSync('git', ['worktree', 'remove', '--force', '--force', dir], { cwd: projectRoot, windowsHide: true, stdio: 'ignore' });
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  } catch (err) {
    log.warn(`Cannot delete ${dir}: ${(err as Error).message}`);
  }
}

/** Deletes a run's own lock, never one another run took over (the run ID decides). */
function releaseLock(path: string, runId: string): void {
  if (readLock(path)?.runId === runId) rmSync(path, { force: true });
}

/**
 * Removes the base worktrees a killed run left. A folder is a leftover when its lock is not live (`lockIsLive`: the
 * pid is gone or the heartbeat stopped), or when it has no lock and is older than `LEFTOVER_AGE_MS` (a run always takes
 * its lock before it makes its folder). A lock without a folder is deleted only when it is not live either, so a run
 * between taking its lock and adding its worktree keeps both. Then `git worktree prune`.
 */
export function sweepLeftoverWorktrees(projectRoot: string, parent: string, now = Date.now()): string[] {
  if (!existsSync(parent)) return [];
  const removed: string[] = [];
  for (const entry of readdirSync(parent, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = join(parent, entry.name);
    const lock = `${dir}.lock`;
    const leftover = existsSync(lock) ? !lockIsLive(lock, now) : now - statSync(dir).mtimeMs > LEFTOVER_AGE_MS;
    if (!leftover) continue;
    removeWorktreeSync(projectRoot, dir);
    if (existsSync(lock) && !lockIsLive(lock, now)) rmSync(lock, { force: true });
    removed.push(entry.name);
  }
  for (const entry of readdirSync(parent, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.lock')) continue;
    const lock = join(parent, entry.name);
    if (!existsSync(lock.slice(0, -'.lock'.length)) && !lockIsLive(lock, now)) rmSync(lock, { force: true });
  }
  if (removed.length > 0) {
    spawnSync('git', ['worktree', 'prune'], { cwd: projectRoot, windowsHide: true, stdio: 'ignore' });
    log.warn(`Removed ${removed.length} leftover base worktree(s) of an interrupted run: ${removed.join(', ')}`);
  }
  return removed;
}

/** The child processes of the current base runs, killed by the signal handlers. */
const runningChildren = new Set<ChildProcess>();

/** One `dotnet` run, asynchronous so a signal handler can run (and kill it) meanwhile. */
function runDotnet(args: readonly string[], cwd: string): Promise<{ readonly code: number | null; readonly output: string }> {
  return new Promise((resolve) => {
    let child: ChildProcess;
    try {
      child = spawn('dotnet', args, { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      resolve({ code: null, output: (err as Error).message });
      return;
    }
    runningChildren.add(child);
    const out: Buffer[] = [];
    child.stdout?.on('data', (chunk: Buffer) => out.push(chunk));
    child.stderr?.on('data', (chunk: Buffer) => out.push(chunk));
    const timer = setTimeout(() => child.kill(), RESTORE_TIMEOUT_MS);
    timer.unref();
    const done = (code: number | null, extra = ''): void => {
      clearTimeout(timer);
      runningChildren.delete(child);
      resolve({ code, output: `${Buffer.concat(out).toString('utf-8')}${extra}` });
    };
    child.on('error', (err) => done(null, err.message));
    child.on('close', (code) => done(code));
  });
}

/**
 * `dotnet restore` in the base worktree for the C# projects that are restored at HEAD (an `obj/project.assets.json`
 * next to the `.csproj` in the project), so the base is analysed at the tier HEAD was: the one `.sln` at the project
 * root when there is exactly one, else each restored project (at most `RESTORE_PROJECT_LIMIT`). Asynchronous, one at a
 * time. Cheap with a warm NuGet cache; skipped without restored projects or without `dotnet`. Returns warnings.
 */
export async function restoreCSharp(projectRoot: string, project: string, files: readonly string[]): Promise<string[]> {
  const restored = files.filter(
    (file) => file.toLowerCase().endsWith('.csproj') && existsSync(join(projectRoot, posix.dirname(file), 'obj', 'project.assets.json')),
  );
  if (restored.length === 0) return [];
  if ((await runDotnet(['--version'], projectRoot)).code !== 0) {
    return ['HEAD\'s C# projects are restored, but "dotnet" is not on PATH here, so the base worktree is not restored'];
  }
  const solutions = files.filter((file) => !file.includes('/') && file.toLowerCase().endsWith('.sln'));
  const targets = solutions.length === 1 ? solutions : restored.slice(0, RESTORE_PROJECT_LIMIT);
  const warnings: string[] = [];
  for (const target of targets) {
    const result = await runDotnet(['restore', join(project, target)], project);
    if (result.code !== 0) warnings.push(`dotnet restore ${target} failed in the base worktree: ${result.output.trim().split('\n')[0] ?? ''}`);
  }
  if (solutions.length !== 1 && restored.length > RESTORE_PROJECT_LIMIT) {
    warnings.push(`only the first ${RESTORE_PROJECT_LIMIT} of ${restored.length} restored C# projects were restored in the base worktree`);
  }
  return warnings;
}

/**
 * Indexes `commit` in a temporary git worktree and returns its index (`ctxo index --skip-history --skip-community`,
 * no module pass), the tiers it ran at and warnings. The worktree lives under
 * `<projectRoot>/.ctxo/.cache/base-worktrees/`, so the language plugins resolve from the project's own `node_modules`;
 * it is detached (no branch), checked out with no hooks, no LFS smudge and long paths on, and removed whether the run
 * succeeds, fails or is interrupted (SIGINT, SIGTERM; a running `dotnet restore` is killed first). The run takes its
 * lock atomically before it adds the worktree and keeps a heartbeat on it, so a concurrent sweep never removes it, and
 * the next run sweeps what a run killed harder left. C# projects restored at HEAD are restored in the worktree too. A
 * warning says when the base index has a lower edge quality than HEAD's `communities.json`. Throws when git or the
 * index fails.
 */
export async function indexCommitInWorktree(projectRoot: string, commit: string): Promise<IndexedCommit> {
  assertRevision(commit);
  const prefix = await projectPrefix(projectRoot);
  const parent = join(projectRoot, '.ctxo', '.cache', 'base-worktrees');
  mkdirSync(parent, { recursive: true });
  sweepLeftoverWorktrees(projectRoot, parent);
  const runId = randomBytes(8).toString('hex');
  const dir = join(parent, `${commit.slice(0, 8)}-${runId.slice(0, 6)}`);
  const lockPath = `${dir}.lock`;
  const lock: RunLock = { pid: process.pid, runId, startedAt: Date.now() };
  // 'wx': the lock is created, never taken over; a name clash fails here, before anything is made.
  writeFileSync(lockPath, JSON.stringify(lock), { encoding: 'utf-8', flag: 'wx' });
  const heartbeat = setInterval(() => {
    try {
      const at = new Date();
      utimesSync(lockPath, at, at);
    } catch {
      // The lock is gone (a signal handler's cleanup): nothing to refresh.
    }
  }, HEARTBEAT_MS);
  heartbeat.unref();

  const onSignal = (signal: NodeJS.Signals): void => {
    clearInterval(heartbeat);
    for (const child of runningChildren) child.kill();
    removeWorktreeSync(projectRoot, dir);
    releaseLock(lockPath, runId);
    spawnSync('git', ['worktree', 'prune'], { cwd: projectRoot, windowsHide: true, stdio: 'ignore' });
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
    process.kill(process.pid, signal);
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  try {
    // The hooks path is the (hook-free) parent folder: no post-checkout hook of the user's runs for this worktree.
    await runGit(
      projectRoot,
      ['-c', `core.hooksPath=${parent}`, '-c', 'core.longpaths=true', 'worktree', 'add', '--detach', '--quiet', dir, commit],
      { ...process.env, GIT_LFS_SKIP_SMUDGE: '1' },
    );
    const project = prefix === '' ? dir : join(dir, ...prefix.split('/').filter((part) => part !== ''));
    const files = [...(await listTree(projectRoot, commit)).keys()].filter((path) => path.startsWith(prefix)).map((path) => path.slice(prefix.length));
    const warnings = await restoreCSharp(projectRoot, project, files);

    const { IndexCommand } = await import('./index-command.js');
    const command = new IndexCommand(project);
    await command.run({ skipHistory: true, skipCommunity: true, skipSideEffects: true });
    const indices = new JsonIndexReader(join(project, '.ctxo')).readAll();
    if (indices.length === 0) throw new Error('the index of the base is empty (no language plugin indexed a file)');

    const tiers = command.lastRunTiers ?? {};
    const edgeQuality = command.lastRunEdgeQuality;
    const head = headEdgeQuality(projectRoot);
    if (edgeQuality !== undefined && head !== undefined && QUALITY_RANK[edgeQuality] < QUALITY_RANK[head]) {
      const lower = Object.entries(tiers).filter(([, tier]) => tier === 'syntax').map(([language]) => language);
      warnings.push(
        `the base was indexed at edge quality "${edgeQuality}"${lower.length > 0 ? ` (${lower.join(', ')} on the syntax tier)` : ''}, HEAD's index at "${head}": ` +
          'violations the base has may be reported as new. For C#, install the .NET SDK 8+ and restore the solution ' +
          '("dotnet restore"; ctxo then restores the base worktree too); for Go, Go 1.22+; for Java, JRE 11+ with "ctxo install java --full-tier". ' +
          'Or commit a current .ctxo/index on the base branch, which ctxo reads instead.',
      );
    }
    return { indices, tiers, ...(edgeQuality !== undefined ? { edgeQuality } : {}), warnings };
  } finally {
    clearInterval(heartbeat);
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
    await removeWorktree(projectRoot, dir);
    releaseLock(lockPath, runId);
  }
}

async function removeWorktree(projectRoot: string, dir: string): Promise<void> {
  try {
    await runGit(projectRoot, ['worktree', 'remove', '--force', dir]);
    return;
  } catch (err) {
    if (!existsSync(dir)) {
      // `worktree add` failed before it made the folder: nothing to remove, maybe a registration to prune.
      await runGit(projectRoot, ['worktree', 'prune']).catch(() => undefined);
      return;
    }
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
