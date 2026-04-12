import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { StalenessDetector } from '../staleness-detector.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  tempDirs.length = 0;
});

function setup(): { projectRoot: string; ctxoRoot: string } {
  const projectRoot = mkdtempSync(join(tmpdir(), 'ctxo-stale-'));
  tempDirs.push(projectRoot);
  const ctxoRoot = join(projectRoot, '.ctxo');
  return { projectRoot, ctxoRoot };
}

describe('StalenessDetector', () => {
  it('returns undefined when all files are fresh', () => {
    const { projectRoot, ctxoRoot } = setup();

    // Create source and index with same timestamp
    mkdirSync(join(projectRoot, 'src'), { recursive: true });
    writeFileSync(join(projectRoot, 'src', 'foo.ts'), 'export const x = 1;');

    mkdirSync(join(ctxoRoot, 'index', 'src'), { recursive: true });
    writeFileSync(join(ctxoRoot, 'index', 'src', 'foo.ts.json'), '{}');

    const detector = new StalenessDetector(projectRoot, ctxoRoot);
    const result = detector.check(['src/foo.ts']);

    expect(result).toBeUndefined();
  });

  it('returns stale files when source is newer than index', async () => {
    const { projectRoot, ctxoRoot } = setup();

    // Create index first (older)
    mkdirSync(join(ctxoRoot, 'index', 'src'), { recursive: true });
    writeFileSync(join(ctxoRoot, 'index', 'src', 'foo.ts.json'), '{}');

    // Wait a bit then create source (newer)
    await new Promise((r) => setTimeout(r, 1100));
    mkdirSync(join(projectRoot, 'src'), { recursive: true });
    writeFileSync(join(projectRoot, 'src', 'foo.ts'), 'export const x = 2;');

    const detector = new StalenessDetector(projectRoot, ctxoRoot);
    const result = detector.check(['src/foo.ts']);

    expect(result).toBeDefined();
    expect(result?.staleFiles).toContain('src/foo.ts');
    expect(result?.message).toContain('1 file(s)');
  });

  it('handles missing index file for existing source', () => {
    const { projectRoot, ctxoRoot } = setup();

    mkdirSync(join(projectRoot, 'src'), { recursive: true });
    writeFileSync(join(projectRoot, 'src', 'foo.ts'), 'export const x = 1;');
    mkdirSync(join(ctxoRoot, 'index'), { recursive: true });

    const detector = new StalenessDetector(projectRoot, ctxoRoot);
    const result = detector.check(['src/foo.ts']);

    // Missing index file is skipped, not flagged as stale
    expect(result).toBeUndefined();
  });

  it('returns undefined for empty file list', () => {
    const { projectRoot, ctxoRoot } = setup();
    mkdirSync(join(ctxoRoot, 'index'), { recursive: true });

    const detector = new StalenessDetector(projectRoot, ctxoRoot);
    expect(detector.check([])).toBeUndefined();
  });
});
