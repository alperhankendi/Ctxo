import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as entry from '../index.js';

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

describe('@ctxo/sql-extract package', () => {
  it('declares no runtime dependencies', () => {
    const pkg = JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf8'));
    expect(pkg.dependencies).toBeUndefined();
    expect(pkg.peerDependencies).toBeUndefined();
    expect(pkg.version).toBe('0.0.0');
  });

  it('source modules import only relative paths', () => {
    const files = sourceFiles(join(pkgRoot, 'src'));
    expect(files.length).toBeGreaterThan(0);
    const re = /(?:\bfrom\s*|\bimport\s*\(?\s*)['"]([^'"]+)['"]/g;
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(re)) {
        expect(m[1], `${file} imports ${m[1]}`).toMatch(/^\.\//);
      }
    }
  });

  it('pins the exact set of public runtime exports', () => {
    // Types are erased at runtime, so this is the whole runtime surface of the package.
    expect(Object.keys(entry).sort()).toEqual([
      'DEFAULT_SQL_SCHEMA',
      'SQL_DIALECT',
      'extractSqlAccesses',
      'extractSqlDefinitions',
    ]);
    expect(typeof entry.extractSqlAccesses).toBe('function');
    expect(typeof entry.extractSqlDefinitions).toBe('function');
  });

  it('re-exports only from the package entry', () => {
    const re = /\bexport\s+(?:type\s+)?(?:\*|\{[^}]*\})\s*from\b/;
    for (const file of sourceFiles(join(pkgRoot, 'src'))) {
      if (file.endsWith(join('src', 'index.ts'))) continue;
      expect(re.test(readFileSync(file, 'utf8')), `${file} re-exports`).toBe(false);
    }
  });
});
