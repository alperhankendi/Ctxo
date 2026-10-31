import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { SymbolNode } from '@ctxo/cli/internal';
import type { FactEvidence, FactOptions, StringLiteralDecoder } from '../fact-types.js';
import { finishFacts, moduleSymbolId } from '../finish-facts.js';
import { DEFAULT_DOMAIN_CONFIG } from '../../domain-config.js';

// The domain copy of the lang-csharp finisher tests; the C# decoder is replaced by a stand-in decoder.
const DEFAULT_FACT_OPTIONS: FactOptions = {
  trivialLiterals: DEFAULT_DOMAIN_CONFIG.facts.trivialLiterals,
  normalizationMethods: DEFAULT_DOMAIN_CONFIG.facts.normalizationMethods,
};

/** Decodes `@"..."` and `"""\n...\n"""` as C# does for the two literals these tests use. */
const decodeCsharpStringLiteral: StringLiteralDecoder = (literal) => {
  if (literal === '@""') return '';
  if (literal === '"""\n\n"""') return '';
  return undefined;
};

const FILE = 'src/Loans/LoanPolicy.cs';
const M = `${FILE}::Lending.LoanPolicy.CanBorrow::method`;

// The shared conformance vectors; detailLiteral pins the finisher's detail.literal.
const VECTORS_PATH = join(dirname(fileURLToPath(import.meta.url)), '../../../../../plugin-api/conformance/fact-vectors.json');
type Segments = readonly (string | { readonly repeat: string; readonly count: number })[];
const detailLiteralVectors = (JSON.parse(readFileSync(VECTORS_PATH, 'utf8')) as { detailLiteral: { input: Segments; expected: Segments }[] }).detailLiteral;
function expand(segments: Segments): string {
  return segments.map(segment => (typeof segment === 'string' ? segment : segment.repeat.repeat(segment.count))).join('');
}

function finish(evidence: readonly FactEvidence[], symbols: readonly SymbolNode[] = []) {
  return finishFacts(FILE, evidence, symbols, DEFAULT_FACT_OPTIONS);
}

describe('finishFacts', () => {
  it('a trivial comparison is dropped and the string "0" is kept', () => {
    const facts = finish([
      { kind: 'comparison', symbolId: M, line: 3, text: 'count == 0', operator: '==', literal: '0', literalKind: 'number' },
      { kind: 'comparison', symbolId: M, line: 4, text: 'code  ==\n "0"', operator: '==', literal: '"0"', literalKind: 'string' },
      { kind: 'comparison', symbolId: M, line: 5, text: 'tier == "gold"', operator: '==', literal: '"gold"', literalKind: 'string' },
    ]);
    expect(facts).toEqual([
      { kind: 'literal-comparison', symbolId: M, line: 4, text: 'code == "0"', detail: { operator: '==', literal: '"0"' } },
      { kind: 'literal-comparison', symbolId: M, line: 5, text: 'tier == "gold"', detail: { operator: '==', literal: '"gold"' } },
    ]);
  });

  it('detail.literal is capped at 200 code points like text', () => {
    const literal = `"${'x'.repeat(4096)}"`;
    const [fact] = finish([{ kind: 'comparison', symbolId: M, line: 1, text: `code == ${literal}`, operator: '==', literal, literalKind: 'string' }]);
    expect(Array.from(fact!.detail!['literal']!)).toHaveLength(200);
    expect(fact!.detail!['literal']).toBe(`"${'x'.repeat(199)}`);
    expect(Array.from(fact!.text)).toHaveLength(200);

    const pairAtCut = `"${'y'.repeat(198)}😀😀 tail"`;
    const [paired] = finish([{ kind: 'comparison', symbolId: M, line: 2, text: 'x == y', operator: '==', literal: pairAtCut, literalKind: 'string' }]);
    expect(paired!.detail!['literal']).toBe(`"${'y'.repeat(198)}😀`);
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(paired!.detail!['literal']!)).toBe(false);

    const spaceAtCut = `"${'z'.repeat(198)}  more"`;
    const [trimmed] = finish([{ kind: 'comparison', symbolId: M, line: 3, text: 'x == z', operator: '==', literal: spaceAtCut, literalKind: 'string' }]);
    expect(trimmed!.detail!['literal']).toBe(`"${'z'.repeat(198)}`);

    const short = '"a  b"';
    const [kept] = finish([{ kind: 'comparison', symbolId: M, line: 4, text: 'x == "a  b"', operator: '==', literal: short, literalKind: 'string' }]);
    expect(kept!.detail!['literal']).toBe(short);
  });

  it('detail.literal turns CRLF and CR into LF before the cap (detailLiteral vectors)', () => {
    expect(detailLiteralVectors.length).toBeGreaterThan(0);
    for (const { input, expected } of detailLiteralVectors) {
      const literal = expand(input);
      const [fact] = finish([{ kind: 'comparison', symbolId: M, line: 1, text: 'x == y', operator: '==', literal, literalKind: 'string' }]);
      expect(fact!.detail!['literal'], JSON.stringify(input)).toBe(expand(expected));
    }
  });

  it('the string literal decoder hook reaches the trivial-literal check', () => {
    const evidence: FactEvidence[] = [
      { kind: 'comparison', symbolId: M, line: 1, text: 'note == """\n\n"""', operator: '==', literal: '"""\n\n"""', literalKind: 'string' },
      { kind: 'comparison', symbolId: M, line: 2, text: 'note == @""', operator: '==', literal: '@""', literalKind: 'string' },
    ];
    expect(finishFacts(FILE, evidence, [], DEFAULT_FACT_OPTIONS)).toHaveLength(2);
    expect(finishFacts(FILE, evidence, [], DEFAULT_FACT_OPTIONS, decodeCsharpStringLiteral)).toEqual([]);
  });

  it('a raw string that does not compile is not trivial, so its comparison is kept', () => {
    const evidence: FactEvidence[] = [
      { kind: 'comparison', symbolId: M, line: 1, text: 'note == """\n"""', operator: '==', literal: '"""\n"""', literalKind: 'string' },
      { kind: 'comparison', symbolId: M, line: 2, text: 'note == $"{x}"', operator: '==', literal: '$"{x}"', literalKind: 'string' },
    ];
    expect(finishFacts(FILE, evidence, [], DEFAULT_FACT_OPTIONS, decodeCsharpStringLiteral).map(f => f.line)).toEqual([1, 2]);
  });

  it('a call is kept only when a normalization pattern matches', () => {
    const facts = finish([
      { kind: 'call', symbolId: M, line: 2, text: 'email.Trim().ToLowerInvariant()', method: 'ToLowerInvariant' },
      { kind: 'call', symbolId: M, line: 2, text: 'email.ToString()', method: 'ToString' },
    ]);
    expect(facts).toEqual([
      { kind: 'normalization', symbolId: M, line: 2, text: 'email.Trim().ToLowerInvariant()', detail: { method: 'ToLowerInvariant' } },
    ]);
  });

  it('a binding needs a fragment name and a numeric constant', () => {
    expect(finish([{ kind: 'binding', symbolId: M, line: 1, name: 'REQUEST_TIMEOUT', value: '30 * 1000' }])).toEqual([
      { kind: 'retry-timeout', symbolId: M, line: 1, text: 'REQUEST_TIMEOUT = 30000', detail: { name: 'REQUEST_TIMEOUT', value: '30000' } },
    ]);
    expect(finish([
      { kind: 'binding', symbolId: M, line: 1, name: 'settlementDays', value: '3' },
      { kind: 'binding', symbolId: M, line: 2, name: 'timeout', value: 'x * 2' },
    ])).toEqual([]);
  });

  it('durations carry their unit and their binding name', () => {
    expect(finish([{ kind: 'duration', symbolId: M, line: 7, name: 'Timeout', constructor: 'System.TimeSpan.FromSeconds', unit: 's', amount: '30' }])).toEqual([
      { kind: 'retry-timeout', symbolId: M, line: 7, text: 'Timeout = 30s', detail: { name: 'Timeout', value: '30s' } },
    ]);
    expect(finish([{ kind: 'duration', symbolId: M, line: 7, constructor: 'System.TimeSpan.FromSeconds', unit: 's', amount: '30' }])).toEqual([
      { kind: 'retry-timeout', symbolId: M, line: 7, text: 'TimeSpan.FromSeconds = 30s', detail: { name: 'TimeSpan.FromSeconds', value: '30s' } },
    ]);
    expect(finish([{ kind: 'duration', symbolId: M, line: 8, name: 'poll', constructor: 'setTimeout', unit: 'ms', amount: '5_000' }])).toEqual([
      { kind: 'retry-timeout', symbolId: M, line: 8, text: 'setTimeout = 5000ms', detail: { name: 'setTimeout', value: '5000ms' } },
    ]);
    expect(finish([{ kind: 'duration', symbolId: M, line: 9, name: 'Wait', constructor: 'TimeSpan.FromSeconds', unit: 's', amount: 'seconds' }])).toEqual([]);
  });

  it('routes are upper-cased and joined', () => {
    expect(finish([{ kind: 'route', symbolId: M, line: 0, verb: 'get', route: 'loans/' }])).toEqual([
      { kind: 'endpoint', symbolId: M, line: 0, text: 'GET /loans', detail: { verb: 'GET', route: '/loans' } },
    ]);
  });

  it('evidence without a symbolId goes to the innermost symbol or the module symbol', () => {
    expect(moduleSymbolId('src/Program.cs')).toBe('src/Program.cs::Program::variable');
    expect(moduleSymbolId('Program.cs')).toBe('Program.cs::Program::variable');
    expect(moduleSymbolId('src/app.config.ts')).toBe('src/app.config.ts::app.config::variable');

    const cls: SymbolNode = { symbolId: `${FILE}::Lending.LoanPolicy::class`, name: 'Lending.LoanPolicy', kind: 'class', startLine: 2, endLine: 40 };
    const method: SymbolNode = { symbolId: M, name: 'Lending.LoanPolicy.CanBorrow', kind: 'method', startLine: 10, endLine: 20 };
    const sameStartWide: SymbolNode = { symbolId: `${FILE}::Lending.LoanPolicy.Wide::method`, name: 'Wide', kind: 'method', startLine: 10, endLine: 30 };
    const twin: SymbolNode = { symbolId: `${FILE}::Lending.LoanPolicy.Twin::method`, name: 'Twin', kind: 'method', startLine: 10, endLine: 20 };
    const symbols = [cls, sameStartWide, method, twin];
    const at = (line: number): FactEvidence => ({ kind: 'route', line, verb: 'GET', route: `r${line}` });

    const facts = finish([at(0), at(5), at(15), at(25), at(50)], symbols);
    expect(facts.map(f => [f.line, f.symbolId])).toEqual([
      [0, moduleSymbolId(FILE)],
      [5, cls.symbolId],
      [15, M],
      [25, sameStartWide.symbolId],
      [50, moduleSymbolId(FILE)],
    ]);
  });

  it('facts are sorted, de-duplicated and capped at 500', () => {
    const evidence: FactEvidence[] = [];
    for (let line = 599; line >= 0; line--) {
      evidence.push({ kind: 'comparison', symbolId: M, line, text: `tier == "gold${line}"`, operator: '==', literal: `"gold${line}"`, literalKind: 'string' });
    }
    evidence.push({ ...evidence[0]! });
    const facts = finish(evidence);
    expect(facts).toHaveLength(500);
    expect(facts.map(f => f.line)).toEqual(Array.from({ length: 500 }, (_, i) => i));

    const sameLine = finish([
      { kind: 'route', symbolId: M, line: 1, verb: 'GET', route: 'b' },
      { kind: 'comparison', symbolId: M, line: 1, text: 'x == 2', operator: '==', literal: '2', literalKind: 'number' },
      { kind: 'route', symbolId: M, line: 1, verb: 'GET', route: 'a' },
      { kind: 'binding', symbolId: M, line: 1, name: 'MaxRetries', value: '3' },
      { kind: 'route', symbolId: M, line: 1, verb: 'GET', route: 'a' },
    ]);
    expect(sameLine.map(f => `${f.kind}|${f.text}`)).toEqual([
      'literal-comparison|x == 2',
      'retry-timeout|MaxRetries = 3',
      'endpoint|GET /a',
      'endpoint|GET /b',
    ]);
  });

  it('shuffled evidence gives deep-equal facts', () => {
    const symbols: SymbolNode[] = [
      { symbolId: `${FILE}::Lending.LoanPolicy::class`, name: 'Lending.LoanPolicy', kind: 'class', startLine: 0, endLine: 30 },
      { symbolId: M, name: 'Lending.LoanPolicy.CanBorrow', kind: 'method', startLine: 5, endLine: 15 },
    ];
    const evidence: FactEvidence[] = [
      { kind: 'comparison', line: 6, text: 'tier == "gold"', operator: '==', literal: '"gold"', literalKind: 'string' },
      { kind: 'comparison', symbolId: 'other', line: 6, text: 'tier == "gold"', operator: '==', literal: '"gold"', literalKind: 'string' },
      { kind: 'call', line: 7, text: 'name.Trim()', method: 'Trim' },
      { kind: 'binding', line: 2, name: 'MaxRetries', value: '3' },
      { kind: 'duration', line: 20, name: 'HoldTtl', constructor: 'TimeSpan.FromDays', unit: 'd', amount: '7' },
      { kind: 'route', line: 6, verb: 'post', route: 'loans' },
      { kind: 'route', line: 6, verb: 'get', route: 'loans' },
      { kind: 'comparison', line: 40, text: 'x > 10', operator: '>', literal: '10', literalKind: 'number' },
    ];
    const expected = finish(evidence, symbols);
    expect(expected).toHaveLength(8);
    let seed = 7;
    for (let round = 0; round < 20; round++) {
      const shuffled = [...evidence];
      for (let i = shuffled.length - 1; i > 0; i--) {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        const j = seed % (i + 1);
        [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
      }
      expect(finish(shuffled, [...symbols].reverse())).toEqual(expected);
    }
  });
});

describe('finishFacts attribution at scale', () => {
  /** A deterministic set of overlapping symbols: nested, sibling, equal-start and equal-span ones. */
  function symbolsFor(count: number, lines: number): SymbolNode[] {
    let seed = 99;
    const next = (n: number): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    return Array.from({ length: count }, (_, i) => {
      const startLine = next(lines);
      const endLine = startLine + next(i % 3 === 0 ? 2000 : 40);
      return { symbolId: `${FILE}::S${i}::method`, name: `S${i}`, kind: 'method' as const, startLine, endLine };
    });
  }

  /** The innermost-symbol rule, written out: the later start, then the smaller span, then index order. */
  function reference(line: number, symbols: readonly SymbolNode[]): string {
    let best: SymbolNode | undefined;
    for (const s of symbols) {
      if (line < s.startLine || line > s.endLine) continue;
      if (!best || s.startLine > best.startLine || (s.startLine === best.startLine && s.endLine - s.startLine < best.endLine - best.startLine)) best = s;
    }
    return best ? best.symbolId : moduleSymbolId(FILE);
  }

  const routes = (count: number, lines: number): FactEvidence[] =>
    Array.from({ length: count }, (_, i) => ({ kind: 'route', line: (i * 7919) % lines, verb: 'GET', route: `r${i}` }));

  it('every fact goes to the symbol the innermost rule picks', () => {
    const symbols = symbolsFor(500, 3000);
    // Duplicate symbols (same start and span) keep the first in index order.
    const withTwins = [...symbols, ...symbols.slice(0, 50).map((s) => ({ ...s, symbolId: `${s.symbolId}2` }))];
    const facts = finishFacts(FILE, routes(450, 3000), withTwins, DEFAULT_FACT_OPTIONS);
    expect(facts).toHaveLength(450);
    for (const fact of facts) expect(fact.symbolId, `line ${fact.line}`).toBe(reference(fact.line, withTwins));
  });

  it('5000 symbols and 50 000 evidence records finish well under a second', () => {
    const symbols = symbolsFor(5000, 60_000);
    const evidence = routes(50_000, 60_000);
    const started = performance.now();
    const facts = finishFacts(FILE, evidence, symbols, DEFAULT_FACT_OPTIONS);
    const ms = performance.now() - started;
    expect(facts).toHaveLength(500);
    for (const fact of facts.slice(0, 50)) expect(fact.symbolId).toBe(reference(fact.line, symbols));
    // About 150 ms locally; the bound leaves room for a slow CI runner (521 ms seen on ubuntu-latest). The old
    // per-record scan of every symbol took several seconds there.
    expect(ms).toBeLessThan(2_000);
  });
});

describe('finishFacts FC-4b', () => {
  const FC4B_FILE = 'src/members.x';
  const OWNER = `${FC4B_FILE}::save::function`;
  const OPTIONS = { trivialLiterals: [0, 1, -1, null, true, false, ''], normalizationMethods: ['ToLower*', 'Trim*', 'strings.ToLower', 'strings.TrimSpace'] };
  const call = (line: number, text: string, method: string, extra: Record<string, unknown> = {}): FactEvidence =>
    ({ kind: 'call', symbolId: OWNER, line, text, method, ...extra }) as FactEvidence;
  const texts = (evidence: readonly FactEvidence[]) => finishFacts(FC4B_FILE, evidence, [], OPTIONS).map(f => `${f.line} ${f.text}`);

  it('the nearest consumer decides: a sink drops the fact, a business call around a sink keeps it', () => {
    expect(texts([
      call(1, 'email.Trim()', 'Trim', { consumer: '_logger.LogWarning', consumerTypes: ['Microsoft.Extensions.Logging.ILogger'] }),
      call(2, 'email.Trim()', 'Trim', { consumer: 'repo.Upsert' }),
      call(3, 'email.Trim()', 'Trim', { consumer: 'telemetry.Info', consumerTypes: ['MyApp.Telemetry'] }),
      call(4, 'email.Trim()', 'Trim', { consumer: 'auth.LogIn' }),
      call(5, 'email.Trim()', 'Trim', { consumer: 'new ArgumentException' }),
      // A type that resolves but is no known logger still counts by the receiver's name, as in the syntax tiers.
      call(6, 'email.Trim()', 'Trim', { consumer: 'this.logger.Info', consumerTypes: ['MyApp.Telemetry'] }),
    ])).toEqual(['2 email.Trim()', '3 email.Trim()', '4 email.Trim()']);
  });

  it('prose drops a fact only when it goes to a sink or a display API', () => {
    expect(texts([
      call(1, 'name.Trim()', 'Trim', { inProse: true }),
      call(2, 'name.Trim()', 'Trim', { inProse: true, consumer: 'sb.AppendLine' }),
      call(3, 'name.Trim()', 'Trim', { inProse: true, consumer: 'db.Query' }),
      call(4, 'name.Trim()', 'Trim', { inProse: true, consumer: 'console.log', consumerTypes: ['Console'] }),
      call(5, 'name.Trim()', 'Trim', { consumer: 'sb.AppendLine' }),
    ])).toEqual(['1 name.Trim()', '3 name.Trim()', '5 name.Trim()']);
  });

  it('a normalization inside a dropped message folds its inner calls too', () => {
    expect(texts([
      call(1, 'strings.ToLower(strings.TrimSpace(s))', 'ToLower', { consumer: 'fmt.Errorf' }),
      call(1, 'strings.TrimSpace(s)', 'TrimSpace', { consumer: 'strings.ToLower' }),
    ])).toEqual([]);
  });

  it('a function-form chain split over lines is one fact; the same call elsewhere stays', () => {
    expect(texts([
      call(1, 'strings.ToLower(\n  strings.TrimSpace(s))', 'ToLower'),
      call(2, 'strings.TrimSpace(s)', 'TrimSpace', { consumer: 'strings.ToLower' }),
      call(4, 'strings.TrimSpace(s)', 'TrimSpace'),
    ])).toEqual(['1 strings.ToLower( strings.TrimSpace(s))', '4 strings.TrimSpace(s)']);
  });

  it('malformed consumer fields count as absent', () => {
    expect(texts([
      call(1, 'email.Trim()', 'Trim', { consumer: 42 }),
      call(2, 'email.Trim()', 'Trim', { consumer: 'logger.Info', consumerTypes: [7] }),
    ])).toEqual(['1 email.Trim()']);
  });
});
