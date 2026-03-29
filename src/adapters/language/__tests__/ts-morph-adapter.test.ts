import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TsMorphAdapter } from '../ts-morph-adapter.js';

const FIXTURES_DIR = join(import.meta.dirname, 'fixtures');

function readFixture(name: string): string {
  return readFileSync(join(FIXTURES_DIR, name), 'utf-8');
}

describe('TsMorphAdapter — symbol extraction', () => {
  let adapter: TsMorphAdapter;

  beforeAll(() => {
    adapter = new TsMorphAdapter();
  });

  it('extracts exported function as symbol with correct ID format', () => {
    const source = readFixture('sample-module.ts.fixture');
    const symbols = adapter.extractSymbols('src/payment.ts', source);

    const fn = symbols.find((s) => s.name === 'processPayment');
    expect(fn).toBeDefined();
    expect(fn?.symbolId).toBe('src/payment.ts::processPayment::function');
    expect(fn?.kind).toBe('function');
    expect(fn?.startLine).toBeGreaterThanOrEqual(0);
    expect(fn?.endLine).toBeGreaterThan(fn!.startLine);
  });

  it('extracts class with correct kind "class"', () => {
    const source = readFixture('sample-module.ts.fixture');
    const symbols = adapter.extractSymbols('src/payment.ts', source);

    const cls = symbols.find((s) => s.name === 'PaymentProcessor');
    expect(cls).toBeDefined();
    expect(cls?.kind).toBe('class');
    expect(cls?.symbolId).toBe('src/payment.ts::PaymentProcessor::class');
  });

  it('extracts interface with correct kind "interface"', () => {
    const source = readFixture('sample-module.ts.fixture');
    const symbols = adapter.extractSymbols('src/payment.ts', source);

    const iface = symbols.find((s) => s.name === 'PaymentResult');
    expect(iface).toBeDefined();
    expect(iface?.kind).toBe('interface');
  });

  it('extracts type alias with correct kind "type"', () => {
    const source = readFixture('sample-module.ts.fixture');
    const symbols = adapter.extractSymbols('src/payment.ts', source);

    const typeAlias = symbols.find((s) => s.name === 'Currency');
    expect(typeAlias).toBeDefined();
    expect(typeAlias?.kind).toBe('type');
  });

  it('extracts exported variable with correct kind "variable"', () => {
    const source = readFixture('sample-module.ts.fixture');
    const symbols = adapter.extractSymbols('src/payment.ts', source);

    const variable = symbols.find((s) => s.name === 'MAX_AMOUNT');
    expect(variable).toBeDefined();
    expect(variable?.kind).toBe('variable');
  });

  it('extracts method inside class with correct symbolId', () => {
    const source = readFixture('sample-module.ts.fixture');
    const symbols = adapter.extractSymbols('src/payment.ts', source);

    const method = symbols.find((s) => s.name === 'PaymentProcessor.process');
    expect(method).toBeDefined();
    expect(method?.kind).toBe('method');
    expect(method?.symbolId).toBe('src/payment.ts::PaymentProcessor.process::method');
  });

  it('generates deterministic symbolId across repeated parses', () => {
    const source = readFixture('sample-module.ts.fixture');
    const first = adapter.extractSymbols('src/payment.ts', source);
    const second = adapter.extractSymbols('src/payment.ts', source);

    expect(first.map((s) => s.symbolId)).toEqual(second.map((s) => s.symbolId));
  });

  it('skips non-exported symbols (private functions)', () => {
    const source = readFixture('sample-module.ts.fixture');
    const symbols = adapter.extractSymbols('src/payment.ts', source);

    const internal = symbols.find((s) => s.name === 'internalHelper');
    expect(internal).toBeUndefined();
  });

  it('returns empty array for empty file', () => {
    const symbols = adapter.extractSymbols('src/empty.ts', '');
    expect(symbols).toEqual([]);
  });

  it('returns empty array for file with only comments', () => {
    const source = readFixture('empty-file.ts.fixture');
    const symbols = adapter.extractSymbols('src/empty.ts', source);
    expect(symbols).toEqual([]);
  });

  it('handles TSX file with JSX elements', () => {
    const source = readFixture('tsx-component.tsx.fixture');
    const symbols = adapter.extractSymbols('src/Button.tsx', source);

    const button = symbols.find((s) => s.name === 'Button');
    expect(button).toBeDefined();
    expect(button?.kind).toBe('function');

    const props = symbols.find((s) => s.name === 'ButtonProps');
    expect(props).toBeDefined();
    expect(props?.kind).toBe('interface');

    const label = symbols.find((s) => s.name === 'DEFAULT_LABEL');
    expect(label).toBeDefined();
    expect(label?.kind).toBe('variable');
  });
});

describe('TsMorphAdapter — edge extraction', () => {
  let adapter: TsMorphAdapter;

  beforeAll(() => {
    adapter = new TsMorphAdapter();
  });

  it('detects "extends" edge for class inheritance', () => {
    const source = readFixture('class-with-inheritance.ts.fixture');
    const edges = adapter.extractEdges('src/user-service.ts', source);

    const extendsEdge = edges.find((e) => e.kind === 'extends');
    expect(extendsEdge).toBeDefined();
    expect(extendsEdge?.from).toBe('src/user-service.ts::UserService::class');
    expect(extendsEdge?.to).toContain('BaseService');
  });

  it('detects "implements" edge for interface implementation', () => {
    const source = readFixture('class-with-inheritance.ts.fixture');
    const edges = adapter.extractEdges('src/user-service.ts', source);

    const implEdge = edges.find((e) => e.kind === 'implements');
    expect(implEdge).toBeDefined();
    expect(implEdge?.from).toBe('src/user-service.ts::UserService::class');
    expect(implEdge?.to).toContain('Configurable');
  });

  it('returns empty edges for file with no imports or references', () => {
    const source = 'export function standalone(): void {}';
    const edges = adapter.extractEdges('src/standalone.ts', source);
    expect(edges).toEqual([]);
  });
});

describe('TsMorphAdapter — complexity extraction', () => {
  let adapter: TsMorphAdapter;

  beforeAll(() => {
    adapter = new TsMorphAdapter();
  });

  it('returns complexity 1 for function with no branches', () => {
    const source = 'export function simple(): number { return 42; }';
    const metrics = adapter.extractComplexity('src/simple.ts', source);

    expect(metrics).toHaveLength(1);
    expect(metrics[0]?.cyclomatic).toBe(1);
  });

  it('returns higher complexity for function with if/else/switch', () => {
    const source = readFixture('sample-module.ts.fixture');
    const metrics = adapter.extractComplexity('src/payment.ts', source);

    const processFn = metrics.find((m) => m.symbolId.includes('processPayment'));
    expect(processFn).toBeDefined();
    expect(processFn!.cyclomatic).toBeGreaterThan(1);
  });

  it('counts nested conditionals correctly', () => {
    const source = `export function nested(a: number, b: number): string {
      if (a > 0) {
        if (b > 0) {
          return 'both positive';
        }
        return 'only a positive';
      }
      return 'neither';
    }`;
    const metrics = adapter.extractComplexity('src/nested.ts', source);
    expect(metrics[0]?.cyclomatic).toBe(3); // 1 base + 2 if statements
  });
});

describe('TsMorphAdapter — edge cases', () => {
  let adapter: TsMorphAdapter;

  beforeAll(() => {
    adapter = new TsMorphAdapter();
  });

  it('handles file with duplicate function names in different scopes', () => {
    const source = `
      export function process(): void {}
      export class Processor {
        process(): void {}
      }
    `;
    const symbols = adapter.extractSymbols('src/dup.ts', source);

    const fnProcess = symbols.find(
      (s) => s.name === 'process' && s.kind === 'function',
    );
    const methodProcess = symbols.find(
      (s) => s.name === 'Processor.process' && s.kind === 'method',
    );

    expect(fnProcess).toBeDefined();
    expect(methodProcess).toBeDefined();
    expect(fnProcess?.symbolId).not.toBe(methodProcess?.symbolId);
  });

  it('handles very large source without crashing', () => {
    const lines = Array.from(
      { length: 1000 },
      (_, i) => `export function fn${i}(): void {}`,
    );
    const source = lines.join('\n');
    const symbols = adapter.extractSymbols('src/large.ts', source);
    expect(symbols).toHaveLength(1000);
  });
});

describe('TsMorphAdapter — isSupported', () => {
  let adapter: TsMorphAdapter;

  beforeAll(() => {
    adapter = new TsMorphAdapter();
  });

  it('returns true for .ts files', () => {
    expect(adapter.isSupported('src/foo.ts')).toBe(true);
  });

  it('returns true for .tsx files', () => {
    expect(adapter.isSupported('src/App.tsx')).toBe(true);
  });

  it('returns true for .js files', () => {
    expect(adapter.isSupported('src/utils.js')).toBe(true);
  });

  it('returns true for .jsx files', () => {
    expect(adapter.isSupported('src/Component.jsx')).toBe(true);
  });

  it('returns false for .py files', () => {
    expect(adapter.isSupported('src/main.py')).toBe(false);
  });

  it('returns false for .go files', () => {
    expect(adapter.isSupported('src/main.go')).toBe(false);
  });
});
