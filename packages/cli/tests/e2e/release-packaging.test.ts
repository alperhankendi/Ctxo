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

  it('tarball size is reasonable (< 1050KB)', { timeout: 30_000 }, () => {
    const output = execSync('npm pack --dry-run --json', { cwd: ROOT, encoding: 'utf-8' });

    const info = JSON.parse(output);
    const sizeBytes = info[0]?.unpackedSize ?? 0;
    const sizeKB = sizeBytes / 1024;

    // Bumped from 950KB to 1050KB in v0.8 for graphology community-detection bundles.
    expect(sizeKB).toBeLessThan(1050);
    expect(sizeKB).toBeGreaterThan(1); // Sanity: not empty (dist/ may not exist in CI pre-build)
  });
});
