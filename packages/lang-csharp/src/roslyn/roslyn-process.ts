import { spawn, type ChildProcess } from 'node:child_process';
import { createLogger } from '../logger.js';

const log = createLogger('ctxo:roslyn');

export interface RoslynFileResult {
  type: 'file';
  file: string;
  symbols: RoslynSymbol[];
  edges: RoslynEdge[];
  complexity: RoslynComplexity[];
}

export interface RoslynSymbol {
  symbolId: string;
  name: string;
  kind: string;
  startLine: number;
  endLine: number;
  startOffset?: number;
  endOffset?: number;
  /** Attribute annotations; absent when the declaration has none. */
  annotations?: RoslynAnnotation[];
}

/** One attribute as the helper reports it (shape of the protocol v2 SymbolAnnotation). */
export interface RoslynAnnotation {
  name: string;
  args?: string[];
  named?: Record<string, string>;
}

export interface RoslynEdge {
  from: string;
  to: string;
  kind: string;
}

export interface RoslynComplexity {
  symbolId: string;
  cyclomatic: number;
  cognitive: number;
}

export interface RoslynProjectGraph {
  type: 'projectGraph';
  projects: Array<{ name: string; path: string }>;
  edges: Array<{ from: string; to: string; kind: string }>;
}

/** SQL texts at known C# call sites, from the helper's `done` line (`--sql-call-sites` only). */
export interface RoslynSqlStats {
  constant: number;
  nonConstant: number;
  unparsable: number;
}

export interface RoslynRunOptions {
  /** Emit reads, writes and executes edges for SQL text at known call sites (`--sql-call-sites`). */
  readonly sqlCallSites?: boolean;
  /** Batch: kill the run after this many ms (default 120_000). Keep-alive: shut down after this much inactivity (default 300_000). */
  readonly timeoutMs?: number;
}

export interface RoslynBatchResult {
  files: RoslynFileResult[];
  projectGraph: RoslynProjectGraph | null;
  totalFiles: number;
  elapsed: string;
  /** False when the helper exited non-zero, was killed (timeout) or could not be spawned. */
  ok: boolean;
  /** Why the run failed (ok false only): the tail of the error output, at most 500 characters. */
  error?: string;
  /** SQL call-site stats; present only when the run had `sqlCallSites` and the helper reported them. */
  sql?: RoslynSqlStats;
}

const SQL_CALL_SITES_FLAG = '--sql-call-sites';

/** `dotnet run` arguments for the helper; the SQL flag comes last and only when enabled. */
function helperArgs(projectDir: string, solutionPath: string, mode: readonly string[], options: RoslynRunOptions): string[] {
  return [
    'run', '--project', projectDir, '--', solutionPath,
    ...mode,
    ...(options.sqlCallSites === true ? [SQL_CALL_SITES_FLAG] : []),
  ];
}

/** The `sql` object of a `done` line, or undefined when it is absent or malformed. */
function toSqlStats(value: unknown): RoslynSqlStats | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const { constant, nonConstant, unparsable } = value as Record<string, unknown>;
  if (typeof constant !== 'number' || typeof nonConstant !== 'number' || typeof unparsable !== 'number') return undefined;
  return { constant, nonConstant, unparsable };
}

/** Longest `RoslynBatchResult.error`. */
const MAX_ERROR_LENGTH = 500;
/** Build error lines kept from stdout; only the tail of the error output is reported. */
const MAX_BUILD_ERROR_LINES = 20;

/**
 * An MSBuild or NuGet error line: an `error NU1101`-style code or ` : error `, matched with case, as the
 * doctor's restore check matches it. A warning such as `warning NU1900: Error occurred ...` has neither.
 */
const BUILD_ERROR_SHAPE = /\berror [A-Z]+\d+\b| : error /;

/** Where the error text of an MSBuild error line starts (at "error"), or -1 when the line has no error shape. */
function buildErrorStart(line: string): number {
  const match = BUILD_ERROR_SHAPE.exec(line);
  if (!match) return -1;
  return match[0].startsWith(' : ') ? match.index + 3 : match.index;
}

/** Appends `line` and keeps only the last `MAX_BUILD_ERROR_LINES`. */
function keepTail(lines: string[], line: string): void {
  lines.push(line);
  if (lines.length > MAX_BUILD_ERROR_LINES) lines.shift();
}

/**
 * The failure text of a batch run: the build errors `dotnet run` printed on stdout (restore and
 * compile errors go there), then stderr. The build errors are the lines with an MSBuild error shape
 * when there are any, else the lines with the word "error" in any case; each starts at "error". Only
 * the tail is kept.
 */
function failureText(buildErrors: readonly string[], stderr: string, fallback: string): string {
  const text = [...buildErrors, stderr.trim()].filter(Boolean).join('\n');
  if (!text) return fallback;
  return text.length > MAX_ERROR_LENGTH ? text.slice(-MAX_ERROR_LENGTH) : text;
}

/**
 * Run ctxo-roslyn in one-shot batch mode.
 * Spawns `dotnet run`, reads JSONL from stdout, returns parsed results.
 * Never rejects: a failed run (restore or build error, timeout, missing dotnet, a spawn that throws)
 * resolves with `ok: false`, no files and the reason in `error`. The run logs only that it failed and
 * how it ended; the error text goes to `error`, which the composite's fallback warning reports.
 */
export async function runBatchIndex(
  projectDir: string,
  solutionPath: string,
  options: RoslynRunOptions = {},
): Promise<RoslynBatchResult> {
  return new Promise((resolve) => {
    const files: RoslynFileResult[] = [];
    let projectGraph: RoslynProjectGraph | null = null;
    let totalFiles = 0;
    let elapsed = '';
    let sql: RoslynSqlStats | undefined;
    let stderr = '';
    // Lines with an MSBuild error shape, and the looser fallback: other lines with the word "error".
    const shapedErrors: string[] = [];
    const otherErrors: string[] = [];
    let settled = false;

    const fail = (reason: string): void => {
      if (settled) return;
      settled = true;
      log.error(`ctxo-roslyn failed (${reason})`);
      const buildErrors = shapedErrors.length > 0 ? shapedErrors : otherErrors;
      resolve({ files: [], projectGraph: null, totalFiles: 0, elapsed: '', ok: false, error: failureText(buildErrors, stderr, reason) });
    };

    let proc: ChildProcess;
    try {
      proc = spawn('dotnet', helperArgs(projectDir, solutionPath, [], options), {
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: options.timeoutMs ?? 120_000,
      });
    } catch (err) {
      stderr = (err as Error).message;
      fail('spawn error');
      return;
    }

    let buffer = '';
    proc.stdout!.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      let newlineIdx: number;
      while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIdx).trim();
        buffer = buffer.slice(newlineIdx + 1);
        if (!line) continue;

        // dotnet run prints the build output (restore and compile errors) before the helper's JSONL.
        if (!line.startsWith('{')) {
          const shapedAt = buildErrorStart(line);
          const errorAt = shapedAt !== -1 ? shapedAt : line.search(/\berror\b/i);
          if (errorAt !== -1) keepTail(shapedAt !== -1 ? shapedErrors : otherErrors, line.slice(errorAt));
          log.debug(`ctxo-roslyn build output: ${line.slice(0, 200)}`);
          continue;
        }

        try {
          const obj = JSON.parse(line);
          switch (obj.type) {
            case 'file':
              files.push(obj as RoslynFileResult);
              break;
            case 'projectGraph':
              projectGraph = obj as RoslynProjectGraph;
              break;
            case 'progress':
              log.info(obj.message);
              break;
            case 'done':
              totalFiles = obj.totalFiles ?? 0;
              elapsed = obj.elapsed ?? '';
              sql = toSqlStats(obj.sql);
              break;
          }
        } catch {
          log.error(`Failed to parse JSONL line: ${line.slice(0, 100)}`);
        }
      }
    });

    proc.stderr!.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on('close', (code, signal) => {
      // A null code means the process was killed, by the timeout or otherwise.
      if (code !== 0) {
        fail(code === null ? `killed by ${signal ?? 'a signal'}` : `exit code ${code}`);
        return;
      }
      if (settled) return;
      settled = true;
      resolve({ files, projectGraph, totalFiles, elapsed, ok: true, ...(sql ? { sql } : {}) });
    });

    proc.on('error', (err) => {
      // The spawn error ends the error text; the output, if any, comes first.
      stderr += `${stderr ? '\n' : ''}${err.message}`;
      fail('spawn error');
    });
  });
}

/**
 * Keep-alive Roslyn process for watch mode.
 * Stays alive, accepts file paths via stdin, returns results via stdout.
 */
export class RoslynKeepAlive {
  private proc: ChildProcess | null = null;
  private buffer = '';
  private pending: Map<string, (result: RoslynFileResult | null) => void> = new Map();
  private projectDir: string;
  private solutionPath: string;
  private timeoutMs: number;
  private sqlCallSites: boolean;
  private inactivityTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(projectDir: string, solutionPath: string, options: RoslynRunOptions = {}) {
    this.projectDir = projectDir;
    this.solutionPath = solutionPath;
    this.timeoutMs = options.timeoutMs ?? 300_000;
    this.sqlCallSites = options.sqlCallSites === true;
  }

  /**
   * Resolves true once the helper reports `ready`, and false when it fails to spawn (an error event
   * or a spawn that throws) or exits before that (a restore or build failure), so `ctxo watch` never
   * hangs at start. Never rejects.
   */
  async start(): Promise<boolean> {
    return new Promise((resolve) => {
      let settled = false;
      const settle = (started: boolean): void => {
        if (settled) return;
        settled = true;
        resolve(started);
      };

      const args = helperArgs(this.projectDir, this.solutionPath, ['--keep-alive'], { sqlCallSites: this.sqlCallSites });
      try {
        this.proc = spawn('dotnet', args, {
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      } catch (err) {
        log.error(`Roslyn keep-alive error: ${(err as Error).message}`);
        this.proc = null;
        settle(false);
        return;
      }

      this.proc.stdout!.on('data', (chunk: Buffer) => {
        this.buffer += chunk.toString();
        let newlineIdx: number;
        while ((newlineIdx = this.buffer.indexOf('\n')) !== -1) {
          const line = this.buffer.slice(0, newlineIdx).trim();
          this.buffer = this.buffer.slice(newlineIdx + 1);
          if (!line) continue;

          try {
            const obj = JSON.parse(line);
            if (obj.type === 'ready') {
              log.info(`Roslyn keep-alive ready: ${obj.projectCount} projects, ${obj.fileCount} files`);
              settle(true);
            } else if (obj.type === 'file') {
              const result = obj as RoslynFileResult;
              const callback = this.pending.get(result.file);
              if (callback) {
                this.pending.delete(result.file);
                callback(result);
              }
            } else if (obj.type === 'progress') {
              log.info(obj.message);
            }
          } catch {
            log.error(`Keep-alive parse error: ${line.slice(0, 100)}`);
          }
        }
      });

      this.proc.stderr!.on('data', (chunk: Buffer) => {
        log.error(`Roslyn stderr: ${chunk.toString().trim()}`);
      });

      this.proc.on('close', (code) => {
        log.info(`Roslyn keep-alive exited (code ${code})`);
        this.proc = null;
        if (this.inactivityTimer) clearTimeout(this.inactivityTimer);
        this.inactivityTimer = null;
        // Reject any pending requests
        for (const callback of this.pending.values()) callback(null);
        this.pending.clear();
        // Exited before `ready`: the helper could not restore, build or load the solution.
        settle(false);
      });

      this.proc.on('error', (err) => {
        log.error(`Roslyn keep-alive error: ${err.message}`);
        settle(false);
      });

      this.resetInactivityTimer();
    });
  }

  async analyzeFile(relativePath: string): Promise<RoslynFileResult | null> {
    if (!this.proc || !this.proc.stdin!.writable) {
      return null;
    }

    this.resetInactivityTimer();

    return new Promise((resolve) => {
      this.pending.set(relativePath, resolve);
      this.proc!.stdin!.write(JSON.stringify({ file: relativePath }) + '\n');

      // Per-request timeout
      setTimeout(() => {
        if (this.pending.has(relativePath)) {
          this.pending.delete(relativePath);
          log.error(`Roslyn keep-alive timeout for ${relativePath}`);
          resolve(null);
        }
      }, 30_000);
    });
  }

  isAlive(): boolean {
    return this.proc !== null && !this.proc.killed;
  }

  async shutdown(): Promise<void> {
    if (this.inactivityTimer) clearTimeout(this.inactivityTimer);
    if (this.proc) {
      this.proc.stdin!.end();
      this.proc.kill();
      this.proc = null;
    }
  }

  private resetInactivityTimer(): void {
    if (this.inactivityTimer) clearTimeout(this.inactivityTimer);
    this.inactivityTimer = setTimeout(() => {
      log.info(`Roslyn keep-alive shutting down after ${this.timeoutMs / 1000}s inactivity`);
      this.shutdown();
    }, this.timeoutMs);
  }
}
