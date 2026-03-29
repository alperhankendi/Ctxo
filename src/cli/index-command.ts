import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { ContentHasher } from '../core/staleness/content-hasher.js';
import { TsMorphAdapter } from '../adapters/language/ts-morph-adapter.js';
import { LanguageAdapterRegistry } from '../adapters/language/language-adapter-registry.js';
import { JsonIndexWriter } from '../adapters/storage/json-index-writer.js';
import { SqliteStorageAdapter } from '../adapters/storage/sqlite-storage-adapter.js';
import { SchemaManager } from '../adapters/storage/schema-manager.js';
import { SimpleGitAdapter } from '../adapters/git/simple-git-adapter.js';
import { RevertDetector } from '../core/why-context/revert-detector.js';
import type { CommitIntent, AntiPattern } from '../core/types.js';
import type { FileIndex } from '../core/types.js';

export class IndexCommand {
  private readonly projectRoot: string;
  ctxoRoot: string;

  constructor(projectRoot: string, ctxoRoot?: string) {
    this.projectRoot = projectRoot;
    this.ctxoRoot = ctxoRoot ?? join(projectRoot, '.ctxo');
  }

  async run(options: { file?: string; check?: boolean; skipSideEffects?: boolean } = {}): Promise<void> {
    if (options.check) {
      // Delegate to verify logic: hash-based freshness check
      return this.runCheck();
    }

    // Set up adapters
    const registry = new LanguageAdapterRegistry();
    registry.register(new TsMorphAdapter());

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

    // Extract symbols and edges for each file
    const indices: FileIndex[] = [];
    let processed = 0;

    for (const filePath of files) {
      const adapter = registry.getAdapter(filePath);
      if (!adapter) continue;

      const relativePath = relative(this.projectRoot, filePath).replace(/\\/g, '/');

      try {
        const source = readFileSync(filePath, 'utf-8');
        const lastModified = Math.floor(Date.now() / 1000);

        const symbols = adapter.extractSymbols(relativePath, source);
        const edges = adapter.extractEdges(relativePath, source);

        // Extract git history and anti-patterns
        const commits = await gitAdapter.getCommitHistory(relativePath);
        const intent: CommitIntent[] = commits.map((c) => ({
          hash: c.hash,
          message: c.message,
          date: c.date,
          kind: 'commit' as const,
        }));
        const antiPatterns: AntiPattern[] = revertDetector.detect(commits);

        const fileIndex: FileIndex = {
          file: relativePath,
          lastModified,
          contentHash: hasher.hash(source),
          symbols,
          edges,
          intent,
          antiPatterns,
        };

        writer.write(fileIndex);
        indices.push(fileIndex);
        processed++;

        if (processed % 50 === 0) {
          console.error(`[ctxo] Processed ${processed}/${files.length} files`);
        }
      } catch (err) {
        console.error(`[ctxo] Skipped ${relativePath}: ${(err as Error).message}`);
      }
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

    console.error(`[ctxo] Index complete: ${processed} files indexed`);
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

      // Resolve glob-like workspace patterns (simple: no ** support, just direct dirs)
      const resolved: string[] = [];
      for (const ws of workspaces) {
        const wsPath = join(this.projectRoot, ws);
        if (existsSync(wsPath)) {
          resolved.push(wsPath);
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
    return ['.ts', '.tsx', '.js', '.jsx'].includes(ext);
  }

  private async runCheck(): Promise<void> {
    console.error('[ctxo] Checking index freshness...');

    const hasher = new ContentHasher();
    const files = this.discoverFilesIn(this.projectRoot);
    const reader = new (await import('../adapters/storage/json-index-reader.js')).JsonIndexReader(this.ctxoRoot);
    const indices = reader.readAll();
    const indexedMap = new Map(indices.map((i) => [i.file, i]));

    let staleCount = 0;

    for (const filePath of files) {
      const ext = extname(filePath).toLowerCase();
      if (!['.ts', '.tsx', '.js', '.jsx'].includes(ext)) continue;

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
