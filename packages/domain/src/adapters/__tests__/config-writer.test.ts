import { describe, it, expect } from 'vitest';
import { parse } from 'yaml';
import { mergeDiscoveryProposal, mergeDomainDefaults } from '../config-writer.js';
import { DEFAULT_DOMAIN_CONFIG, resolveDomainConfig } from '../../core/domain-config.js';

const BOM = String.fromCharCode(0xfeff);

/** The block an absent `domain:` section gets (D15), with `<mode>` filled in. */
function block(mode: string): string {
  return [
    'domain:',
    '  registry: docs/domain/contexts.yaml',
    '  coverage:',
    '    unowned: warn            # warn | error',
    '  boundaries:',
    `    enforce: ${mode}          # by-rung | new-only | report`,
    '    blockingRungs: [bounded, boring]',
    '  rules:',
    '    idPattern: "^[A-Z][A-Z0-9]*-\\\\d+$"',
    '    trackerPrefixes: []',
    '  tests:',
    '    ruleTraitKeys: [Rule]',
    '    characterization:',
    '      annotations: ["Trait:Kind=Characterization", "Tag:characterization"]',
    '      paths: ["**/Characterization/**"]',
    '      names: ["[characterization]"]',
    '    contract:',
    '      annotations: ["Trait:Kind=Contract", "Tag:contract"]',
    '      paths: ["**/Contract/**", "**/Contracts.Tests/**"]',
    '      names: ["[contract]"]',
    '  rungs:',
    '    pinnedCoverage: 0.8',
    '  guard:',
    '    enabled: true',
    '    subagents: false',
    '',
  ].join('\n');
}

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

const CONFIG = `# ctxo project configuration
version: "1.0"

gate:
  enabled: true
  sensitivity: balanced   # strict | balanced | lenient
`;

describe('mergeDomainDefaults', () => {
  it('mergeDomainDefaults appends the commented block when the section is absent', () => {
    const merged = mergeDomainDefaults(CONFIG, 'report');

    expect(merged.changed).toBe(true);
    expect(merged.text).toBe(`${CONFIG}\n${block('report')}`);
    // The block parses to the defaults, with the chosen mode.
    const domain = parse(merged.text).domain;
    expect(resolveDomainConfig(domain)).toEqual({
      config: { ...DEFAULT_DOMAIN_CONFIG, boundaries: { ...DEFAULT_DOMAIN_CONFIG.boundaries, enforce: 'report' } },
      problems: [],
    });
    // A text without a trailing newline and an empty text get the block too.
    expect(mergeDomainDefaults('version: "1.0"', 'by-rung').text).toBe(`version: "1.0"\n\n${block('by-rung')}`);
    expect(mergeDomainDefaults('', 'by-rung').text).toBe(block('by-rung'));
  });

  it('adds missing keys and never changes existing values', () => {
    const text = `${CONFIG}domain:
  registry: docs/contexts.yaml
  boundaries:
    enforce: report
  guard:
    subagents: true
`;

    const merged = mergeDomainDefaults(text, 'by-rung');

    expect(merged.changed).toBe(true);
    const domain = parse(merged.text).domain;
    expect(domain.registry).toBe('docs/contexts.yaml');
    expect(domain.boundaries).toEqual({ enforce: 'report', blockingRungs: ['bounded', 'boring'] });
    expect(domain.guard).toEqual({ subagents: true, enabled: true });
    expect(domain.coverage).toEqual({ unowned: 'warn' });
    expect(domain.rules).toEqual({ idPattern: '^[A-Z][A-Z0-9]*-\\d+$', trackerPrefixes: [] });
    expect(domain.tests).toEqual({
      ruleTraitKeys: ['Rule'],
      characterization: CHARACTERIZATION,
      contract: CONTRACT,
    });
    expect(domain.rungs).toEqual({ pinnedCoverage: 0.8 });

    // A complete section is left exactly as it is.
    expect(mergeDomainDefaults(merged.text, 'by-rung')).toEqual({ text: merged.text, changed: false });
  });

  it('keeps comments', () => {
    const text = `${CONFIG}# Domain layer
domain:
  # where the registry lives
  registry: docs/contexts.yaml # custom
`;

    const merged = mergeDomainDefaults(text, 'report');

    expect(merged.text).toContain('# ctxo project configuration');
    expect(merged.text).toContain('# Domain layer');
    expect(merged.text).toContain('# where the registry lives');
    expect(merged.text).toContain('registry: docs/contexts.yaml # custom');
    expect(merged.text).toContain('sensitivity: balanced');
    expect(parse(merged.text).domain.boundaries.enforce).toBe('report');
  });

  it('keeps CRLF line endings and a BOM', () => {
    const crlf = BOM + CONFIG.replace(/\n/g, '\r\n');
    const appended = mergeDomainDefaults(crlf, 'report');
    expect(appended.text.startsWith(BOM)).toBe(true);
    expect(appended.text.slice(1).replace(/\r\n/g, '')).not.toContain('\n');
    expect(appended.text).toBe(BOM + `${CONFIG}\n${block('report')}`.replace(/\n/g, '\r\n'));

    const partial = BOM + `${CONFIG}domain:\n  registry: x.yaml\n`.replace(/\n/g, '\r\n');
    const merged = mergeDomainDefaults(partial, 'report');
    expect(merged.changed).toBe(true);
    expect(merged.text.startsWith(BOM)).toBe(true);
    expect(merged.text.slice(1).replace(/\r\n/g, '')).not.toContain('\n');
    expect(parse(merged.text.slice(1)).domain.registry).toBe('x.yaml');
  });

  it('mergeDomainDefaults writes the K13a and rungs defaults and no fact lists', () => {
    for (const text of [CONFIG, 'domain:\n', `${CONFIG}domain:\n  registry: x.yaml\n`]) {
      const domain = parse(mergeDomainDefaults(text, 'by-rung').text).domain;
      expect(domain.tests).toEqual({ ruleTraitKeys: ['Rule'], characterization: CHARACTERIZATION, contract: CONTRACT });
      expect(domain.rungs).toEqual({ pinnedCoverage: 0.8 });
      expect(domain.facts).toBeUndefined();
    }
  });

  it('adds the new keys to an existing domain section without changing values', () => {
    const text = `${CONFIG}domain:
  tests:
    ruleTraitKeys: [Req]
    contract:
      paths: ["api/**"]   # ours
  rungs:
    pinnedCoverage: 0.6
`;

    const merged = mergeDomainDefaults(text, 'by-rung');

    expect(merged.changed).toBe(true);
    expect(merged.text).toContain('# ours');
    const domain = parse(merged.text).domain;
    expect(domain.tests).toEqual({
      ruleTraitKeys: ['Req'],
      contract: { paths: ['api/**'], annotations: CONTRACT.annotations, names: CONTRACT.names },
      characterization: CHARACTERIZATION,
    });
    expect(domain.rungs).toEqual({ pinnedCoverage: 0.6 });
    expect(domain.facts).toBeUndefined();
  });

  it('fills an empty domain: key and rejects a section that is not a mapping', () => {
    const merged = mergeDomainDefaults('domain:\n', 'report');
    expect(parse(merged.text).domain.boundaries.enforce).toBe('report');
    expect(() => mergeDomainDefaults('domain: 3\n', 'report')).toThrow(/domain must be a mapping/);
    expect(() => mergeDomainDefaults('a: [\n', 'report')).toThrow();
  });
});

describe('mergeDiscoveryProposal', () => {
  const proposal = {
    trackerPrefixes: ['LEND', 'OPS'],
    ruleTraitKeys: ['Rule', 'Req'],
    indexTests: ['qa/**'],
    characterizationPaths: [],
    contractPaths: [],
  };

  it('mergeDiscoveryProposal unions characterization and contract paths', () => {
    const text = 'domain:\n  tests:\n    contract:\n      paths: ["api/**"]   # ours\n';
    const out = mergeDiscoveryProposal(text, {
      ...proposal,
      characterizationPaths: ['tests/Golden/**'],
      contractPaths: ['api/**', 'tests/Contracts/**'],
    });

    expect(out.changed).toBe(true);
    expect(out.text).toContain('# ours');
    const doc = parse(out.text);
    expect(doc.domain.tests.contract.paths).toEqual(['api/**', 'tests/Contracts/**']);
    // An absent list starts from the defaults, so the proposal adds to them instead of replacing them.
    expect(doc.domain.tests.characterization.paths).toEqual([...CHARACTERIZATION.paths, 'tests/Golden/**']);

    const again = mergeDiscoveryProposal(out.text, { ...proposal, characterizationPaths: ['tests/Golden/**'], contractPaths: ['tests/Contracts/**'] });
    expect(parse(again.text).domain.tests.contract.paths).toEqual(['api/**', 'tests/Contracts/**']);
  });

  it('unions characterization and contract annotations, starting an absent list from its defaults (#191)', () => {
    const text = 'domain:\n  tests:\n    contract:\n      annotations: [ContractFact]   # ours\n';
    const out = mergeDiscoveryProposal(text, {
      ...proposal,
      characterizationAnnotations: ['Category:FeeCharacterization'],
      contractAnnotations: ['ContractFact', 'Trait:Category=StorageContract'],
    });
    expect(out.changed).toBe(true);
    expect(out.text).toContain('# ours');
    const doc = parse(out.text);
    expect(doc.domain.tests.contract.annotations).toEqual(['ContractFact', 'Trait:Category=StorageContract']);
    expect(doc.domain.tests.characterization.annotations).toEqual([...CHARACTERIZATION.annotations, 'Category:FeeCharacterization']);
    const again = mergeDiscoveryProposal(out.text, { ...proposal, contractAnnotations: ['Trait:Category=StorageContract'] });
    expect(parse(again.text).domain.tests.contract.annotations).toEqual(['ContractFact', 'Trait:Category=StorageContract']);
  });

  it('mergeDiscoveryProposal adds values without dropping existing ones', () => {
    const text = [
      'version: "1.0"',
      'domain:',
      '  rules:',
      '    trackerPrefixes: [OPS, ZED]  # mine',
      '  tests:',
      '    ruleTraitKeys: [Rule]',
      'index:',
      '  tests:',
      '    - "old/**"',
      '',
    ].join('\n');
    const out = mergeDiscoveryProposal(text, proposal);
    expect(out.changed).toBe(true);
    const doc = parse(out.text);
    expect(doc.domain.rules.trackerPrefixes).toEqual(['OPS', 'ZED', 'LEND']);
    expect(doc.domain.tests.ruleTraitKeys).toEqual(['Rule', 'Req']);
    expect(doc.index.tests).toEqual(['old/**', 'qa/**']);
    expect(out.text).toContain('# mine');
  });

  it('creates missing sections, also from an empty file', () => {
    const doc = parse(mergeDiscoveryProposal('', proposal).text);
    expect(doc.domain.rules.trackerPrefixes).toEqual(['LEND', 'OPS']);
    expect(doc.domain.tests.ruleTraitKeys).toEqual(['Rule', 'Req']);
    expect(doc.index.tests).toEqual(['qa/**']);
  });

  it('keeps other keys and fills null sections', () => {
    const out = mergeDiscoveryProposal('stats:\n  enabled: false\ndomain:\nindex:\n', proposal);
    const doc = parse(out.text);
    expect(doc.stats.enabled).toBe(false);
    expect(doc.domain.rules.trackerPrefixes).toEqual(['LEND', 'OPS']);
    expect(doc.index.tests).toEqual(['qa/**']);
  });

  it('returns the text unchanged when nothing is new', () => {
    const text = 'domain:\n  rules:\n    trackerPrefixes: [LEND, OPS]\n  tests:\n    ruleTraitKeys: [Rule, Req]\nindex:\n  tests: ["qa/**"]\n';
    expect(mergeDiscoveryProposal(text, proposal)).toEqual({ text, changed: false });
  });

  it('keeps a BOM and CRLF line endings', () => {
    const out = mergeDiscoveryProposal(BOM + 'version: "1.0"\r\n', proposal);
    expect(out.text.startsWith(BOM)).toBe(true);
    expect(out.text).toContain('\r\n');
    expect(out.text.slice(1).replace(/\r\n/g, '')).not.toContain('\n');
  });

  it('throws on invalid YAML or a non-sequence target', () => {
    expect(() => mergeDiscoveryProposal('a: [\n', proposal)).toThrow(/not valid YAML/);
    expect(() => mergeDiscoveryProposal('domain:\n  rules:\n    trackerPrefixes: nope\n', proposal)).toThrow(/sequence/);
  });
});
