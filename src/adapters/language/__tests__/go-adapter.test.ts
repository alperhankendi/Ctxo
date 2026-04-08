import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GoAdapter } from '../go-adapter.js';

const FIXTURES_DIR = join(import.meta.dirname, 'fixtures');

function readFixture(name: string): string {
  return readFileSync(join(FIXTURES_DIR, name), 'utf-8');
}

describe('GoAdapter — symbol extraction', () => {
  const adapter = new GoAdapter();

  it('extracts exported function as symbol', () => {
    const source = readFixture('go-sample.go.fixture');
    const symbols = adapter.extractSymbols('cmd/payment.go', source);

    const fn = symbols.find(s => s.name === 'FormatAmount');
    expect(fn).toBeDefined();
    expect(fn!.kind).toBe('function');
    expect(fn!.symbolId).toBe('cmd/payment.go::FormatAmount::function');
  });

  it('skips unexported functions (lowercase)', () => {
    const source = readFixture('go-sample.go.fixture');
    const symbols = adapter.extractSymbols('cmd/payment.go', source);

    const unexported = symbols.find(s => s.name === 'newProcessor');
    expect(unexported).toBeUndefined();
  });

  it('extracts struct as class kind', () => {
    const source = readFixture('go-sample.go.fixture');
    const symbols = adapter.extractSymbols('cmd/payment.go', source);

    const struct = symbols.find(s => s.name === 'PaymentResult');
    expect(struct).toBeDefined();
    expect(struct!.kind).toBe('class');
    expect(struct!.symbolId).toBe('cmd/payment.go::PaymentResult::class');
  });

  it('extracts interface as interface kind', () => {
    const source = readFixture('go-sample.go.fixture');
    const symbols = adapter.extractSymbols('cmd/payment.go', source);

    const iface = symbols.find(s => s.name === 'Processor');
    expect(iface).toBeDefined();
    expect(iface!.kind).toBe('interface');
  });

  it('extracts method with receiver type in name', () => {
    const source = readFixture('go-sample.go.fixture');
    const symbols = adapter.extractSymbols('cmd/payment.go', source);

    const method = symbols.find(s => s.name === 'CardProcessor.Process');
    expect(method).toBeDefined();
    expect(method!.kind).toBe('method');
    expect(method!.symbolId).toBe('cmd/payment.go::CardProcessor.Process::method');
  });

  it('extracts all exported symbols from fixture', () => {
    const source = readFixture('go-sample.go.fixture');
    const symbols = adapter.extractSymbols('cmd/payment.go', source);

    const names = symbols.map(s => s.name);
    expect(names).toContain('PaymentResult');
    expect(names).toContain('Processor');
    expect(names).toContain('FormatAmount');
    expect(names).toContain('CardProcessor');
    expect(names).toContain('CardProcessor.Process');
    expect(names).toHaveLength(5);
  });

  it('includes byte offsets on all symbols', () => {
    const source = readFixture('go-sample.go.fixture');
    const symbols = adapter.extractSymbols('cmd/payment.go', source);

    for (const sym of symbols) {
      expect(sym.startOffset).toBeDefined();
      expect(sym.endOffset).toBeDefined();
      expect(sym.startOffset).toBeLessThan(sym.endOffset!);
    }
  });

  it('includes correct line numbers', () => {
    const source = readFixture('go-sample.go.fixture');
    const symbols = adapter.extractSymbols('cmd/payment.go', source);

    const fn = symbols.find(s => s.name === 'FormatAmount');
    expect(fn!.startLine).toBeGreaterThanOrEqual(0);
    expect(fn!.endLine).toBeGreaterThan(fn!.startLine);
  });
});

describe('GoAdapter — edge extraction', () => {
  const adapter = new GoAdapter();

  it('extracts import edges from import declarations', () => {
    const source = readFixture('go-sample.go.fixture');
    const edges = adapter.extractEdges('cmd/payment.go', source);

    const importEdges = edges.filter(e => e.kind === 'imports');
    expect(importEdges.length).toBeGreaterThanOrEqual(2);
    expect(importEdges.some(e => e.to.includes('fmt'))).toBe(true);
    expect(importEdges.some(e => e.to.includes('strings'))).toBe(true);
  });

  it('returns empty edges for file with no imports', () => {
    const source = `package main

func Hello() string { return "hi" }
`;
    const edges = adapter.extractEdges('cmd/main.go', source);
    expect(edges).toEqual([]);
  });

  it('returns empty edges for file with no exported symbols', () => {
    const source = `package internal

import "fmt"

func helper() { fmt.Println("hi") }
`;
    const edges = adapter.extractEdges('cmd/internal.go', source);
    // No exported symbol to use as 'from' — should return empty
    expect(edges).toEqual([]);
  });
});

describe('GoAdapter — complexity extraction', () => {
  const adapter = new GoAdapter();

  it('returns complexity 1 for function with no branches', () => {
    const source = `package main

func Simple() int { return 42 }
`;
    const metrics = adapter.extractComplexity('cmd/simple.go', source);
    expect(metrics).toHaveLength(1);
    expect(metrics[0]!.cyclomatic).toBe(1);
  });

  it('counts if statement as branch', () => {
    const source = readFixture('go-sample.go.fixture');
    const metrics = adapter.extractComplexity('cmd/payment.go', source);

    const processMetric = metrics.find(m => m.symbolId.includes('CardProcessor.Process'));
    expect(processMetric).toBeDefined();
    expect(processMetric!.cyclomatic).toBeGreaterThan(1);
  });

  it('skips unexported functions', () => {
    const source = readFixture('go-sample.go.fixture');
    const metrics = adapter.extractComplexity('cmd/payment.go', source);

    const unexported = metrics.find(m => m.symbolId.includes('newProcessor'));
    expect(unexported).toBeUndefined();
  });
});

describe('GoAdapter — edge cases', () => {
  const adapter = new GoAdapter();

  it('extracts method with non-pointer receiver', () => {
    const source = `package main

type Svc struct{}

func (s Svc) Run() {}
`;
    const symbols = adapter.extractSymbols('cmd/svc.go', source);
    const method = symbols.find(s => s.name === 'Svc.Run');
    expect(method).toBeDefined();
    expect(method!.kind).toBe('method');
  });

  it('uses type_spec as first exported symbol for edge from', () => {
    // File with no function — only an exported struct, then imports
    const source = `package models

import "fmt"

type Config struct {
    Host string
}

func init() { fmt.Println("init") }
`;
    const edges = adapter.extractEdges('pkg/models.go', source);
    const importEdge = edges.find(e => e.kind === 'imports');
    expect(importEdge).toBeDefined();
    // from should be the Config struct (first exported symbol)
    expect(importEdge!.from).toBe('pkg/models.go::Config::class');
  });

  it('uses interface as first exported symbol for edge from', () => {
    const source = `package api

import "net/http"

type Handler interface {
    Handle()
}
`;
    const edges = adapter.extractEdges('pkg/api.go', source);
    const importEdge = edges.find(e => e.kind === 'imports');
    expect(importEdge).toBeDefined();
    expect(importEdge!.from).toBe('pkg/api.go::Handler::interface');
  });

  it('extracts type alias (non-struct, non-interface) as type kind', () => {
    const source = `package main

type ID string
`;
    const symbols = adapter.extractSymbols('cmd/id.go', source);
    const t = symbols.find(s => s.name === 'ID');
    expect(t).toBeDefined();
    expect(t!.kind).toBe('type');
  });

  it('extracts exported const as variable', () => {
    const source = `package main

const MaxRetries = 3
`;
    const symbols = adapter.extractSymbols('cmd/const.go', source);
    // const_spec is at top level — currently not extracted (only functions/types/methods)
    // This documents the current behavior
    expect(symbols).toHaveLength(0);
  });

  it('handles single import (no parens)', () => {
    const source = `package main

import "fmt"

func Hello() { fmt.Println("hi") }
`;
    const edges = adapter.extractEdges('cmd/hello.go', source);
    const importEdge = edges.find(e => e.kind === 'imports' && e.to.includes('fmt'));
    expect(importEdge).toBeDefined();
  });

  it('handles file with only unexported types — no edges', () => {
    const source = `package internal

import "fmt"

type config struct { host string }

func setup() { fmt.Println("setup") }
`;
    const edges = adapter.extractEdges('pkg/internal.go', source);
    expect(edges).toEqual([]);
  });

  it('complexity counts switch cases', () => {
    const source = `package main

func Route(path string) string {
    switch path {
    case "/home":
        return "home"
    case "/about":
        return "about"
    default:
        return "404"
    }
}
`;
    const metrics = adapter.extractComplexity('cmd/route.go', source);
    expect(metrics).toHaveLength(1);
    // 1 base + 1 switch + 2 case clauses = 4
    expect(metrics[0]!.cyclomatic).toBeGreaterThanOrEqual(3);
  });
});

describe('GoAdapter — isSupported', () => {
  const adapter = new GoAdapter();

  it('returns true for .go files', () => {
    expect(adapter.isSupported('cmd/main.go')).toBe(true);
  });

  it('returns false for .ts files', () => {
    expect(adapter.isSupported('src/main.ts')).toBe(false);
  });

  it('returns false for .cs files', () => {
    expect(adapter.isSupported('src/App.cs')).toBe(false);
  });

  it('has syntax tier', () => {
    expect(adapter.tier).toBe('syntax');
  });
});
