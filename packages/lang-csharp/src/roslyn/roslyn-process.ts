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

export interface RoslynBatchResult {
  files: RoslynFileResult[];
  projectGraph: RoslynProjectGraph | null;
  totalFiles: number;
  elapsed: string;
}

/**
 * Run ctxo-roslyn in one-shot batch mode.
 * Spawns `dotnet run`, reads JSONL from stdout, returns parsed results.
 */
export async function runBatchIndex(
  projectDir: string,
  solutionPath: string,
  timeoutMs = 120_000,
): Promise<RoslynBatchResult> {
  return new Promise((resolve) => {
    const proc = spawn('dotnet', ['run', '--project', projectDir, '--', solutionPath], {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: timeoutMs,
    });

    const files: RoslynFileResult[] = [];
    let projectGraph: RoslynProjectGraph | null = null;
    let totalFiles = 0;
    let elapsed = '';
    let stderr = '';

    let buffer = '';
    proc.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      let newlineIdx: number;
      while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIdx).trim();
        buffer = buffer.slice(newlineIdx + 1);
        if (!line) continue;

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
              break;
          }
        } catch {
          log.error(`Failed to parse JSONL line: ${line.slice(0, 100)}`);
        }
      }
    });

    proc.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        log.error(`ctxo-roslyn exited with code ${code}: ${stderr.trim()}`);
        resolve({ files: [], projectGraph: null, totalFiles: 0, elapsed: '' });
        return;
      }
      resolve({ files, projectGraph, totalFiles, elapsed });
    });

    proc.on('error', (err) => {
      log.error(`ctxo-roslyn spawn error: ${err.message}`);
      resolve({ files: [], projectGraph: null, totalFiles: 0, elapsed: '' });
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
  private inactivityTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(projectDir: string, solutionPath: string, timeoutMs = 300_000) {
    this.projectDir = projectDir;
    this.solutionPath = solutionPath;
    this.timeoutMs = timeoutMs;
  }

  async start(): Promise<boolean> {
    return new Promise((resolve) => {
      this.proc = spawn('dotnet', ['run', '--project', this.projectDir, '--', this.solutionPath, '--keep-alive'], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

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
              resolve(true);
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
        // Reject any pending requests
        for (const callback of this.pending.values()) callback(null);
        this.pending.clear();
      });

      this.proc.on('error', (err) => {
        log.error(`Roslyn keep-alive error: ${err.message}`);
        resolve(false);
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
