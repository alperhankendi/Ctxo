import { spawnSync } from 'node:child_process';
import { simpleGit, type SimpleGit } from 'simple-git';
import type { IGitPort } from '../../ports/i-git-port.js';
import type {
  CommitRecord,
  ChurnData,
  ChangeLog,
  CommitChangeSet,
  FileChange,
  FileChangeStatus,
  GitRange,
  GitRefs,
  RangeCommit,
} from '../../core/types.js';
import { compareCodepoint } from '../../core/compare-codepoint.js';
import { createLogger } from '../../core/logger.js';

const log = createLogger('ctxo:git');

const NUL = '\x00';
const RECORD_SEPARATOR = '\x1e';
const FIELD_SEPARATOR = '\x1f';

/**
 * One record per commit: a record separator, then hash, author date (ISO), committer unix
 * time, author name and subject, joined by field separators.
 */
const CHANGE_LOG_FORMAT = '--format=%x1e%H%x1f%aI%x1f%ct%x1f%an%x1f%s';

/**
 * Config overrides that keep git's output parseable whatever the user has configured.
 * - core.quotepath=off: paths come out verbatim instead of quoted and octal-escaped.
 * - log.showSignature=false: when on, gpg verification text (CRLF on Windows) is written
 *   into the log stream ahead of each commit.
 */
const STABLE_OUTPUT_CONFIG: readonly string[] = [
  '-c', 'core.quotepath=off',
  '-c', 'log.showSignature=false',
];

function toForwardSlashes(path: string): string {
  return path.replace(/\\/g, '/');
}

function isFileChangeStatus(value: string): value is FileChangeStatus {
  return value === 'A' || value === 'M' || value === 'D' || value === 'R' || value === 'C' || value === 'T';
}

/**
 * Parses the NUL-separated tokens of `--name-status -z`: `<status> <path>`, or for renames and
 * copies `<status><score> <old path> <new path>` (for example `R100`). Only status tokens are
 * trimmed, because git puts a newline between a commit header and its first status; paths are
 * never altered beyond separator normalisation. Statuses outside FileChangeStatus (for example
 * U) are skipped, and a truncated trailing entry is dropped.
 */
function parseNameStatus(tokens: readonly string[]): FileChange[] {
  const changes: FileChange[] = [];
  let i = 0;
  while (i < tokens.length) {
    const kind = (tokens[i] ?? '').trim().charAt(0);
    if (kind === '') {
      i += 1; // terminator after the last path, or a bare newline
    } else if (kind === 'R' || kind === 'C') {
      const oldPath = tokens[i + 1];
      const path = tokens[i + 2];
      i += 3;
      if (oldPath !== undefined && path !== undefined) {
        changes.push({ status: kind, path: toForwardSlashes(path), oldPath: toForwardSlashes(oldPath) });
      }
    } else {
      const path = tokens[i + 1];
      i += 2;
      if (path !== undefined && isFileChangeStatus(kind)) {
        changes.push({ status: kind, path: toForwardSlashes(path) });
      }
    }
  }
  return changes;
}

/**
 * Parses `git ls-files -t -z`: records of `<tag> <path>`, where the tag is H for an ordinary tracked file
 * and S for a skip-worktree one (others mark unmerged, removed, modified or untracked paths). Returns the
 * paths tagged S.
 */
function parseSkipWorktree(raw: string): Set<string> {
  const paths = new Set<string>();
  for (const record of raw.split(NUL)) {
    if (record.length > 2 && record.charAt(0) === 'S' && record.charAt(1) === ' ') {
      paths.add(toForwardSlashes(record.slice(2)));
    }
  }
  return paths;
}

/** Parses `git log` output produced with CHANGE_LOG_FORMAT, `--name-status` and `-z`. */
function parseChangeLog(raw: string): CommitChangeSet[] {
  const commits: CommitChangeSet[] = [];
  for (const record of raw.split(RECORD_SEPARATOR)) {
    // "<header>\0\n<status>\0<path>\0...": the header ends at the first NUL. Text before the
    // first separator, or a record without a complete header, is skipped.
    const [header = '', ...tokens] = record.split(NUL);
    const [hash, date, time, author, ...subject] = header.split(FIELD_SEPARATOR);
    const committedAt = Number.parseInt(time ?? '', 10);
    if (!hash || date === undefined || author === undefined || Number.isNaN(committedAt)) continue;

    commits.push({
      hash,
      message: subject.join(FIELD_SEPARATOR).trim(),
      date,
      author,
      committedAt,
      changes: parseNameStatus(tokens),
    });
  }
  return commits;
}

/** One record per commit: hash, parents, subject and the requested trailer values, then the name-status tokens. */
function rangeLogFormat(trailerKey: string | undefined): string {
  const trailers = trailerKey === undefined ? '' : `%(trailers:key=${trailerKey},valueonly)`;
  return `--format=%x1e%H%x1f%P%x1f%s%x1f${trailers}%x1f`;
}

/** Parses `git log` output produced with rangeLogFormat, `--name-status` and `-z`. */
function parseRangeLog(raw: string): RangeCommit[] {
  const commits: RangeCommit[] = [];
  for (const record of raw.split(RECORD_SEPARATOR)) {
    const [header = '', ...tokens] = record.split(NUL);
    const [hash, parents, subject, trailerText] = header.split(FIELD_SEPARATOR);
    if (!hash || parents === undefined || subject === undefined) continue;

    const isMerge = parents.trim().split(' ').filter((p) => p.length > 0).length > 1;
    commits.push({
      hash,
      subject,
      isMerge,
      trailers: (trailerText ?? '').split('\n').map((t) => t.trim()).filter((t) => t.length > 0),
      changes: isMerge ? [] : parseNameStatus(tokens),
    });
  }
  return commits;
}

/**
 * Parses `git status --porcelain=v1 -z`: records of `XY <path>`, where a rename or copy in either column
 * is followed by its source path as a separate token.
 */
function parseStatus(raw: string): FileChange[] {
  const tokens = raw.split(NUL);
  const changes: FileChange[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const entry = tokens[i] ?? '';
    if (entry.length < 4) continue;
    const x = entry.charAt(0);
    const y = entry.charAt(1);
    const path = toForwardSlashes(entry.slice(3));
    if (x === 'R' || x === 'C' || y === 'R' || y === 'C') {
      const oldPath = tokens[++i];
      if (oldPath === undefined) continue;
      const status: FileChangeStatus = x === 'R' || y === 'R' ? 'R' : 'C';
      changes.push({ status, path, oldPath: toForwardSlashes(oldPath) });
    } else if (x === '?') {
      changes.push({ status: 'A', path });
    } else if (x === 'D' || y === 'D') {
      changes.push({ status: 'D', path });
    } else if (x === 'A' || y === 'A') {
      changes.push({ status: 'A', path });
    } else {
      changes.push({ status: 'M', path });
    }
  }
  return changes;
}

/** Short ref names in `for-each-ref --format=%(refname)` output, local and remote-tracking apart (codepoint order). */
function parseBranchNames(raw: string): { local: string[]; remote: string[]; all: string[] } {
  const local = new Set<string>();
  const remote = new Set<string>();
  for (const line of raw.split('\n')) {
    const ref = line.trim();
    if (ref.startsWith('refs/heads/')) {
      local.add(ref.slice('refs/heads/'.length));
    } else if (ref.startsWith('refs/remotes/') && !/^refs\/remotes\/[^/]+\/HEAD$/.test(ref)) {
      remote.add(ref.slice('refs/remotes/'.length));
    }
  }
  const sorted = (set: Set<string>): string[] => [...set].sort(compareCodepoint);
  return { local: sorted(local), remote: sorted(remote), all: sorted(new Set([...local, ...remote])) };
}

const TRAILER_KEY = /^[A-Za-z0-9][A-Za-z0-9-]*$/;

export class SimpleGitAdapter implements IGitPort {
  private readonly git: SimpleGit;
  private readonly projectRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
    this.git = simpleGit(projectRoot);
    log.debug('Initialized with root: %s', projectRoot);
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.git.version();
      return true;
    } catch {
      return false;
    }
  }

  async getCommitHistory(filePath: string, maxCount?: number): Promise<CommitRecord[]> {
    try {
      const log = await this.git.log({
        file: filePath,
        '--follow': null,
        ...(maxCount ? { maxCount } : {}),
      });

      return log.all.map((entry) => ({
        hash: entry.hash,
        message: entry.message,
        date: entry.date,
        author: entry.author_name,
      }));
    } catch (err) {
      log.error(` Failed to get history for ${filePath}: ${(err as Error).message}`);
      return [];
    }
  }

  async getChangedFiles(since: string): Promise<string[]> {
    try {
      const diff = await this.git.diffSummary([since]);
      return diff.files.map((f) => f.file.replace(/\\/g, '/'));
    } catch (err) {
      log.error(` Failed to get changed files since ${since}: ${(err as Error).message}`);
      return [];
    }
  }

  async getFileChurn(filePath: string): Promise<ChurnData> {
    try {
      const log = await this.git.log({ file: filePath, '--follow': null });

      return {
        filePath,
        commitCount: log.total,
      };
    } catch (err) {
      log.error(` Failed to get churn for ${filePath}: ${(err as Error).message}`);
      return { filePath, commitCount: 0 };
    }
  }

  async getHeadSha(): Promise<string | undefined> {
    try {
      const raw = await this.git.revparse(['--short', 'HEAD']);
      const sha = raw.trim();
      return sha.length > 0 ? sha : undefined;
    } catch (err) {
      log.error(`Failed to resolve HEAD: ${(err as Error).message}`);
      return undefined;
    }
  }

  async countCommitsBetween(base: string): Promise<number | undefined> {
    try {
      const raw = await this.git.raw(['rev-list', '--count', `${base}..HEAD`]);
      const n = parseInt(raw.trim(), 10);
      return Number.isFinite(n) && n >= 0 ? n : undefined;
    } catch (err) {
      log.error(`Failed to count commits since ${base}: ${(err as Error).message}`);
      return undefined;
    }
  }

  async getChangeLog(maxCommits: number | 'all'): Promise<ChangeLog | undefined> {
    try {
      // HEAD gets its own call because the log below skips merge commits and HEAD may be one.
      // It is read first on purpose: if a commit lands between the two calls, `head` can only
      // end up older than the log (it looks stale), never newer (it would look current while
      // missing a commit).
      const headRaw = await this.git.raw([...STABLE_OUTPUT_CONFIG, 'log', '-1', '--format=%h%x1f%ct', 'HEAD']);
      const [head, headTime] = headRaw.trim().split(FIELD_SEPARATOR);
      const headCommittedAt = Number.parseInt(headTime ?? '', 10);
      if (!head || Number.isNaN(headCommittedAt)) {
        throw new Error(`unexpected HEAD description ${JSON.stringify(headRaw)}`);
      }

      const args = [...STABLE_OUTPUT_CONFIG, 'log', '--no-merges', '-M', '--name-status', '-z', CHANGE_LOG_FORMAT];
      if (maxCommits !== 'all') args.push(`--max-count=${maxCommits}`);
      args.push('HEAD');

      return { head, headCommittedAt, commits: parseChangeLog(await this.git.raw(args)) };
    } catch (err) {
      log.error(`Failed to read change log: ${(err as Error).message}`);
      return undefined;
    }
  }

  async getSkipWorktreePaths(): Promise<ReadonlySet<string> | undefined> {
    try {
      // One listing of the index with status tags; -z keeps unusual names verbatim.
      return parseSkipWorktree(await this.git.raw([...STABLE_OUTPUT_CONFIG, 'ls-files', '-t', '-z']));
    } catch (err) {
      log.error(`Failed to list skip-worktree paths: ${(err as Error).message}`);
      return undefined;
    }
  }

  async getIgnoredPaths(paths: readonly string[]): Promise<ReadonlySet<string> | undefined> {
    if (paths.length === 0) return new Set();

    // The paths go in on stdin, NUL separated, so a long list cannot overflow the command line and unusual
    // names arrive verbatim. Exit code 0: some of them are ignored; 1: none is; anything else is a failure.
    const result = spawnSync('git', [...STABLE_OUTPUT_CONFIG, 'check-ignore', '-z', '--stdin'], {
      cwd: this.projectRoot,
      input: paths.map((path) => `${path}${NUL}`).join(''),
      encoding: 'utf-8',
      maxBuffer: 64 * 1024 * 1024,
    });
    if (result.error === undefined && result.status === 1) return new Set();
    if (result.error !== undefined || result.status !== 0) {
      const reason = (result.error?.message ?? result.stderr ?? '').replace(/\s+/g, ' ').trim();
      log.error(`Failed to check ignored paths: ${reason}`);
      return undefined;
    }
    return new Set(
      result.stdout
        .split(NUL)
        .filter((path) => path.length > 0)
        .map(toForwardSlashes),
    );
  }

  async resolveCommit(ref: string): Promise<string | undefined> {
    if (this.refuseOptionLike('resolve', [ref])) return undefined;
    try {
      const sha = (await this.git.raw([...STABLE_OUTPUT_CONFIG, 'rev-parse', '--verify', '--quiet', `${ref}^{commit}`])).trim();
      return sha.length > 0 ? sha : undefined;
    } catch (err) {
      log.debug(`Cannot resolve ${ref}: ${(err as Error).message}`);
      return undefined;
    }
  }

  async mergeBase(a: string, b: string): Promise<string | undefined> {
    if (this.refuseOptionLike('merge-base', [a, b])) return undefined;
    try {
      const sha = (await this.git.raw([...STABLE_OUTPUT_CONFIG, 'merge-base', a, b])).trim();
      return sha.length > 0 ? sha : undefined;
    } catch (err) {
      log.debug(`No merge base for ${a} and ${b}: ${(err as Error).message}`);
      return undefined;
    }
  }

  async firstParentSuccessors(base: string, head: string, limit: number): Promise<string[] | undefined> {
    if (this.refuseOptionLike('rev-list', [base, head])) return undefined;
    try {
      const out = await this.git.raw([...STABLE_OUTPUT_CONFIG, 'rev-list', '--reverse', '--first-parent', '--ancestry-path', `${base}..${head}`]);
      return out.split('\n').map((line) => line.trim()).filter((line) => line.length > 0).slice(0, Math.max(0, limit));
    } catch (err) {
      log.debug(`No first-parent successors of ${base} on ${head}: ${(err as Error).message}`);
      return undefined;
    }
  }

  async isAncestor(ancestor: string, descendant: string): Promise<boolean | undefined> {
    if (this.refuseOptionLike('is-ancestor', [ancestor, descendant])) return undefined;
    // Exit code 0: an ancestor; 1: not; anything else is a failure.
    const result = spawnSync('git', [...STABLE_OUTPUT_CONFIG, 'merge-base', '--is-ancestor', ancestor, descendant], {
      cwd: this.projectRoot,
      encoding: 'utf-8',
    });
    if (result.error === undefined && result.status === 0) return true;
    if (result.error === undefined && result.status === 1) return false;
    log.debug(`Cannot tell whether ${ancestor} is an ancestor of ${descendant}`);
    return undefined;
  }

  async getRangeLog(
    range: GitRange,
    options?: { readonly trailerKey?: string },
  ): Promise<RangeCommit[] | undefined> {
    if (this.refuseOptionLike('range log', [range.head, ...range.exclude])) return undefined;
    const trailerKey = options?.trailerKey;
    if (trailerKey !== undefined && !TRAILER_KEY.test(trailerKey)) {
      log.error(`Refusing to read trailers for invalid key ${JSON.stringify(trailerKey)}`);
      return undefined;
    }

    try {
      const raw = await this.git.raw([
        ...STABLE_OUTPUT_CONFIG,
        'log', '-M', '--name-status', '-z', rangeLogFormat(trailerKey),
        range.head, ...range.exclude.map((ref) => `^${ref}`), '--',
      ]);
      return parseRangeLog(raw);
    } catch (err) {
      log.error(`Failed to read range log of ${range.head}: ${(err as Error).message}`);
      return undefined;
    }
  }

  async getWorkingTreeChanges(scope: 'all' | 'staged'): Promise<FileChange[] | undefined> {
    try {
      if (scope === 'staged') {
        const raw = await this.git.raw([...STABLE_OUTPUT_CONFIG, 'diff', '--cached', '-M', '--name-status', '-z']);
        return parseNameStatus(raw.split(NUL));
      }
      // status.renames=true: rename detection must not depend on the user's diff.renames setting.
      const raw = await this.git.raw([...STABLE_OUTPUT_CONFIG, '-c', 'status.renames=true', 'status','--porcelain=v1', '-z', '--untracked-files=all']);
      return parseStatus(raw);
    } catch (err) {
      log.error(`Failed to read ${scope} working-tree changes: ${(err as Error).message}`);
      return undefined;
    }
  }

  async getRefs(): Promise<GitRefs | undefined> {
    let names: ReturnType<typeof parseBranchNames>;
    try {
      names = parseBranchNames(
        await this.git.raw([...STABLE_OUTPUT_CONFIG, 'for-each-ref', '--format=%(refname)', 'refs/heads', 'refs/remotes']),
      );
    } catch (err) {
      log.error(`Failed to list branches: ${(err as Error).message}`);
      return undefined;
    }

    const currentBranch = await this.tryRaw(['symbolic-ref', '--quiet', '--short', 'HEAD']);
    const upstream = await this.tryRaw(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
    const originHead = await this.tryRaw(['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']);
    return {
      ...(currentBranch !== undefined ? { currentBranch } : {}),
      ...(upstream !== undefined ? { upstream } : {}),
      ...(originHead !== undefined ? { originHead } : {}),
      branches: names.all,
      localBranches: names.local,
      remoteBranches: names.remote,
    };
  }

  async listTrackedFiles(): Promise<string[] | undefined> {
    try {
      const raw = await this.git.raw([...STABLE_OUTPUT_CONFIG, 'ls-files', '-z']);
      return raw.split(NUL).filter((path) => path.length > 0).map(toForwardSlashes);
    } catch (err) {
      log.error(`Failed to list tracked files: ${(err as Error).message}`);
      return undefined;
    }
  }

  /** Runs one git call whose failure only means "no such fact"; logged at debug, not error. */
  private async tryRaw(args: string[]): Promise<string | undefined> {
    try {
      const out = (await this.git.raw([...STABLE_OUTPUT_CONFIG, ...args])).trim();
      return out.length > 0 ? out : undefined;
    } catch (err) {
      log.debug(`git ${args[0]} unavailable: ${(err as Error).message}`);
      return undefined;
    }
  }

  /** A ref is never an option; true (and logged) when one would be parsed as such. */
  private refuseOptionLike(what: string, refs: readonly string[]): boolean {
    const bad = refs.find((ref) => ref.startsWith('-'));
    if (bad === undefined) return false;
    log.error(`Refusing ${what} for option-like ref ${bad}`);
    return true;
  }

  async getCommitFileChanges(rev: string): Promise<FileChange[] | undefined> {
    // A revision is never an option; refuse anything that git would parse as one.
    if (rev.startsWith('-')) {
      log.error(`Refusing to read file changes for option-like revision ${rev}`);
      return undefined;
    }

    try {
      const raw = await this.git.raw([
        ...STABLE_OUTPUT_CONFIG,
        'diff-tree', '--root', '--no-commit-id', '-r', '-M', '--name-status', '-z', rev,
      ]);
      return parseNameStatus(raw.split(NUL));
    } catch (err) {
      log.error(`Failed to read file changes of ${rev}: ${(err as Error).message}`);
      return undefined;
    }
  }
}
