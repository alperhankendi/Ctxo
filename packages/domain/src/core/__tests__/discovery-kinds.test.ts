import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { createModuleHost, type FileIndex } from '@ctxo/cli/internal';
import {
  discoverConventions,
  EXTERNAL_ID_FAMILIES,
  EXTERNAL_ID_NOTE,
  formatDiscovery,
  proposalAddsSomething,
  type DiscoveryInput,
} from '../discovery.js';
import { parseCard } from '../card-parser.js';
import { DEFAULT_DOMAIN_CONFIG, type DomainConfig } from '../domain-config.js';

/** Issue #191: tracker kinds, GitHub issues, other identifiers and test-kind markers beyond folders. */

const host = createModuleHost({ cliVersion: '0.0.0', mode: 'cli', projectRoot: process.cwd() });

type Annotation = { name: string; args?: string[] };

function index(file: string, methods: Annotation[][], classAnnotations: Annotation[] = []): FileIndex {
  return {
    file,
    lastModified: 1,
    symbols: [
      {
        symbolId: `${file}::C::class`,
        name: 'C',
        kind: 'class',
        startLine: 0,
        endLine: 100,
        ...(classAnnotations.length > 0 ? { annotations: classAnnotations } : {}),
      },
      ...methods.map((annotations, i) => ({
        symbolId: `${file}::C.M${i}::method`,
        name: `M${i}`,
        kind: 'method',
        startLine: i + 1,
        endLine: i + 1,
        ...(annotations.length > 0 ? { annotations } : {}),
      })),
    ],
    edges: [],
    intent: [],
    antiPatterns: [],
  } as FileIndex;
}

function input(overrides: Partial<DiscoveryInput> = {}): DiscoveryInput {
  return {
    cards: [],
    commitSubjects: [],
    localBranches: [],
    remoteBranches: [],
    indices: [],
    trackedFiles: [],
    isPathTestFile: (path) => /\.Tests\//.test(path),
    config: DEFAULT_DOMAIN_CONFIG,
    indexTests: [],
    testFrameworkAnnotations: ['Fact', 'Theory', 'Test', 'TestMethod'],
    makeGlobMatcher: host.services.makeGlobMatcher,
    ...overrides,
  };
}

const times = (n: number, make: (i: number) => string): string[] => Array.from({ length: n }, (_, i) => make(i));

describe('external ID families', () => {
  it('lists at least CWE, CVE, ADR, RFC, ISO, GHSA and OWASP in one constant', () => {
    for (const family of ['CWE', 'CVE', 'ADR', 'RFC', 'ISO', 'GHSA', 'OWASP']) expect(EXTERNAL_ID_FAMILIES).toContain(family);
  });

  it('reports CWE and ADR keys as external IDs, not as tracker keys, and never proposes them', () => {
    const { evidence, proposal } = discoverConventions(
      input({
        commitSubjects: [
          ...times(6, (i) => `fix: path traversal (CWE-${22 + i})`),
          'docs: ADR-017 data coupling',
          'feat: dates in ISO-8601',
          ...times(5, (i) => `LEND-${i + 1} hold expiry`),
        ],
      }),
    );
    expect(evidence.trackerKeys).toEqual([{ prefix: 'LEND', occurrences: 5, overlapsRulePrefix: false }]);
    expect(evidence.externalIds).toEqual([
      { prefix: 'CWE', occurrences: 6, overlapsRulePrefix: false, note: EXTERNAL_ID_NOTE },
      { prefix: 'ADR', occurrences: 1, overlapsRulePrefix: false, note: EXTERNAL_ID_NOTE },
      { prefix: 'ISO', occurrences: 1, overlapsRulePrefix: false, note: EXTERNAL_ID_NOTE },
    ]);
    expect(EXTERNAL_ID_NOTE).toBe('references, not rule IDs; no config needed');
    expect(proposal.trackerPrefixes).toEqual(['LEND']);
    expect(proposal).not.toHaveProperty('externalIdPrefixes');
  });

  it('external IDs alone add nothing to the proposal', () => {
    const { proposal } = discoverConventions(input({ commitSubjects: ['dates in ISO-8601', 'RFC-7231 caching'] }));
    expect(proposal.trackerPrefixes).toEqual([]);
    expect(proposalAddsSomething(proposal, DEFAULT_DOMAIN_CONFIG, [])).toBe(false);
  });

  it('flags a family that is also a card rule prefix and still never proposes it', () => {
    const card = parseCard('# Decisions\n\n## Rules and invariants\n### ADR-01 Decisions are recorded\nUntested: manual\n');
    const { evidence, proposal } = discoverConventions(input({ cards: [card], commitSubjects: times(6, (i) => `ADR-0${i} note`) }));
    expect(evidence.externalIds).toEqual([{ prefix: 'ADR', occurrences: 6, overlapsRulePrefix: true, note: EXTERNAL_ID_NOTE }]);
    expect(proposal.trackerPrefixes).toEqual([]);
    expect(formatDiscovery(evidence, proposal, DEFAULT_DOMAIN_CONFIG)).toContain('ADR   <- also a card rule prefix; never proposed');
  });

  it('a real tracker prefix still needs five subjects or branches', () => {
    const { proposal } = discoverConventions(input({ commitSubjects: times(4, (i) => `OPS-${i} tune`) }));
    expect(proposal.trackerPrefixes).toEqual([]);
  });

  it('prints external IDs with their counts and label', () => {
    const { evidence, proposal } = discoverConventions(
      input({ commitSubjects: [...times(2, (i) => `CVE-2026-${1000 + i} patch`), 'ISO-8601 dates'] }),
    );
    const text = formatDiscovery(evidence, proposal, DEFAULT_DOMAIN_CONFIG);
    expect(text).toContain(`${'  external IDs:'.padEnd(22)}CVE (2), ISO (1)   <- references, not rule IDs; no config needed`);
    expect(text).toContain(`${'  tracker-like keys:'.padEnd(22)}none`);
    expect(text).toContain('trackerPrefixes: []');
  });
});

describe('GitHub issues (#N)', () => {
  it('counts issue references, (#N) squash suffixes and N-slug branches, but not a bare #N', () => {
    const { evidence } = discoverConventions(
      input({
        commitSubjects: [
          'feat: holds (#164)',
          'fix #12 overdue fees',
          'Closes: #40 the fee rounding',
          '#7 tidy the card',
          'Merge pull request #189 from someone/branch',
          'docs: step #1 of the plan',
          'chore: tidy',
          'colour &#35;1 entity',
        ],
        localBranches: ['feat/164-holds', 'fix/12-overdue-fees', 'release/2026-05', '164-fix-holds', 'main'],
        remoteBranches: ['origin/feat/164-holds', 'origin/docs/201-site'],
      }),
    );
    expect(evidence.githubIssues).toEqual({ subjects: 5, squashSuffixes: 1, totalSubjects: 8, branches: 4, largestFamily: true });
  });

  it('prints the share and the squash count, and names GitHub as the tracker when it is the largest family', () => {
    const subjects = [...times(40, (i) => `feat: holds (#${100 + i})`), ...times(12, (i) => `chore: tidy ${i}`)];
    const found = discoverConventions(input({ commitSubjects: subjects, localBranches: ['feat/164-holds', 'fix/170-fees'] }));
    expect(formatDiscovery(found.evidence, found.proposal, DEFAULT_DOMAIN_CONFIG)).toContain(
      `${'  GitHub issues (#N):'.padEnd(22)}40 of 52 subjects (77%), 40 with a (#N) suffix; 2 branches   <- the issue tracker (GitHub); no config key needed`,
    );
    const none = discoverConventions(input());
    expect(none.evidence.githubIssues).toEqual({ subjects: 0, squashSuffixes: 0, totalSubjects: 0, branches: 0, largestFamily: false });
    expect(formatDiscovery(none.evidence, none.proposal, DEFAULT_DOMAIN_CONFIG)).not.toContain('GitHub issues');
  });

  it('needs at least five references for the tracker verdict, and skips year-like branches (m3)', () => {
    const one = discoverConventions(input({ commitSubjects: ['fix (#1)', ...times(999, (i) => `chore ${i}`)] }));
    expect(one.evidence.githubIssues).toMatchObject({ subjects: 1, largestFamily: false });
    expect(formatDiscovery(one.evidence, one.proposal, DEFAULT_DOMAIN_CONFIG)).not.toContain('the issue tracker (GitHub)');
    const five = discoverConventions(input({ commitSubjects: times(4, (i) => `fix (#${i + 1})`), localBranches: ['feat/9-holds'] }));
    expect(five.evidence.githubIssues.largestFamily).toBe(true);
    expect(discoverConventions(input({ localBranches: ['release/2024-q1', '2025-hotfix'] })).evidence.githubIssues.branches).toBe(0);
  });

  it('does not name GitHub as the tracker when a tracker key family is larger', () => {
    const { evidence, proposal } = discoverConventions(
      input({ commitSubjects: [...times(9, (i) => `LEND-${i + 1} loans`), 'fix (#3)'] }),
    );
    expect(evidence.githubIssues.largestFamily).toBe(false);
    expect(formatDiscovery(evidence, proposal, DEFAULT_DOMAIN_CONFIG)).not.toContain('the issue tracker (GitHub)');
  });

  it('proposes no config key for them', () => {
    const { proposal } = discoverConventions(input({ commitSubjects: times(10, (i) => `fix (#${i + 1})`) }));
    expect(proposal.trackerPrefixes).toEqual([]);
    expect(proposalAddsSomething(proposal, DEFAULT_DOMAIN_CONFIG, [])).toBe(false);
  });
});

describe('other identifiers', () => {
  it('reports lowercase name-NN branch families seen in at least three branches, and proposes nothing', () => {
    const { evidence, proposal } = discoverConventions(
      input({
        localBranches: ['fix/acme-12', 'fix/acme-14-login', 'acme-15', 'fix/zeta-1', 'fix/zeta-2', 'deps/lib-1.2.3', 'deps/lib-1.4.0', 'deps/lib-2.0.0'],
        remoteBranches: ['origin/fix/acme-12'],
      }),
    );
    expect(evidence.otherIdentifiers).toEqual([{ prefix: 'acme', branches: 3, possibleTrackerKey: false }]);
    expect(proposal.trackerPrefixes).toEqual([]);
    const text = formatDiscovery(evidence, proposal, DEFAULT_DOMAIN_CONFIG);
    expect(text).toContain(`${'  other identifiers:'.padEnd(22)}acme-NN in 3 branches   <- lowercase identifiers; not proposed`);
  });

  it('leaves out runtime names', () => {
    const { evidence } = discoverConventions(
      input({ localBranches: ['chore/node-18', 'chore/node-20', 'chore/node-22', 'ci/python-3', 'ci/python-4', 'ci/python-5'] }),
    );
    expect(evidence.otherIdentifiers).toEqual([]);
  });

  it('marks a family whose upper case is a card rule prefix, a tracker key or a configured prefix', () => {
    const config: DomainConfig = { ...DEFAULT_DOMAIN_CONFIG, rules: { ...DEFAULT_DOMAIN_CONFIG.rules, trackerPrefixes: ['ENG'] } };
    const card = parseCard('# Lending\n\n## Rules and invariants\n### LEND-01 r\nUntested: manual\n');
    const { evidence, proposal } = discoverConventions(
      input({
        config,
        cards: [card],
        commitSubjects: ['OPS-1 deploy'],
        localBranches: [
          ...times(3, (i) => `fix/lend-${i + 1}`),
          ...times(3, (i) => `fix/ops-${i + 1}`),
          ...times(3, (i) => `user/eng-${i + 1}-title`),
          ...times(3, (i) => `fix/acme-${i + 1}`),
        ],
      }),
    );
    expect(evidence.otherIdentifiers).toEqual([
      { prefix: 'acme', branches: 3, possibleTrackerKey: false },
      { prefix: 'eng', branches: 3, possibleTrackerKey: true },
      { prefix: 'lend', branches: 3, possibleTrackerKey: true },
      { prefix: 'ops', branches: 3, possibleTrackerKey: true },
    ]);
    const text = formatDiscovery(evidence, proposal, config);
    expect(text).toContain('eng-NN in 3 branches (possible tracker key, lowercase)');
  });
});

describe('test-kind markers beyond folders', () => {
  const contractFile = index(
    'tests/Storage.Tests/BlobStoreContractTests.cs',
    [[{ name: 'StorageContractFact' }], [{ name: 'StorageContractTheory' }], [{ name: 'StorageContractFact' }]],
    [{ name: 'Trait', args: ['Category', 'StorageContract'] }],
  );
  const characterizationFile = index('tests/Lending.Tests/FeeCharacterizationTests.cs', [
    [{ name: 'Fact' }, { name: 'Category', args: ['FeeCharacterization'] }],
  ]);
  const plain = index('tests/Lending.Tests/LoanTests.cs', [[{ name: 'Fact' }, { name: 'Trait', args: ['Category', 'Slow'] }]]);
  const trackedFiles = [contractFile.file, characterizationFile.file, plain.file, 'src/Storage/BlobStore.cs'];

  it('reports Trait and Category values, custom attributes and file-name patterns per kind', () => {
    const { evidence } = discoverConventions(input({ indices: [contractFile, characterizationFile, plain], trackedFiles }));
    expect(evidence.testKindMarkers).toEqual({
      characterization: {
        annotationValues: [{ matcher: 'Category:FeeCharacterization', count: 1 }],
        attributes: [],
        fileNames: [{ glob: '**/*CharacterizationTests.cs', files: 1, entityTests: 0, entityFiles: [] }],
      },
      contract: {
        annotationValues: [{ matcher: 'Trait:Category=StorageContract', count: 1 }],
        attributes: [
          { name: 'StorageContractFact', count: 2 },
          { name: 'StorageContractTheory', count: 1 },
        ],
        fileNames: [{ glob: '**/*ContractTests.cs', files: 1, entityTests: 0, entityFiles: [] }],
      },
    });
  });

  it('proposes annotations and file-name globs as paths, keeping folder proposals', () => {
    const { proposal } = discoverConventions(
      input({ indices: [contractFile, characterizationFile, plain], trackedFiles: [...trackedFiles, 'tests/Contracts/X.cs'] }),
    );
    expect(proposal.contractAnnotations).toEqual(['StorageContractFact', 'StorageContractTheory', 'Trait:Category=StorageContract']);
    expect(proposal.characterizationAnnotations).toEqual(['Category:FeeCharacterization']);
    expect(proposal.contractPaths).toEqual(['**/*ContractTests.cs', 'tests/Contracts/**']);
    expect(proposal.characterizationPaths).toEqual(['**/*CharacterizationTests.cs']);
    expect(proposalAddsSomething(proposal, DEFAULT_DOMAIN_CONFIG, [])).toBe(true);
  });

  it('proposes nothing the configured convention already matches', () => {
    const config: DomainConfig = {
      ...DEFAULT_DOMAIN_CONFIG,
      tests: {
        ...DEFAULT_DOMAIN_CONFIG.tests,
        contract: {
          annotations: ['Trait:Kind=Contract', 'Trait:category=storagecontract', 'StorageContractFact', 'StorageContractTheory'],
          paths: ['**/*ContractTests.cs'],
          names: [],
        },
      },
    };
    const kindFile = index('tests/Storage.Tests/KindTests.cs', [[{ name: 'Fact' }, { name: 'Trait', args: ['Kind', 'Contract'] }]]);
    const { evidence, proposal } = discoverConventions(input({ config, indices: [contractFile, kindFile], trackedFiles: [contractFile.file] }));
    expect(evidence.testKindMarkers.contract.annotationValues).toEqual([
      { matcher: 'Trait:Category=StorageContract', count: 1 },
      { matcher: 'Trait:Kind=Contract', count: 1 },
    ]);
    expect(proposal.contractAnnotations).toEqual([]);
    expect(proposal.contractPaths).toEqual([]);
  });

  it('reads custom attributes in files outside the test globs, but values only in test files', () => {
    const outside = index('src/Storage/Probe.cs', [[{ name: 'StorageContractFact' }, { name: 'Trait', args: ['Category', 'OtherContract'] }]]);
    const { evidence } = discoverConventions(input({ indices: [outside] }));
    expect(evidence.testKindMarkers.contract.attributes).toEqual([{ name: 'StorageContractFact', count: 1 }]);
    // The custom test attribute makes the file a test file, so its Trait value counts too.
    expect(evidence.testKindMarkers.contract.annotationValues).toEqual([{ matcher: 'Trait:Category=OtherContract', count: 1 }]);
    const prod = index('src/Storage/Prod.cs', [[{ name: 'Trait', args: ['Category', 'ProdContract'] }]]);
    expect(discoverConventions(input({ indices: [prod] })).evidence.testKindMarkers.contract.annotationValues).toEqual([]);
  });

  it('prints the markers and a proposed config block that parses to the configured values plus the new ones', () => {
    const { evidence, proposal } = discoverConventions(input({ indices: [contractFile, characterizationFile], trackedFiles }));
    const text = formatDiscovery(evidence, proposal, DEFAULT_DOMAIN_CONFIG);
    expect(text).toContain('Test kind markers');
    expect(text).toContain('Trait:Category=StorageContract   <- not covered by domain.tests.contract.annotations');
    expect(text).toContain('**/*ContractTests.cs   <- not covered by domain.tests.contract.paths');
    const block = text.slice(text.indexOf('Proposed config (.ctxo/config.yaml)\n') + 'Proposed config (.ctxo/config.yaml)\n'.length);
    const parsed = parseYaml(block) as {
      domain: { tests: { contract: { annotations: string[]; paths: string[] }; characterization: { annotations: string[]; paths: string[] } } };
    };
    expect(parsed.domain.tests.contract.annotations).toEqual([...DEFAULT_DOMAIN_CONFIG.tests.contract.annotations, ...proposal.contractAnnotations]);
    expect(parsed.domain.tests.contract.paths).toEqual([...DEFAULT_DOMAIN_CONFIG.tests.contract.paths, ...proposal.contractPaths]);
    expect(parsed.domain.tests.characterization.annotations).toEqual([
      ...DEFAULT_DOMAIN_CONFIG.tests.characterization.annotations,
      ...proposal.characterizationAnnotations,
    ]);
    expect(text).not.toContain(String.fromCharCode(0x2014));
  });

  it('says so when no marker beyond folders is found', () => {
    const { evidence, proposal } = discoverConventions(input({ indices: [plain], trackedFiles: [plain.file] }));
    expect(formatDiscovery(evidence, proposal, DEFAULT_DOMAIN_CONFIG)).toContain(`${'Test kind markers'.padEnd(22)}none beyond folders`);
  });
});

describe('test-kind markers: what is not a marker', () => {
  /** A non-test source file declaring a class, so its name is an entity of the domain. */
  const entity = (file: string, name: string): FileIndex =>
    ({
      file,
      lastModified: 1,
      symbols: [{ symbolId: `${file}::${name}::class`, name, kind: 'class', startLine: 0, endLine: 9 }],
      edges: [],
      intent: [],
      antiPatterns: [],
    }) as FileIndex;

  it('LoanContractTests.cs next to a LoanContract class tests an entity: evidence only, no glob', () => {
    const tests = index('tests/Lending.Tests/LoanContractTests.cs', [[{ name: 'Fact' }]]);
    const { evidence, proposal } = discoverConventions(
      input({ indices: [tests, entity('src/Lending/LoanContract.cs', 'LoanContract')], trackedFiles: [tests.file, 'src/Lending/LoanContract.cs'] }),
    );
    expect(evidence.testKindMarkers.contract.fileNames).toEqual([
      { glob: '**/*ContractTests.cs', files: 1, entityTests: 1, entityFiles: ['tests/Lending.Tests/LoanContractTests.cs'] },
    ]);
    expect(proposal.contractPaths).toEqual([]);
    expect(formatDiscovery(evidence, proposal, DEFAULT_DOMAIN_CONFIG)).toContain(
      'file names **/*ContractTests.cs (1, 1 named after a non-test class, so not proposed: tests/Lending.Tests/LoanContractTests.cs)',
    );
  });

  it('a family made only of entity files is not proposed, whatever its size', () => {
    const tests = [
      index('tests/Lending.Tests/LoanContractTests.cs', [[{ name: 'Fact' }]]),
      index('tests/Lending.Tests/RentalContractTests.cs', [[{ name: 'Fact' }]]),
    ];
    const entities = [entity('src/Lending/LoanContract.cs', 'LoanContract'), entity('src/Lending/RentalContract.cs', 'RentalContract')];
    const { evidence, proposal } = discoverConventions(
      input({ indices: [...tests, ...entities], trackedFiles: [...tests, ...entities].map((i) => i.file) }),
    );
    expect(evidence.testKindMarkers.contract.fileNames).toEqual([
      {
        glob: '**/*ContractTests.cs',
        files: 2,
        entityTests: 2,
        entityFiles: ['tests/Lending.Tests/LoanContractTests.cs', 'tests/Lending.Tests/RentalContractTests.cs'],
      },
    ]);
    expect(proposal.contractPaths).toEqual([]);
  });

  it('an entity file is left out of its family, which is proposed on its other files (#191 leftover)', () => {
    const files = [
      'tests/Storage.Tests/BlobStoreContractTests.cs',
      'tests/Lending.Tests/LoanContractTests.cs',
      'tests/Storage.Tests/QueueContractTests.cs',
      'tests/Lending.Tests/FeeContractTests.cs',
    ];
    const tests = files.map((file) => index(file, [[{ name: 'Fact' }]]));
    const entities = [entity('src/Lending/LoanContract.cs', 'LoanContract'), entity('src/Lending/FeeContract.cs', 'FeeContract')];
    const run = (tracked: readonly string[]) =>
      discoverConventions(input({ indices: [...tests, ...entities], trackedFiles: [...tracked, ...entities.map((i) => i.file)] }));
    const { evidence, proposal } = run(files);
    const expected = {
      glob: '**/*ContractTests.cs',
      files: 4,
      entityTests: 2,
      entityFiles: ['tests/Lending.Tests/FeeContractTests.cs', 'tests/Lending.Tests/LoanContractTests.cs'],
    };
    expect(evidence.testKindMarkers.contract.fileNames).toEqual([expected]);
    expect(proposal.contractPaths).toEqual(['**/*ContractTests.cs']);
    expect(formatDiscovery(evidence, proposal, DEFAULT_DOMAIN_CONFIG)).toContain(
      'file names **/*ContractTests.cs (4, 2 named after a non-test class, left out: tests/Lending.Tests/FeeContractTests.cs, tests/Lending.Tests/LoanContractTests.cs)',
    );
    // Deterministic: the order of the tracked files changes nothing.
    const reversed = run([...files].reverse());
    expect(reversed.evidence.testKindMarkers.contract.fileNames).toEqual([expected]);
    expect(formatDiscovery(reversed.evidence, reversed.proposal, DEFAULT_DOMAIN_CONFIG)).toBe(
      formatDiscovery(evidence, proposal, DEFAULT_DOMAIN_CONFIG),
    );
  });

  it('the printout names the first 5 entity files and the count of the rest; --json keeps them all', () => {
    const names = Array.from({ length: 7 }, (_, i) => `Item${i}Contract`);
    const tests = names.map((name) => index(`tests/Lending.Tests/${name}Tests.cs`, [[{ name: 'Fact' }]]));
    const entities = names.map((name) => entity(`src/Lending/${name}.cs`, name));
    const all = [...tests, ...entities];
    const { evidence, proposal } = discoverConventions(input({ indices: all, trackedFiles: all.map((i) => i.file) }));
    const files = tests.map((t) => t.file);
    expect(evidence.testKindMarkers.contract.fileNames[0]!.entityFiles).toEqual(files);
    expect(formatDiscovery(evidence, proposal, DEFAULT_DOMAIN_CONFIG)).toContain(
      `**/*ContractTests.cs (7, 7 named after a non-test class, so not proposed: ${files.slice(0, 5).join(', ')}, and 2 more)`,
    );
  });

  it('a family whose only non-entity files the configured paths already cover is not proposed', () => {
    const files = ['tests/Lending.Tests/LoanContractTests.cs', 'tests/Storage.Tests/BlobStoreContractTests.cs'];
    const tests = files.map((file) => index(file, [[{ name: 'Fact' }]]));
    const loan = entity('src/Lending/LoanContract.cs', 'LoanContract');
    const config: DomainConfig = {
      ...DEFAULT_DOMAIN_CONFIG,
      tests: { ...DEFAULT_DOMAIN_CONFIG.tests, contract: { annotations: [], paths: ['tests/Storage.Tests/**'], names: [] } },
    };
    const { proposal } = discoverConventions(input({ indices: [...tests, loan], trackedFiles: [...files, loan.file], config }));
    expect(proposal.contractPaths).toEqual([]);
  });

  it('a value that only contains the kind (ContractRenewal) or holds = is no marker', () => {
    const tests = index('tests/Lending.Tests/RenewalTests.cs', [
      [{ name: 'Fact' }, { name: 'Trait', args: ['Category', 'ContractRenewal'] }],
      [{ name: 'Fact' }, { name: 'Category', args: ['Contract=1'] }],
      [{ name: 'Fact' }, { name: 'Trait', args: ['Category', 'Contracts'] }],
      [{ name: 'Fact' }, { name: 'Trait', args: ['Kind', 'ContractTests'] }],
    ]);
    const { evidence, proposal } = discoverConventions(input({ indices: [tests] }));
    expect(evidence.testKindMarkers.contract.annotationValues).toEqual([
      { matcher: 'Trait:Category=Contracts', count: 1 },
      { matcher: 'Trait:Kind=ContractTests', count: 1 },
    ]);
    expect(proposal.contractAnnotations).toEqual(['Trait:Category=Contracts', 'Trait:Kind=ContractTests']);
  });

  it('a value named after a non-test class (Category LoanContract next to LoanContract) is no marker (m4)', () => {
    const tests = index('tests/Lending.Tests/LoanTests.cs', [
      [{ name: 'Fact' }, { name: 'Category', args: ['LoanContract'] }],
      [{ name: 'Fact' }, { name: 'Category', args: ['StorageContract'] }],
    ]);
    const { evidence, proposal } = discoverConventions(input({ indices: [tests, entity('src/Lending/LoanContract.cs', 'LoanContract')] }));
    expect(evidence.testKindMarkers.contract.annotationValues).toEqual([{ matcher: 'Category:StorageContract', count: 1 }]);
    expect(proposal.contractAnnotations).toEqual(['Category:StorageContract']);
  });

  it('DataContract and ContractTestBase attributes are no test attributes', () => {
    const tests = index('tests/Lending.Tests/A.cs', [[{ name: 'Fact' }, { name: 'DataContract' }], [{ name: 'ContractTestBase' }]]);
    expect(discoverConventions(input({ indices: [tests] })).evidence.testKindMarkers.contract.attributes).toEqual([]);
  });

  it('reads a qualified Category and proposes it under its indexed name', () => {
    const tests = index('tests/Lending.Tests/A.cs', [[{ name: 'Test' }, { name: 'NUnit.Framework.Category', args: ['Contract'] }]]);
    const { proposal } = discoverConventions(input({ indices: [tests] }));
    expect(proposal.contractAnnotations).toEqual(['NUnit.Framework.Category:Contract']);
  });

  it('takes file names from test source files only, and reads the dotted and snake-case forms', () => {
    const { evidence, proposal } = discoverConventions(
      input({
        trackedFiles: [
          'docs/ContractTests.md',
          'src/Lending/ContractTests.cs',
          'web/Lending.Tests/loan.contract.test.ts',
          'web/Lending.Tests/fee.characterization.spec.ts',
          'svc/Lending.Tests/loan_contract_test.go',
        ],
      }),
    );
    expect(evidence.testKindMarkers.contract.fileNames).toEqual([
      { glob: '**/*.contract.test.ts', files: 1, entityTests: 0, entityFiles: [] },
      { glob: '**/*_contract_test.go', files: 1, entityTests: 0, entityFiles: [] },
    ]);
    expect(evidence.testKindMarkers.characterization.fileNames).toEqual([{ glob: '**/*.characterization.spec.ts', files: 1, entityTests: 0, entityFiles: [] }]);
    expect(proposal.contractPaths).toEqual(['**/*.contract.test.ts', '**/*_contract_test.go']);
  });
});
