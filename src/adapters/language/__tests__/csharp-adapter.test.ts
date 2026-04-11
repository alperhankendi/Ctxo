import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CSharpAdapter } from '../csharp-adapter.js';

const FIXTURES_DIR = join(import.meta.dirname, 'fixtures');

function readFixture(name: string): string {
  return readFileSync(join(FIXTURES_DIR, name), 'utf-8');
}

describe('CSharpAdapter — symbol extraction', () => {
  const adapter = new CSharpAdapter();

  it('extracts public class with namespace qualification', async () => {
    const source = readFixture('csharp-sample.cs.fixture');
    const symbols = await adapter.extractSymbols('Services/Payment.cs', source);

    const cls = symbols.find(s => s.name === 'Payment.PaymentResult');
    expect(cls).toBeDefined();
    expect(cls!.kind).toBe('class');
    expect(cls!.symbolId).toBe('Services/Payment.cs::Payment.PaymentResult::class');
  });

  it('extracts public interface with namespace', async () => {
    const source = readFixture('csharp-sample.cs.fixture');
    const symbols = await adapter.extractSymbols('Services/Payment.cs', source);

    const iface = symbols.find(s => s.name === 'Payment.IPaymentProcessor');
    expect(iface).toBeDefined();
    expect(iface!.kind).toBe('interface');
  });

  it('extracts public methods inside classes', async () => {
    const source = readFixture('csharp-sample.cs.fixture');
    const symbols = await adapter.extractSymbols('Services/Payment.cs', source);

    const method = symbols.find(s => s.name === 'Payment.CardProcessor.Process(1)');
    expect(method).toBeDefined();
    expect(method!.kind).toBe('method');
  });

  it('extracts constructor as method', async () => {
    const source = readFixture('csharp-sample.cs.fixture');
    const symbols = await adapter.extractSymbols('Services/Payment.cs', source);

    const ctor = symbols.find(s => s.name === 'Payment.CardProcessor.CardProcessor(1)');
    expect(ctor).toBeDefined();
    expect(ctor!.kind).toBe('method');
  });

  it('skips private methods', async () => {
    const source = readFixture('csharp-sample.cs.fixture');
    const symbols = await adapter.extractSymbols('Services/Payment.cs', source);

    const priv = symbols.find(s => s.name.includes('Log'));
    expect(priv).toBeUndefined();
  });

  it('extracts all expected symbols', async () => {
    const source = readFixture('csharp-sample.cs.fixture');
    const symbols = await adapter.extractSymbols('Services/Payment.cs', source);

    const names = symbols.map(s => s.name);
    expect(names).toContain('Payment.IPaymentProcessor');
    expect(names).toContain('Payment.PaymentResult');
    expect(names).toContain('Payment.CardProcessor');
    expect(names).toContain('Payment.CardProcessor.Process(1)');
    expect(names).toContain('Payment.CardProcessor.CardProcessor(1)');
  });

  it('includes byte offsets on all symbols', async () => {
    const source = readFixture('csharp-sample.cs.fixture');
    const symbols = await adapter.extractSymbols('Services/Payment.cs', source);

    for (const sym of symbols) {
      expect(sym.startOffset).toBeDefined();
      expect(sym.endOffset).toBeDefined();
      expect(sym.startOffset).toBeLessThan(sym.endOffset!);
    }
  });

  it('extracts enum as type kind', async () => {
    const source = `
namespace App {
    public enum Status { Active, Inactive }
}
`;
    const symbols = await adapter.extractSymbols('src/Status.cs', source);
    const en = symbols.find(s => s.name === 'App.Status');
    expect(en).toBeDefined();
    expect(en!.kind).toBe('type');
  });

  it('extracts struct as class kind', async () => {
    const source = `
namespace App {
    public struct Point {
        public int X;
        public int Y;
    }
}
`;
    const symbols = await adapter.extractSymbols('src/Point.cs', source);
    const st = symbols.find(s => s.name === 'App.Point');
    expect(st).toBeDefined();
    expect(st!.kind).toBe('class');
  });
});

describe('CSharpAdapter — edge extraction', () => {
  const adapter = new CSharpAdapter();

  it('extracts using directives as import edges', async () => {
    const source = readFixture('csharp-sample.cs.fixture');
    const edges = await adapter.extractEdges('Services/Payment.cs', source);

    const importEdges = edges.filter(e => e.kind === 'imports');
    expect(importEdges.some(e => e.to.includes('System'))).toBe(true);
  });

  it('extracts implements edge for class implementing interface', async () => {
    const source = readFixture('csharp-sample.cs.fixture');
    const edges = await adapter.extractEdges('Services/Payment.cs', source);

    const implEdge = edges.find(e => e.kind === 'implements');
    expect(implEdge).toBeDefined();
    expect(implEdge!.from).toContain('CardProcessor');
    expect(implEdge!.to).toContain('IPaymentProcessor');
  });

  it('extracts extends edge for class inheritance', async () => {
    const source = `
namespace App {
    public class Base { }
    public class Child : Base { }
}
`;
    const edges = await adapter.extractEdges('src/Child.cs', source);
    const extendsEdge = edges.find(e => e.kind === 'extends');
    expect(extendsEdge).toBeDefined();
    expect(extendsEdge!.to).toContain('Base');
  });

  it('returns empty edges for file with no public symbols', async () => {
    const source = `
namespace App {
    internal class Secret { }
}
`;
    const edges = await adapter.extractEdges('src/Secret.cs', source);
    expect(edges).toEqual([]);
  });
});

describe('CSharpAdapter — complexity extraction', () => {
  const adapter = new CSharpAdapter();

  it('counts if statement as branch', async () => {
    const source = readFixture('csharp-sample.cs.fixture');
    const metrics = await adapter.extractComplexity('Services/Payment.cs', source);

    const processMetric = metrics.find(m => m.symbolId.includes('CardProcessor.Process'));
    expect(processMetric).toBeDefined();
    expect(processMetric!.cyclomatic).toBeGreaterThan(1);
  });

  it('returns complexity 1 for simple method', async () => {
    const source = `
namespace App {
    public class Svc {
        public int Get() { return 42; }
    }
}
`;
    const metrics = await adapter.extractComplexity('src/Svc.cs', source);
    expect(metrics).toHaveLength(1);
    expect(metrics[0]!.cyclomatic).toBe(1);
  });

  it('skips private methods', async () => {
    const source = readFixture('csharp-sample.cs.fixture');
    const metrics = await adapter.extractComplexity('Services/Payment.cs', source);

    const priv = metrics.find(m => m.symbolId.includes('Log'));
    expect(priv).toBeUndefined();
  });
});

describe('CSharpAdapter — edge cases', () => {
  it('resolves base type via symbol registry', async () => {
    const adapter = new CSharpAdapter();
    const registry = new Map<string, import('../../../core/types.js').SymbolKind>();
    registry.set('Services/IHandler.cs::Services.IHandler::interface', 'interface');
    adapter.setSymbolRegistry(registry);

    const source = `
namespace Services {
    public class Worker : IHandler {
        public void Handle() {}
    }
}
`;
    const edges = await adapter.extractEdges('Services/Worker.cs', source);
    const implEdge = edges.find(e => e.kind === 'implements');
    expect(implEdge).toBeDefined();
    // Should resolve via registry to full symbolId
    expect(implEdge!.to).toBe('Services/IHandler.cs::Services.IHandler::interface');

    adapter.setSymbolRegistry(new Map());
  });

  it('resolves base type via registry with unqualified name match', async () => {
    const adapter = new CSharpAdapter();
    const registry = new Map<string, import('../../../core/types.js').SymbolKind>();
    // Registry has BaseService (unqualified) — matches includes check
    registry.set('Core/Base.cs::BaseService::class', 'class');
    adapter.setSymbolRegistry(registry);

    const source = `
namespace App {
    public class MyService : BaseService {
        public void Run() {}
    }
}
`;
    const edges = await adapter.extractEdges('App/MyService.cs', source);
    const extendsEdge = edges.find(e => e.kind === 'extends');
    expect(extendsEdge).toBeDefined();
    expect(extendsEdge!.to).toBe('Core/Base.cs::BaseService::class');

    adapter.setSymbolRegistry(new Map());
  });

  it('extracts record as class kind', async () => {
    const adapter = new CSharpAdapter();
    const source = `
namespace App {
    public record UserDto(string Name, int Age);
}
`;
    const symbols = await adapter.extractSymbols('src/UserDto.cs', source);
    const rec = symbols.find(s => s.name === 'App.UserDto');
    expect(rec).toBeDefined();
    expect(rec!.kind).toBe('class');
  });

  it('extracts symbols without namespace', async () => {
    const adapter = new CSharpAdapter();
    const source = `
public class GlobalHelper {
    public void Help() {}
}
`;
    const symbols = await adapter.extractSymbols('src/Global.cs', source);
    const cls = symbols.find(s => s.name === 'GlobalHelper');
    expect(cls).toBeDefined();
    expect(cls!.kind).toBe('class');
    const method = symbols.find(s => s.name === 'GlobalHelper.Help(0)');
    expect(method).toBeDefined();
  });

  it('handles multiple using directives', async () => {
    const adapter = new CSharpAdapter();
    const source = `
using System;
using System.Linq;
using System.Collections.Generic;

namespace App {
    public class Svc {
        public void Run() {}
    }
}
`;
    const edges = await adapter.extractEdges('src/Svc.cs', source);
    const imports = edges.filter(e => e.kind === 'imports');
    expect(imports).toHaveLength(3);
  });

  it('complexity counts foreach and while loops', async () => {
    const adapter = new CSharpAdapter();
    const source = `
namespace App {
    public class Processor {
        public void Process() {
            foreach (var item in new int[]{}) { }
            while (true) { break; }
        }
    }
}
`;
    const metrics = await adapter.extractComplexity('src/Processor.cs', source);
    expect(metrics).toHaveLength(1);
    // 1 base + 1 foreach + 1 while = 3
    expect(metrics[0]!.cyclomatic).toBeGreaterThanOrEqual(3);
  });
});

describe('CSharpAdapter — isSupported', () => {
  const adapter = new CSharpAdapter();

  it('returns true for .cs files', async () => {
    expect(adapter.isSupported('Services/App.cs')).toBe(true);
  });

  it('returns false for .ts files', async () => {
    expect(adapter.isSupported('src/main.ts')).toBe(false);
  });

  it('returns false for .go files', async () => {
    expect(adapter.isSupported('cmd/main.go')).toBe(false);
  });

  it('has syntax tier', async () => {
    expect(adapter.tier).toBe('syntax');
  });
});
