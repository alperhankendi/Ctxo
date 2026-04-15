import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync, cpSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { IndexCommand } from '../index-command.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, 'fixtures', 'sample-project');

function setupTempProject(): string {
  const tempDir = mkdtempSync(join(tmpdir(), 'ctxo-cli-'));

  // Copy fixture files
  cpSync(FIXTURES_DIR, tempDir, { recursive: true });

  // Init git repo so git ls-files works
  execFileSync('git', ['init'], { cwd: tempDir, stdio: 'ignore' });
  execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'user.name=Test', '-c', 'user.email=test@test.com', 'add', '.'], { cwd: tempDir, stdio: 'ignore' });
  execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'user.name=Test', '-c', 'user.email=test@test.com', 'commit', '-m', 'init'], { cwd: tempDir, stdio: 'ignore' });

  return tempDir;
}

describe('IndexCommand', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = setupTempProject();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('discovers all .ts files in project directory', async () => {
    const cmd = new IndexCommand(tempDir);
    await cmd.run();

    const indexDir = join(tempDir, '.ctxo', 'index', 'src');
    expect(existsSync(indexDir)).toBe(true);

    const files = readdirSync(indexDir).filter((f) => f.endsWith('.json'));
    expect(files).toHaveLength(3);
  });

  it('writes one JSON file per source file to .ctxo/index/', async () => {
    const cmd = new IndexCommand(tempDir);
    await cmd.run();

    const greetIndex = join(tempDir, '.ctxo', 'index', 'src', 'greet.ts.json');
    expect(existsSync(greetIndex)).toBe(true);

    const content = JSON.parse(readFileSync(greetIndex, 'utf-8'));
    expect(content.file).toBe('src/greet.ts');
    expect(content.symbols.length).toBeGreaterThan(0);
  });

  it('creates schema-version file on first run', async () => {
    const cmd = new IndexCommand(tempDir);
    await cmd.run();

    const versionFile = join(tempDir, '.ctxo', 'index', 'schema-version');
    expect(existsSync(versionFile)).toBe(true);
    expect(readFileSync(versionFile, 'utf-8').trim()).toBe('1.0.0');
  });

  it('populates SQLite cache from extracted data', async () => {
    const cmd = new IndexCommand(tempDir);
    await cmd.run();

    const dbFile = join(tempDir, '.ctxo', '.cache', 'symbols.db');
    expect(existsSync(dbFile)).toBe(true);
  });

  it('ensures .ctxo/.cache/ is in .gitignore', async () => {
    const cmd = new IndexCommand(tempDir);
    await cmd.run();

    const gitignore = readFileSync(join(tempDir, '.gitignore'), 'utf-8');
    expect(gitignore).toContain('.ctxo/.cache/');
  });

  it('handles project with zero supported files gracefully', async () => {
    // Create empty project
    const emptyDir = mkdtempSync(join(tmpdir(), 'ctxo-empty-'));
    execFileSync('git', ['init'], { cwd: emptyDir, stdio: 'ignore' });
    mkdirSync(join(emptyDir, 'src'));
    writeFileSync(join(emptyDir, 'src', 'readme.md'), '# Hello', 'utf-8');
    execFileSync('git', ['add', '.'], { cwd: emptyDir, stdio: 'ignore' });
    execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'user.name=Test', '-c', 'user.email=test@test.com', 'commit', '-m', 'init'], { cwd: emptyDir, stdio: 'ignore' });

    const cmd = new IndexCommand(emptyDir);
    await cmd.run();

    // Should not crash, schema version should still exist
    const versionFile = join(emptyDir, '.ctxo', 'index', 'schema-version');
    expect(existsSync(versionFile)).toBe(true);

    rmSync(emptyDir, { recursive: true, force: true });
  });

  it('extracts symbols correctly from fixture files', async () => {
    const cmd = new IndexCommand(tempDir);
    await cmd.run();

    const utilsIndex = join(tempDir, '.ctxo', 'index', 'src', 'utils.ts.json');
    const content = JSON.parse(readFileSync(utilsIndex, 'utf-8'));

    const symbolNames = content.symbols.map((s: { name: string }) => s.name);
    expect(symbolNames).toContain('formatName');
    expect(symbolNames).toContain('VERSION');
  });

  it('resolves cross-file import edge kinds correctly via multi-file project', async () => {
    const cmd = new IndexCommand(tempDir);
    await cmd.run();

    const greetIndex = join(tempDir, '.ctxo', 'index', 'src', 'greet.ts.json');
    const content = JSON.parse(readFileSync(greetIndex, 'utf-8'));

    const importEdge = content.edges.find(
      (e: { kind: string; to: string }) => e.kind === 'imports' && e.to.includes('formatName')
    );
    expect(importEdge).toBeDefined();
    // formatName is a function in utils.ts — should resolve to ::function, not ::class (heuristic)
    expect(importEdge.to).toBe('src/utils.ts::formatName::function');
  });

  it('extracts interfaces and type aliases from fixture files', async () => {
    const cmd = new IndexCommand(tempDir);
    await cmd.run();

    const typesIndex = join(tempDir, '.ctxo', 'index', 'src', 'types.ts.json');
    const content = JSON.parse(readFileSync(typesIndex, 'utf-8'));

    const symbolNames = content.symbols.map((s: { name: string }) => s.name);
    expect(symbolNames).toContain('User');
    expect(symbolNames).toContain('Role');
  });

  it('writes communities.json on full index run', async () => {
    const cmd = new IndexCommand(tempDir);
    await cmd.run();
    expect(existsSync(join(tempDir, '.ctxo', 'index', 'communities.json'))).toBe(true);
  });

  it('skips community detection with --skip-community and preserves any existing snapshot', async () => {
    // Full run first — produces real snapshot.
    await new IndexCommand(tempDir).run();
    const snapshotPath = join(tempDir, '.ctxo', 'index', 'communities.json');
    expect(existsSync(snapshotPath)).toBe(true);
    const beforeMtime = readFileSync(snapshotPath, 'utf-8');

    // Re-index with skipCommunity — snapshot must not be touched.
    await new IndexCommand(tempDir).run({ skipCommunity: true });
    const afterMtime = readFileSync(snapshotPath, 'utf-8');
    expect(afterMtime).toBe(beforeMtime);
  });

  it('recomputes community snapshot over the FULL project graph during --file incremental re-index', async () => {
    // Full run establishes real snapshot.
    await new IndexCommand(tempDir).run();
    const snapshotPath = join(tempDir, '.ctxo', 'index', 'communities.json');
    const before = JSON.parse(readFileSync(snapshotPath, 'utf-8'));
    const beforeClusterCount = new Set(
      (before.communities as Array<{ communityId: number }>).map((c) => c.communityId),
    ).size;
    const beforeSymbolCount = before.communities.length;

    // Incremental re-index of a single file MUST refresh communities.json using the full
    // graph (committed index merged with in-memory fileIndex) — not just the 1-file subgraph.
    await new IndexCommand(tempDir).run({ file: 'src/types.ts' });
    const after = JSON.parse(readFileSync(snapshotPath, 'utf-8'));
    const afterClusterCount = new Set(
      (after.communities as Array<{ communityId: number }>).map((c) => c.communityId),
    ).size;
    const afterSymbolCount = after.communities.length;

    // computedAt must advance (snapshot refreshed).
    expect(after.computedAt).not.toBe(before.computedAt);
    // Symbol count must match the full project — NOT just the 1-file subgraph.
    // If --file mode incorrectly ran over the subgraph we would see only that file's symbols.
    expect(afterSymbolCount).toBeGreaterThanOrEqual(beforeSymbolCount);
    // Cluster count stays in the right order of magnitude (no singleton explosion).
    expect(afterClusterCount).toBeLessThanOrEqual(beforeSymbolCount);
  });
});
