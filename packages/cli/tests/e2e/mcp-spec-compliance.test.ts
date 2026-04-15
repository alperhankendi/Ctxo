import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SqliteStorageAdapter } from '../../src/adapters/storage/sqlite-storage-adapter.js';
import { MaskingPipeline } from '../../src/core/masking/masking-pipeline.js';
import { handleGetLogicSlice } from '../../src/adapters/mcp/get-logic-slice.js';
import { handleGetBlastRadius } from '../../src/adapters/mcp/get-blast-radius.js';
import { handleGetArchitecturalOverlay } from '../../src/adapters/mcp/get-architectural-overlay.js';
import { handleGetWhyContext } from '../../src/adapters/mcp/get-why-context.js';
import { handleGetChangeIntelligence } from '../../src/adapters/mcp/get-change-intelligence.js';
import type { FileIndex } from '../../src/core/types.js';
import type { IGitPort } from '../../src/ports/i-git-port.js';

const mockGit: IGitPort = {
  getCommitHistory: async () => [],
  getFileChurn: async (filePath: string) => ({ filePath, commitCount: 0 }),
  isAvailable: async () => true,
};

function buildTestIndex(): FileIndex {
  return {
    file: 'src/app.ts',
    lastModified: 1711620000,
    symbols: [{
      symbolId: 'src/app.ts::main::function',
      name: 'main',
      kind: 'function',
      startLine: 0,
      endLine: 20,
    }],
    edges: [],
    intent: [],
    antiPatterns: [],
  };
}

function assertMcpResponseShape(result: { content: Array<{ type: string; text: string }> }): void {
  expect(result).toHaveProperty('content');
  expect(Array.isArray(result.content)).toBe(true);
  expect(result.content.length).toBeGreaterThanOrEqual(1);

  for (const item of result.content) {
    expect(item).toHaveProperty('type');
    expect(item.type).toBe('text');
    expect(item).toHaveProperty('text');
    expect(typeof item.text).toBe('string');
  }
}

describe('NFR15/NFR17: MCP Spec Compliance — All 5 Tools', () => {
  let tempDir: string;
  let storage: SqliteStorageAdapter;
  let masking: MaskingPipeline;

  beforeAll(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'ctxo-mcp-spec-'));
    storage = new SqliteStorageAdapter(tempDir);
    await storage.initEmpty();
    storage.bulkWrite([buildTestIndex()]);
    masking = new MaskingPipeline();
  });

  afterAll(() => {
    storage.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('get_logic_slice', () => {
    it('success response conforms to MCP content shape', () => {
      const handler = handleGetLogicSlice(storage, masking, undefined, tempDir);
      const result = handler({ symbolId: 'src/app.ts::main::function' });
      assertMcpResponseShape(result);

      const payload = JSON.parse(result.content[result.content.length - 1]!.text);
      expect(payload).toHaveProperty('root');
      expect(payload).toHaveProperty('dependencies');
      expect(payload).toHaveProperty('edges');
      expect(payload).toHaveProperty('level');
    });

    it('miss response returns { found: false, hint }', () => {
      const handler = handleGetLogicSlice(storage, masking, undefined, tempDir);
      const result = handler({ symbolId: 'src/missing.ts::x::function' });
      assertMcpResponseShape(result);

      const payload = JSON.parse(result.content[result.content.length - 1]!.text);
      expect(payload.found).toBe(false);
      expect(payload.hint).toBeDefined();
    });

    it('error response returns { error: true, message }', () => {
      const handler = handleGetLogicSlice(storage, masking, undefined, tempDir);
      const result = handler({ symbolId: '' });
      assertMcpResponseShape(result);

      const payload = JSON.parse(result.content[result.content.length - 1]!.text);
      expect(payload.error).toBe(true);
      expect(payload.message).toBeDefined();
    });
  });

  describe('get_blast_radius', () => {
    it('success response conforms to MCP content shape', async () => {
      const handler = handleGetBlastRadius(storage, masking, undefined, tempDir);
      const result = await handler({ symbolId: 'src/app.ts::main::function' });
      assertMcpResponseShape(result);

      const payload = JSON.parse(result.content[result.content.length - 1]!.text);
      expect(payload).toHaveProperty('symbolId');
      expect(payload).toHaveProperty('impactScore');
      expect(payload).toHaveProperty('directDependentsCount');
      expect(payload).toHaveProperty('confirmedCount');
      expect(payload).toHaveProperty('potentialCount');
      expect(payload).toHaveProperty('overallRiskScore');
      expect(payload).toHaveProperty('impactedSymbols');
    });

    it('miss response returns { found: false }', async () => {
      const handler = handleGetBlastRadius(storage, masking, undefined, tempDir);
      const result = await handler({ symbolId: 'src/missing.ts::x::function' });
      assertMcpResponseShape(result);

      const payload = JSON.parse(result.content[result.content.length - 1]!.text);
      expect(payload.found).toBe(false);
    });
  });

  describe('get_architectural_overlay', () => {
    it('success response conforms to MCP content shape', async () => {
      const handler = handleGetArchitecturalOverlay(storage, masking);
      const result = await handler({});
      assertMcpResponseShape(result);

      const payload = JSON.parse(result.content[result.content.length - 1]!.text);
      expect(payload).toHaveProperty('layers');
    });

    it('filtered response returns layer + files', async () => {
      const handler = handleGetArchitecturalOverlay(storage, masking);
      const result = await handler({ layer: 'Unknown' });
      assertMcpResponseShape(result);

      const payload = JSON.parse(result.content[result.content.length - 1]!.text);
      expect(payload).toHaveProperty('layer');
      expect(payload).toHaveProperty('files');
    });
  });

  describe('get_why_context', () => {
    it('success response conforms to MCP content shape', async () => {
      const handler = handleGetWhyContext(storage, mockGit, masking);
      const result = await handler({ symbolId: 'src/app.ts::main::function' });
      assertMcpResponseShape(result);

      const payload = JSON.parse(result.content[result.content.length - 1]!.text);
      expect(payload).toHaveProperty('commitHistory');
      expect(payload).toHaveProperty('antiPatternWarnings');
    });

    it('miss response returns { found: false }', async () => {
      const handler = handleGetWhyContext(storage, mockGit, masking);
      const result = await handler({ symbolId: 'src/missing.ts::x::function' });
      assertMcpResponseShape(result);

      const payload = JSON.parse(result.content[result.content.length - 1]!.text);
      expect(payload.found).toBe(false);
    });
  });

  describe('get_change_intelligence', () => {
    it('success response conforms to MCP content shape', async () => {
      const handler = handleGetChangeIntelligence(storage, mockGit, masking);
      const result = await handler({ symbolId: 'src/app.ts::main::function' });
      assertMcpResponseShape(result);

      const payload = JSON.parse(result.content[result.content.length - 1]!.text);
      expect(payload).toHaveProperty('symbolId');
      expect(payload).toHaveProperty('complexity');
      expect(payload).toHaveProperty('churn');
      expect(payload).toHaveProperty('composite');
      expect(payload).toHaveProperty('band');
    });

    it('miss response returns { found: false }', async () => {
      const handler = handleGetChangeIntelligence(storage, mockGit, masking);
      const result = await handler({ symbolId: 'src/missing.ts::x::function' });
      assertMcpResponseShape(result);

      const payload = JSON.parse(result.content[result.content.length - 1]!.text);
      expect(payload.found).toBe(false);
    });
  });
});
