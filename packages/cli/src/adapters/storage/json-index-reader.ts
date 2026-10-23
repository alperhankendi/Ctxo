import { readFileSync, readdirSync, existsSync, realpathSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  FileIndexSchema,
  SymbolNodeSchema,
  GraphEdgeSchema,
  CommitIntentSchema,
  AntiPatternSchema,
  type FileIndex,
} from '../../core/types.js';
import { createLogger } from '../../core/logger.js';

const log = createLogger('ctxo:json-reader');

/** JSON files next to the index entries that are products of Ctxo, not entries: the reader skips them. */
export const INDEX_ARTIFACT_FILES: readonly string[] = [
  'co-changes.json',
  'communities.json',
  'drift-events.json',
  'boundary-violations.json',
];

/** The folder of archived community snapshots inside the index folder: not entries either. */
export const COMMUNITY_HISTORY_DIR = 'communities.history';

/** One index entry and the JSON file on disk it was read from. */
export interface IndexEntry {
  readonly path: string;
  readonly index: FileIndex;
}

export class JsonIndexReader {
  private readonly indexDir: string;

  constructor(ctxoRoot: string) {
    this.indexDir = join(ctxoRoot, 'index');
  }

  readAll(): FileIndex[] {
    return this.readEntries().map((entry) => entry.index);
  }

  /**
   * Every valid index entry together with the path of the JSON file it came from. A caller that wants to
   * delete an entry must use this path: the `file` field inside the JSON says which source file the entry
   * is for, but a corrupt or crafted file can claim any name, such as an artifact's.
   */
  readEntries(): IndexEntry[] {
    if (!existsSync(this.indexDir)) {
      return [];
    }

    const jsonFiles = this.collectJsonFiles(this.indexDir);
    const results: IndexEntry[] = [];

    for (const filePath of jsonFiles) {
      const parsed = this.readSingle(filePath);
      if (parsed) {
        results.push({ path: filePath, index: parsed });
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
      const rawIntent = Array.isArray(raw_data['intent']) ? raw_data['intent'] : [];
      const rawAntiPatterns = Array.isArray(raw_data['antiPatterns']) ? raw_data['antiPatterns'] : [];

      const validSymbols = rawSymbols.filter((s) => SymbolNodeSchema.safeParse(s).success);
      const validEdges = rawEdges.filter((e) => GraphEdgeSchema.safeParse(e).success);
      const validIntent = rawIntent.filter((i) => CommitIntentSchema.safeParse(i).success);
      const validAntiPatterns = rawAntiPatterns.filter((a) => AntiPatternSchema.safeParse(a).success);

      const droppedSymbols = rawSymbols.length - validSymbols.length;
      const droppedEdges = rawEdges.length - validEdges.length;
      const droppedIntent = rawIntent.length - validIntent.length;
      const droppedAntiPatterns = rawAntiPatterns.length - validAntiPatterns.length;

      if (droppedSymbols > 0 || droppedEdges > 0 || droppedIntent > 0 || droppedAntiPatterns > 0) {
        log.warn(
          `${rel}: dropped ${droppedSymbols} invalid symbol(s), ${droppedEdges} invalid edge(s), ${droppedIntent} invalid intent(s), ${droppedAntiPatterns} invalid antiPattern(s) — kept ${validSymbols.length} symbol(s), ${validEdges.length} edge(s), ${validIntent.length} intent(s), ${validAntiPatterns.length} antiPattern(s)`,
        );
      }

      // Re-parse with the filtered arrays to get a fully-typed FileIndex.
      const recovered = FileIndexSchema.safeParse({
        ...raw_data,
        symbols: validSymbols,
        edges: validEdges,
        intent: validIntent,
        antiPatterns: validAntiPatterns,
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
        if (entry.name === COMMUNITY_HISTORY_DIR) continue;
        files.push(...this.collectJsonFiles(fullPath, visited));
      } else if (entry.name.endsWith('.json') && !INDEX_ARTIFACT_FILES.includes(entry.name)) {
        files.push(fullPath);
      }
    }

    return files;
  }
}
