import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

interface PackageJson {
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

/** Every non-test `.ts` file under `dir`. */
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

describe('@ctxo/lang-typescript package', () => {
  it('depends on @ctxo/sql-extract and keeps the plugin-api peer range', () => {
    const pkg = JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf8')) as PackageJson;
    expect(pkg.dependencies?.['@ctxo/sql-extract']).toBe('workspace:^');
    expect(pkg.peerDependencies?.['@ctxo/plugin-api']).toBe('^0.7.3 || ^0.8.0 || ^0.9.0');

    // The bundle keeps it external, like ts-morph and the plugin API.
    const tsup = readFileSync(join(pkgRoot, 'tsup.config.ts'), 'utf8');
    expect(tsup).toMatch(/external:\s*\[[^\]]*'@ctxo\/sql-extract'/);
  });

  it('source imports stay within the allowed set', () => {
    const files = sourceFiles(join(pkgRoot, 'src'));
    expect(files.some((f) => f.endsWith(join('sql', 'sql-edges.ts')))).toBe(true);
    const re = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)['"]([^'"]+)['"]/g;
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(re)) {
        const spec = m[1]!;
        expect(spec, `${file} imports ${spec}`).toMatch(/^(?:@ctxo\/plugin-api|@ctxo\/sql-extract|picomatch|ts-morph|node:[a-z:/_]+|\.{1,2}\/.*)$/);
      }
      expect(/['"]@ctxo\/cli\b/.test(text), `${file} names @ctxo/cli as a module`).toBe(false);
    }
  });
});
