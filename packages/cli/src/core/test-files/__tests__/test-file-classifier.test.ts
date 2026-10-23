import { describe, it, expect } from 'vitest';
import {
  createTestFileClassifier,
  DEFAULT_TEST_GLOBS,
  filesWithTestAnnotations,
  NAME_ONLY_TEST_GLOBS,
  TEST_FRAMEWORK_ANNOTATIONS,
} from '../test-file-classifier.js';
import type { FileIndex, SymbolAnnotation, SymbolNode } from '../../types.js';

describe('createTestFileClassifier', () => {
  const isTest = createTestFileClassifier();

  it('exposes the 13 default globs', () => {
    expect(DEFAULT_TEST_GLOBS).toHaveLength(13);
  });

  it.each([
    'src/__tests__/a.ts',
    'src/a.test.ts',
    'web/a.spec.js',
    'test/a.ts',
    'tests/e2e/a.ts',
    'pkg/store_test.go',
    'src/test/java/AT.java',
    'src/Billing.Tests/A.cs',
    'src/Billing.Test/A.cs',
    'src/LoanTests.cs',
    'src/LoanTest.cs',
    'app/test_models.py',
    'app/models_test.py',
  ])('classifies a path matched by each default glob as a test file: %s', (p) => {
    expect(isTest(p)).toBe(true);
  });

  it.each([
    'src/latest.ts',
    'src/contest/a.ts',
    'src/Testing.cs',
    'src/attestation.go',
    'src/testing_utils.py',
  ])('leaves look-alike production paths alone: %s', (p) => {
    expect(isTest(p)).toBe(false);
  });

  it('matches backslash paths and paths with spaces or non-ASCII characters', () => {
    expect(isTest('src\\ödünç kaydı\\__tests__\\a.ts')).toBe(true);
    expect(isTest('src/ödünç kaydı/b.test.ts')).toBe(true);
  });

  it('adds index.tests globs to the defaults', () => {
    const custom = createTestFileClassifier(['**/Characterization/**']);
    expect(custom('src/Characterization/A.cs')).toBe(true);
    expect(custom('src/a.test.ts')).toBe(true);
    expect(isTest('src/Characterization/A.cs')).toBe(false);
  });
});

function method(file: string, name: string, annotations?: readonly SymbolAnnotation[]): SymbolNode {
  return {
    symbolId: `${file}::${name}::method`,
    name,
    kind: 'method',
    startLine: 1,
    endLine: 3,
    ...(annotations ? { annotations } : {}),
  };
}

function indexOf(file: string, symbols: readonly SymbolNode[]): FileIndex {
  return { file, lastModified: 1, symbols: [...symbols], edges: [], intent: [], antiPatterns: [] };
}

describe('TEST_FRAMEWORK_ANNOTATIONS', () => {
  it('lists the 11 test-framework annotation names in order', () => {
    expect(TEST_FRAMEWORK_ANNOTATIONS).toEqual([
      'Fact',
      'Theory',
      'SkippableFact',
      'SkippableTheory',
      'Test',
      'TestCase',
      'TestCaseSource',
      'TestFixture',
      'TestMethod',
      'DataTestMethod',
      'TestClass',
    ]);
  });

  it('lists the two name-only globs, both already part of the default globs', () => {
    expect(NAME_ONLY_TEST_GLOBS).toEqual(['**/*Tests.cs', '**/*Test.cs']);
    for (const glob of NAME_ONLY_TEST_GLOBS) expect(DEFAULT_TEST_GLOBS).toContain(glob);
  });
});

describe('filesWithTestAnnotations', () => {
  it.each([
    'Fact',
    'Theory',
    'SkippableFact',
    'SkippableTheory',
    'Test',
    'TestCase',
    'TestCaseSource',
    'TestFixture',
    'TestMethod',
    'DataTestMethod',
    'TestClass',
  ])('finds files with a test-framework annotation: %s', (name) => {
    const file = 'src/Lending/LoanChecks.cs';
    const found = filesWithTestAnnotations([
      indexOf(file, [method(file, 'RejectsExpiredCard', [{ name }])]),
      indexOf('src/Lending/LoanService.cs', [method('src/Lending/LoanService.cs', 'Lend')]),
    ]);
    expect([...found]).toEqual([file]);
  });

  it.each(['Facts', 'test', 'Trait'])('ignores other annotations and near misses: %s', (name) => {
    const file = 'src/Lending/LoanChecks.cs';
    const found = filesWithTestAnnotations([indexOf(file, [method(file, 'RejectsExpiredCard', [{ name }])])]);
    expect(found.size).toBe(0);
  });

  it('finds a test annotation among several annotations on any symbol of the file', () => {
    const file = 'src/Lending/LoanChecks.cs';
    const found = filesWithTestAnnotations([
      indexOf(file, [
        method(file, 'Setup', [{ name: 'Trait', args: ['"Category"', '"Lending"'] }]),
        method(file, 'ChargesLateFee', [{ name: 'Trait' }, { name: 'Fact', named: { Skip: '"flaky"' } }]),
      ]),
    ]);
    expect(found.has(file)).toBe(true);
  });
});

describe('createTestFileClassifier with annotated files', () => {
  it('the classifier treats an annotated file as a test file whatever its path', () => {
    const annotated = new Set(['src/Lending/LoanChecks.cs']);
    const isTest = createTestFileClassifier([], annotated);
    expect(isTest('src/Lending/LoanChecks.cs')).toBe(true);
    expect(isTest('src/Lending/LoanService.cs')).toBe(false);
    expect(createTestFileClassifier()('src/Lending/LoanChecks.cs')).toBe(false);
  });

  it('backslash paths match the annotated set', () => {
    const isTest = createTestFileClassifier([], new Set(['src/Lending/LoanChecks.cs']));
    expect(isTest('src\\Lending\\LoanChecks.cs')).toBe(true);

    const file = 'src\\Lending\\LoanChecks.cs';
    const found = filesWithTestAnnotations([indexOf(file, [method(file, 'RejectsExpiredCard', [{ name: 'Fact' }])])]);
    expect(createTestFileClassifier([], found)('src/Lending/LoanChecks.cs')).toBe(true);
    expect(createTestFileClassifier([], found)(file)).toBe(true);
  });

  it('a call without the options argument still treats name-only paths as test files', () => {
    const annotated = new Set(['src/Lending/LoanChecks.cs']);
    expect(createTestFileClassifier([], annotated)('src/Lending/LoanServiceTests.cs')).toBe(true);
    expect(createTestFileClassifier([], annotated, {})('src/Lending/LoanServiceTests.cs')).toBe(true);
    expect(createTestFileClassifier([], annotated, { annotationAware: false })('src/Lending/LoanServiceTests.cs')).toBe(true);
  });
});

describe('createTestFileClassifier with annotationAware', () => {
  const annotated = new Set(['src/Lending/MemberRegistryTest.cs']);
  const isTest = createTestFileClassifier(['**/Characterization/**'], annotated, { annotationAware: true });

  it.each(['src/Lending/LoanServiceTests.cs', 'src/Lending/BookCatalogTest.cs', 'LoanServiceTests.cs'])(
    'a name-only path without annotations is no test file: %s',
    (p) => {
      expect(isTest(p)).toBe(false);
    },
  );

  it('a name-only path in the annotated set stays a test file', () => {
    expect(isTest('src/Lending/MemberRegistryTest.cs')).toBe(true);
    expect(isTest('src\\Lending\\MemberRegistryTest.cs')).toBe(true);
  });

  it.each([
    'src/Lending.Tests/LoanFixtures.cs',
    'src/Lending.Test/LoanFixtures.cs',
    'tests/LoanServiceTests.cs',
    'src/__tests__/LoanServiceTest.cs',
    'src/Lending/LoanService.test.cs',
    'src/Characterization/LoanServiceTests.cs',
    'src/Characterization/LoanServiceHelpers.cs',
  ])('a path matched by another glob stays a test file: %s', (p) => {
    expect(isTest(p)).toBe(true);
  });

  it('an index.tests glob that equals a name-only glob keeps its matches', () => {
    const custom = createTestFileClassifier(['**/*Tests.cs'], undefined, { annotationAware: true });
    expect(custom('src/Lending/LoanServiceTests.cs')).toBe(true);
    expect(custom('src/Lending/BookCatalogTest.cs')).toBe(false);
  });

  it('leaves non-.cs name look-alikes and production paths alone', () => {
    expect(isTest('src/Lending/LoanService.cs')).toBe(false);
    expect(isTest('src/latest.ts')).toBe(false);
    expect(isTest('src/a.test.ts')).toBe(true);
  });
});
