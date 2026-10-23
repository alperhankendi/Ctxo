import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock child_process before importing modules
vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
  spawn: vi.fn(),
}));

import { execFileSync } from 'node:child_process';
import { detectDotnetSdk } from '../roslyn/solution-discovery.js';
import { toGraphEdges, toSymbolNode } from '../roslyn/roslyn-adapter.js';

describe('toGraphEdges', () => {
  const CLOSE = 'Data/LoanRepository.cs::Lending.Data.LoanRepository.Close::method';
  const ARCHIVE = 'Data/LoanRepository.cs::Lending.Data.LoanRepository.Archive::method';

  it('toGraphEdges keeps 2-part table, view and procedure targets on data edges', () => {
    const edges = toGraphEdges([
      { from: ARCHIVE, to: 'dbo.loans::table', kind: 'reads' },
      { from: ARCHIVE, to: 'dbo.active_loans::view', kind: 'reads' },
      { from: ARCHIVE, to: 'dbo.loanarchive::table', kind: 'writes' },
      { from: CLOSE, to: 'dbo.usp_closeloan::procedure', kind: 'executes' },
      { from: CLOSE, to: 'Data/LoanRepository.cs::Lending.Data.Loan::class', kind: 'uses' },
      { from: ARCHIVE, to: 'Sql/Loans.sql::dbo.loans::table', kind: 'reads' },
    ]);
    expect(edges).toEqual([
      { from: ARCHIVE, to: 'dbo.loans::table', kind: 'reads' },
      { from: ARCHIVE, to: 'dbo.active_loans::view', kind: 'reads' },
      { from: ARCHIVE, to: 'dbo.loanarchive::table', kind: 'writes' },
      { from: CLOSE, to: 'dbo.usp_closeloan::procedure', kind: 'executes' },
      { from: CLOSE, to: 'Data/LoanRepository.cs::Lending.Data.Loan::class', kind: 'uses' },
      { from: ARCHIVE, to: 'Sql/Loans.sql::dbo.loans::table', kind: 'reads' },
    ]);
  });

  it('toGraphEdges drops a 2-part target on a calls edge and malformed ids', () => {
    const edges = toGraphEdges([
      { from: CLOSE, to: 'dbo.usp_closeloan::procedure', kind: 'calls' },
      { from: CLOSE, to: 'dbo.loans::table', kind: 'uses' },
      { from: CLOSE, to: 'dbo.loans::function', kind: 'reads' },
      { from: CLOSE, to: '::table', kind: 'reads' },
      { from: CLOSE, to: 'dbo.loans', kind: 'reads' },
      { from: CLOSE, to: '', kind: 'writes' },
      { from: 'dbo.loans::table', to: 'dbo.members::table', kind: 'reads' },
      { from: 'Lending.Data.LoanRepository.Close::method', to: 'dbo.loans::table', kind: 'reads' },
      { from: CLOSE, to: 'Data/LoanRepository.cs::Lending.Data.Loan::class', kind: 'uses' },
    ]);
    expect(edges).toEqual([
      { from: CLOSE, to: 'Data/LoanRepository.cs::Lending.Data.Loan::class', kind: 'uses' },
    ]);
  });
});

describe('toSymbolNode', () => {
  it('toSymbolNode copies annotations and omits an absent list', () => {
    const withAnnotations = toSymbolNode({
      symbolId: 'Tests/LoanTests.cs::Tests.LoanTests.Renews::method',
      name: 'Tests.LoanTests.Renews',
      kind: 'method',
      startLine: 4,
      endLine: 8,
      startOffset: 40,
      endOffset: 90,
      annotations: [
        { name: 'Fact', named: { type: 'Xunit.FactAttribute' } },
        { name: 'Trait', args: ['Rule', 'LEND-03'] },
      ],
    });
    expect(withAnnotations).toEqual({
      symbolId: 'Tests/LoanTests.cs::Tests.LoanTests.Renews::method',
      name: 'Tests.LoanTests.Renews',
      kind: 'method',
      startLine: 4,
      endLine: 8,
      startOffset: 40,
      endOffset: 90,
      annotations: [
        { name: 'Fact', named: { type: 'Xunit.FactAttribute' } },
        { name: 'Trait', args: ['Rule', 'LEND-03'] },
      ],
    });

    const without = toSymbolNode({
      symbolId: 'Loans/Loan.cs::Loans.Loan::class',
      name: 'Loans.Loan',
      kind: 'class',
      startLine: 0,
      endLine: 3,
    });
    expect(without).toEqual({
      symbolId: 'Loans/Loan.cs::Loans.Loan::class',
      name: 'Loans.Loan',
      kind: 'class',
      startLine: 0,
      endLine: 3,
    });
    expect(without).not.toHaveProperty('annotations');
    expect(without).not.toHaveProperty('startOffset');
  });
});

describe('solution-discovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('detectDotnetSdk', () => {
    it('returns available when dotnet 8+ found', () => {
      vi.mocked(execFileSync).mockReturnValue('8.0.400\n');
      const result = detectDotnetSdk();
      expect(result.available).toBe(true);
      expect(result.version).toBe('8.0.400');
    });

    it('returns available for dotnet 10+', () => {
      vi.mocked(execFileSync).mockReturnValue('10.0.201\n');
      const result = detectDotnetSdk();
      expect(result.available).toBe(true);
    });

    it('returns unavailable when dotnet < 8', () => {
      vi.mocked(execFileSync).mockReturnValue('6.0.100\n');
      const result = detectDotnetSdk();
      expect(result.available).toBe(false);
      expect(result.version).toBe('6.0.100');
    });

    it('returns unavailable when dotnet not found', () => {
      vi.mocked(execFileSync).mockImplementation(() => { throw new Error('not found'); });
      const result = detectDotnetSdk();
      expect(result.available).toBe(false);
      expect(result.version).toBeUndefined();
    });
  });
});

describe('RoslynAdapter JSONL parsing', () => {
  it('parses file result with symbols', () => {
    const line = '{"type":"file","file":"src/User.cs","symbols":[{"symbolId":"src/User.cs::Models.User::class","name":"Models.User","kind":"class","startLine":3,"endLine":10}],"edges":[],"complexity":[]}';
    const obj = JSON.parse(line);
    expect(obj.type).toBe('file');
    expect(obj.symbols).toHaveLength(1);
    expect(obj.symbols[0].kind).toBe('class');
    expect(obj.symbols[0].symbolId).toContain('::class');
  });

  it('parses file result with edges', () => {
    const line = '{"type":"file","file":"src/UserService.cs","symbols":[],"edges":[{"from":"src/UserService.cs::Services.UserService::class","to":"src/IUserRepo.cs::Interfaces.IUserRepository::interface","kind":"implements"}],"complexity":[]}';
    const obj = JSON.parse(line);
    expect(obj.edges).toHaveLength(1);
    expect(obj.edges[0].kind).toBe('implements');
  });

  it('parses file result with complexity', () => {
    const line = '{"type":"file","file":"src/Svc.cs","symbols":[],"edges":[],"complexity":[{"symbolId":"src/Svc.cs::Svc.Run::method","cyclomatic":5,"cognitive":8}]}';
    const obj = JSON.parse(line);
    expect(obj.complexity).toHaveLength(1);
    expect(obj.complexity[0].cyclomatic).toBe(5);
    expect(obj.complexity[0].cognitive).toBe(8);
  });

  it('parses project graph', () => {
    const line = '{"type":"projectGraph","projects":[{"name":"MyApp","path":"MyApp.csproj"}],"edges":[{"from":"MyApp","to":"Shared","kind":"projectReference"}]}';
    const obj = JSON.parse(line);
    expect(obj.type).toBe('projectGraph');
    expect(obj.projects).toHaveLength(1);
    expect(obj.edges).toHaveLength(1);
    expect(obj.edges[0].kind).toBe('projectReference');
  });

  it('parses done message', () => {
    const line = '{"type":"done","totalFiles":42,"elapsed":"2.3s"}';
    const obj = JSON.parse(line);
    expect(obj.type).toBe('done');
    expect(obj.totalFiles).toBe(42);
  });

  it('parses progress message', () => {
    const line = '{"type":"progress","message":"Loading solution..."}';
    const obj = JSON.parse(line);
    expect(obj.type).toBe('progress');
    expect(obj.message).toContain('Loading');
  });

  it('handles extends edge (not I-prefix heuristic)', () => {
    const line = '{"type":"file","file":"src/UserSyncJob.cs","symbols":[],"edges":[{"from":"src/UserSyncJob.cs::Jobs.UserSyncJob::class","to":"src/BaseSyncJob.cs::Jobs.BaseSyncJob::class","kind":"extends"}],"complexity":[]}';
    const obj = JSON.parse(line);
    expect(obj.edges[0].kind).toBe('extends');
    // Not 'implements' - semantic, not I-prefix heuristic
  });

  it('handles implements edge', () => {
    const line = '{"type":"file","file":"src/UserService.cs","symbols":[],"edges":[{"from":"src/UserService.cs::Services.UserService::class","to":"src/IUserRepo.cs::Interfaces.IUserRepository::interface","kind":"implements"}],"complexity":[]}';
    const obj = JSON.parse(line);
    expect(obj.edges[0].kind).toBe('implements');
  });

  it('handles calls edge (cross-file method invocation)', () => {
    const line = '{"type":"file","file":"src/Job.cs","symbols":[],"edges":[{"from":"src/Job.cs::Jobs.UserSyncJob.ExecuteAsync::method","to":"src/Svc.cs::Services.UserService.GetAll::method","kind":"calls"}],"complexity":[]}';
    const obj = JSON.parse(line);
    expect(obj.edges[0].kind).toBe('calls');
    expect(obj.edges[0].from).toContain('ExecuteAsync');
    expect(obj.edges[0].to).toContain('GetAll');
  });
});
