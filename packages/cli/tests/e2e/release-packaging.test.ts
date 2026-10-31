import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync, execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

describe('Release Packaging', () => {
  it('package.json has correct bin field', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'));
    expect(pkg.bin).toEqual({ ctxo: 'dist/index.js' });
  });

  it('package.json has files field limiting tarball contents', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'));
    expect(pkg.files).toContain('dist/');
    expect(pkg.files).toContain('README.md');
    expect(pkg.files).not.toContain('src/');
    expect(pkg.files).not.toContain('tests/');
  });

  it('package.json type is module (ESM)', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'));
    expect(pkg.type).toBe('module');
  });

  it('package.json engines requires Node >= 20', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'));
    expect(pkg.engines.node).toBe('>=20');
  });

  it('dist/index.js exists after build', () => {
    expect(existsSync(join(ROOT, 'dist', 'index.js'))).toBe(true);
  });

  it('exports publish the entry and the internal API', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'));
    expect(pkg.exports).toEqual({
      '.': { types: './dist/index.d.ts', import: './dist/index.js' },
      './internal': { types: './dist/internal.d.ts', import: './dist/internal.js' },
      './package.json': './package.json',
    });
    expect(existsSync(join(ROOT, 'dist', 'internal.js'))).toBe(true);
    expect(existsSync(join(ROOT, 'dist', 'internal.d.ts'))).toBe(true);
  });

  it('the internal API resolves through the package name', { timeout: 30_000 }, () => {
    const dir = mkdtempSync(join(tmpdir(), 'ctxo-internal-api-'));
    const link = join(dir, 'node_modules', '@ctxo', 'cli');
    mkdirSync(dirname(link), { recursive: true });
    symlinkSync(ROOT, link, 'junction');
    try {
      const output = execFileSync(
        process.execPath,
        ['--input-type=module', '-e', "import('@ctxo/cli/internal').then(m => process.stdout.write(typeof m.createModuleHost))"],
        { cwd: dir, encoding: 'utf-8' },
      );
      expect(output).toBe('function');
    } finally {
      // Remove the link before the folder, so nothing can ever walk into the package it points at.
      unlinkSync(link);
      if (!existsSync(link)) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it('npm pack --dry-run lists the internal entry and its types', { timeout: 30_000 }, () => {
    const output = execSync('npm pack --dry-run --json', { cwd: ROOT, encoding: 'utf-8' });
    const files: string[] = (JSON.parse(output)[0]?.files ?? []).map((f: { path: string }) => f.path);
    expect(files).toContain('dist/internal.js');
    expect(files).toContain('dist/internal.d.ts');
  });

  it('npm pack --dry-run excludes source and test files', { timeout: 30_000 }, () => {
    const output = execSync('npm pack --dry-run --json', { cwd: ROOT, encoding: 'utf-8' });
    const info = JSON.parse(output);
    const files: string[] = (info[0]?.files ?? []).map((f: { path: string }) => f.path);

    // Should NOT contain source or test files
    expect(files.some((f: string) => f.startsWith('src/'))).toBe(false);
    expect(files.some((f: string) => f.includes('__tests__'))).toBe(false);
    expect(files.some((f: string) => f.includes('vitest.config'))).toBe(false);

    // Should contain dist files
    expect(files.some((f: string) => f.includes('dist/index.js'))).toBe(true);
    expect(files.some((f: string) => f === 'package.json')).toBe(true);
  });

  it('npm pack --dry-run ships no source maps', { timeout: 30_000 }, () => {
    const output = execSync('npm pack --dry-run --json', { cwd: ROOT, encoding: 'utf-8' });

    const files: string[] = JSON.parse(output)[0]?.files?.map((f: { path: string }) => f.path) ?? [];

    expect(files.filter((f) => f.endsWith('.map'))).toEqual([]);
    expect(files).toContain('dist/index.js');
    expect(files).toContain('dist/internal.js');
  });

  it('tarball size is reasonable (< 900KB)', { timeout: 30_000 }, () => {
    const output = execSync('npm pack --dry-run --json', { cwd: ROOT, encoding: 'utf-8' });

    const info = JSON.parse(output);
    const sizeBytes = info[0]?.unpackedSize ?? 0;
    const sizeKB = sizeBytes / 1024;

    // 950KB → 1050KB (v0.8 graphology) → 1200KB (v0.8 follow-ups: report
    // templates, architectural-intelligence helpers, cluster-label masker,
    // snapshot staleness, drift stability filter) → 1350KB (v0.8 lang-java
    // CLI integration: install command, doctor checks, gate handler). PR 0 (co-change engine,
    // incremental --files/--commit runs, stale-entry pruning) raised the limit to 1400KB, and the
    // rest of PR 0 (one snapshot per commit, co-change in every blast-radius caller, hook v2 with
    // its shared-directory guard, `--help` for every subcommand, docs shipped in the tarball) to
    // 1450KB (measured 1420.70KB).
    // PR 1A contexts view (file graph, clustering, overlay, CLI) → 1600KB (measured 1564.51KB).
    // PR 1B (plugin protocol v2, @ctxo/lang-sql registration, UTF-16 sources, the doctor C# tier
    // check) → 1700KB (measured 1606.42KB; 1592.09KB before the C# tier check). The rest of PR 1B
    // measured 1667.57KB (contexts-view data coupling, docs) and 1684.11KB (data-resource tie-break,
    // R4 attribution); its final-review fixes (one data-resource identity for the impact tools, the
    // linear R4 pass, annotations only at L4, the review carries) crossed the limit at 1711.62KB,
    // so it is 1800KB. The tarball also carries the root README.md and llms*.txt, so docs count too.
    // On its own branch (from 1450KB), PR 2A (#159: tiered rules block and its parser, init parts
    // pipeline, agent-setup doctor checks and fixes, about 49KB of new source shipped as JS plus
    // source maps, and the longer docs) raised it to 1550KB (measured 1530.42KB after the rebase).
    // The PR 2A final fix (formatter-stable blocks and normalised comparison, linked rules files,
    // versioned skills, one hold rule shared by init, the dry run and --fix, and its JSDoc, shipped
    // as JS and again in the source maps) raised it to 1650KB (measured 1574.88KB: the next 50KB
    // step, 1600KB, plus 50KB of headroom). The owner set 2000KB ahead of the stack merge: PR 1B
    // (#156, 1712.86KB) plus PR 2A (tiered agent rules, about 1870KB together) would cross 1800KB;
    // PR 2A alone measured 1587.18KB at that change.
    // PR 2B (#156) adds the `@ctxo/cli/internal` entry (its bundled declarations, about 31KB, and the code
    // splitting shares between the two entries): 1905.87KB before it, 1946.30KB after, still under 2000KB.
    // The fast hook route and the module seams (index pass, commands, doctor checks) measured 1999.45KB.
    // The MCP module seams (the response enricher on six core tools, module tools with their envelope,
    // masking and schema checks, get_why_context through the envelope, shipped as JS plus source maps)
    // crossed the limit at 2024.33KB, so it is 2050KB, the next 50KB step.
    // Global installs (K15: install kinds, `ctxo install domain`, global MCP entries, the install_copies
    // check, shipped as JS plus source maps) crossed it at 2052.03KB, so it is 2100KB, the next 50KB step.
    // The rest of PR 2B (the module's response enrichers, the six tool description clauses, the longer
    // README and llms*.txt, and the merge of language parity and 0.13.1) measured 2124.73KB, so it is
    // 2150KB, the next 50KB step. Source maps were a large part of the tarball; slimming them was the owner's
    // call (spec 4).
    // PR 3 (#156) stops publishing source maps (the owner's call): 2128.79KB to 766.07KB, so the limit is 850KB.
    // The new-only boundary mode (#156: base-index.ts, the two host services, the longer llms*.txt) crossed it
    // at 854.35KB, so it is 900KB, the next 50KB step.
    expect(sizeKB).toBeLessThan(900);
    expect(sizeKB).toBeGreaterThan(1); // Sanity: not empty (dist/ may not exist in CI pre-build)
  });
});
