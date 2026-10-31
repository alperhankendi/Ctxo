import { describe, it, expect, vi, afterEach } from 'vitest';
import type { CodeFact, ILanguageAdapter, SymbolNode } from '@ctxo/plugin-api';
import { dropTestFileFacts, extractFileFacts, pluginFactRequest } from '../index-facts.js';
import type { CtxoConfig } from '../../core/config/config-schema.js';
import type { CtxoModuleRegistration, FactDetectorOptions, LoadedModule } from '../../ports/i-ctxo-module.js';

const { makeGlobMatcherSpy } = vi.hoisted(() => ({ makeGlobMatcherSpy: vi.fn() }));
vi.mock('../../core/config/load-config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../core/config/load-config.js')>();
  makeGlobMatcherSpy.mockImplementation(actual.makeGlobMatcher);
  return { ...actual, makeGlobMatcher: makeGlobMatcherSpy };
});

const FACT: CodeFact ={ kind: 'endpoint', symbolId: 'src/a.fake::run::function', line: 3, text: 'GET /loans' };

function adapter(extra: Partial<ILanguageAdapter>): ILanguageAdapter {
  return {
    extractSymbols: async () => [],
    extractEdges: async () => [],
    extractComplexity: async () => [],
    isSupported: () => true,
    ...extra,
  };
}

describe('extractFileFacts', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns undefined for an adapter without extractFacts', async () => {
    expect(await extractFileFacts(adapter({}), 'src/a.fake', 'x')).toBeUndefined();
    expect(await extractFileFacts(adapter({ extractFacts: async () => [FACT] }), 'src/a.fake', 'x')).toEqual([FACT]);
  });

  it('returns [] for an adapter whose extractFacts finds nothing', async () => {
    expect(await extractFileFacts(adapter({ extractFacts: async () => [] }), 'src/a.fake', 'x')).toEqual([]);
  });

  it('returns undefined and reports a throwing adapter', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await extractFileFacts(
      adapter({ extractFacts: async () => { throw new Error('boom'); } }),
      'src/a.fake',
      'x',
    );
    expect(result).toBeUndefined();
    expect(err).toHaveBeenCalledWith('[ctxo] Fact extraction failed for src/a.fake: boom');
  });
});

describe('dropTestFileFacts', () => {
  const facts = (file: string): CodeFact[] => [
    { kind: 'literal-comparison', symbolId: `${file}::check::function`, line: 2, text: 'n >= 5', detail: { operator: '>=', literal: '5' } },
    { kind: 'retry-timeout', symbolId: `${file}::check::function`, line: 3, text: 'maxRetries = 3', detail: { name: 'maxRetries', value: '3' } },
    { kind: 'normalization', symbolId: `${file}::check::function`, line: 3, text: 'email.trim()', detail: { method: 'trim' } },
    { kind: 'endpoint', symbolId: `${file}::check::function`, line: 4, text: 'GET /loans', detail: { verb: 'GET', route: '/loans' } },
  ];
  const symbol = (file: string, annotations?: SymbolNode['annotations']): SymbolNode => ({
    symbolId: `${file}::check::function`, name: 'check', kind: 'function', startLine: 1, endLine: 9,
    ...(annotations ? { annotations } : {}),
  });

  it.each([
    ['src/__tests__/loan.test.ts'],
    ['src/loan.spec.ts'],
    ['loans/policy_test.go'],
    ['src/test/java/parity/LoanPolicyTest.java'],
    ['Lending.Tests/LoanPolicyChecks.cs'],
  ])('a test file by path keeps every kind except retry-timeout and normalization: %s', (file) => {
    expect(dropTestFileFacts(file, [symbol(file)], facts(file), []).map((f) => f.kind)).toEqual(['literal-comparison', 'endpoint']);
  });

  it('a production file keeps its retry-timeout and normalization facts', () => {
    const file = 'src/loans/policy.ts';
    expect(dropTestFileFacts(file, [symbol(file)], facts(file), [])).toEqual(facts(file));
  });

  it('an index.tests glob marks a test file too', () => {
    const file = 'checks/loan-checks.ts';
    expect(dropTestFileFacts(file, [symbol(file)], facts(file), ['checks/**']).map((f) => f.kind)).toEqual(['literal-comparison', 'endpoint']);
  });

  it('a test-framework annotation marks a test file; a name-only glob alone does not', () => {
    const annotated = 'src/Lending/LoanRules.cs';
    expect(dropTestFileFacts(annotated, [symbol(annotated, [{ name: 'Fact' }])], facts(annotated), []).map((f) => f.kind))
      .toEqual(['literal-comparison', 'endpoint']);
    // *Tests.cs decides only with a test annotation: the fact-capable C# plugin always reports annotations.
    const named = 'src/Lending/LoanTests.cs';
    expect(dropTestFileFacts(named, [symbol(named)], facts(named), [])).toEqual(facts(named));
  });

  it('compiles the test globs once per glob list, not once per file (C-M)', () => {
    const before = makeGlobMatcherSpy.mock.calls.length;
    for (let i = 0; i < 200; i++) {
      const file = `src/loans/policy-${i}.ts`;
      dropTestFileFacts(file, [symbol(file)], facts(file), ['qa/**', 'checks/**']);
    }
    expect(makeGlobMatcherSpy.mock.calls.length - before).toBeLessThanOrEqual(1);
    // Another glob list compiles once more, and its own globs decide.
    const file = 'qa2/loan.ts';
    expect(dropTestFileFacts(file, [symbol(file)], facts(file), ['qa2/**']).map((f) => f.kind)).toEqual(['literal-comparison', 'endpoint']);
    expect(dropTestFileFacts(file, [symbol(file)], facts(file), ['qa/**'])).toEqual(facts(file));
  });

  it('backslash paths are classified like forward-slash ones', () => {
    const file = 'src\\__tests__\\loan.test.ts';
    expect(dropTestFileFacts(file, [], facts(file), []).map((f) => f.kind)).toEqual(['literal-comparison', 'endpoint']);
  });
});

const O: FactDetectorOptions = { trivialLiterals: [0, 1, '', true, null], normalizationMethods: ['trim', 'toLowerCase'] };
const P: FactDetectorOptions = { trivialLiterals: [], normalizationMethods: ['normalize'] };

function mod(indexCapabilities: CtxoModuleRegistration['indexCapabilities']): LoadedModule {
  return { name: '@ctxo/domain', version: '0.0.0', registration: { id: 'domain', indexCapabilities } };
}

describe('pluginFactRequest', () => {
  const noConfig: CtxoConfig = {} as CtxoConfig;
  const factsOn = { index: { facts: true } } as unknown as CtxoConfig;

  it.each([
    ['no config, no modules', noConfig, [], { facts: false }],
    ['index.facts: true', factsOn, [], { facts: true }],
    ['a module with facts and options', noConfig, [mod({ facts: true, factOptions: O })], { facts: true, factOptions: O }],
    ['two modules with options', noConfig, [mod({ facts: true, factOptions: O }), mod({ facts: true, factOptions: P })], { facts: true, factOptions: O }],
    ['a module with options but no facts', noConfig, [mod({ factOptions: O })], { facts: false }],
  ] as const)('pluginFactRequest combines index.facts with module requests: %s', (_name, config, modules, expected) => {
    expect(pluginFactRequest(config, modules)).toStrictEqual(expected);
  });

  it('hands the plugins a deep-frozen copy of the options, so no plugin can change another one\'s (C-M)', () => {
    const own: FactDetectorOptions = { trivialLiterals: [0, 1], normalizationMethods: ['trim'] };
    const request = pluginFactRequest(noConfig, [mod({ facts: true, factOptions: own })]);
    const options = request.factOptions!;
    expect(options).not.toBe(own);
    expect(Object.isFrozen(options)).toBe(true);
    expect(Object.isFrozen(options.trivialLiterals)).toBe(true);
    expect(Object.isFrozen(options.normalizationMethods)).toBe(true);
    expect(() => (options.trivialLiterals as unknown[]).push(5)).toThrow(TypeError);
    expect(() => (options.normalizationMethods as string[]).splice(0)).toThrow(TypeError);
    // The module's own object stays as it was, and a later change to it does not reach the plugins.
    (own.normalizationMethods as string[]).push('toLowerCase');
    expect(options.normalizationMethods).toEqual(['trim']);
  });
});
