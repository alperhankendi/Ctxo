import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

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

  it('tarball size is reasonable (< 2000KB)', { timeout: 30_000 }, () => {
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
    // The owner set 2000KB ahead of the stack merge: PR 1B (1712.86KB) plus PR 2A (tiered agent
    // rules, about 1870KB together) would cross 1800KB.
    expect(sizeKB).toBeLessThan(2000);
    expect(sizeKB).toBeGreaterThan(1); // Sanity: not empty (dist/ may not exist in CI pre-build)
  });
});
