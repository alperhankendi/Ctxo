import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import type { IHealthCheck, CheckResult, CheckContext } from '../../../core/diagnostics/types.js';
import { JsonIndexReader } from '../../storage/json-index-reader.js';
import { StalenessDetector } from '../../../core/staleness/staleness-detector.js';
import { SchemaManager } from '../../storage/schema-manager.js';

function pass(id: string, title: string, message: string, value?: string): CheckResult {
  return { id, title, status: 'pass', message, value };
}
function warn(id: string, title: string, message: string, fix?: string, value?: string): CheckResult {
  return { id, title, status: 'warn', message, fix, value };
}
function fail(id: string, title: string, message: string, fix?: string, value?: string): CheckResult {
  return { id, title, status: 'fail', message, fix, value };
}

export class IndexDirectoryCheck implements IHealthCheck {
  readonly id = 'index_directory';
  readonly title = 'Index directory';

  async run(ctx: CheckContext): Promise<CheckResult> {
    const indexDir = join(ctx.ctxoRoot, 'index');
    if (!existsSync(indexDir)) {
      return fail(this.id, this.title, 'No index directory', 'Run "ctxo index"');
    }
    const reader = new JsonIndexReader(ctx.ctxoRoot);
    const indices = reader.readAll();
    if (indices.length === 0) {
      return fail(this.id, this.title, 'Index directory empty', 'Run "ctxo index"');
    }
    return pass(this.id, this.title, `${indices.length} files indexed`, String(indices.length));
  }
}

export class IndexFreshnessCheck implements IHealthCheck {
  readonly id = 'index_freshness';
  readonly title = 'Index freshness';

  async run(ctx: CheckContext): Promise<CheckResult> {
    const reader = new JsonIndexReader(ctx.ctxoRoot);
    const indices = reader.readAll();
    if (indices.length === 0) {
      return fail(this.id, this.title, 'No indexed files to check', 'Run "ctxo index"');
    }

    const indexedFiles = indices.map(idx => idx.file);
    const staleness = new StalenessDetector(ctx.projectRoot, ctx.ctxoRoot);
    const warning = staleness.check(indexedFiles);

    if (!warning) {
      return pass(this.id, this.title, `All ${indices.length} files fresh`, `0/${indices.length} stale`);
    }

    const staleCount = warning.staleFiles.length;
    const pct = staleCount / indices.length;
    const value = `${staleCount}/${indices.length} stale`;

    if (pct <= 0.1) {
      return warn(this.id, this.title, `${staleCount} of ${indices.length} files stale`, 'Run "ctxo index"', value);
    }
    return fail(this.id, this.title, `${staleCount} of ${indices.length} files stale (${Math.round(pct * 100)}%)`, 'Run "ctxo index"', value);
  }
}

export class SymbolCountCheck implements IHealthCheck {
  readonly id = 'symbol_count';
  readonly title = 'Symbol count';

  async run(ctx: CheckContext): Promise<CheckResult> {
    const reader = new JsonIndexReader(ctx.ctxoRoot);
    const indices = reader.readAll();
    const total = indices.reduce((sum, idx) => sum + idx.symbols.length, 0);
    if (total > 0) {
      return pass(this.id, this.title, `${total.toLocaleString()} symbols`, String(total));
    }
    return fail(this.id, this.title, '0 symbols (index empty)', 'Run "ctxo index"', '0');
  }
}

export class EdgeCountCheck implements IHealthCheck {
  readonly id = 'edge_count';
  readonly title = 'Edge count';

  async run(ctx: CheckContext): Promise<CheckResult> {
    const reader = new JsonIndexReader(ctx.ctxoRoot);
    const indices = reader.readAll();
    const total = indices.reduce((sum, idx) => sum + idx.edges.length, 0);
    if (total > 0) {
      return pass(this.id, this.title, `${total.toLocaleString()} edges`, String(total));
    }
    return warn(this.id, this.title, '0 edges (possible isolated files)', undefined, '0');
  }
}

export class OrphanedFilesCheck implements IHealthCheck {
  readonly id = 'orphaned_files';
  readonly title = 'Orphaned index files';

  async run(ctx: CheckContext): Promise<CheckResult> {
    const reader = new JsonIndexReader(ctx.ctxoRoot);
    const indices = reader.readAll();
    if (indices.length === 0) {
      return pass(this.id, this.title, 'no index files to check');
    }

    const sourceFiles = this.getSourceFiles(ctx.projectRoot);
    if (sourceFiles.size === 0) {
      return pass(this.id, this.title, 'none (git ls-files unavailable)');
    }

    const orphaned = indices.filter(idx => !sourceFiles.has(idx.file));
    if (orphaned.length === 0) {
      return pass(this.id, this.title, 'none', '0');
    }
    if (orphaned.length <= 5) {
      return warn(this.id, this.title, `${orphaned.length} orphaned index files`, 'Delete orphaned files from .ctxo/index/', String(orphaned.length));
    }
    return fail(this.id, this.title, `${orphaned.length} orphaned index files`, 'Delete orphaned files from .ctxo/index/', String(orphaned.length));
  }

  private getSourceFiles(projectRoot: string): Set<string> {
    try {
      const output = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
        cwd: projectRoot,
        encoding: 'utf-8',
      });
      return new Set(output.split('\n').map(l => l.trim()).filter(l => l.length > 0));
    } catch {
      return new Set();
    }
  }
}

export class CoChangesCacheCheck implements IHealthCheck {
  readonly id = 'co_changes_cache';
  readonly title = 'Co-changes cache';

  async run(ctx: CheckContext): Promise<CheckResult> {
    const coChangesPath = join(ctx.ctxoRoot, 'index', 'co-changes.json');
    if (existsSync(coChangesPath)) {
      return pass(this.id, this.title, 'present');
    }
    return warn(this.id, this.title, 'missing (co-change analysis disabled)', 'Run "ctxo index" with git history');
  }
}

export class SchemaVersionCheck implements IHealthCheck {
  readonly id = 'schema_version';
  readonly title = 'Schema version';

  async run(ctx: CheckContext): Promise<CheckResult> {
    const manager = new SchemaManager(ctx.ctxoRoot);
    const stored = manager.readStoredVersion();
    const current = manager.currentVersion();

    if (!stored) {
      return fail(this.id, this.title, 'No schema version found', 'Run "ctxo index"');
    }
    if (manager.isCompatible()) {
      return pass(this.id, this.title, `${stored} (current)`, stored);
    }
    return fail(this.id, this.title, `${stored} (expected ${current})`, 'Run "ctxo index" to re-index with current schema', stored);
  }
}
