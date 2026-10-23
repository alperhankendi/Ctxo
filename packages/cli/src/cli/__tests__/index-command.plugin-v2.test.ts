import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, cpSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import type { CodeFact, CtxoLanguagePlugin, SymbolNode, GraphEdge } from '@ctxo/plugin-api';
import { isolateGitEnv, type IsolatedGitEnv } from './git-test-env.js';

const SYMBOLS: SymbolNode[] = [
  {
    symbolId: 'src/a.fake::dbo.loans::table',
    name: 'dbo.loans',
    kind: 'table',
    startLine: 0,
    endLine: 3,
    annotations: [{ name: 'columns', args: ['id', 'member_id'] }],
  },
  { symbolId: 'src/a.fake::dbo.usp_close::procedure', name: 'dbo.usp_close', kind: 'procedure', startLine: 4, endLine: 9 },
];
const EDGES: GraphEdge[] = [
  { from: 'src/a.fake::dbo.usp_close::procedure', to: 'dbo.loans::table', kind: 'writes' },
  { from: 'src/a.fake::dbo.usp_close::procedure', to: 'dbo.usp_audit::procedure', kind: 'executes' },
];
const FACT: CodeFact = { kind: 'endpoint', symbolId: 'src/a.fake::dbo.usp_close::procedure', line: 5, text: 'POST /close' };

const extractFacts = vi.hoisted(() => vi.fn());

vi.mock('../../adapters/language/plugin-discovery.js', () => {
  const plugin: CtxoLanguagePlugin = {
    apiVersion: '2',
    id: 'fake',
    name: 'fake',
    version: '0.0.1',
    extensions: ['.fake'],
    tier: 'syntax',
    createAdapter: () => ({
      extractSymbols: async () => SYMBOLS,
      extractEdges: async () => EDGES,
      extractComplexity: async () => [],
      extractFacts,
      isSupported: () => true,
    }),
  };
  return {
    discoverPlugins: async () => ({ plugins: [{ plugin, specifier: 'ctxo-lang-fake' }], failures: [] }),
  };
});

import { IndexCommand } from '../index-command.js';
import { JsonIndexReader } from '../../adapters/storage/json-index-reader.js';
import { SqliteStorageAdapter } from '../../adapters/storage/sqlite-storage-adapter.js';

const IDENTITY = ['-c', 'commit.gpgsign=false', '-c', 'user.name=Test', '-c', 'user.email=test@test.com'];

function createProject(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ctxo-plugin-v2-'));
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'src', 'a.fake'), 'create table dbo.loans (id int);\n', 'utf-8');
  execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', [...IDENTITY, 'add', '.'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', [...IDENTITY, 'commit', '-m', 'init'], { cwd: dir, stdio: 'ignore' });
  return dir;
}

describe('IndexCommand with a protocol v2 plugin', () => {
  let dir: string;
  let gitEnv: IsolatedGitEnv;

  beforeEach(() => {
    gitEnv = isolateGitEnv();
    extractFacts.mockReset();
    extractFacts.mockResolvedValue([FACT]);
    dir = createProject();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    gitEnv.restore();
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch {
      /* best effort */
    }
  });

  it("a v2 plugin's kinds, annotations and edges survive the JSON round trip and reach SQLite", async () => {
    await new IndexCommand(dir).run({ skipHistory: true });

    const entries = new JsonIndexReader(join(dir, '.ctxo')).readAll();
    expect(entries).toHaveLength(1);
    expect(entries[0]!.symbols).toEqual(SYMBOLS);
    expect(entries[0]!.edges).toEqual(EDGES);

    const scratch = mkdtempSync(join(tmpdir(), 'ctxo-v2-sqlite-'));
    try {
      mkdirSync(join(scratch, '.cache'), { recursive: true });
      cpSync(join(dir, '.ctxo', '.cache', 'symbols.db'), join(scratch, '.cache', 'symbols.db'));
      const storage = new SqliteStorageAdapter(scratch);
      try {
        await storage.init();
        expect(storage.getAllSymbols().map((s) => s.symbolId)).toContain('src/a.fake::dbo.loans::table');
        expect(storage.getAllEdges().some((e) => e.kind === 'writes')).toBe(true);
      } finally {
        storage.close();
      }
    } finally {
      rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it('facts are extracted and written only with index.facts: true', async () => {
    await new IndexCommand(dir).run({ skipHistory: true });
    expect(extractFacts).not.toHaveBeenCalled();
    const jsonFile = join(dir, '.ctxo', 'index', 'src', 'a.fake.json');
    expect(Object.keys(JSON.parse(readFileSync(jsonFile, 'utf-8')))).not.toContain('facts');

    writeFileSync(join(dir, '.ctxo', 'config.yaml'), 'version: "1.0"\nindex:\n  facts: true\n', 'utf-8');
    await new IndexCommand(dir).run({ skipHistory: true });
    expect(extractFacts).toHaveBeenCalled();
    const entries = new JsonIndexReader(join(dir, '.ctxo')).readAll();
    expect(entries[0]!.facts).toEqual([FACT]);
  });
});
