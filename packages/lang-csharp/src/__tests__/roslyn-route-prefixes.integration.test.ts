import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { CodeFact } from '@ctxo/plugin-api';
import { RoslynAdapter } from '../roslyn/roslyn-adapter.js';
import { CSharpAdapter } from '../csharp-adapter.js';
import { DEFAULT_FACT_OPTIONS } from '../facts/fact-options.js';

const HAS_DOTNET = (() => {
  try {
    const v = execFileSync('dotnet', ['--version'], { encoding: 'utf-8' }).trim();
    return parseInt(v.split('.')[0]!, 10) >= 8;
  } catch { return false; }
})();

const FIXTURE_DIR = resolve(import.meta.dirname, 'fixtures/csharp-v2-sample');
const ROUTES = 'CsharpV2Sample/Routes';
const GROUPS = `${ROUTES}/GroupEndpoints.cs`;
const USERS = `${ROUTES}/UserEndpoints.cs`;
const CONTROLLERS = `${ROUTES}/Controllers.cs`;
const BASES = `${ROUTES}/ControllerBases.cs`;

/** `<text> <member>` for each endpoint fact, the member being the symbol ID's name part. */
function endpoints(facts: readonly CodeFact[]): string[] {
  return facts
    .filter(f => f.kind === 'endpoint')
    .map(f => `${f.text} ${f.symbolId.split('::')[1]!.replace(/\(\d*\)$/, '')}`)
    .sort();
}

describe.skipIf(!HAS_DOTNET)('Roslyn route prefixes', () => {
  let roslyn: RoslynAdapter;

  beforeAll(async () => {
    roslyn = new RoslynAdapter({ facts: DEFAULT_FACT_OPTIONS });
    await roslyn.initialize(FIXTURE_DIR);
    expect(roslyn.isReady()).toBe(true);
    expect((await roslyn.batchIndex()).ok).toBe(true);
  }, 120_000);

  afterAll(async () => {
    await roslyn.dispose();
  });

  it('MapGroup prefixes join local, nested and chained groups; unresolved groups keep the call route', async () => {
    expect(endpoints(await roslyn.extractFacts(GROUPS, ''))).toEqual([
      // A local group, and a group of a group (`"v1/"` normalised).
      'GET /api/status Lending.Routes.GroupEndpoints.Map',
      'POST /api/v1/loans Lending.Routes.GroupEndpoints.Map',
      // A group created inline.
      'GET /inline/chained Lending.Routes.GroupEndpoints.Map',
      // Unresolved: a reassigned local, a group returned by a method, a non-constant prefix.
      'GET /reassigned Lending.Routes.GroupEndpoints.Map',
      'GET /opaque Lending.Routes.GroupEndpoints.Map',
      'GET /dynamic Lending.Routes.GroupEndpoints.Map',
      // The app itself.
      'GET /root Lending.Routes.GroupEndpoints.Map',
      // ASP.NET conventions that return their receiver keep the prefix.
      'GET /tagged/t Lending.Routes.GroupEndpoints.Map',
      // A project's own call, also of the same generic shape, is not followed.
      'GET /d Lending.Routes.GroupEndpoints.Map',
      'GET /s Lending.Routes.GroupEndpoints.Map',
      // Written again: deconstruction, ??=, out.
      'GET /decon Lending.Routes.GroupEndpoints.Map',
      'GET /coalesce Lending.Routes.GroupEndpoints.Map',
      'GET /out Lending.Routes.GroupEndpoints.Map',
      // A generic builder receiver, with a group on top: the group's own segment is not presented as the full prefix.
      'POST /generic Lending.Routes.GroupEndpoints.MapGeneric',
      // Unresolved: two call sites with different prefixes, and no call site.
      'GET /shared Lending.Routes.GroupEndpoints.MapShared',
      'GET /nowhere Lending.Routes.GroupEndpoints.MapNowhere',
    ].sort());
  });

  it('a group passed to an extension method in another file takes the prefix of its call site', async () => {
    expect(endpoints(await roslyn.extractFacts(USERS, ''))).toEqual([
      'GET /users/{id} Lending.Routes.UserEndpoints.MapUsers',
      'POST /users/admin/ban Lending.Routes.UserEndpoints.MapUsers',
    ]);
  });

  it('a controller inherits the class Route of its nearest base with one, one or two levels up', async () => {
    expect(endpoints(await roslyn.extractFacts(CONTROLLERS, ''))).toEqual([
      // One level, with [controller] from the derived class.
      'GET /api/Members/{id} Lending.Routes.MembersController.Get',
      // Two levels.
      'POST /api/Fines Lending.Routes.FinesController.Pay',
      // An own Route wins over the inherited one.
      'GET /own/x Lending.Routes.OwnRouteController.X',
      // [action] from the derived method.
      'GET /api/Reports/List Lending.Routes.ReportsController.List',
      // A generic base class.
      'GET /api/v2/LoansV2/{id} Lending.Routes.LoansV2Controller.Get',
      // A base marked [NonController]: no inherited prefix.
      'GET /hidden Lending.Routes.InternalController.Hidden',
      // No Route anywhere.
      'GET /plain Lending.Routes.PlainController.Plain',
    ].sort());
  });

  it('the inherited route stays out of the annotations', async () => {
    const symbols = await roslyn.extractSymbols(CONTROLLERS, '');
    const members = symbols.find(s => s.name === 'Lending.Routes.MembersController');
    expect(members).toBeDefined();
    expect(members).not.toHaveProperty('annotations');
    expect(members).not.toHaveProperty('inheritedRoute');
    expect(await roslyn.extractFacts(BASES, '')).toEqual([]);
  });

  it('the tree-sitter tier keeps the call and annotation routes only', async () => {
    const syntax = new CSharpAdapter({ facts: DEFAULT_FACT_OPTIONS });
    const groups = endpoints(await syntax.extractFacts(GROUPS, readFileSync(resolve(FIXTURE_DIR, GROUPS), 'utf-8')));
    expect(groups).toContain('GET /status Lending.Routes.GroupEndpoints.Map');
    expect(groups).toContain('POST /loans Lending.Routes.GroupEndpoints.Map');
    const controllers = endpoints(await syntax.extractFacts(CONTROLLERS, readFileSync(resolve(FIXTURE_DIR, CONTROLLERS), 'utf-8')));
    expect(controllers).toContain('GET /{id} Lending.Routes.MembersController.Get');
    expect(controllers).toContain('GET /own/x Lending.Routes.OwnRouteController.X');
  });
});
