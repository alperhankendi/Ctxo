import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { IndexCommand } from './index-command.js';
import { JsonIndexReader } from '../adapters/storage/json-index-reader.js';

export class VerifyCommand {
  private readonly projectRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
  }

  async run(): Promise<void> {
    console.error('[ctxo] Verifying index freshness...');

    // Build index into a temp directory to avoid overwriting committed index
    const tempDir = mkdtempSync(join(tmpdir(), 'ctxo-verify-'));

    try {
      const tempCtxo = join(tempDir, '.ctxo');

      // Run index into temp .ctxo (does not touch committed index)
      const indexCmd = new IndexCommand(this.projectRoot, tempCtxo);
      await indexCmd.run({ skipSideEffects: true });

      // Compare temp index with committed index
      const committedReader = new JsonIndexReader(join(this.projectRoot, '.ctxo'));
      const freshReader = new JsonIndexReader(tempCtxo);

      const committedIndices = committedReader.readAll();
      const freshIndices = freshReader.readAll();

      // Compare full index: symbols + edges + intent + antiPatterns
      const serialize = (i: { symbols: unknown; edges: unknown; intent: unknown; antiPatterns: unknown }) =>
        JSON.stringify({ symbols: i.symbols, edges: i.edges, intent: i.intent, antiPatterns: i.antiPatterns });

      const committedMap = new Map(committedIndices.map((i) => [i.file, serialize(i)]));
      const freshMap = new Map(freshIndices.map((i) => [i.file, serialize(i)]));

      let stale = false;

      // Check for files that changed or were added
      for (const [file, freshData] of freshMap) {
        const committed = committedMap.get(file);
        if (committed !== freshData) {
          console.error(`[ctxo] STALE: ${file}`);
          stale = true;
        }
      }

      // Check for files that were removed
      for (const file of committedMap.keys()) {
        if (!freshMap.has(file)) {
          console.error(`[ctxo] REMOVED: ${file}`);
          stale = true;
        }
      }

      if (stale) {
        console.error('[ctxo] Index is STALE — run "ctxo index" and commit .ctxo/index/');
        process.exit(1);
      }

      console.error('[ctxo] Index is up to date');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }
}
