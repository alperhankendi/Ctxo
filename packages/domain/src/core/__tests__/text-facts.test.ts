import { describe, expect, it } from 'vitest';
import type { CodeFact, SymbolNode } from '@ctxo/cli/internal';
import { MAX_TEXT_SCAN_LINE, scanTextFacts } from '../text-facts.js';
import { DEFAULT_DOMAIN_CONFIG } from '../domain-config.js';
import type { FactOptions } from '../facts/fact-types.js';

const OPTIONS: FactOptions = {
  trivialLiterals: DEFAULT_DOMAIN_CONFIG.facts.trivialLiterals,
  normalizationMethods: DEFAULT_DOMAIN_CONFIG.facts.normalizationMethods,
};

/** `kind|text` of every fact the line gives in the file. */
function scan(file: string, text: string, options: FactOptions = OPTIONS): string[] {
  return scanTextFacts(file, text, [], options).map((f) => `${f.kind}|${f.text}`);
}

const PY = 'src/Billing/fees.py';
const LEND = 'src/Loans/policy.lend';

describe('scanTextFacts', () => {
  it('a Python file gives its facts', () => {
    expect(scan(PY, 'TIMEOUT_SECONDS = 30')).toEqual(['retry-timeout|TIMEOUT_SECONDS = 30']);
    expect(scan(PY, 'if days > 14:\n    pass')).toEqual(['literal-comparison|days > 14']);
    expect(scan(PY, "    return 'late' if days > 14 else 'ok'")).toEqual(['literal-comparison|days > 14']);
    expect(scan(PY, 'x = "if a > 5"')).toEqual([]);
    expect(scan(PY, '@app.route("/fees", methods=["POST"])\ndef fees():')).toEqual(['endpoint|POST /fees']);
    const lower = scanTextFacts(PY, 'key = s.lower()', [], { ...OPTIONS, normalizationMethods: ['lower'] });
    expect(lower).toEqual([
      { kind: 'normalization', symbolId: `${PY}::fees::variable`, line: 0, text: 's.lower()', detail: { method: 'lower' } },
    ]);
    const facts = scanTextFacts(PY, 'if days > 14:', [], OPTIONS);
    expect(facts[0]!.detail).toEqual({ operator: '>', literal: '14' });
  });

  it('a C-style file of an unknown language gives its facts', () => {
    expect(scan(LEND, 'if days > 14 then charge 2.5')).toEqual(['literal-comparison|days > 14']);
    expect(scan(LEND, 'retries = 3')).toEqual(['retry-timeout|retries = 3']);
    expect(scan(LEND, '// retries = 3\n/* if days > 14 */')).toEqual([]);
  });

  it('generics are not comparisons', () => {
    expect(scan('src/A.kt', 'List<int> xs = new List<int>();')).toEqual([]);
    expect(scan(LEND, 'Map<String, List<Int>> m = make();')).toEqual([]);
  });

  it('trivial literals in single quotes give nothing', () => {
    expect(scan(PY, "if name == '':")).toEqual([]);
    expect(scan(LEND, "if name == '' then fail")).toEqual([]);
    expect(scan('db/fees.sql', "IF @name == '' BEGIN\nIF @code == 'gold' BEGIN")).toEqual(["literal-comparison|code == 'gold'"]);
    expect(scan(PY, "if name == 'gold':")).toEqual(["literal-comparison|name == 'gold'"]);
    expect(scan(PY, 'if name == """""":')).toEqual([]);
  });

  it('a lone quote does not swallow later lines', () => {
    expect(scan('src/lib.rs', "fn f<'a>(x: &str) {\n    if n > 14 {")).toEqual(['literal-comparison|n > 14']);
  });

  it('count + 1 > limit gives nothing', () => {
    expect(scan(LEND, 'if count + 1 > limit then stop')).toEqual([]);
    expect(scan(LEND, 'if limit < count + 1 then stop')).toEqual([]);
    expect(scan(LEND, 'if a > b then stop')).toEqual([]);
    expect(scan(LEND, 'if 1 > 2 then stop')).toEqual([]);
  });

  it('operands are adjacent runs of words, members, calls and literals, stopping at && and ||', () => {
    expect(scan(LEND, 'if (loan.days() > 14 && user.tier == "gold") {')).toEqual([
      'literal-comparison|loan.days() > 14',
      'literal-comparison|user.tier == "gold"',
    ]);
    expect(scan(LEND, 'while (x>=-5) {')).toEqual(['literal-comparison|x>=-5']);
    expect(scan(LEND, 'ok = days > 14 ? 1 : 2')).toEqual(['literal-comparison|days > 14']);
    expect(scan('src/A.kt', 'if (user?.age >= 18 && flag)')).toEqual(['literal-comparison|user?.age >= 18']);
    expect(scan('src/A.kt', 'ok = user?.age >= 18')).toEqual([]);
    expect(scan(LEND, 'if a.b[2] >= 3.5 {')).toEqual(['literal-comparison|a.b[2] >= 3.5']);
    expect(scan(LEND, 'ok = days > 14')).toEqual([]);
    expect(scan(LEND, 'if (count == 0) {')).toEqual([]);
    expect(scan(PY, 'if not x == None:')).toEqual([]);
    expect(scan(PY, 'if x is None or y == "a":')).toEqual(['literal-comparison|y == "a"']);
  });

  it('a case or when line with one literal gives case evidence', () => {
    expect(scanTextFacts(LEND, '  case 30:\n  when "gold" ->\n  case x:\n  case 0:', [], OPTIONS).map((f) => [f.line, f.text, f.detail])).toEqual([
      [0, 'case 30', { operator: 'case', literal: '30' }],
      [1, 'case "gold"', { operator: 'case', literal: '"gold"' }],
    ]);
  });

  it('bindings need a fragment name and a numeric constant up to the end of the value', () => {
    expect(scan(LEND, 'val retryCount: Int = 3; maxRetries = 5, delayMs := 250)')).toEqual([
      'retry-timeout|delayMs = 250',
      'retry-timeout|maxRetries = 5',
    ]);
    expect(scan(LEND, 'f(timeout=30 * 1000)')).toEqual(['retry-timeout|timeout = 30000']);
    expect(scan(LEND, 'config = { ttl: 60 }')).toEqual(['retry-timeout|ttl = 60']);
    expect(scan(LEND, 'timeout = base * 2')).toEqual([]);
    expect(scan(LEND, 'settlementDays = 3')).toEqual([]);
    expect(scan(LEND, 'if retries == 3 then x')).toEqual(['literal-comparison|retries == 3']);
  });

  it('durations from TimeSpan, Duration, time and setTimeout', () => {
    expect(scan(LEND, 'var t = TimeSpan.FromSeconds(30);')).toEqual(['retry-timeout|t = 30s']);
    expect(scan(LEND, 'return TimeSpan.FromSeconds(30);')).toEqual(['retry-timeout|TimeSpan.FromSeconds = 30s']);
    expect(scan(LEND, 'Timeout = TimeSpan.FromMinutes(2);')).toEqual(['retry-timeout|Timeout = 2min']);
    expect(scan(LEND, 'holdTtl = Duration.ofDays(7)')).toEqual(['retry-timeout|holdTtl = 7d']);
    expect(scan(LEND, 'Duration.ofMillis(1_500)')).toEqual(['retry-timeout|Duration.ofMillis = 1500ms']);
    expect(scan(LEND, 'wait := 5 * time.Second')).toEqual(['retry-timeout|wait = 5s']);
    expect(scan(LEND, 'client.Timeout = time.Minute * 2')).toEqual(['retry-timeout|Timeout = 2min']);
    expect(scan(LEND, 'setTimeout(() => poll(), 5000);')).toEqual(['retry-timeout|setTimeout = 5000ms']);
    expect(scan(LEND, 'TimeSpan.FromSeconds(seconds)')).toEqual([]);
  });

  it('Flask: route, get and post decorators on apps and Blueprints, with a same-file url_prefix', () => {
    const text = [
      'from flask import Blueprint, Flask',
      'app = Flask(__name__)',
      'bp = Blueprint("loans", __name__, url_prefix="/api/loans")',
      "admin = flask.Blueprint('admin', __name__, url_prefix='/admin/')",
      'plain = Blueprint("plain", __name__)',
      '@bp.route("/<int:id>", methods=["GET", "DELETE"])',
      'def loan(id): pass',
      '@bp.post("/")',
      'def create(): pass',
      "@admin.get('users')",
      'def users(): pass',
      '@plain.route("/p")',
      'def p(): pass',
      '@app.get("/health")',
      'def health(): pass',
    ].join('\n');
    expect(scan(PY, text)).toEqual([
      'endpoint|DELETE /api/loans/<int:id>',
      'endpoint|GET /api/loans/<int:id>',
      'endpoint|POST /api/loans',
      'endpoint|GET /admin/users',
      'endpoint|ANY /p',
      'endpoint|GET /health',
    ]);
    expect(scan(PY, 'import flask\nbp = flask.Blueprint("x", __name__, url_prefix="/v1")\n@bp.get("/a")')).toEqual(['endpoint|GET /v1/a']);
  });

  it('Flask: a dynamic, multi-line, conflicting or unimported url_prefix keeps the route as written', () => {
    const lines = (...rows: string[]) => rows.join('\n');
    // A url_prefix that is not a constant.
    expect(scan(PY, lines('from flask import Blueprint', 'bp = Blueprint("x", __name__, url_prefix=PREFIX)', '@bp.get("/a")'))).toEqual(['endpoint|GET /a']);
    expect(scan(PY, lines('from flask import Blueprint', 'bp = Blueprint("x", __name__, url_prefix=f"/{v}")', '@bp.get("/a")'))).toEqual(['endpoint|GET /a']);
    expect(scan(PY, lines('from flask import Blueprint', 'bp = Blueprint("x", __name__, url_prefix="/a" + v)', '@bp.get("/a")'))).toEqual(['endpoint|GET /a']);
    // The call continues on the next line.
    expect(scan(PY, lines('from flask import Blueprint', 'bp = Blueprint("x", __name__,', '    url_prefix="/api")', '@bp.get("/a")'))).toEqual(['endpoint|GET /a']);
    // Bound twice to different prefixes.
    expect(scan(PY, lines('from flask import Blueprint', 'bp = Blueprint("x", __name__, url_prefix="/one")', 'bp = Blueprint("x", __name__, url_prefix="/two")', '@bp.get("/a")'))).toEqual(['endpoint|GET /a']);
    // No flask import, or the import after the Blueprint.
    expect(scan(PY, lines('bp = Blueprint("x", __name__, url_prefix="/api")', '@bp.get("/a")'))).toEqual(['endpoint|GET /a']);
    expect(scan(PY, lines('bp = Blueprint("x", __name__, url_prefix="/api")', 'from flask import Blueprint', '@bp.get("/a")'))).toEqual(['endpoint|GET /a']);
    // A url_prefix inside a nested call is not the Blueprint's.
    expect(scan(PY, lines('from flask import Blueprint', 'bp = Blueprint("x", __name__, opts(url_prefix="/no"))', '@bp.get("/a")'))).toEqual(['endpoint|GET /a']);
    // Not Python: no Blueprint prefixes.
    expect(scan(LEND, lines('from flask import Blueprint', 'bp = Blueprint("x", __name__, url_prefix="/api")', '@bp.get("/a")'))).toEqual(['endpoint|GET /a']);
  });

  it('routes from attributes, annotations, decorators and router calls', () => {
    expect(scan(LEND, '[HttpGet("loans/{id}")]')).toEqual(['endpoint|GET /loans/{id}']);
    expect(scan(LEND, '@PostMapping("/loans")')).toEqual(['endpoint|POST /loans']);
    expect(scan(PY, '@router.get("/items")')).toEqual(['endpoint|GET /items']);
    expect(scan(PY, '@app.route("/x")')).toEqual(['endpoint|ANY /x']);
    expect(scan(PY, "@app.route('/x', methods=['GET', 'POST'])")).toEqual(['endpoint|GET /x', 'endpoint|POST /x']);
    expect(scan(LEND, "app.post('/fees', handler)")).toEqual(['endpoint|POST /fees']);
    expect(scan(LEND, "app.all('/any', handler)")).toEqual(['endpoint|ANY /any']);
    expect(scan(LEND, "cache.get('key')")).toEqual([]);
    expect(scan(LEND, 'app.MapDelete("/loans/{id}", Handler);')).toEqual(['endpoint|DELETE /loans/{id}']);
    expect(scan(LEND, 'http.HandleFunc("/health", h)')).toEqual(['endpoint|ANY /health']);
    expect(scan(LEND, 'mux.HandleFunc("GET /loans", h)')).toEqual(['endpoint|GET /loans']);
  });

  it('facts attach to the innermost symbol, others to the module symbol', () => {
    const file = 'src/Loans/policy.lend';
    const cls: SymbolNode = { symbolId: `${file}::Policy::class`, name: 'Policy', kind: 'class', startLine: 1, endLine: 10 };
    const method: SymbolNode = { symbolId: `${file}::Policy.check::method`, name: 'Policy.check', kind: 'method', startLine: 3, endLine: 6 };
    const text = ['retries = 3', 'class Policy {', '  timeout = 30', '  check() {', '    if days > 14 then x', '  }', '}', '', '', '', '', 'delay = 5'].join('\n');
    const facts = scanTextFacts(file, text, [cls, method], OPTIONS);
    expect(facts.map((f: CodeFact) => [f.line, f.symbolId])).toEqual([
      [0, `${file}::policy::variable`],
      [2, cls.symbolId],
      [4, method.symbolId],
      [11, `${file}::policy::variable`],
    ]);
  });

  it('the same text twice gives deep-equal facts', () => {
    const text = 'retries = 3\nif days > 14:\n@app.route("/fees", methods=["POST"])\nTIMEOUT = 30\n';
    expect(scanTextFacts(PY, text, [], OPTIONS)).toEqual(scanTextFacts(PY, text, [], OPTIONS));
    expect(scanTextFacts(PY, text, [], OPTIONS)).toHaveLength(4);
  });

  it('never throws on odd input', () => {
    for (const text of ['', '(((', ')))', 'if', 'if >', 'if > 5', '== 5 ?', 'case', 'timeout =', 'setTimeout(', '@app.route(', '[HttpGet(', '5 * time.']) {
      expect(() => scanTextFacts(LEND, text, [], OPTIONS), text).not.toThrow();
    }
  });

  it('names of Object.prototype members are ordinary names', () => {
    expect(scan('src/a.js', 'if (routes.hasOwnProperty("/users")) go()')).toEqual([]);
    expect(scan(LEND, 'if (kind == constructor) x')).toEqual([]);
    expect(scan(LEND, 'if (kind == toString) x')).toEqual([]);
    expect(scan(LEND, '  case valueOf:')).toEqual([]);
    expect(scan(LEND, 'timeout = TimeSpan.valueOf(5)')).toEqual([]);
    expect(scan(LEND, 'timeout = Duration.__proto__(5)')).toEqual([]);
    expect(scan(LEND, 'wait := 5 * time.constructor')).toEqual([]);
    expect(scan(LEND, 'app.toString("/x"); app.__proto__("/y"); app.constructor("/z")')).toEqual([]);
  });

  it('a file whose facts cannot be finished gives no facts and does not throw', () => {
    const broken = { trivialLiterals: null, normalizationMethods: [] } as unknown as FactOptions;
    expect(() => scanTextFacts(LEND, 'if days > 14 then x', [], broken)).not.toThrow();
    expect(scanTextFacts(LEND, 'if days > 14 then x', [], broken)).toEqual([]);
  });

  it('the same output with Map lookups: case, literal words and router verbs still work', () => {
    expect(scan(LEND, 'if (flag == true) x\nif (v != nil) y\n  case True:')).toEqual([]);
    expect(scan(LEND, "app.options('/o', h)")).toEqual(['endpoint|OPTIONS /o']);
  });
});

describe('scanTextFacts scale (every per-line rule is linear in the line length)', () => {
  // Every line stays under MAX_TEXT_SCAN_LINE (W29), so the linear paths are exercised; files have many such lines.
  const timed = (file: string, text: string): { readonly ms: number; readonly facts: CodeFact[] } => {
    const started = performance.now();
    const facts = scanTextFacts(file, text, [], OPTIONS);
    return { ms: performance.now() - started, facts };
  };
  const lines = (line: string, count: number): string => {
    // 20 000 is MAX_TEXT_SCAN_LINE (pinned by the W29 test), written out so these cases also run on older code.
    expect(line.length).toBeLessThanOrEqual(20_000);
    return Array.from({ length: count }, () => line).join('\n');
  };

  it('a 1 MB file of 19.5 KB generics lines without a condition word', () => {
    const { ms, facts } = timed(LEND, lines('List<Map<K,V>> '.repeat(1300), 54));
    expect(facts).toEqual([]);
    expect(ms).toBeLessThan(2000);
  });

  it('unclosed a.trim( calls after if (', () => {
    const { ms, facts } = timed(LEND, lines(`if (${'a.trim('.repeat(2790)}`, 3));
    // Every call's text runs to the line end and is cut at 200 code points, so all but the last 28 of a line are one fact.
    expect(facts.length).toBe(3 * 29);
    expect(facts.every((f) => f.kind === 'normalization' && Array.from(f.text).length <= 200)).toBe(true);
    expect(ms).toBeLessThan(2000);
  });

  it('nested x=( bindings', () => {
    const { ms, facts } = timed(LEND, lines('x=('.repeat(6600), 15));
    expect(facts).toEqual([]);
    expect(ms).toBeLessThan(2000);
  });

  it('nested comparisons', () => {
    const { ms, facts } = timed(LEND, lines(`if ${'('.repeat(4990)}x${')>2'.repeat(4990)}`, 4));
    expect(facts.length).toBeGreaterThan(0);
    expect(ms).toBeLessThan(2000);
  });

  it('chained receivers', () => {
    const { ms, facts } = timed(LEND, lines(`s${'.trim()'.repeat(2800)}`, 20));
    // The texts grow by `.trim()` until the 200 code point cut, after which they are one fact per line.
    const reference = timed(LEND, `s${'.trim()'.repeat(40)}`).facts.map((f) => f.text);
    expect(facts.filter((f) => f.line === 0).map((f) => f.text)).toEqual(reference);
    expect(ms).toBeLessThan(2000);
  });

  it('nested setTimeout(f, calls', () => {
    const { ms, facts } = timed(LEND, lines(`${'setTimeout(f,'.repeat(1400)}1${')'.repeat(1400)}`, 100));
    // Only the innermost call has a constant amount.
    expect(facts.filter((f) => f.line === 0).map((f) => f.text)).toEqual(['setTimeout = 1ms']);
    expect(ms).toBeLessThan(2000);
  });

  it('many route decorators after a long methods list', () => {
    const verbs = Array.from({ length: 1500 }, (_, i) => `"V${i}"`).join(',');
    const line = `@app.route("/a", methods=[${verbs}]) ${'@app.route("/b") '.repeat(500)}`;
    const { ms, facts } = timed(PY, lines(line, 8));
    // The first 16 verbs of the call's own list, and one ANY fact for the 500 identical decorators.
    expect(facts.filter((f) => f.line === 0).map((f) => f.text)).toEqual(['ANY /b', ...Array.from({ length: 16 }, (_, i) => `V${i} /a`)].sort());
    expect(ms).toBeLessThan(2000);
  });

  it('a huge receiver token is read once, not by every chained call', () => {
    const { ms, facts } = timed(LEND, lines(`"${'x'.repeat(12_000)}"${'.trim()'.repeat(1100)}`, 50));
    expect(facts.filter((f) => f.line === 0)).toHaveLength(1);
    expect(ms).toBeLessThan(2000);
  });

  it('1 MiB of route calls nested inside methods lists', () => {
    const { ms, facts } = timed(PY, lines("@a.route('',methods=['G',".repeat(769), 52));
    // Each list ends at the nested call; every call on a line gives the one fact `G /`.
    expect(facts.map((f) => [f.line, f.text])).toEqual(Array.from({ length: 52 }, (_, i) => [i, 'G /']));
    expect(ms).toBeLessThan(2000);
  });

  it('2 MiB of nested comparisons: collection stops once the finished lines hold 500 facts', () => {
    const { ms, facts } = timed(LEND, lines(`if ${'('.repeat(4990)}x${')>2'.repeat(4990)}`, 104));
    expect(facts).toHaveLength(500);
    expect(facts[499]!.line).toBeLessThan(5);
    expect(ms).toBeLessThan(1000);
  });
});

describe('the 500-fact file cap (FC-10)', () => {
  it('the kept facts are the first 500 in FC-10 order, whole lines first', () => {
    const text = Array.from({ length: 260 }, (_, i) => `if n == ${i + 2} then retries = ${i + 2}`).join('\n');
    const facts = scanTextFacts(LEND, text, [], OPTIONS);
    expect(facts).toHaveLength(500);
    expect(facts.slice(-2).map((f) => [f.line, f.kind])).toEqual([[249, 'literal-comparison'], [249, 'retry-timeout']]);
    expect(facts.slice(0, 2).map((f) => f.text)).toEqual(['n == 2', 'retries = 2']);
  });

  it('a line whose evidence repeats keeps one fact per distinct fact, and later lines fill the cap', () => {
    const repeated = `if n == 5 then x ${'if n == 5 then x '.repeat(50)}`;
    const text = [repeated, ...Array.from({ length: 600 }, (_, i) => `retries = ${i + 2}`)].join('\n');
    const facts = scanTextFacts(LEND, text, [], OPTIONS);
    expect(facts).toHaveLength(500);
    expect(facts[0]!.text).toBe('n == 5');
    expect(facts[1]!.text).toBe('retries = 2');
    expect(facts[499]!.line).toBe(499);
  });
});

describe('scanTextFacts output kept from the first version (N5)', () => {
  it('values made of _ and digits are numbers, as canonicalNumber strips _', () => {
    expect(scan(LEND, 'timeout = _5')).toEqual(['retry-timeout|timeout = 5']);
    expect(scan(LEND, 'timeout = __30;')).toEqual(['retry-timeout|timeout = 30']);
    expect(scan(LEND, 'd = TimeSpan.FromSeconds(_5)')).toEqual(['retry-timeout|d = 5s']);
    expect(scan(LEND, 'return TimeSpan.FromSeconds(_5);')).toEqual(['retry-timeout|TimeSpan.FromSeconds = 5s']);
  });

  it('setTimeout with an unbalanced bracket before its last comma gives nothing', () => {
    expect(scan(LEND, 'setTimeout(f[, 5)')).toEqual([]);
    expect(scan(LEND, 'setTimeout(f], 5)')).toEqual([]);
    expect(scan(LEND, 'timeout = setTimeout(f[, 5); x')).toEqual([]);
    expect(scan(LEND, 'setTimeout(f[0], 5)')).toEqual(['retry-timeout|setTimeout = 5ms']);
  });
});

describe('route methods lists', () => {
  it('methods come only from the route call, deduplicated, at most 16', () => {
    expect(scan(PY, '@app.route("/x") @app.route("/y", methods=["GET", "get", "POST"])')).toEqual(['endpoint|ANY /x', 'endpoint|GET /y', 'endpoint|POST /y']);
    const twenty = Array.from({ length: 20 }, (_, i) => `"V${String(i).padStart(2, '0')}"`).join(', ');
    expect(scan(PY, `@app.route("/z", methods=[${twenty}])`)).toHaveLength(16);
  });

  it('a list takes only its own strings: bracket groups inside it are skipped, an unclosed one ends it', () => {
    expect(scan(PY, '@app.route("/y", methods=["GET", "POST"], strict=True)')).toEqual(['endpoint|GET /y', 'endpoint|POST /y']);
    expect(scan(PY, '@app.route("/y", methods=["GET", verb, "POST"])')).toEqual(['endpoint|GET /y', 'endpoint|POST /y']);
    expect(scan(PY, '@app.route("/y", methods=["GET", f("PUT"), "POST"])')).toEqual(['endpoint|GET /y', 'endpoint|POST /y']);
    expect(scan(PY, '@app.route("/y", methods=["GET", f("PUT", "POST"')).toEqual(['endpoint|GET /y']);
    expect(scan(PY, '@app.route("/y", methods=[])')).toEqual(['endpoint|ANY /y']);
  });
});

describe('long lines (W29)', () => {
  it('a line longer than MAX_TEXT_SCAN_LINE gives no facts and the other lines keep theirs', () => {
    expect(MAX_TEXT_SCAN_LINE).toBe(20_000);
    const long = `if retries > 5 then x${' y'.repeat(12_500)}`;
    expect(long.length).toBeGreaterThan(25_000);
    const facts = scanTextFacts(LEND, `${long}\nif retries > 5 then x`, [], OPTIONS);
    expect(facts.map((f) => [f.line, f.text])).toEqual([[1, 'retries > 5']]);
    const atCap = `if retries > 5 then x${' '.repeat(MAX_TEXT_SCAN_LINE - 21)}`;
    expect(atCap.length).toBe(MAX_TEXT_SCAN_LINE);
    expect(scan(LEND, `${atCap}\r\n${atCap}x`)).toEqual(['literal-comparison|retries > 5']);
  });
});

describe('scanTextFacts onError', () => {
  it('reports the file and the error when its facts cannot be finished', () => {
    const broken = { trivialLiterals: null, normalizationMethods: [] } as unknown as FactOptions;
    const seen: [string, unknown][] = [];
    expect(scanTextFacts(LEND, 'if days > 14 then x', [], broken, (file, error) => seen.push([file, error]))).toEqual([]);
    expect(seen).toHaveLength(1);
    expect(seen[0]![0]).toBe(LEND);
    expect(seen[0]![1]).toBeInstanceOf(Error);
    expect(scanTextFacts(LEND, 'retries = 3', [], OPTIONS, () => seen.push(['unexpected', undefined]))).toHaveLength(1);
    expect(seen).toHaveLength(1);
  });
});

describe("''' strings in Dart and Groovy", () => {
  it("'''\\nif retries > 5\\n''' in a .groovy file gives no fact", () => {
    expect(scan('src/Billing/q.groovy', "def q = '''\nif retries > 5\n'''")).toEqual([]);
    expect(scan('src/Billing/q.dart', "var q = '''\nif retries > 5\n''';\nif (n > 3) {}")).toEqual(['literal-comparison|n > 3']);
  });
});
