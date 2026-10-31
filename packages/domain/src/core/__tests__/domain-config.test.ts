import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_DOMAIN_CONFIG,
  DEFAULT_TEXT_SCAN_EXTENSIONS,
  describeUnknownDomainKey,
  findUnknownDomainKeys,
  keyDistance,
  knownDomainKeyPaths,
  NORMALIZATION_METHOD_PATTERN,
  resolveDomainConfig,
  toFactDetectorOptions,
} from '../domain-config.js';

const NORMALIZATION_METHODS = [
  'ToLower*',
  'ToUpper*',
  'Trim*',
  'Normalize',
  'toLowerCase',
  'toUpperCase',
  'trim',
  'strings.ToLower',
  'strings.TrimSpace',
  'equalsIgnoreCase',
];

const CHARACTERIZATION = {
  annotations: ['Trait:Kind=Characterization', 'Tag:characterization'],
  paths: ['**/Characterization/**'],
  names: ['[characterization]'],
};
const CONTRACT = {
  annotations: ['Trait:Kind=Contract', 'Tag:contract'],
  paths: ['**/Contract/**', '**/Contracts.Tests/**'],
  names: ['[contract]'],
};

describe('resolveDomainConfig', () => {
  it('defaults when the section is absent', () => {
    const { config, problems } = resolveDomainConfig(undefined);

    expect(problems).toEqual([]);
    expect(config).toEqual(DEFAULT_DOMAIN_CONFIG);
    expect(config.registry).toBe('docs/domain/contexts.yaml');
    expect(config.coverage.unowned).toBe('warn');
    expect(config.boundaries).toEqual({ enforce: 'by-rung', blockingRungs: ['bounded', 'boring'] });
    expect(config.rules.idPattern).toBe('^[A-Z][A-Z0-9]*-\\d+$');
    expect(config.tests.ruleTraitKeys).toEqual(['Rule']);
    expect(config.guard).toEqual({ enabled: true, subagents: false });
  });

  it('keeps valid values', () => {
    const { config, problems } = resolveDomainConfig({
      registry: 'domain/ctx.yaml',
      coverage: { unowned: 'error' },
      boundaries: { enforce: 'report', blockingRungs: ['boring'] },
      rules: { idPattern: '^R-\\d+$', trackerPrefixes: ['JIRA'] },
      tests: {
        ruleTraitKeys: ['Rule', 'Req'],
        characterization: { annotations: ['Category:Golden'], paths: ['golden/**'], names: ['[golden]'] },
        contract: { annotations: ['Pact'], paths: ['pacts/**'], names: ['[pact]'] },
      },
      rungs: { pinnedCoverage: 0.5 },
      facts: { trivialLiterals: [0], normalizationMethods: ['lower'], textScanExtensions: ['.py'] },
      guard: { enabled: false, base: 'origin/main', subagents: true },
    });

    expect(problems).toEqual([]);
    expect(config).toEqual({
      registry: 'domain/ctx.yaml',
      coverage: { unowned: 'error' },
      boundaries: { enforce: 'report', blockingRungs: ['boring'] },
      rules: { idPattern: '^R-\\d+$', trackerPrefixes: ['JIRA'] },
      tests: {
        ruleTraitKeys: ['Rule', 'Req'],
        characterization: { annotations: ['Category:Golden'], paths: ['golden/**'], names: ['[golden]'] },
        contract: { annotations: ['Pact'], paths: ['pacts/**'], names: ['[pact]'] },
      },
      rungs: { pinnedCoverage: 0.5 },
      facts: { trivialLiterals: [0], normalizationMethods: ['lower'], textScanExtensions: ['.py'] },
      guard: { enabled: false, base: 'origin/main', subagents: true },
    });
  });

  it('falls back per key and reports each invalid value', () => {
    const { config, problems } = resolveDomainConfig({
      registry: 'domain/ctx.yaml',
      coverage: { unowned: 'eror' },
      boundaries: { enforce: 'strict', blockingRungs: ['gold'] },
      rules: { idPattern: '([', trackerPrefixes: ['JIRA'] },
    });

    expect(problems.map((p) => p.path).sort()).toEqual([
      'domain.boundaries.blockingRungs',
      'domain.boundaries.enforce',
      'domain.coverage.unowned',
      'domain.rules.idPattern',
    ]);
    expect(config.registry).toBe('domain/ctx.yaml');
    expect(config.coverage.unowned).toBe('warn');
    expect(config.boundaries).toEqual(DEFAULT_DOMAIN_CONFIG.boundaries);
    expect(config.rules.idPattern).toBe(DEFAULT_DOMAIN_CONFIG.rules.idPattern);
    expect(config.rules.trackerPrefixes).toEqual(['JIRA']);
  });

  it('rejects bad tracker prefixes, trait keys, guard base and non-boolean flags', () => {
    const { config, problems } = resolveDomainConfig({
      rules: { trackerPrefixes: ['lower'] },
      tests: { ruleTraitKeys: [''] },
      guard: { enabled: 'yes', base: '--upload-pack=x', subagents: 1 },
    });

    expect(problems.map((p) => p.path).sort()).toEqual([
      'domain.guard.base',
      'domain.guard.enabled',
      'domain.guard.subagents',
      'domain.rules.trackerPrefixes',
      'domain.tests.ruleTraitKeys',
    ]);
    expect(config).toEqual(DEFAULT_DOMAIN_CONFIG);
  });

  it('defaults include the K13a conventions, pinnedCoverage 0.8 and the spec fact lists', () => {
    const { config } = resolveDomainConfig(undefined);

    expect(config.tests).toEqual({ ruleTraitKeys: ['Rule'], characterization: CHARACTERIZATION, contract: CONTRACT });
    expect(config.rungs).toEqual({ pinnedCoverage: 0.8 });
    expect(config.facts).toEqual({
      trivialLiterals: [0, 1, -1, null, true, false, ''],
      normalizationMethods: NORMALIZATION_METHODS,
      textScanExtensions: ['.dart', '.ex', '.exs', '.groovy', '.kt', '.kts', '.php', '.py', '.rb', '.rs', '.scala', '.swift'],
    });
    expect(DEFAULT_TEXT_SCAN_EXTENSIONS).toEqual(config.facts.textScanExtensions);
    expect([...DEFAULT_TEXT_SCAN_EXTENSIONS].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))).toEqual(DEFAULT_TEXT_SCAN_EXTENSIONS);
  });

  it('typed trivial literals are kept', () => {
    const { config, problems } = resolveDomainConfig({ facts: { trivialLiterals: [0, null, 'N/A', true] } });

    expect(problems).toEqual([]);
    expect(config.facts.trivialLiterals).toEqual([0, null, 'N/A', true]);
    expect(toFactDetectorOptions(config)).toEqual({
      trivialLiterals: [0, null, 'N/A', true],
      normalizationMethods: NORMALIZATION_METHODS,
    });
  });

  it('invalid values fall back per key with their paths', () => {
    const { config, problems } = resolveDomainConfig({
      tests: {
        characterization: { annotations: ['Trait:'], paths: ['golden/**'] },
        contract: { names: ['[pact]'] },
      },
      rungs: { pinnedCoverage: 1.5 },
      facts: { trivialLiterals: [{}], normalizationMethods: ['lower'], textScanExtensions: ['py'] },
    });

    expect(problems.map((p) => p.path).sort()).toEqual([
      'domain.facts.textScanExtensions',
      'domain.facts.trivialLiterals',
      'domain.rungs.pinnedCoverage',
      'domain.tests.characterization.annotations',
    ]);
    expect(config.tests.characterization).toEqual({ ...CHARACTERIZATION, paths: ['golden/**'] });
    expect(config.tests.contract).toEqual({ ...CONTRACT, names: ['[pact]'] });
    expect(config.rungs.pinnedCoverage).toBe(0.8);
    expect(config.facts.trivialLiterals).toEqual(DEFAULT_DOMAIN_CONFIG.facts.trivialLiterals);
    expect(config.facts.normalizationMethods).toEqual(['lower']);
    expect(config.facts.textScanExtensions).toEqual(DEFAULT_TEXT_SCAN_EXTENSIONS);
  });

  it('rejects bad paths, names, coverage types, method patterns and non-finite literals', () => {
    const { problems } = resolveDomainConfig({
      tests: { contract: { paths: [''], names: [3] }, characterization: 'x' },
      rungs: { pinnedCoverage: '0.8' },
      facts: { normalizationMethods: ['to lower'], trivialLiterals: [Number.NaN] },
    });

    expect(problems.map((p) => p.path).sort()).toEqual([
      'domain.facts.normalizationMethods',
      'domain.facts.trivialLiterals',
      'domain.rungs.pinnedCoverage',
      'domain.tests.characterization',
      'domain.tests.contract.names',
      'domain.tests.contract.paths',
    ]);
  });

  it('extensions are lower-cased', () => {
    const { config, problems } = resolveDomainConfig({ facts: { textScanExtensions: ['.PY'] } });

    expect(problems).toEqual([]);
    expect(config.facts.textScanExtensions).toEqual(['.py']);
  });

  it('extensions are deduplicated after lower-casing, first seen first', () => {
    const { config, problems } = resolveDomainConfig({ facts: { textScanExtensions: ['.rb', '.py', '.PY', '.Rb', '.kt'] } });

    expect(problems).toEqual([]);
    expect(config.facts.textScanExtensions).toEqual(['.rb', '.py', '.kt']);
  });
});

describe('fact defaults stay in line with the plugins (W6)', () => {
  const vectors = JSON.parse(
    readFileSync(new URL('../../../../plugin-api/conformance/fact-vectors.json', import.meta.url), 'utf8'),
  ) as {
    defaults: { trivialLiterals: unknown[]; normalizationMethods: string[] };
    matchesNormalizationPatternCustom: { input: { patterns: string[] } }[];
  };

  it('the default fact lists equal the defaults block of fact-vectors.json', () => {
    expect(DEFAULT_DOMAIN_CONFIG.facts.trivialLiterals).toEqual(vectors.defaults.trivialLiterals);
    expect(DEFAULT_DOMAIN_CONFIG.facts.normalizationMethods).toEqual(vectors.defaults.normalizationMethods);
  });

  it('the method pattern equals the plugins METHOD_PATTERN', () => {
    const source = readFileSync(new URL('../../../../lang-csharp/src/facts/fact-options.ts', import.meta.url), 'utf8');
    const literal = /const METHOD_PATTERN = \/(.+)\/;/.exec(source);
    expect(literal).not.toBeNull();
    const master = new RegExp(literal![1]!);
    expect(NORMALIZATION_METHOD_PATTERN.source).toBe(master.source);

    const inputs = [
      ...vectors.defaults.normalizationMethods,
      ...vectors.matchesNormalizationPatternCustom.flatMap((v) => v.input.patterns),
      'to lower',
      'a.b.c',
      '*',
      '',
    ];
    for (const input of inputs) expect(NORMALIZATION_METHOD_PATTERN.test(input), input).toBe(master.test(input));
  });
});

/** A valid `domain:` section that sets every key the resolver reads. */
const FULL_DOMAIN = {
  registry: 'domain/ctx.yaml',
  coverage: { unowned: 'error' },
  boundaries: { enforce: 'report', blockingRungs: ['boring'] },
  rules: { idPattern: '^R-\\d+$', trackerPrefixes: ['JIRA'] },
  tests: {
    ruleTraitKeys: ['Rule'],
    characterization: { annotations: ['Category:Golden'], paths: ['golden/**'], names: ['[golden]'] },
    contract: { annotations: ['Pact'], paths: ['pacts/**'], names: ['[pact]'] },
  },
  rungs: { pinnedCoverage: 0.5 },
  facts: { trivialLiterals: [0], normalizationMethods: ['trim'], textScanExtensions: ['.py'] },
  guard: { enabled: false, base: 'origin/main', subagents: true },
};

function keyPaths(value: Record<string, unknown>, prefix = 'domain'): string[] {
  return Object.entries(value).flatMap(([key, child]) => {
    const path = `${prefix}.${key}`;
    return typeof child === 'object' && child !== null && !Array.isArray(child)
      ? [path, ...keyPaths(child as Record<string, unknown>, path)]
      : [path];
  });
}

describe('findUnknownDomainKeys', () => {
  it('the known keys are the keys the resolver returns (no drift between defaults, optional keys and the resolver)', () => {
    const { config, problems } = resolveDomainConfig(FULL_DOMAIN);
    expect(problems).toEqual([]);
    const known = [...knownDomainKeyPaths()].sort();
    expect(keyPaths(config as unknown as Record<string, unknown>).sort()).toEqual(known);
    expect(keyPaths(FULL_DOMAIN).sort()).toEqual(known);
    expect(known).toContain('domain.tests.contract.paths');
    expect(known).toContain('domain.guard.base');
  });

  it('reports nothing for a valid full config, an empty section and an absent one', () => {
    expect(findUnknownDomainKeys(FULL_DOMAIN)).toEqual([]);
    expect(findUnknownDomainKeys({})).toEqual([]);
    expect(findUnknownDomainKeys(undefined)).toEqual([]);
    expect(findUnknownDomainKeys(null)).toEqual([]);
    expect(findUnknownDomainKeys(['registry'])).toEqual([]);
  });

  it('names unknown top-level and nested keys by dotted path, in config order', () => {
    const unknown = findUnknownDomainKeys({
      boundaires: { enforce: 'report' },
      rules: { trackerPrefix: ['JIRA'] },
      tests: { contract: { pathz: ['x/**'], colour: 'red' } },
    });
    expect(unknown.map((k) => k.path)).toEqual([
      'domain.boundaires',
      'domain.rules.trackerPrefix',
      'domain.tests.contract.pathz',
      'domain.tests.contract.colour',
    ]);
  });

  it('suggests the closest sibling for a near miss, case-insensitively', () => {
    expect(findUnknownDomainKeys({ boundaires: {} })).toEqual([{ path: 'domain.boundaires', suggestion: 'domain.boundaries' }]);
    expect(findUnknownDomainKeys({ rules: { trackerPrefix: [] } })).toEqual([
      { path: 'domain.rules.trackerPrefix', suggestion: 'domain.rules.trackerPrefixes' },
    ]);
    expect(findUnknownDomainKeys({ tests: { contract: { pathz: [] } } })).toEqual([
      { path: 'domain.tests.contract.pathz', suggestion: 'domain.tests.contract.paths' },
    ]);
    expect(findUnknownDomainKeys({ guard: { Enabled: true } })).toEqual([{ path: 'domain.guard.Enabled', suggestion: 'domain.guard.enabled' }]);
  });

  it('suggests a key of the same name in another section when no sibling is close', () => {
    expect(findUnknownDomainKeys({ trackerPrefixes: ['JIRA'] })).toEqual([
      { path: 'domain.trackerPrefixes', suggestion: 'domain.rules.trackerPrefixes' },
    ]);
  });

  it('gives no suggestion for a far miss', () => {
    expect(findUnknownDomainKeys({ colour: 'red' })).toEqual([{ path: 'domain.colour' }]);
    expect(findUnknownDomainKeys({ rules: { somethingElse: 1 } })).toEqual([{ path: 'domain.rules.somethingElse' }]);
  });

  it('does not descend into lists, scalars or a mapping given where the schema has a leaf (the section has no free-form maps)', () => {
    expect(
      findUnknownDomainKeys({
        registry: { anything: 1 },
        boundaries: { blockingRungs: [{ odd: 1 }] },
        facts: { trivialLiterals: [{ odd: 1 }] },
        tests: 'not a mapping',
      }),
    ).toEqual([]);
  });

  it('the loader still falls back: unknown keys change nothing in the resolved config', () => {
    const { config, problems } = resolveDomainConfig({ boundaires: { enforce: 'report' }, rules: { trackerPrefix: ['JIRA'] } });
    expect(config).toEqual(DEFAULT_DOMAIN_CONFIG);
    expect(problems).toEqual([]);
  });

  it('describes a key with and without a suggestion', () => {
    expect(describeUnknownDomainKey({ path: 'domain.boundaires', suggestion: 'domain.boundaries' })).toBe(
      'domain.boundaires (did you mean domain.boundaries?)',
    );
    expect(describeUnknownDomainKey({ path: 'domain.colour' })).toBe('domain.colour');
  });

  it('keyDistance counts an adjacent transposition as one edit', () => {
    expect(keyDistance('boundaires', 'boundaries')).toBe(1);
    expect(keyDistance('trackerPrefix', 'trackerPrefixes')).toBe(2);
    expect(keyDistance('ABC', 'abc')).toBe(0);
    expect(keyDistance('', 'abc')).toBe(3);
  });
});
