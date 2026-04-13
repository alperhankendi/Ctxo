import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { IndexCommand } from '../index-command.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  tempDirs.length = 0;
});

function gitInit(dir: string): void {
  execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['add', '.'], { cwd: dir, stdio: 'ignore' });
  execFileSync(
    'git',
    ['-c', 'commit.gpgsign=false', '-c', 'user.name=Test', '-c', 'user.email=t@t.com', 'commit', '-m', 'init'],
    { cwd: dir, stdio: 'ignore' },
  );
}

function indexedFiles(root: string): string[] {
  const idxDir = join(root, '.ctxo', 'index');
  if (!existsSync(idxDir)) return [];
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.name.endsWith('.json')) out.push(p);
    }
  };
  walk(idxDir);
  return out;
}

describe('IndexCommand with .ctxo/config.yaml ignore', () => {
  it('skips files matching index.ignore globs', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'ctxo-ignore-files-'));
    tempDirs.push(tempDir);

    mkdirSync(join(tempDir, 'src'), { recursive: true });
    mkdirSync(join(tempDir, 'fixtures'), { recursive: true });
    mkdirSync(join(tempDir, '.ctxo'), { recursive: true });
    writeFileSync(join(tempDir, 'src', 'keep.ts'), 'export const a = 1;');
    writeFileSync(join(tempDir, 'fixtures', 'skip.ts'), 'export const b = 2;');
    writeFileSync(
      join(tempDir, '.ctxo', 'config.yaml'),
      `version: "1.0"\nindex:\n  ignore:\n    - "fixtures/**"\n`,
    );
    writeFileSync(join(tempDir, 'package.json'), JSON.stringify({
      name: 'ignore-files-test',
      devDependencies: { '@ctxo/lang-typescript': 'workspace:*' },
    }));
    gitInit(tempDir);

    await new IndexCommand(tempDir).run();

    const files = indexedFiles(tempDir).map((f) => f.replace(/\\/g, '/'));
    expect(files.some((f) => f.includes('keep.ts.json'))).toBe(true);
    expect(files.some((f) => f.includes('skip.ts.json'))).toBe(false);
  });

  it('skips workspaces matching index.ignoreProjects globs', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'ctxo-ignore-ws-'));
    tempDirs.push(tempDir);

    mkdirSync(join(tempDir, 'packages', 'keep', 'src'), { recursive: true });
    mkdirSync(join(tempDir, 'packages', 'experimental-foo', 'src'), { recursive: true });
    mkdirSync(join(tempDir, '.ctxo'), { recursive: true });
    writeFileSync(join(tempDir, 'packages', 'keep', 'src', 'a.ts'), 'export const x = 1;');
    writeFileSync(join(tempDir, 'packages', 'keep', 'package.json'), JSON.stringify({ name: 'keep' }));
    writeFileSync(join(tempDir, 'packages', 'experimental-foo', 'src', 'b.ts'), 'export const y = 2;');
    writeFileSync(
      join(tempDir, 'packages', 'experimental-foo', 'package.json'),
      JSON.stringify({ name: 'experimental-foo' }),
    );
    writeFileSync(
      join(tempDir, '.ctxo', 'config.yaml'),
      `version: "1.0"\nindex:\n  ignoreProjects:\n    - "packages/experimental-*"\n`,
    );
    writeFileSync(join(tempDir, 'package.json'), JSON.stringify({
      name: 'root',
      workspaces: ['packages/*'],
      devDependencies: { '@ctxo/lang-typescript': 'workspace:*' },
    }));
    gitInit(tempDir);

    await new IndexCommand(tempDir).run();

    const files = indexedFiles(tempDir).map((f) => f.replace(/\\/g, '/'));
    expect(files.some((f) => f.includes('/keep/src/a.ts.json'))).toBe(true);
    expect(files.some((f) => f.includes('experimental-foo'))).toBe(false);
  });
});
