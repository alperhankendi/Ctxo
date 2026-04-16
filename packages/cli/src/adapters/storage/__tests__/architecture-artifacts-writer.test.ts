import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type {
  BoundaryViolationsArtifact,
  DriftEventsArtifact,
} from '../../../core/types.js';
import { ArchitectureArtifactsWriter } from '../architecture-artifacts-writer.js';

let ctxoRoot: string;

beforeEach(() => {
  ctxoRoot = mkdtempSync(join(tmpdir(), 'ctxo-arch-')) + '/.ctxo';
});

afterEach(() => {
  try {
    rmSync(ctxoRoot.replace(/\.ctxo$/, ''), { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});

const drift: DriftEventsArtifact = {
  version: 1,
  computedAt: '2026-04-16T10:00:00.000Z',
  commitSha: 'abc1234',
  confidence: 'medium',
  snapshotsAvailable: 3,
  events: [
    {
      symbolId: 'a.ts::A::function',
      movedFrom: { id: 0, label: 'core' },
      movedTo: { id: 1, label: 'infra' },
      firstSeenInNewCluster: '2026-04-15',
    },
  ],
};

const violations: BoundaryViolationsArtifact = {
  version: 1,
  computedAt: '2026-04-16T10:00:00.000Z',
  commitSha: 'abc1234',
  confidence: 'high',
  snapshotsAvailable: 7,
  violations: [
    {
      from: { symbolId: 'a.ts::A::function', communityId: 0, label: 'core' },
      to: { symbolId: 'b.ts::B::function', communityId: 1, label: 'infra' },
      edgeKind: 'imports',
      historicalEdgesBetweenClusters: 0,
      severity: 'high',
    },
  ],
};

describe('ArchitectureArtifactsWriter', () => {
  it('writes drift events and boundary violations under .ctxo/index/', () => {
    const writer = new ArchitectureArtifactsWriter(ctxoRoot);
    writer.writeDriftEvents(drift);
    writer.writeBoundaryViolations(violations);

    const driftPath = join(ctxoRoot, 'index', 'drift-events.json');
    const violationsPath = join(ctxoRoot, 'index', 'boundary-violations.json');
    expect(existsSync(driftPath)).toBe(true);
    expect(existsSync(violationsPath)).toBe(true);

    const driftOnDisk = JSON.parse(readFileSync(driftPath, 'utf-8'));
    expect(driftOnDisk.events).toHaveLength(1);
    expect(driftOnDisk.confidence).toBe('medium');

    const violationsOnDisk = JSON.parse(readFileSync(violationsPath, 'utf-8'));
    expect(violationsOnDisk.violations).toHaveLength(1);
    expect(violationsOnDisk.violations[0].severity).toBe('high');
  });

  it('read helpers roundtrip', () => {
    const writer = new ArchitectureArtifactsWriter(ctxoRoot);
    writer.writeDriftEvents(drift);
    writer.writeBoundaryViolations(violations);
    expect(writer.readDriftEvents()?.events).toHaveLength(1);
    expect(writer.readBoundaryViolations()?.violations).toHaveLength(1);
  });

  it('read helpers return undefined when artifacts are absent', () => {
    const writer = new ArchitectureArtifactsWriter(ctxoRoot);
    expect(writer.readDriftEvents()).toBeUndefined();
    expect(writer.readBoundaryViolations()).toBeUndefined();
  });

  it('rejects production paths without allowProductionPath', () => {
    expect(() => new ArchitectureArtifactsWriter('/some/real/project/.ctxo')).toThrow(
      /refusing to write to non-tmp path/,
    );
  });

  it('allows production paths when opted in', () => {
    expect(
      () =>
        new ArchitectureArtifactsWriter('/some/real/project/.ctxo', {
          allowProductionPath: true,
        }),
    ).not.toThrow();
  });
});
