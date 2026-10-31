import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, rmdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BoundaryViolationRecord, CrossContextSummary } from '../core/boundaries.js';
import type { ContextHistoryEntry, MovedFile } from '../core/context-metrics.js';
import { isBoundaryMode, type BoundaryMode } from '../core/domain-config.js';
import type { DomainGraph } from '../core/domain-graph.js';
import type { MaturityArtifact } from '../core/maturity.js';
import { RUNGS, type Rung } from '../core/registry.js';
import type { ShadowCandidatesArtifact } from '../core/shadow-candidates.js';

/** `.ctxo/index/domain/contexts.json`: the file-to-context map of the current registry (E1, E2). */
export interface ContextsArtifact {
  readonly ctxoArtifact: 'domain-contexts';
  readonly version: 1;
  readonly registryHash: string;
  readonly contexts: readonly { id: string; name: string; rung: Rung; card?: string; fileCount: number; files: readonly string[] }[];
  readonly unowned: { readonly count: number; readonly files: readonly string[] };
  readonly multiplyOwned: readonly { file: string; contexts: readonly string[] }[];
  readonly movedFiles: readonly MovedFile[];
}

/** `.ctxo/index/domain/boundaries.json`: cross-context edges and violations under the configured mode. */
export interface BoundariesArtifact {
  readonly ctxoArtifact: 'domain-boundaries';
  readonly version: 1;
  readonly registryHash: string;
  readonly mode: BoundaryMode;
  readonly blockingRungs: readonly Rung[];
  readonly crossEdges: readonly CrossContextSummary[];
  readonly violations: readonly BoundaryViolationRecord[];
}

type ArtifactName = 'contexts.json' | 'boundaries.json' | 'graph.json' | 'shadow-candidates.json' | 'maturity.json';

type Artifact = ContextsArtifact | BoundariesArtifact | DomainGraph | ShadowCandidatesArtifact | MaturityArtifact;

/** Every artifact `removeAll` deletes, with the marker it must carry. */
const MARKED_ARTIFACTS = [
  ['contexts.json', 'domain-contexts'],
  ['boundaries.json', 'domain-boundaries'],
  ['graph.json', 'domain-graph'],
  ['shadow-candidates.json', 'domain-shadow-candidates'],
  ['maturity.json', 'domain-maturity'],
] as const;

const GRAPH_ARRAYS = ['contexts', 'rules', 'terms', 'decisions', 'sections', 'openQuestions', 'links', 'unresolved'] as const;

const HISTORY_DIR = 'history';
const DEFAULT_KEEP = 10;
const HISTORY_FILE = /^(\d+)-([0-9a-zA-Z]+)\.json$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const isString = (v: unknown): v is string => typeof v === 'string';
const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every(isString);
const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;
const isRung = (v: unknown): v is Rung => typeof v === 'string' && (RUNGS as readonly string[]).includes(v);

function isMovedFile(v: unknown): boolean {
  return (
    isRecord(v) &&
    isString(v['file']) &&
    isString(v['from']) &&
    (v['fromContext'] === undefined || isString(v['fromContext'])) &&
    (v['toContext'] === undefined || isString(v['toContext'])) &&
    isString(v['commit']) &&
    isString(v['date'])
  );
}

function isContexts(v: unknown): v is ContextsArtifact {
  if (!isRecord(v) || v['ctxoArtifact'] !== 'domain-contexts' || v['version'] !== 1 || !isString(v['registryHash'])) return false;
  const contexts = v['contexts'];
  const unowned = v['unowned'];
  return (
    Array.isArray(contexts) &&
    contexts.every(
      (c) =>
        isRecord(c) &&
        isString(c['id']) &&
        isString(c['name']) &&
        isRung(c['rung']) &&
        (c['card'] === undefined || isString(c['card'])) &&
        isCount(c['fileCount']) &&
        isStringArray(c['files']),
    ) &&
    isRecord(unowned) &&
    isCount(unowned['count']) &&
    isStringArray(unowned['files']) &&
    Array.isArray(v['multiplyOwned']) &&
    v['multiplyOwned'].every((m) => isRecord(m) && isString(m['file']) && isStringArray(m['contexts'])) &&
    Array.isArray(v['movedFiles']) &&
    v['movedFiles'].every(isMovedFile)
  );
}

function isEnd(v: unknown): boolean {
  return isRecord(v) && isString(v['symbolId']) && isString(v['file']) && isString(v['context']);
}

function isBoundaries(v: unknown): v is BoundariesArtifact {
  if (!isRecord(v) || v['ctxoArtifact'] !== 'domain-boundaries' || v['version'] !== 1 || !isString(v['registryHash'])) return false;
  return (
    isBoundaryMode(v['mode']) &&
    Array.isArray(v['blockingRungs']) &&
    v['blockingRungs'].every(isRung) &&
    Array.isArray(v['crossEdges']) &&
    v['crossEdges'].every(
      (c) =>
        isRecord(c) &&
        isString(c['from']) &&
        isString(c['to']) &&
        isRecord(c['byKind']) &&
        Object.values(c['byKind']).every(isCount) &&
        isCount(c['allowed']) &&
        isCount(c['violations']),
    ) &&
    Array.isArray(v['violations']) &&
    v['violations'].every(
      (x) => isRecord(x) && isEnd(x['from']) && isEnd(x['to']) && isString(x['edgeKind']) && (x['severity'] === 'error' || x['severity'] === 'warning'),
    )
  );
}

/** The marker, version 1, both hashes and every array; the entries themselves are the index pass's own output. */
function isGraph(v: unknown): v is DomainGraph {
  return (
    isRecord(v) &&
    v['ctxoArtifact'] === 'domain-graph' &&
    v['version'] === 1 &&
    isString(v['registryHash']) &&
    isString(v['cardsHash']) &&
    GRAPH_ARRAYS.every((key) => Array.isArray(v[key]))
  );
}

/** The marker, version 1, both hashes and the array; the candidates themselves are the index pass's own output. */
function isShadowCandidates(v: unknown): v is ShadowCandidatesArtifact {
  return (
    isRecord(v) &&
    v['ctxoArtifact'] === 'domain-shadow-candidates' &&
    v['version'] === 1 &&
    isString(v['registryHash']) &&
    isString(v['cardsHash']) &&
    Array.isArray(v['candidates'])
  );
}

/** The marker, version 1, both hashes and the array; the entries themselves are the index pass's own output. */
function isMaturity(v: unknown): v is MaturityArtifact {
  return (
    isRecord(v) &&
    v['ctxoArtifact'] === 'domain-maturity' &&
    v['version'] === 1 &&
    isString(v['registryHash']) &&
    isString(v['cardsHash']) &&
    Array.isArray(v['contexts'])
  );
}

function isHistoryEntry(v: unknown): v is ContextHistoryEntry {
  return (
    isRecord(v) &&
    v['ctxoArtifact'] === 'domain-history' &&
    v['version'] === 1 &&
    isString(v['commitSha']) &&
    v['commitSha'].length > 0 &&
    typeof v['committedAt'] === 'number' &&
    Number.isFinite(v['committedAt']) &&
    isString(v['registryHash']) &&
    Array.isArray(v['contexts']) &&
    v['contexts'].every(
      (c) =>
        isRecord(c) &&
        isString(c['id']) &&
        isCount(c['files']) &&
        isCount(c['internalEdges']) &&
        isCount(c['crossOut']) &&
        isCount(c['crossIn']) &&
        typeof c['crossShare'] === 'number',
    )
  );
}

/** Strips a BOM and turns CRLF and CR into LF, so line endings alone never count as a change (E2). */
function normalize(text: string): string {
  const noBom = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  return noBom.replace(/\r\n?/g, '\n');
}

function serialize(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The domain artifacts under `<ctxoRoot>/index/domain/`. Every file is read once, never checked first; a write
 * goes to a fresh temporary file (`wx`) renamed over the target (PF27). Reads of missing or invalid files give
 * undefined (or no entry); writes throw, and the index pass reports them.
 */
export class DomainArtifactStore {
  private readonly dir: string;
  private readonly historyDir: string;

  constructor(ctxoRoot: string) {
    this.dir = join(ctxoRoot, 'index', 'domain');
    this.historyDir = join(this.dir, HISTORY_DIR);
  }

  /** Writes the artifact unless the file already holds the same JSON (after CRLF and BOM normalisation). */
  writeIfChanged(name: ArtifactName, artifact: Artifact): boolean {
    const target = join(this.dir, name);
    const content = serialize(artifact);
    const existing = this.readText(target);
    if (existing !== undefined && normalize(existing) === content) return false;
    if (this.isForeign(target, artifact.ctxoArtifact)) return false;
    this.writeAtomic(target, content);
    return true;
  }

  /**
   * Writes the entry as `<committedAt>-<sha7>.json` (PF26), replacing any entry of the same commit, then keeps
   * the newest `keep` entries by committer date.
   */
  writeHistory(entry: ContextHistoryEntry, keep: number = DEFAULT_KEEP): void {
    const sha7 = entry.commitSha.slice(0, 7);
    const name = `${entry.committedAt}-${sha7}.json`;
    mkdirSync(this.historyDir, { recursive: true });

    for (const file of this.historyFiles()) {
      if (file.name === name) continue;
      if (!this.isMarked(join(this.historyDir, file.name), 'domain-history')) continue;
      const sameCommit = file.sha === sha7 || this.readHistoryFile(file.name)?.commitSha === entry.commitSha;
      if (sameCommit) rmSync(join(this.historyDir, file.name), { force: true });
    }

    const target = join(this.historyDir, name);
    const content = serialize(entry);
    const existing = this.readText(target);
    if ((existing === undefined || normalize(existing) !== content) && !this.isForeign(target, 'domain-history')) {
      this.writeAtomic(target, content);
    }

    const files = this.historyFiles()
      .filter((f) => this.isMarked(join(this.historyDir, f.name), 'domain-history'))
      .sort((a, b) => b.committedAt - a.committedAt || compare(b.name, a.name));
    for (const file of files.slice(Math.max(1, keep))) rmSync(join(this.historyDir, file.name), { force: true });
  }

  readContexts(): ContextsArtifact | undefined {
    const value = this.readJson(join(this.dir, 'contexts.json'));
    return isContexts(value) ? value : undefined;
  }

  readBoundaries(): BoundariesArtifact | undefined {
    const value = this.readJson(join(this.dir, 'boundaries.json'));
    return isBoundaries(value) ? value : undefined;
  }

  /** `graph.json`: undefined unless it carries the `domain-graph` marker, version 1 and every array. */
  readGraph(): DomainGraph | undefined {
    const value = this.readJson(join(this.dir, 'graph.json'));
    return isGraph(value) ? value : undefined;
  }

  /** `shadow-candidates.json`: undefined unless it carries the `domain-shadow-candidates` marker, version 1 and its array. */
  readShadowCandidates(): ShadowCandidatesArtifact | undefined {
    const value = this.readJson(join(this.dir, 'shadow-candidates.json'));
    return isShadowCandidates(value) ? value : undefined;
  }

  /** `maturity.json`: undefined unless it carries the `domain-maturity` marker, version 1 and its array. */
  readMaturity(): MaturityArtifact | undefined {
    const value = this.readJson(join(this.dir, 'maturity.json'));
    return isMaturity(value) ? value : undefined;
  }

  /** Valid history entries, newest first by committer date. */
  readHistory(): ContextHistoryEntry[] {
    const out: ContextHistoryEntry[] = [];
    for (const file of this.historyFiles()) {
      const entry = this.readHistoryFile(file.name);
      if (entry !== undefined) out.push(entry);
    }
    return out.sort((a, b) => b.committedAt - a.committedAt || compare(b.commitSha, a.commitSha));
  }

  /**
   * Deletes the domain artifacts: `contexts.json`, `boundaries.json`, `graph.json`, `shadow-candidates.json`,
   * `maturity.json` and the history entries, each
   * only when it carries the matching `ctxoArtifact` marker (ADR-018 C3). The folder also holds the index entries of
   * a source folder named `domain/` (`domain/graph` has its entry at `graph.json`), which are never touched. An
   * emptied `history/` folder is removed.
   */
  removeAll(): void {
    for (const [name, marker] of MARKED_ARTIFACTS) {
      const path = join(this.dir, name);
      if (this.isMarked(path, marker)) rmSync(path, { force: true });
    }
    for (const file of this.historyFiles()) {
      const path = join(this.historyDir, file.name);
      if (this.isMarked(path, 'domain-history')) rmSync(path, { force: true });
    }
    try {
      rmdirSync(this.historyDir);
    } catch {
      // not empty (source entries live here) or already gone
    }
  }

  /**
   * Deletes `shadow-candidates.json` and `maturity.json`, each only when it carries its `ctxoArtifact` marker: the
   * index pass calls it when it cannot rebuild them, so the two loop files are written together or removed together.
   */
  removeLoopArtifacts(): void {
    for (const [name, marker] of MARKED_ARTIFACTS) {
      if (name !== 'shadow-candidates.json' && name !== 'maturity.json') continue;
      const path = join(this.dir, name);
      if (this.isMarked(path, marker)) rmSync(path, { force: true });
    }
  }

  /** True when the file parses as JSON and carries this `ctxoArtifact` marker. */
  private isMarked(path: string, marker: string): boolean {
    const value = this.readJson(path);
    return isRecord(value) && value['ctxoArtifact'] === marker;
  }

  /** True when the file holds valid JSON without the marker: a source index entry, never ours to overwrite. */
  private isForeign(path: string, marker: string): boolean {
    const value = this.readJson(path);
    if (value === undefined) return false;
    if (isRecord(value) && value['ctxoArtifact'] === marker) return false;
    process.stderr.write(`[ctxo:domain] left ${path} alone: it is not a domain artifact\n`);
    return true;
  }

  private historyFiles(): { name: string; committedAt: number; sha: string }[] {
    let names: string[];
    try {
      names = readdirSync(this.historyDir);
    } catch {
      return [];
    }
    const out: { name: string; committedAt: number; sha: string }[] = [];
    for (const name of names) {
      const match = HISTORY_FILE.exec(name);
      if (match) out.push({ name, committedAt: Number(match[1]), sha: match[2]! });
    }
    return out;
  }

  private readHistoryFile(name: string): ContextHistoryEntry | undefined {
    const value = this.readJson(join(this.historyDir, name));
    return isHistoryEntry(value) ? value : undefined;
  }

  private readText(path: string): string | undefined {
    try {
      return readFileSync(path, 'utf-8');
    } catch {
      return undefined;
    }
  }

  private readJson(path: string): unknown {
    const text = this.readText(path);
    if (text === undefined) return undefined;
    try {
      return JSON.parse(normalize(text));
    } catch {
      return undefined;
    }
  }

  private writeAtomic(target: string, content: string): void {
    mkdirSync(this.dir, { recursive: true });
    const temp = `${target}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
    try {
      writeFileSync(temp, content, { encoding: 'utf-8', flag: 'wx' });
      renameSync(temp, target);
    } catch (err) {
      rmSync(temp, { force: true });
      throw err;
    }
  }
}
