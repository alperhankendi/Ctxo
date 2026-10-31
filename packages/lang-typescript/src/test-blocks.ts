import { Node, type CallExpression, type SourceFile } from 'ts-morph';
import type { SymbolNode } from '@ctxo/plugin-api';

/**
 * Test blocks (`describe`, `it`, `test` and friends) as synthetic `function` symbols (ADR-017 addendum,
 * PR 1C). A block is named by its title path, for example `LoanPolicy > renewal > extends by seven days`.
 */

/** Group callees. */
const GROUP_CALLEES: ReadonlySet<string> = new Set(['describe', 'suite', 'context', 'fdescribe', 'xdescribe']);
/** Test callees. */
const TEST_CALLEES: ReadonlySet<string> = new Set(['it', 'test', 'specify', 'fit', 'xit', 'xtest']);
/** Members chained onto a callee: `it.only(...)`, `test.concurrent.skip(...)`. */
const CHAINED_MEMBERS: ReadonlySet<string> = new Set([
  'only',
  'skip',
  'todo',
  'concurrent',
  'sequential',
  'shuffle',
  'fails',
]);
/** Members called before the title call: `it.each(table)(...)`, `it.skipIf(flag)(...)`. */
const CALLED_MEMBERS: ReadonlySet<string> = new Set(['each', 'for', 'skipIf', 'runIf']);

const TITLE_CHARS = 200;
const UNTITLED = '(untitled)';
const PATH_SEPARATOR = ' > ';

/**
 * The fallback test-file rule, used when the host sends no `PluginContext.testGlobs` (an older core).
 * The TypeScript and JavaScript part of the core's DEFAULT_TEST_GLOBS (`**\/__tests__/**`, `**\/*.test.*`,
 * `**\/*.spec.*`, `**\/test/**`, `**\/tests/**`), reimplemented because a plugin cannot import the CLI:
 * a path segment `__tests__`, `test` or `tests`, or a basename containing `.test.` or `.spec.`.
 * Either path separator is accepted; matching is case-sensitive, as in the core.
 */
export function isTestFilePath(path: string): boolean {
  const segments = path.replace(/\\/g, '/').split('/');
  if (segments.some((s) => s === '__tests__' || s === 'test' || s === 'tests')) return true;
  const basename = segments[segments.length - 1] ?? '';
  return basename.includes('.test.') || basename.includes('.spec.');
}

export interface TestBlock {
  /** `<file>::<title path>::function` */
  readonly symbolId: string;
  /** The title path. */
  readonly name: string;
  /** The block's call, the symbol's span. */
  readonly call: CallExpression;
  /** The callback. */
  readonly body: Node;
  /** Callbacks of every block inside this one. */
  readonly nested: readonly Node[];
}

/** True when `expr` names a test callee: a listed identifier, a chained member or a called member's call. */
function isTestCallee(expr: Node): boolean {
  if (Node.isIdentifier(expr)) {
    const name = expr.getText();
    return GROUP_CALLEES.has(name) || TEST_CALLEES.has(name);
  }
  if (Node.isPropertyAccessExpression(expr)) {
    return CHAINED_MEMBERS.has(expr.getName()) && isTestCallee(expr.getExpression());
  }
  if (Node.isCallExpression(expr) || Node.isTaggedTemplateExpression(expr)) {
    const member = Node.isCallExpression(expr) ? expr.getExpression() : expr.getTag();
    return (
      Node.isPropertyAccessExpression(member) &&
      CALLED_MEMBERS.has(member.getName()) &&
      isTestCallee(member.getExpression())
    );
  }
  return false;
}

/** The title node and callback of a block call, or undefined when the call is not a block. */
function blockParts(call: CallExpression): { title: Node; body: Node } | undefined {
  if (!isTestCallee(call.getExpression())) return undefined;
  const [title, ...rest] = call.getArguments();
  if (!title) return undefined;
  const body = rest.find((arg) => Node.isArrowFunction(arg) || Node.isFunctionExpression(arg));
  return body ? { title, body } : undefined;
}

function rawTitle(title: Node): string {
  if (Node.isStringLiteral(title) || Node.isNoSubstitutionTemplateLiteral(title)) {
    return title.getLiteralValue();
  }
  if (Node.isTemplateExpression(title)) {
    return title.getText().slice(1, -1);
  }
  return title.getText();
}

/** Cut at 200 UTF-16 units without leaving half of a surrogate pair. */
function cutTitle(title: string): string {
  if (title.length <= TITLE_CHARS) return title;
  const cut = title.slice(0, TITLE_CHARS);
  const last = cut.charCodeAt(cut.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}

/**
 * Whitespace runs become one space, then trim; runs of `:` become one `:`; an empty title becomes
 * `(untitled)`; the title is cut at 200 characters; a trailing `:` is dropped. Repeated until stable,
 * so no title ends in `:` or holds `::`, and every ID splits into exactly three `::` parts.
 */
function normaliseTitle(raw: string): string {
  let title = raw;
  for (;;) {
    let next = title.replace(/\s+/g, ' ').trim().replace(/:{2,}/g, ':');
    if (next.length === 0) next = UNTITLED;
    next = cutTitle(next).replace(/:+$/, '');
    if (next === title) return title;
    title = next;
  }
}

interface PendingBlock {
  readonly name: string;
  readonly call: CallExpression;
  readonly body: Node;
  readonly nested: Node[];
  readonly ancestors: readonly PendingBlock[];
}

/**
 * The test blocks of a test file in source order; `[]` unless `isTestFile(filePath)` (default
 * `isTestFilePath`; the adapter passes the matcher built from the host's `testGlobs`). A path seen again
 * in the file (or equal to an exported function's name) gets ` #2`, ` #3` in source order, and children use
 * their parent's final name.
 */
export function findTestBlocks(
  sourceFile: SourceFile,
  filePath: string,
  isTestFile: (path: string) => boolean = isTestFilePath,
): TestBlock[] {
  if (!isTestFile(filePath)) return [];

  const used = new Set<string>();
  for (const fn of sourceFile.getFunctions()) {
    const name = fn.getName();
    if (name && fn.isExported()) used.add(name);
  }
  const lastSuffix = new Map<string, number>();
  const byBody = new Map<object, PendingBlock>();
  const blocks: PendingBlock[] = [];

  sourceFile.forEachDescendant((node) => {
    if (!Node.isCallExpression(node)) return undefined;
    const parts = blockParts(node);
    if (!parts) return undefined;

    let parent: PendingBlock | undefined;
    for (let up = node.getParent(); up && !parent; up = up.getParent()) {
      parent = byBody.get(up.compilerNode);
    }

    const title = normaliseTitle(rawTitle(parts.title));
    const path = parent ? `${parent.name}${PATH_SEPARATOR}${title}` : title;
    let n = lastSuffix.get(path) ?? 0;
    let name: string;
    do {
      n++;
      name = n === 1 ? path : `${path} #${n}`;
    } while (used.has(name));
    lastSuffix.set(path, n);
    used.add(name);

    const ancestors = parent ? [...parent.ancestors, parent] : [];
    const block: PendingBlock = { name, call: node, body: parts.body, nested: [], ancestors };
    for (const ancestor of ancestors) ancestor.nested.push(parts.body);
    byBody.set(parts.body.compilerNode, block);
    blocks.push(block);
    return undefined;
  });

  return blocks.map((b) => ({
    symbolId: `${filePath}::${b.name}::function`,
    name: b.name,
    call: b.call,
    body: b.body,
    nested: b.nested,
  }));
}

/** The block's symbol: kind `function`, spanning its call, annotated `{ name: 'test' }`. */
export function testBlockSymbol(block: TestBlock): SymbolNode {
  return {
    symbolId: block.symbolId,
    name: block.name,
    kind: 'function',
    startLine: block.call.getStartLineNumber() - 1,
    endLine: block.call.getEndLineNumber() - 1,
    startOffset: block.call.getStart(),
    endOffset: block.call.getEnd(),
    annotations: [{ name: 'test' }],
  };
}
