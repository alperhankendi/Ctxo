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

  it('resolves cross-file implements edge to normalized path (BUG-19)', () => {
    const source = `
import { IStoragePort } from '../../ports/i-storage-port.js';
export class MyAdapter implements IStoragePort {
  save(): void {}
}
`;
    const edges = adapter.extractEdges('src/adapters/storage/my-adapter.ts', source);
    const implEdge = edges.find((e) => e.kind === 'implements');
    expect(implEdge).toBeDefined();
    expect(implEdge?.to).toBe('src/ports/i-storage-port.ts::IStoragePort::interface');
  });

  it('resolves cross-file implements edge with .jsx → .tsx (BUG-19)', () => {
    const source = `
import { IRenderer } from '../ports/i-renderer.jsx';
export class MyRenderer implements IRenderer {
  render(): void {}
}
`;
    const edges = adapter.extractEdges('src/adapters/my-renderer.ts', source);
    const implEdge = edges.find((e) => e.kind === 'implements');
    expect(implEdge).toBeDefined();
    expect(implEdge?.to).toBe('src/ports/i-renderer.tsx::IRenderer::interface');
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

describe('TsMorphAdapter — byte offset indexing', () => {
  let adapter: TsMorphAdapter;

  beforeAll(() => {
    adapter = new TsMorphAdapter();
  });

  it('extracts startOffset and endOffset for functions', () => {
    const source = 'export function hello(): void {}\n';
    const symbols = adapter.extractSymbols('src/fn.ts', source);
    const fn = symbols.find(s => s.name === 'hello');

    expect(fn).toBeDefined();
    expect(fn!.startOffset).toBeDefined();
    expect(fn!.endOffset).toBeDefined();
    expect(fn!.startOffset).toBe(0);
    expect(fn!.endOffset).toBeGreaterThan(fn!.startOffset!);
    // Verify O(1) substring retrieval
    expect(source.substring(fn!.startOffset!, fn!.endOffset!)).toContain('function hello');
  });

  it('extracts byte offsets for classes and methods', () => {
    const source = `export class MyClass {\n  greet(): void {}\n}\n`;
    const symbols = adapter.extractSymbols('src/cls.ts', source);

    const cls = symbols.find(s => s.kind === 'class');
    expect(cls!.startOffset).toBeDefined();
    expect(cls!.endOffset).toBeDefined();
    expect(source.substring(cls!.startOffset!, cls!.endOffset!)).toContain('class MyClass');

    const method = symbols.find(s => s.kind === 'method');
    expect(method!.startOffset).toBeDefined();
    expect(method!.endOffset).toBeDefined();
    expect(source.substring(method!.startOffset!, method!.endOffset!)).toContain('greet');
  });

  it('extracts byte offsets for interfaces', () => {
    const source = `export interface IFoo {\n  bar(): void;\n}\n`;
    const symbols = adapter.extractSymbols('src/iface.ts', source);
    const iface = symbols.find(s => s.kind === 'interface');

    expect(iface!.startOffset).toBeDefined();
    expect(source.substring(iface!.startOffset!, iface!.endOffset!)).toContain('interface IFoo');
  });

  it('extracts byte offsets for type aliases', () => {
    const source = `export type ID = string;\n`;
    const symbols = adapter.extractSymbols('src/alias.ts', source);
    const t = symbols.find(s => s.kind === 'type');

    expect(t!.startOffset).toBeDefined();
    expect(source.substring(t!.startOffset!, t!.endOffset!)).toContain('type ID');
  });

  it('extracts byte offsets for variables', () => {
    const source = `export const MAX = 100;\n`;
    const symbols = adapter.extractSymbols('src/var.ts', source);
    const v = symbols.find(s => s.kind === 'variable');

    expect(v!.startOffset).toBeDefined();
    expect(source.substring(v!.startOffset!, v!.endOffset!)).toContain('MAX');
  });

  it('byte offsets are precise for multi-symbol files', () => {
    const source = `// comment\nexport function a(): void {}\nexport function b(): void {}\n`;
    const symbols = adapter.extractSymbols('src/multi.ts', source);

    const a = symbols.find(s => s.name === 'a')!;
    const b = symbols.find(s => s.name === 'b')!;

    // a starts before b
    expect(a.startOffset).toBeLessThan(b.startOffset!);
    // Each substring is precisely the symbol source
    expect(source.substring(a.startOffset!, a.endOffset!)).toContain('function a');
    expect(source.substring(b.startOffset!, b.endOffset!)).toContain('function b');
    // No overlap
    expect(a.endOffset).toBeLessThanOrEqual(b.startOffset!);
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

describe('TsMorphAdapter — Faz 1 fixes', () => {
  let adapter: TsMorphAdapter;

  beforeAll(() => {
    adapter = new TsMorphAdapter();
  });

  it('import edges have valid from symbolId (not phantom) when file has exports (BUG-1 fix)', () => {
    const source = `
      export function myFunc(): void {}
      import { Helper } from './helper.js';
    `;
    const symbols = adapter.extractSymbols('src/caller.ts', source);
    const edges = adapter.extractEdges('src/caller.ts', source);

    const importEdge = edges.find(e => e.kind === 'imports');
    expect(importEdge).toBeDefined();
    // from should be the exported function, not a phantom fileSymbolId
    expect(importEdge!.from).toBe('src/caller.ts::myFunc::function');
    // Verify the from actually exists in the symbol list
    expect(symbols.some(s => s.symbolId === importEdge!.from)).toBe(true);
  });

  it('strips generic type arguments from extends (BUG-17 fix)', () => {
    const source = `
      export class Base {}
      export class Child extends Base {}
    `;
    // First index the symbols to build context
    const edges = adapter.extractEdges('src/generic.ts', source);
    const extendsEdge = edges.find(e => e.kind === 'extends');
    expect(extendsEdge).toBeDefined();
    expect(extendsEdge!.to).not.toContain('<');
  });

  it('strips generic type arguments from extends with generics', () => {
    const source = `
      import { Base } from './base.js';
      export class Child extends Base<string> {}
    `;
    const edges = adapter.extractEdges('src/child.ts', source);
    const extendsEdge = edges.find(e => e.kind === 'extends');
    expect(extendsEdge).toBeDefined();
    // Should be Base, not Base<string>
    expect(extendsEdge!.to).toContain('::Base::');
    expect(extendsEdge!.to).not.toContain('<');
    expect(extendsEdge!.to).not.toContain('>');
  });

  it('strips generic type arguments from implements', () => {
    const source = `
      import { IRepo } from './repo.js';
      export class UserRepo implements IRepo<User> {}
    `;
    const edges = adapter.extractEdges('src/user-repo.ts', source);
    const implEdge = edges.find(e => e.kind === 'implements');
    expect(implEdge).toBeDefined();
    expect(implEdge!.to).toContain('::IRepo::');
    expect(implEdge!.to).not.toContain('<');
  });

  it('uses symbolRegistry for correct kind resolution (BUG-8/9 fix)', () => {
    const registry = new Map<string, import('../../../core/types.js').SymbolKind>();
    registry.set('src/types.ts::Handler::type', 'type');

    adapter.setSymbolRegistry(registry);

    const source = `
      import { Handler } from './types.js';
      export function process(h: Handler): void {}
    `;
    const edges = adapter.extractEdges('src/processor.ts', source);
    const importEdge = edges.find(e => e.kind === 'imports' && e.to.includes('Handler'));
    expect(importEdge).toBeDefined();
    // Should resolve to ::type not ::class (heuristic would say class for PascalCase)
    expect(importEdge!.to).toBe('src/types.ts::Handler::type');

    // Clean up registry
    adapter.setSymbolRegistry(new Map());
  });

  it('falls back to heuristic when symbolRegistry has no match', () => {
    adapter.setSymbolRegistry(new Map()); // empty registry

    const source = `
      import { SomeClass } from './mod.js';
      export function use(): void {}
    `;
    const edges = adapter.extractEdges('src/user.ts', source);
    const importEdge = edges.find(e => e.kind === 'imports' && e.to.includes('SomeClass'));
    expect(importEdge).toBeDefined();
    // PascalCase → heuristic says 'class'
    expect(importEdge!.to).toBe('src/mod.ts::SomeClass::class');
  });
});

describe('TsMorphAdapter — uses edge extraction (Faz 3)', () => {
  let adapter: TsMorphAdapter;

  beforeAll(() => {
    adapter = new TsMorphAdapter();
  });

  it('emits uses edge when exported function references an import in its body', () => {
    const source = `
      import { validate } from './validator.js';
      export function process(data: string): boolean {
        return validate(data);
      }
    `;
    const edges = adapter.extractEdges('src/processor.ts', source);
    const usesEdge = edges.find(e => e.kind === 'uses' && e.to.includes('validate'));
    expect(usesEdge).toBeDefined();
    expect(usesEdge!.from).toBe('src/processor.ts::process::function');
    expect(usesEdge!.to).toContain('::validate::');
  });

  it('emits uses edge when exported class references an import', () => {
    const source = `
      import { Logger } from './logger.js';
      export class Service {
        run(): void {
          Logger.info('running');
        }
      }
    `;
    const edges = adapter.extractEdges('src/service.ts', source);
    const usesEdge = edges.find(e => e.kind === 'uses' && e.to.includes('Logger'));
    expect(usesEdge).toBeDefined();
    expect(usesEdge!.from).toBe('src/service.ts::Service::class');
  });

  it('does not emit uses edge for imports not referenced in body', () => {
    const source = `
      import { unusedHelper } from './helper.js';
      export function doWork(): void {
        console.log('hello');
      }
    `;
    const edges = adapter.extractEdges('src/worker.ts', source);
    const usesEdge = edges.find(e => e.kind === 'uses' && e.to.includes('unusedHelper'));
    expect(usesEdge).toBeUndefined();
  });

  it('emits one uses edge per unique import reference (deduplicates)', () => {
    const source = `
      import { helper } from './utils.js';
      export function process(): void {
        helper();
        helper();
        helper();
      }
    `;
    const edges = adapter.extractEdges('src/caller.ts', source);
    const usesEdges = edges.filter(e => e.kind === 'uses' && e.to.includes('helper'));
    expect(usesEdges).toHaveLength(1);
  });

  it('emits uses edges for multiple distinct imports', () => {
    const source = `
      import { foo } from './a.js';
      import { bar } from './b.js';
      export function baz(): void {
        foo();
        bar();
      }
    `;
    const edges = adapter.extractEdges('src/multi.ts', source);
    const usesEdges = edges.filter(e => e.kind === 'uses');
    expect(usesEdges).toHaveLength(2);
    expect(usesEdges.map(e => e.to)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('::foo::'),
        expect.stringContaining('::bar::'),
      ]),
    );
  });

  it('does not emit uses edge for non-exported functions', () => {
    const source = `
      import { helper } from './utils.js';
      function internal(): void {
        helper();
      }
      export function pub(): void {}
    `;
    const edges = adapter.extractEdges('src/internal.ts', source);
    const usesEdges = edges.filter(e => e.kind === 'uses');
    // Only pub is exported, and it doesn't reference helper
    expect(usesEdges).toHaveLength(0);
  });

  it('does not emit uses edge for external (non-relative) imports', () => {
    const source = `
      import { z } from 'zod';
      export function validate(input: unknown): boolean {
        return z.string().safeParse(input).success;
      }
    `;
    const edges = adapter.extractEdges('src/val.ts', source);
    const usesEdges = edges.filter(e => e.kind === 'uses');
    // zod is external, should not produce uses edge
    expect(usesEdges).toHaveLength(0);
  });
});

describe('TsMorphAdapter — uses edge + blast radius integration', () => {
  it('uses edge is classified as confirmed in blast radius', async () => {
    const { SymbolGraph } = await import('../../../core/graph/symbol-graph.js');
    const { BlastRadiusCalculator } = await import('../../../core/blast-radius/blast-radius-calculator.js');

    const graph = new SymbolGraph();
    graph.addNode({ symbolId: 'src/a.ts::A::function', name: 'A', kind: 'function', startLine: 0, endLine: 10 });
    graph.addNode({ symbolId: 'src/b.ts::B::class', name: 'B', kind: 'class', startLine: 0, endLine: 20 });
    graph.addEdge({ from: 'src/a.ts::A::function', to: 'src/b.ts::B::class', kind: 'uses' });

    const calc = new BlastRadiusCalculator();
    const result = calc.calculate(graph, 'src/b.ts::B::class');

    expect(result.confirmedCount).toBe(1);
    expect(result.potentialCount).toBe(0);
    expect(result.impactedSymbols[0]!.confidence).toBe('confirmed');
  });
});

describe('TsMorphAdapter — namespace imports (GAP-3 fix)', () => {
  let adapter: TsMorphAdapter;

  beforeAll(() => {
    adapter = new TsMorphAdapter();
  });

  it('creates import edge for namespace import (import * as X)', () => {
    const source = `
      import * as utils from './utils.js';
      export function run(): void { utils.doStuff(); }
    `;
    const edges = adapter.extractEdges('src/runner.ts', source);
    const nsEdge = edges.find(e => e.kind === 'imports' && e.to.includes('utils'));
    expect(nsEdge).toBeDefined();
    expect(nsEdge!.to).toBe('src/utils.ts::utils::variable');
  });

  it('does not create namespace edge for external modules', () => {
    const source = `
      import * as path from 'node:path';
      export function resolve(): string { return path.join('.'); }
    `;
    const edges = adapter.extractEdges('src/paths.ts', source);
    const nsEdge = edges.find(e => e.kind === 'imports' && e.to.includes('path'));
    expect(nsEdge).toBeUndefined();
  });
});

describe('TsMorphAdapter — constructor calls (GAP-11 fix)', () => {
  let adapter: TsMorphAdapter;

  beforeAll(() => {
    adapter = new TsMorphAdapter();
  });

  it('creates calls edge for new Foo() in exported function', () => {
    const source = `
      import { Service } from './service.js';
      export function createService(): Service {
        return new Service();
      }
    `;
    const edges = adapter.extractEdges('src/factory.ts', source);
    const callEdge = edges.find(e => e.kind === 'calls' && e.to.includes('Service'));
    expect(callEdge).toBeDefined();
    expect(callEdge!.from).toBe('src/factory.ts::createService::function');
  });

  it('creates calls edge for new Foo() in class method', () => {
    const source = `
      import { Logger } from './logger.js';
      export class App {
        init(): void {
          const log = new Logger();
        }
      }
    `;
    const edges = adapter.extractEdges('src/app.ts', source);
    const callEdge = edges.find(e => e.kind === 'calls' && e.to.includes('Logger'));
    expect(callEdge).toBeDefined();
    expect(callEdge!.from).toContain('App.init');
  });

  it('does not create constructor edge for non-imported class', () => {
    const source = `
      export function make(): void {
        const x = new Map();
      }
    `;
    const edges = adapter.extractEdges('src/map.ts', source);
    const callEdge = edges.find(e => e.kind === 'calls');
    expect(callEdge).toBeUndefined();
  });
});

describe('TsMorphAdapter — typeOnly flag (SCHEMA-40 fix)', () => {
  let adapter: TsMorphAdapter;

  beforeAll(() => {
    adapter = new TsMorphAdapter();
  });

  it('marks import type edges as typeOnly: true', () => {
    const source = `
      import type { Foo } from './foo.js';
      export function useFoo(f: Foo): void {}
    `;
    const edges = adapter.extractEdges('src/consumer.ts', source);
    const importEdge = edges.find(e => e.kind === 'imports' && e.to.includes('Foo'));
    expect(importEdge).toBeDefined();
    expect(importEdge!.typeOnly).toBe(true);
  });

  it('marks per-specifier type imports as typeOnly', () => {
    const source = `
      import { type Bar, baz } from './mod.js';
      export function use(): void { baz(); }
    `;
    const edges = adapter.extractEdges('src/mixed.ts', source);
    const barEdge = edges.find(e => e.kind === 'imports' && e.to.includes('Bar'));
    const bazEdge = edges.find(e => e.kind === 'imports' && e.to.includes('baz'));
    expect(barEdge).toBeDefined();
    expect(barEdge!.typeOnly).toBe(true);
    expect(bazEdge).toBeDefined();
    expect(bazEdge!.typeOnly).toBeUndefined(); // value import — no typeOnly flag
  });

  it('does not set typeOnly for regular value imports', () => {
    const source = `
      import { helper } from './utils.js';
      export function run(): void { helper(); }
    `;
    const edges = adapter.extractEdges('src/user.ts', source);
    const importEdge = edges.find(e => e.kind === 'imports' && e.to.includes('helper'));
    expect(importEdge).toBeDefined();
    expect(importEdge!.typeOnly).toBeUndefined();
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
