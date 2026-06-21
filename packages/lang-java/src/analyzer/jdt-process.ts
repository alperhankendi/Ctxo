import { spawn } from 'node:child_process';
import { createLogger } from '../logger.js';

const log = createLogger('ctxo:lang-java');

export interface JdtSymbol {
  symbolId: string;
  name: string;
  kind: string;
  startLine: number;
  endLine: number;
  startOffset?: number;
  endOffset?: number;
}

export interface JdtEdge {
  from: string;
  to: string;
  kind: string;
}

export interface JdtFileResult {
  type: 'file';
  file: string;
  symbols: JdtSymbol[];
  edges: JdtEdge[];
  complexity: unknown[];
}

export interface JdtBatchResult {
  files: JdtFileResult[];
  totalFiles: number;
  elapsed: string;
}

export interface RunOpts {
  classpathOverride?: string[];
  allowBuildTools?: boolean;
  timeoutMs?: number;
}

/**
 * Spawn `java -jar <jar> <root> [--classpath ...] [--allow-build-tools]` in batch
 * mode and parse JSONL. Never throws — empty result on any failure.
 */
export async function runBatchIndex(
  javaBin: string,
  jarPath: string,
  projectRoot: string,
  opts: RunOpts = {},
): Promise<JdtBatchResult> {
  const timeoutMs = opts.timeoutMs ?? 180_000;
  return new Promise((resolve) => {
    const empty: JdtBatchResult = { files: [], totalFiles: 0, elapsed: '' };
    const args = ['-jar', jarPath, projectRoot];
    if (opts.classpathOverride?.length) args.push('--classpath', opts.classpathOverride.join(';'));
    if (opts.allowBuildTools) args.push('--allow-build-tools');
    const proc = spawn(javaBin, args, { stdio: ['ignore', 'pipe', 'pipe'], timeout: timeoutMs });
    const files: JdtFileResult[] = [];
    let totalFiles = 0,
      elapsed = '',
      stderr = '',
      buffer = '';
    proc.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      let nl: number;
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        try {
          const obj = JSON.parse(line) as { type: string; message?: unknown; totalFiles?: unknown; elapsed?: unknown };
          switch (obj.type) {
            case 'file':
              files.push(obj as unknown as JdtFileResult);
              break;
            case 'progress':
              log.info(String(obj.message ?? ''));
              break;
            case 'done':
              totalFiles = Number(obj.totalFiles ?? 0);
              elapsed = String(obj.elapsed ?? '');
              break;
          }
        } catch {
          log.error(`Failed to parse JSONL line: ${line.slice(0, 120)}`);
        }
      }
    });
    proc.stderr.on('data', (c: Buffer) => {
      stderr += c.toString();
    });
    proc.on('close', (code) => {
      if (code !== 0) {
        log.error(`ctxo-jdt-analyzer exited ${code}: ${stderr.trim().slice(0, 500)}`);
        resolve(empty);
        return;
      }
      resolve({ files, totalFiles, elapsed });
    });
    proc.on('error', (err) => {
      log.error(`ctxo-jdt-analyzer spawn error: ${(err as Error).message}`);
      resolve(empty);
    });
  });
}
