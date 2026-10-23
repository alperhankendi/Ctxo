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
} from '../../core/types.js';
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
