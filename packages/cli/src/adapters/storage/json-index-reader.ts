import { readFileSync, readdirSync, existsSync, realpathSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  FileIndexSchema,
  SymbolNodeSchema,
  GraphEdgeSchema,
  type FileIndex,
} from '../../core/types.js';
import { createLogger } from '../../core/logger.js';

const log = createLogger('ctxo:json-reader');

export class JsonIndexReader {
  private readonly indexDir: string;

  constructor(ctxoRoot: string) {
    this.indexDir = join(ctxoRoot, 'index');
  }

  readAll(): FileIndex[] {
    if (!existsSync(this.indexDir)) {
      return [];
    }

    const jsonFiles = this.collectJsonFiles(this.indexDir);
    const results: FileIndex[] = [];

    for (const filePath of jsonFiles) {
      const parsed = this.readSingle(filePath);
      if (parsed) {
        results.push(parsed);
      }
    }

    return results;
  }

  readSingle(absolutePath: string): FileIndex | undefined {
    try {
      const raw = readFileSync(absolutePath, 'utf-8');
      const data: unknown = JSON.parse(raw);
      const result = FileIndexSchema.safeParse(data);

      if (result.success) {
        return result.data;
      }

      // Strict parse failed — attempt resilient recovery: keep valid items, drop invalid ones.
      const rel = relative(this.indexDir, absolutePath);
      const raw_data = data as Record<string, unknown>;

      // Must have at least a valid file name and lastModified to be recoverable.
      if (typeof raw_data['file'] !== 'string' || !raw_data['file'] ||
          typeof raw_data['lastModified'] !== 'number') {
        console.error(
          `[ctxo:json-reader] Invalid schema in ${rel}: ${result.error.message}`,
        );
        return undefined;
      }

      const rawSymbols = Array.isArray(raw_data['symbols']) ? raw_data['symbols'] : [];
      const rawEdges = Array.isArray(raw_data['edges']) ? raw_data['edges'] : [];

      const validSymbols = rawSymbols.filter((s) => SymbolNodeSchema.safeParse(s).success);
      const validEdges = rawEdges.filter((e) => GraphEdgeSchema.safeParse(e).success);

      const droppedSymbols = rawSymbols.length - validSymbols.length;
      const droppedEdges = rawEdges.length - validEdges.length;

      if (droppedSymbols > 0 || droppedEdges > 0) {
        log.warn(
          `${rel}: dropped ${droppedSymbols} invalid symbol(s) and ${droppedEdges} invalid edge(s) — kept ${validSymbols.length} symbol(s) and ${validEdges.length} edge(s)`,
        );
      }

      // Re-parse with the filtered arrays to get a fully-typed FileIndex.
      const recovered = FileIndexSchema.safeParse({
        ...raw_data,
        symbols: validSymbols,
        edges: validEdges,
      });

      if (!recovered.success) {
        console.error(
          `[ctxo:json-reader] Invalid schema in ${rel}: ${result.error.message}`,
        );
        return undefined;
      }

      return recovered.data;
    } catch (err) {
      const rel = relative(this.indexDir, absolutePath);
      console.error(
        `[ctxo:json-reader] Failed to read ${rel}: ${(err as Error).message}`,
      );
      return undefined;
    }
  }

  private collectJsonFiles(dir: string, visited: Set<string> = new Set()): string[] {
    const realDir = realpathSync(dir);
    if (visited.has(realDir)) return []; // Guard against symlink loops
    visited.add(realDir);

    const files: string[] = [];

    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue; // Skip symlinks entirely

      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        // Skip non-FileIndex directories under .ctxo/index/
        if (entry.name === 'communities.history') continue;
        files.push(...this.collectJsonFiles(fullPath, visited));
      } else if (
        entry.name.endsWith('.json') &&
        entry.name !== 'co-changes.json' &&
        entry.name !== 'communities.json' &&
        entry.name !== 'drift-events.json' &&
        entry.name !== 'boundary-violations.json'
      ) {
        files.push(fullPath);
      }
    }

    return files;
  }
}
