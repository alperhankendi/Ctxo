import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import defaultPlugin, { plugin, SqlAdapter } from '../index.js';

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, '..', '..');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name !== '__tests__') out.push(...sourceFiles(full));
    } else if (name.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

describe('@ctxo/lang-sql plugin', () => {
  it('declares protocol 2, id sql, the .sql extension and the syntax tier', () => {
    expect(plugin.apiVersion).toBe('2');
    expect(plugin.id).toBe('sql');
    expect(plugin.name).toBe('SQL (T-SQL definitions and data access)');
    expect(plugin.extensions).toEqual(['.sql']);
    expect(plugin.tier).toBe('syntax');
    expect(defaultPlugin).toBe(plugin);
  });

  it('creates a SqlAdapter that handles .sql files', () => {
    const ctx = {
      logger: { debug() {}, info() {}, warn() {}, error() {} },
      projectRoot: '/repo',
      workspace: { root: '/repo', packages: [] },
      config: {},
    } as never;
    const adapter = plugin.createAdapter(ctx);
    expect(adapter).toBeInstanceOf(SqlAdapter);
    expect(adapter.isSupported('db/schema.sql')).toBe(true);
    expect(adapter.isSupported('src/loans.ts')).toBe(false);
  });

  it('version equals package.json version', () => {
    const pkg = JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf8')) as { version: string };
    expect(plugin.version).toBe(pkg.version);
  });

  it('source imports only @ctxo/plugin-api types, @ctxo/sql-extract, node built-ins and relative paths', () => {
    const files = sourceFiles(join(pkgRoot, 'src'));
    expect(files.length).toBeGreaterThan(0);
    const re = /(?:\bfrom\s*|\bimport\s*\(?\s*)['"]([^'"]+)['"]/g;
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(re)) {
        const spec = m[1]!;
        expect(spec, `${file} imports ${spec}`).toMatch(/^(?:@ctxo\/plugin-api|@ctxo\/sql-extract|node:[a-z:/_]+|\.{1,2}\/.*)$/);
      }
      // The protocol package is a peer dependency: only its types may be imported.
      for (const m of text.matchAll(/^\s*(import|export)\s+(type\s+)?[^;]*?\bfrom\s*['"]@ctxo\/plugin-api['"]/gm)) {
        expect(m[2], `${file}: ${m[0]}`).toBeDefined();
      }
      // Also catches a require() or dynamic specifier the import pattern above cannot see.
      expect(/['"]@ctxo\/cli\b/.test(text), `${file} names @ctxo/cli as a module`).toBe(false);
    }
  });

  it('re-exports only from the package entry and never writes to stdout', () => {
    const reExport = /\bexport\s+(?:type\s+)?(?:\*|\{[^}]*\})\s*from\b/;
    for (const file of sourceFiles(join(pkgRoot, 'src'))) {
      const text = readFileSync(file, 'utf8');
      if (!file.endsWith(join('src', 'index.ts'))) expect(reExport.test(text), `${file} re-exports`).toBe(false);
      expect(/console\.(log|info|debug)\b/.test(text), `${file} uses console`).toBe(false);
    }
  });
});
