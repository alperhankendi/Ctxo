import { describe, expect, it } from 'vitest';
import type { SymbolNode } from '@ctxo/plugin-api';
import { CSharpAdapter } from '../../csharp-adapter.js';
import { annotationRouteEvidence } from '../annotation-endpoints.js';
import { DEFAULT_FACT_OPTIONS } from '../fact-options.js';
import { finishFacts } from '../finish-facts.js';

const FILE = 'src/Controllers/LoansController.cs';

function cls(name: string, startLine: number, endLine: number, annotations?: SymbolNode['annotations']): SymbolNode {
  return { symbolId: `${FILE}::${name}::class`, name, kind: 'class', startLine, endLine, ...(annotations ? { annotations } : {}) };
}

function method(name: string, line: number, annotations?: SymbolNode['annotations']): SymbolNode {
  return { symbolId: `${FILE}::${name}::method`, name, kind: 'method', startLine: line, endLine: line + 3, ...(annotations ? { annotations } : {}) };
}

function endpoints(symbols: readonly SymbolNode[]): string[] {
  return finishFacts(FILE, annotationRouteEvidence(symbols), symbols, DEFAULT_FACT_OPTIONS).map(f => `${f.line} ${f.symbolId} ${f.text}`);
}

describe('annotationRouteEvidence', () => {
  it('attribute routes combine the controller route with the action template', () => {
    const symbols = [
      cls('Lending.Api.LoansController', 2, 40, [{ name: 'ApiController' }, { name: 'Route', args: ['api/[controller]'] }]),
      method('Lending.Api.LoansController.Get', 5, [{ name: 'HttpGet', args: ['{id}'] }]),
      method('Lending.Api.LoansController.Create', 10, [{ name: 'HttpPost' }]),
      method('Lending.Api.LoansController.Health', 15, [{ name: 'HttpGet', args: ['/health'] }]),
      method('Lending.Api.LoansController.Archive(0)', 20, [{ name: 'Route', args: ['legacy/[action]'] }]),
    ];
    expect(annotationRouteEvidence(symbols)).toEqual([
      { kind: 'route', symbolId: symbols[1]!.symbolId, line: 5, verb: 'GET', route: '/api/Loans/{id}' },
      { kind: 'route', symbolId: symbols[2]!.symbolId, line: 10, verb: 'POST', route: '/api/Loans' },
      { kind: 'route', symbolId: symbols[3]!.symbolId, line: 15, verb: 'GET', route: '/health' },
      { kind: 'route', symbolId: symbols[4]!.symbolId, line: 20, verb: 'ANY', route: '/api/Loans/legacy/Archive' },
    ]);
    expect(endpoints(symbols)).toEqual([
      `5 ${symbols[1]!.symbolId} GET /api/Loans/{id}`,
      `10 ${symbols[2]!.symbolId} POST /api/Loans`,
      `15 ${symbols[3]!.symbolId} GET /health`,
      `20 ${symbols[4]!.symbolId} ANY /api/Loans/legacy/Archive`,
    ]);
  });

  it('a ~/ template ignores the class route and the innermost class gives the prefix', () => {
    const symbols = [
      cls('Lending.Api.Outer', 0, 50, [{ name: 'Route', args: ['outer'] }]),
      cls('Lending.Api.Outer.HoldsController', 2, 40, [{ name: 'Route', args: ['holds'] }]),
      method('Lending.Api.Outer.HoldsController.Ping', 5, [{ name: 'HttpGet', args: ['~/ping'] }]),
      method('Lending.Api.Outer.HoldsController.List', 10, [{ name: 'HttpGet' }, { name: 'HttpHead' }]),
      method('Lending.Api.Outer.Root', 45, [{ name: 'HttpDelete', args: ['[action]'] }]),
    ];
    expect(endpoints(symbols)).toEqual([
      `5 ${symbols[2]!.symbolId} GET /ping`,
      `10 ${symbols[3]!.symbolId} GET /holds`,
      `10 ${symbols[3]!.symbolId} HEAD /holds`,
      `45 ${symbols[4]!.symbolId} DELETE /outer/Root`,
    ]);
  });

  it('named Template is read when args is empty', () => {
    const symbols = [
      cls('Lending.Api.MembersController', 0, 30, [{ name: 'Route', named: { Template: 'api/[controller]' } }]),
      method('Lending.Api.MembersController.Find', 3, [{ name: 'HttpGet', named: { Template: 'find/{name}', Name: 'FindMember' } }]),
      method('Lending.Api.MembersController.Update', 8, [{ name: 'HttpPut', args: ['{id}'], named: { Template: 'ignored' } }]),
    ];
    expect(endpoints(symbols)).toEqual([
      `3 ${symbols[1]!.symbolId} GET /api/Members/find/{name}`,
      `8 ${symbols[2]!.symbolId} PUT /api/Members/{id}`,
    ]);
  });

  it('the template: constructor argument reads the same from args[0] (Roslyn semantic) and named.template (syntax)', () => {
    const roslyn = [
      cls('Lending.Api.HoldsController', 0, 30, [{ name: 'Route', args: ['api/[controller]'] }]),
      method('Lending.Api.HoldsController.Get', 3, [{ name: 'HttpGet', args: ['{id}'] }]),
    ];
    const syntax = [
      cls('Lending.Api.HoldsController', 0, 30, [{ name: 'Route', named: { template: 'api/[controller]' } }]),
      method('Lending.Api.HoldsController.Get(1)', 3, [{ name: 'HttpGet', named: { template: '{id}' } }]),
    ];
    expect(annotationRouteEvidence(roslyn).map(e => e.kind === 'route' ? `${e.verb} ${e.route}` : '')).toEqual(['GET /api/Holds/{id}']);
    expect(annotationRouteEvidence(syntax).map(e => e.kind === 'route' ? `${e.verb} ${e.route}` : '')).toEqual(['GET /api/Holds/{id}']);
  });

  it('[HttpGet(template: "{id}")] parsed by the tree-sitter tier gives the route', async () => {
    const source = [
      'using Microsoft.AspNetCore.Mvc;',
      'namespace Lending.Api;',
      '[Route(template: "api/[controller]")]',
      'public class HoldsController : ControllerBase',
      '{',
      '    [HttpGet(template: "{id}")]',
      '    public string Get(int id) => "";',
      '    [HttpPost("renew/{id}")]',
      '    public string Renew(int id) => "";',
      '}',
    ].join('\n');
    const symbols = await new CSharpAdapter().extractSymbols('Api/HoldsController.cs', source);
    const evidence = annotationRouteEvidence(symbols);
    expect(evidence.map(e => e.kind === 'route' ? `${e.line} ${e.verb} ${e.route}` : '')).toEqual([
      '5 GET /api/Holds/{id}',
      '7 POST /api/Holds/renew/{id}',
    ]);
  });

  it('an inherited route is the prefix of a class without its own Route; an own Route wins', () => {
    const symbols = [
      cls('Lending.Api.MembersController', 0, 10),
      method('Lending.Api.MembersController.Get', 3, [{ name: 'HttpGet', args: ['{id}'] }]),
      cls('Lending.Api.OwnController', 12, 20, [{ name: 'Route', args: ['own'] }]),
      method('Lending.Api.OwnController.List', 14, [{ name: 'HttpGet', args: ['[action]'] }]),
    ];
    const inherited = new Map([
      [symbols[0]!.symbolId, 'api/[controller]'],
      [symbols[2]!.symbolId, 'ignored'],
    ]);
    expect(annotationRouteEvidence(symbols, inherited).map(e => (e.kind === 'route' ? `${e.verb} ${e.route}` : ''))).toEqual([
      'GET /api/Members/{id}',
      'GET /own/List',
    ]);
    // Without the map (the tree-sitter tier) the method template stands alone, as before.
    expect(annotationRouteEvidence(symbols).map(e => (e.kind === 'route' ? `${e.verb} ${e.route}` : ''))).toEqual([
      'GET /{id}',
      'GET /own/List',
    ]);
  });

  it('methods without route annotations and non-route annotations give nothing', () => {
    const symbols = [
      cls('Lending.Api.LoansController', 0, 30, [{ name: 'Route', args: ['api/[controller]'] }]),
      method('Lending.Api.LoansController.Helper', 3),
      method('Lending.Api.LoansController.Audit', 8, [{ name: 'Authorize' }, { name: 'HttpGetter', args: ['x'] }]),
      { symbolId: `${FILE}::Lending.Api.LoansController.Name::variable`, name: 'Lending.Api.LoansController.Name', kind: 'variable', startLine: 12, endLine: 12, annotations: [{ name: 'HttpGet', args: ['x'] }] },
    ] satisfies SymbolNode[];
    expect(annotationRouteEvidence(symbols)).toEqual([]);
  });
});
