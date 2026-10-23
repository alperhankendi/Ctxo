import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { computeAndWriteContextsView } from '../index-contexts-view.js';
import { DEFAULT_CONFIG } from '../../core/config/config-schema.js';
import type { ContextsView } from '../../core/contexts-view/contexts-view-builder.js';
import type { CoChangeEntry, CommunitySnapshot, FileIndex, GraphEdge, SymbolAnnotation, SymbolNode } from '../../core/types.js';

const FILES = ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts'];

const SNAPSHOT: CommunitySnapshot = {
  version: 1,
  computedAt: '2026-10-21T00:00:00.000Z',
  commitSha: 'abc1234',
  modularity: 0,
  communities: [],
  godNodes: [],
  edgeQuality: 'full',
  crossClusterEdges: 0,
};

function plain(file: string): FileIndex {
  return { file, lastModified: 1, symbols: [], edges: [], intent: [], antiPatterns: [] };
}

const PRODUCTION = ['src/Lending/LoanService.cs', 'src/Lending/BookCatalog.cs', 'src/Lending/PatronLedger.cs'];

function classOf(file: string, annotations?: readonly SymbolAnnotation[]): SymbolNode {
  const name = file.slice(file.lastIndexOf('/') + 1, -'.cs'.length);
  return {
    symbolId: `${file}::${name}::class`,
    name,
    kind: 'class',
    startLine: 1,
    endLine: 20,
    ...(annotations ? { annotations } : {}),
  };
}

function methodOf(file: string, name: string, annotations?: readonly SymbolAnnotation[]): SymbolNode {
  return {
    symbolId: `${file}::${name}::method`,
    name,
    kind: 'method',
    startLine: 2,
    endLine: 6,
    ...(annotations ? { annotations } : {}),
  };
}

function calls(from: string, to: string): GraphEdge {
  return { from, to, kind: 'calls' };
}

/** Three production files that call each other; `annotateFirst` gives the first a non-test annotation. */
function lendingProduction(options: { readonly annotateFirst?: boolean } = {}): FileIndex[] {
  const [loans, books, ledger] = PRODUCTION as [string, string, string];
  const loanClass = classOf(loans, options.annotateFirst ? [{ name: 'Serializable' }] : undefined);
  const bookClass = classOf(books);
  const ledgerClass = classOf(ledger);
  const index = (file: string, symbols: SymbolNode[], edges: GraphEdge[]): FileIndex => ({
    ...plain(file),
    symbols,
    edges,
  });
  return [
    index(loans, [loanClass], [calls(loanClass.symbolId, bookClass.symbolId), calls(loanClass.symbolId, ledgerClass.symbolId)]),
    index(books, [bookClass], [calls(bookClass.symbolId, ledgerClass.symbolId)]),
    index(ledger, [ledgerClass], []),
  ];
}

/** A file with one method that calls into every production file. */
function linkedMethodFile(file: string, annotations?: readonly SymbolAnnotation[]): FileIndex {
  const method = methodOf(file, 'ChecksLoans', annotations);
  return {
    ...plain(file),
    symbols: [method],
    edges: PRODUCTION.map((target) => calls(method.symbolId, `${target}::${classOf(target).name}::class`)),
  };
}

function filesInView(view: ContextsView): string[] {
  return [...view.candidates.flatMap((candidate) => candidate.files), ...view.unclustered.files].sort();
}

describe('computeAndWriteContextsView', () => {
  const dirs: string[] = [];

  function viewOf(indices: readonly FileIndex[]): ContextsView {
    const projectRoot = mkdtempSync(join(tmpdir(), 'ctxo-contexts-step-'));
    dirs.push(projectRoot);
    const ctxoRoot = join(projectRoot, '.ctxo');
    mkdirSync(join(ctxoRoot, 'index'), { recursive: true });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    return computeAndWriteContextsView({
      projectRoot,
      ctxoRoot,
      config: DEFAULT_CONFIG,
      indices,
      snapshot: SNAPSHOT,
      symbolPageRank: new Map(),
      exists: () => true,
    });
  }

  afterEach(() => {
    vi.restoreAllMocks();
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it('checks the working tree once per path, however often the file graph asks about it', () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'ctxo-contexts-step-'));
    dirs.push(projectRoot);
    const ctxoRoot = join(projectRoot, '.ctxo');
    mkdirSync(join(ctxoRoot, 'index'), { recursive: true });
    // Every pair co-changes, so each file is named in three entries, each listed under both of its files.
    const entries: CoChangeEntry[] = [];
    for (let i = 0; i < FILES.length; i++) {
      for (let j = i + 1; j < FILES.length; j++) {
        entries.push({ file1: FILES[i]!, file2: FILES[j]!, sharedCommits: 3, frequency: 0.5 });
      }
    }
    writeFileSync(join(ctxoRoot, 'index', 'co-changes.json'), JSON.stringify({ version: 1, timestamp: 1, entries }));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const checks = new Map<string, number>();
    const exists = (path: string): boolean => {
      checks.set(path, (checks.get(path) ?? 0) + 1);
      return true;
    };

    const view = computeAndWriteContextsView({
      projectRoot,
      ctxoRoot,
      config: DEFAULT_CONFIG,
      indices: FILES.map(plain),
      snapshot: SNAPSHOT,
      symbolPageRank: new Map(),
      exists,
    });

    expect(view.coverage.files).toBe(FILES.length);
    expect([...checks.keys()].sort()).toEqual(FILES.map((file) => join(projectRoot, file)).sort());
    expect([...checks.values()]).toEqual(FILES.map(() => 1));
  });

  it('computeAndWriteContextsView leaves a file whose only test mark is a Fact annotation out of the view', () => {
    const checks = 'src/Lending/LoanChecks.cs';
    const view = viewOf([...lendingProduction(), linkedMethodFile(checks, [{ name: 'Fact' }])]);

    expect(filesInView(view)).toEqual([...PRODUCTION].sort());
    expect(view.coverage.files).toBe(PRODUCTION.length);
  });

  it('a name-only production file without annotations becomes a node when annotation evidence exists', () => {
    const nameOnly = 'src/Lending/MemberRegistryTest.cs';
    const view = viewOf([...lendingProduction({ annotateFirst: true }), linkedMethodFile(nameOnly)]);

    expect(filesInView(view)).toEqual([...PRODUCTION, nameOnly].sort());
    expect(view.coverage.files).toBe(PRODUCTION.length + 1);
  });

  it('the same name-only file with a Fact annotation stays a test file', () => {
    const nameOnly = 'src/Lending/MemberRegistryTest.cs';
    const view = viewOf([...lendingProduction({ annotateFirst: true }), linkedMethodFile(nameOnly, [{ name: 'Fact' }])]);

    expect(filesInView(view)).toEqual([...PRODUCTION].sort());
    expect(view.coverage.files).toBe(PRODUCTION.length);
  });

  it('a folder-matched file without annotations stays a test file', () => {
    const inTestFolder = 'src/Lending.Tests/LoanFixtures.cs';
    const view = viewOf([...lendingProduction({ annotateFirst: true }), linkedMethodFile(inTestFolder)]);

    expect(filesInView(view)).toEqual([...PRODUCTION].sort());
    expect(view.coverage.files).toBe(PRODUCTION.length);
  });

  it('with no annotated .cs file anywhere, name-only matches stay test files', () => {
    const nameOnly = 'src/Lending/MemberRegistryTest.cs';
    const view = viewOf([...lendingProduction(), linkedMethodFile(nameOnly)]);

    expect(filesInView(view)).toEqual([...PRODUCTION].sort());
    expect(view.coverage.files).toBe(PRODUCTION.length);
  });

  it('annotations on a file that is not .cs are no evidence that the C# plugin ran', () => {
    const nameOnly = 'src/Lending/MemberRegistryTest.cs';
    const decorated = 'src/web/loan-form.ts';
    const component: SymbolNode = {
      symbolId: `${decorated}::LoanForm::class`,
      name: 'LoanForm',
      kind: 'class',
      startLine: 1,
      endLine: 10,
      annotations: [{ name: 'Component' }],
    };
    const view = viewOf([...lendingProduction(), { ...plain(decorated), symbols: [component] }, linkedMethodFile(nameOnly)]);

    expect(filesInView(view)).not.toContain(nameOnly);
  });

  describe('the stderr line', () => {
    function functionOf(file: string): SymbolNode {
      const name = file.slice(file.lastIndexOf('/') + 1, file.lastIndexOf('.'));
      return { symbolId: `${file}::${name}::function`, name, kind: 'function', startLine: 1, endLine: 2 };
    }

    /** Files that call each other in every pair; the first one also reads `table` when given. */
    function area(files: readonly string[], table?: string): FileIndex[] {
      return files.map((file, i) => {
        const own = functionOf(file);
        const edges: GraphEdge[] = files.slice(i + 1).map((other) => calls(own.symbolId, functionOf(other).symbolId));
        if (table && i === 0) edges.push({ from: own.symbolId, to: `${table}::table`, kind: 'reads' });
        return { ...plain(file), symbols: [own], edges };
      });
    }

    const LOANS = ['src/loans/LoanDesk.ts', 'src/loans/LoanRules.ts', 'src/loans/LoanQueue.ts'];
    const MEMBERS = ['src/members/MemberCard.ts', 'src/members/MemberFees.ts', 'src/members/MemberNotices.ts'];

    function contextsLine(): string {
      const lines = vi.mocked(console.error).mock.calls.map((args) => String(args[0]));
      const line = lines.find((text) => text.startsWith('[ctxo] Contexts view:'));
      expect(line).toBeDefined();
      return line!;
    }

    it('ends with the shared table count when two candidates read one table', () => {
      const view = viewOf([...area(LOANS, 'dbo.loans'), ...area(MEMBERS, 'dbo.loans')]);

      expect(view.candidates).toHaveLength(2);
      expect(contextsLine()).toMatch(/, 0 unclustered, 1 shared tables$/);
    });

    it('leaves the count out when no table is shared', () => {
      const view = viewOf([...area(LOANS, 'dbo.loans'), ...area(MEMBERS, 'dbo.members')]);

      expect(view.candidates).toHaveLength(2);
      expect(view.dataResources).toHaveLength(2);
      expect(contextsLine()).toMatch(/, 0 unclustered$/);
    });
  });
});
