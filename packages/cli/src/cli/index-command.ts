import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { ContentHasher } from '../core/staleness/content-hasher.js';
import { TsMorphAdapter } from '../adapters/language/ts-morph-adapter.js';
import { LanguageAdapterRegistry } from '../adapters/language/language-adapter-registry.js';
import { JsonIndexWriter } from '../adapters/storage/json-index-writer.js';
import { SqliteStorageAdapter } from '../adapters/storage/sqlite-storage-adapter.js';
import { SchemaManager } from '../adapters/storage/schema-manager.js';
import { SimpleGitAdapter } from '../adapters/git/simple-git-adapter.js';
import { RevertDetector } from '../core/why-context/revert-detector.js';
import { aggregateCoChanges } from '../core/co-change/co-change-analyzer.js';
import type { FileIndex, SymbolKind } from '../core/types.js';
import { RoslynAdapter } from '../adapters/language/roslyn/roslyn-adapter.js';

export class IndexCommand {
  private readonly projectRoot: string;
  ctxoRoot: string;
  private supportedExtensions: Set<string>;

  constructor(projectRoot: string, ctxoRoot?: string) {
    this.projectRoot = projectRoot;
    this.ctxoRoot = ctxoRoot ?? join(projectRoot, '.ctxo');
    this.supportedExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.go', '.cs']);
  }

  async run(options: { file?: string; check?: boolean; skipSideEffects?: boolean; skipHistory?: boolean; maxHistory?: number } = {}): Promise<void> {
    if (options.check) {
      // Delegate to verify logic: hash-based freshness check
      return this.runCheck();
    }

    // Set up adapters
    const registry = new LanguageAdapterRegistry();
    const tsMorphAdapter = new TsMorphAdapter();
    registry.register(tsMorphAdapter);
    const { roslynAdapter, csharpTier } = await this.registerCSharpAdapter(registry);
    this.registerGoAdapter(registry);
    this.supportedExtensions = registry.getSupportedExtensions();

    const writer = new JsonIndexWriter(this.ctxoRoot);
    const schemaManager = new SchemaManager(this.ctxoRoot);
    const hasher = new ContentHasher();
    const gitAdapter = new SimpleGitAdapter(this.projectRoot);
    const revertDetector = new RevertDetector();

    // Discover files (single file, monorepo workspaces, or full project)
    let files: string[];
    if (options.file) {
      const fullPath = join(this.projectRoot, options.file);
      files = [fullPath];
      console.error(`[ctxo] Incremental re-index: ${options.file}`);
    } else {
      // Check for monorepo workspaces — discover files across all roots
      const workspaces = this.discoverWorkspaces();
      files = [];
      for (const ws of workspaces) {
        const wsFiles = this.discoverFilesIn(ws);
        files.push(...wsFiles);
      }
      console.error(`[ctxo] Building codebase index... Found ${files.length} source files`);
    }

    // Phase 0: Roslyn batch index (if available, pre-caches all C# results)
    if (roslynAdapter?.isReady()) {
      const hasCsFiles = files.some(f => f.endsWith('.cs'));
      if (hasCsFiles) {
        await roslynAdapter.batchIndex();
      }
    }

    // Phase 1a: Extract symbols (CPU-bound, builds symbol registry for edge resolution)
    const symbolRegistry = new Map<string, SymbolKind>();
    const pendingIndices: Array<{
      relativePath: string;
      source: string;
      fileIndex: FileIndex;
    }> = [];
    let processed = 0;

    for (const filePath of files) {
      const adapter = registry.getAdapter(filePath);
      if (!adapter) continue;

      const relativePath = relative(this.projectRoot, filePath).replace(/\\/g, '/');

      try {
        const source = readFileSync(filePath, 'utf-8');
        const lastModified = Math.floor(Date.now() / 1000);

        const symbols = await adapter.extractSymbols(relativePath, source);
        const complexity = await adapter.extractComplexity(relativePath, source);

        // Build symbol registry for accurate edge resolution
        for (const sym of symbols) {
          symbolRegistry.set(sym.symbolId, sym.kind);
        }

        pendingIndices.push({
          relativePath,
          source,
          fileIndex: {
            file: relativePath,
            lastModified,
            contentHash: hasher.hash(source),
            symbols,
            edges: [],
            complexity,
            intent: [],
            antiPatterns: [],
          },
        });

        processed++;
        if (processed % 50 === 0) {
          console.error(`[ctxo] Processed ${processed}/${files.length} files (symbols)`);
        }
      } catch (err) {
        console.error(`[ctxo] Skipped ${relativePath}: ${(err as Error).message}`);
      }
    }

    // Pre-load all sources into ts-morph for cross-file resolution
    const allSources = new Map<string, string>();
    for (const entry of pendingIndices) {
      allSources.set(entry.relativePath, entry.source);
    }
    tsMorphAdapter.loadProjectSources(allSources);

    // Phase 1b: Extract edges (uses symbol registry for correct kind resolution)
    for (const entry of pendingIndices) {
      const adapter = registry.getAdapter(entry.relativePath);
      if (!adapter) continue;

      try {
        adapter.setSymbolRegistry?.(symbolRegistry);
        entry.fileIndex.edges = await adapter.extractEdges(entry.relativePath, entry.source);
      } catch (err) {
        console.error(`[ctxo] Edge extraction failed for ${entry.relativePath}: ${(err as Error).message}`);
      }
    }

    // Clean up pre-loaded sources
    tsMorphAdapter.clearProjectSources();

    // Phase 2: Batch git history (single git call for all files)
    if (!options.skipHistory && pendingIndices.length > 0) {
      const maxHistory = options.maxHistory ?? 20;
      const batchHistory = await gitAdapter.getBatchHistory?.(maxHistory) ?? new Map<string, import('../core/types.js').CommitRecord[]>();

      for (const { relativePath, fileIndex } of pendingIndices) {
        const commits = batchHistory.get(relativePath) ?? [];
        fileIndex.intent = commits.map((c) => ({
          hash: c.hash,
          message: c.message,
          date: c.date,
          kind: 'commit' as const,
        }));
        fileIndex.antiPatterns = revertDetector.detect(commits);
      }
    }

    // Phase 2b: Aggregate co-change data from git history
    if (!options.skipHistory && pendingIndices.length > 0) {
      const fileIndices = pendingIndices.map(e => e.fileIndex);
      const coChangeMatrix = aggregateCoChanges(fileIndices);
      writer.writeCoChanges(coChangeMatrix);
      console.error(`[ctxo] Co-change analysis: ${coChangeMatrix.entries.length} file pairs detected`);
    }

    // Phase 3: Write all indices
    const indices: FileIndex[] = [];
    for (const { fileIndex } of pendingIndices) {
      writer.write(fileIndex);
      indices.push(fileIndex);
    }

    // Write schema version
    schemaManager.writeVersion();

    // Populate SQLite cache (skip rebuildFromJson since we just wrote the JSON)
    const storage = new SqliteStorageAdapter(this.ctxoRoot);
    try {
      await storage.initEmpty();
      storage.bulkWrite(indices);
    } finally {
      storage.close();
    }

    // Ensure .ctxo/.cache/ is in .gitignore (skip during verify runs)
    if (!options.skipSideEffects) {
      this.ensureGitignore();
    }

    // Tier summary
    const csCount = pendingIndices.filter(e => e.relativePath.endsWith('.cs')).length;
    const tsCount = pendingIndices.filter(e => /\.(ts|tsx|js|jsx)$/.test(e.relativePath)).length;
    const goCount = pendingIndices.filter(e => e.relativePath.endsWith('.go')).length;
    console.error(`[ctxo] Index complete: ${processed} files indexed`);
    if (tsCount > 0) console.error(`[ctxo]   TypeScript/JS: ${tsCount} files (full tier)`);
    if (csCount > 0) console.error(`[ctxo]   C#: ${csCount} files (${csharpTier} tier${csharpTier === 'syntax' ? ' - .NET SDK 8+ for full analysis' : ''})`);
    if (goCount > 0) console.error(`[ctxo]   Go: ${goCount} files (syntax tier)`);

    // Dispose Roslyn adapter
    if (roslynAdapter) await roslynAdapter.dispose();
  }

  private async registerCSharpAdapter(registry: LanguageAdapterRegistry): Promise<{ roslynAdapter: RoslynAdapter | null; csharpTier: string }> {
    try {
      const roslyn = new RoslynAdapter();
      await roslyn.initialize(this.projectRoot);
      if (roslyn.isReady()) {
        registry.register(roslyn);
        return { roslynAdapter: roslyn, csharpTier: 'full' };
      }
    } catch (err) {
      console.error(`[ctxo] Roslyn adapter init failed: ${(err as Error).message}`);
    }

    // Fallback to tree-sitter
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { CSharpAdapter } = require('../adapters/language/csharp-adapter.js');
      registry.register(new CSharpAdapter());
      return { roslynAdapter: null, csharpTier: 'syntax' };
    } catch {
      return { roslynAdapter: null, csharpTier: 'unavailable' };
    }
  }

  private registerGoAdapter(registry: LanguageAdapterRegistry): void {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { GoAdapter } = require('../adapters/language/go-adapter.js');
      registry.register(new GoAdapter());
    } catch {
      console.error('[ctxo] Go adapter unavailable (tree-sitter-go not installed)');
    }
  }

  private discoverFilesIn(root: string): string[] {
    try {
      const output = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
        cwd: root,
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024,
      });

      return output
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .filter((line) => this.isSupportedExtension(line))
        .map((line) => join(root, line));
    } catch {
      console.error(`[ctxo] git ls-files failed for ${root}`);
      return [];
    }
  }

  private discoverWorkspaces(): string[] {
    const pkgPath = join(this.projectRoot, 'package.json');
    if (!existsSync(pkgPath)) return [this.projectRoot];

    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      const workspaces: string[] | undefined = Array.isArray(pkg.workspaces)
        ? pkg.workspaces
        : pkg.workspaces?.packages;

      if (!workspaces || workspaces.length === 0) return [this.projectRoot];

      // Resolve workspace patterns (supports simple globs like packages/*)
      const resolved: string[] = [];
      for (const ws of workspaces) {
        if (ws.endsWith('/*') || ws.endsWith('\\*')) {
          // Glob: packages/* → list subdirectories of packages/
          const parentDir = join(this.projectRoot, ws.slice(0, -2));
          if (existsSync(parentDir)) {
            for (const entry of readdirSync(parentDir, { withFileTypes: true })) {
              if (entry.isDirectory()) {
                resolved.push(join(parentDir, entry.name));
              }
            }
          }
        } else {
          // Literal path
          const wsPath = join(this.projectRoot, ws);
          if (existsSync(wsPath)) {
            resolved.push(wsPath);
          }
        }
      }

      if (resolved.length === 0) return [this.projectRoot];

      console.error(`[ctxo] Monorepo detected: ${resolved.length} workspace(s)`);
      return resolved;
    } catch {
      return [this.projectRoot];
    }
  }

  private isSupportedExtension(filePath: string): boolean {
    const ext = extname(filePath).toLowerCase();
    return this.supportedExtensions.has(ext);
  }

  private async runCheck(): Promise<void> {
    console.error('[ctxo] Checking index freshness...');

    // Register adapters so supportedExtensions includes .go/.cs
    const registry = new LanguageAdapterRegistry();
    registry.register(new TsMorphAdapter());
    const { roslynAdapter: _roslyn } = await this.registerCSharpAdapter(registry);
    this.registerGoAdapter(registry);
    this.supportedExtensions = registry.getSupportedExtensions();
    if (_roslyn) await _roslyn.dispose();

    const hasher = new ContentHasher();
    const files = this.discoverFilesIn(this.projectRoot);
    const reader = new (await import('../adapters/storage/json-index-reader.js')).JsonIndexReader(this.ctxoRoot);
    const indices = reader.readAll();
    const indexedMap = new Map(indices.map((i) => [i.file, i]));

    let staleCount = 0;

    for (const filePath of files) {
      if (!this.isSupportedExtension(filePath)) continue;

      const relativePath = relative(this.projectRoot, filePath).replace(/\\/g, '/');
      const indexed = indexedMap.get(relativePath);

      if (!indexed) {
        console.error(`[ctxo] NOT INDEXED: ${relativePath}`);
        staleCount++;
        continue;
      }

      // Guard: file may be deleted from disk but still tracked by git
      if (!existsSync(filePath)) {
        console.error(`[ctxo] DELETED: ${relativePath}`);
        staleCount++;
        continue;
      }

      // Fast path: mtime check (skip hash if mtime hasn't changed)
      const mtime = Math.floor(statSync(filePath).mtimeMs / 1000);
      if (mtime <= indexed.lastModified) continue;

      // Slow path: hash-based verification (handles git checkout, cp -p, CI)
      if (indexed.contentHash) {
        const source = readFileSync(filePath, 'utf-8');
        const currentHash = hasher.hash(source);
        if (currentHash === indexed.contentHash) continue;
      }

      console.error(`[ctxo] STALE: ${relativePath}`);
      staleCount++;
    }

    if (staleCount > 0) {
      console.error(`[ctxo] ${staleCount} file(s) need re-indexing. Run "ctxo index"`);
      process.exit(1);
    }

    console.error('[ctxo] Index is up to date');
  }

  private ensureGitignore(): void {
    const gitignorePath = join(this.projectRoot, '.gitignore');
    const cachePattern = '.ctxo/.cache/';
    const suffix = `\n# Ctxo local cache (never committed)\n${cachePattern}\n`;

    // Read-modify-write atomically to avoid TOCTOU race
    const existing = existsSync(gitignorePath) ? readFileSync(gitignorePath, 'utf-8') : '';
    if (existing.includes(cachePattern)) return;

    writeFileSync(gitignorePath, existing + suffix, 'utf-8');
    console.error('[ctxo] Added .ctxo/.cache/ to .gitignore');
  }
}
