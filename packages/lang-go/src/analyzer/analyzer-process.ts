import { spawn } from 'node:child_process';
import { createLogger } from '../logger.js';

const log = createLogger('ctxo:lang-go');

export interface AnalyzerSymbol {
  symbolId: string;
  name: string;
  kind: string;
  startLine: number;
  endLine: number;
  startOffset?: number;
  endOffset?: number;
}

export interface AnalyzerEdge {
  from: string;
  to: string;
  kind: string;
  typeArgs?: string[];
}

export interface AnalyzerFileResult {
  type: 'file';
  file: string;
  symbols: AnalyzerSymbol[];
  edges: AnalyzerEdge[];
  complexity: unknown[];
}

export interface AnalyzerBatchResult {
  files: AnalyzerFileResult[];
  dead: string[];
  hasMain: boolean;
  timeout: boolean;
  totalFiles: number;
  elapsed: string;
}

/**
 * Spawn the analyzer binary in batch mode and parse its JSONL stream.
 * Failures resolve to an empty result so the composite adapter can fall
 * back to tree-sitter without throwing.
 */
export async function runBatchAnalyze(
  binaryPath: string,
  moduleRoot: string,
  timeoutMs = 120_000,
): Promise<AnalyzerBatchResult> {
  return new Promise((resolve) => {
    const empty: AnalyzerBatchResult = {
      files: [], dead: [], hasMain: false, timeout: false, totalFiles: 0, elapsed: '',
    };
    const proc = spawn(binaryPath, ['--root', moduleRoot], {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: timeoutMs,
    });

    const files: AnalyzerFileResult[] = [];
    let dead: string[] = [];
    let hasMain = false;
    let timeout = false;
    let totalFiles = 0;
    let elapsed = '';
    let stderr = '';
    let buffer = '';

    proc.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      let nl: number;
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        try {
          const obj = JSON.parse(line);
          switch (obj.type) {
            case 'file':
              files.push(obj as AnalyzerFileResult);
              break;
            case 'dead':
              dead = Array.isArray(obj.symbolIds) ? obj.symbolIds : [];
              hasMain = Boolean(obj.hasMain);
              timeout = Boolean(obj.timeout);
              break;
            case 'progress':
              log.info(String(obj.message ?? ''));
              break;
            case 'summary':
              totalFiles = Number(obj.totalFiles ?? 0);
              elapsed = String(obj.elapsed ?? '');
              break;
          }
        } catch {
          log.error(`Failed to parse JSONL line: ${line.slice(0, 120)}`);
        }
      }
    });

    proc.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        log.error(`ctxo-go-analyzer exited with code ${code}: ${stderr.trim().slice(0, 500)}`);
        resolve(empty);
        return;
      }
      resolve({ files, dead, hasMain, timeout, totalFiles, elapsed });
    });

    proc.on('error', (err) => {
      log.error(`ctxo-go-analyzer spawn error: ${err.message}`);
      resolve(empty);
    });
  });
}
