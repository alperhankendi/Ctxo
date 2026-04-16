import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createLogger } from '../../core/logger.js';
import type {
  BoundaryViolationsArtifact,
  DriftEventsArtifact,
} from '../../core/types.js';
import { atomicWrite } from './atomic-write.js';

const log = createLogger('ctxo:architecture-artifacts');

const DRIFT_FILE_NAME = 'drift-events.json';
const VIOLATIONS_FILE_NAME = 'boundary-violations.json';

export interface ArchitectureArtifactsWriterOptions {
  /**
   * Acknowledge writes to a production `.ctxo/` root. Mirrors the guard in
   * CommunitySnapshotWriter so tests can't accidentally poison a real project.
   */
  readonly allowProductionPath?: boolean;
}

/**
 * Persists derived architectural-intelligence artifacts next to the
 * community snapshot. These files exist so the static HTML visualizer
 * (pages/ctxo-visualizer.html) can render the Architecture views without
 * re-running the detectors in the browser.
 *
 * Contracts:
 * - `drift-events.json` is overwritten on every index run.
 * - `boundary-violations.json` is overwritten on every index run.
 * - Both are derived — no history rotation needed (history lives in
 *   communities.history/ and the detectors recompute from there).
 */
export class ArchitectureArtifactsWriter {
  private readonly indexDir: string;

  constructor(ctxoRoot: string, options: ArchitectureArtifactsWriterOptions = {}) {
    this.indexDir = join(ctxoRoot, 'index');
    assertSafeWritePath(ctxoRoot, options.allowProductionPath ?? false);
  }

  writeDriftEvents(artifact: DriftEventsArtifact): void {
    mkdirSync(this.indexDir, { recursive: true });
    atomicWrite(join(this.indexDir, DRIFT_FILE_NAME), JSON.stringify(artifact, null, 2));
  }

  writeBoundaryViolations(artifact: BoundaryViolationsArtifact): void {
    mkdirSync(this.indexDir, { recursive: true });
    atomicWrite(join(this.indexDir, VIOLATIONS_FILE_NAME), JSON.stringify(artifact, null, 2));
  }

  readDriftEvents(): DriftEventsArtifact | undefined {
    const path = join(this.indexDir, DRIFT_FILE_NAME);
    if (!existsSync(path)) return undefined;
    try {
      return JSON.parse(readFileSync(path, 'utf-8')) as DriftEventsArtifact;
    } catch (err) {
      log.warn(`failed to parse ${DRIFT_FILE_NAME}: ${(err as Error).message}`);
      return undefined;
    }
  }

  readBoundaryViolations(): BoundaryViolationsArtifact | undefined {
    const path = join(this.indexDir, VIOLATIONS_FILE_NAME);
    if (!existsSync(path)) return undefined;
    try {
      return JSON.parse(readFileSync(path, 'utf-8')) as BoundaryViolationsArtifact;
    } catch (err) {
      log.warn(`failed to parse ${VIOLATIONS_FILE_NAME}: ${(err as Error).message}`);
      return undefined;
    }
  }
}

function assertSafeWritePath(ctxoRoot: string, allowProductionPath: boolean): void {
  const resolvedRoot = resolve(ctxoRoot);
  const resolvedTmp = resolve(tmpdir());
  if (resolvedRoot.startsWith(resolvedTmp)) return;
  if (allowProductionPath) return;
  throw new Error(
    `ArchitectureArtifactsWriter: refusing to write to non-tmp path ${resolvedRoot}. ` +
      `Pass { allowProductionPath: true } for production CLI writes, ` +
      `or target a tmpdir-based path in tests.`,
  );
}
