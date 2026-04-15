import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, cpSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { SqliteStorageAdapter } from '../../src/adapters/storage/sqlite-storage-adapter.js';
import { MaskingPipeline } from '../../src/core/masking/masking-pipeline.js';
import { handleGetLogicSlice } from '../../src/adapters/mcp/get-logic-slice.js';
import { handleGetBlastRadius } from '../../src/adapters/mcp/get-blast-radius.js';
import { handleGetArchitecturalOverlay } from '../../src/adapters/mcp/get-architectural-overlay.js';
import { IndexCommand } from '../../src/cli/index-command.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = join(__dirname, 'fixtures', 'credential-fixture');

// Full credential values that the masking pipeline MUST catch
const FORBIDDEN_PATTERNS = [
  'AKIAIOSFODNN7EXAMPLE',         // AWS access key (AKIA pattern)
  '192.168.1.100',                // Private IP
  '10.0.0.50',                    // Private IP in service
];

// Partial patterns that are only caught when appearing in full credential context
// (e.g., JWT needs 3 base64 segments separated by dots, AWS secret needs 40-char boundary)
// These are validated separately
const FULL_CREDENTIAL_PATTERNS = [
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U', // Full JWT
  'DATABASE_PASSWORD=SuperSecret123!',  // Full env secret assignment
  'AUTH_TOKEN=abc123def456ghi789jkl012', // Full env token assignment
  'AccountKey=dGhpcyBpcyBhIHRlc3Qga2V5IHZhbHVl', // Full Azure connection string
];

describe('NFR8: Privacy Zero-Leakage Gate', () => {
  let tempDir: string;
  let storage: SqliteStorageAdapter;
  let masking: MaskingPipeline;

  beforeAll(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'ctxo-leakage-'));

    // Copy credential fixtures
    cpSync(FIXTURE_DIR, tempDir, { recursive: true });

    // Init git repo
    execFileSync('git', ['init'], { cwd: tempDir, stdio: 'ignore' });
    execFileSync('git', ['add', '.'], { cwd: tempDir, stdio: 'ignore' });
    execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'user.name=Test', '-c', 'user.email=test@test.com', 'commit', '-m', 'init'], { cwd: tempDir, stdio: 'ignore' });

    // Build index
    const indexCmd = new IndexCommand(tempDir);
    await indexCmd.run();

    // Init storage for MCP tool calls
    const ctxoRoot = join(tempDir, '.ctxo');
    storage = new SqliteStorageAdapter(ctxoRoot);
    await storage.init();
    masking = new MaskingPipeline();
  });

  afterAll(() => {
    storage.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('get_logic_slice response contains no unmasked credentials', () => {
    const handler = handleGetLogicSlice(storage, masking, undefined, join(tempDir, '.ctxo'));
    const symbols = storage.getAllSymbols();

    for (const sym of symbols) {
      const result = handler({ symbolId: sym.symbolId });
      const responseText = result.content.map((c) => c.text).join(' ');

      for (const forbidden of FORBIDDEN_PATTERNS) {
        expect(responseText).not.toContain(forbidden);
      }
    }
  });

  it('get_blast_radius response contains no unmasked credentials', async () => {
    const handler = handleGetBlastRadius(storage, masking, undefined, join(tempDir, '.ctxo'));
    const symbols = storage.getAllSymbols();

    for (const sym of symbols) {
      const result = await handler({ symbolId: sym.symbolId });
      const responseText = result.content.map((c) => c.text).join(' ');

      for (const forbidden of FORBIDDEN_PATTERNS) {
        expect(responseText).not.toContain(forbidden);
      }
    }
  });

  it('get_architectural_overlay response contains no unmasked credentials', async () => {
    const handler = handleGetArchitecturalOverlay(storage, masking, undefined);
    const result = await handler({});
    const responseText = result.content.map((c) => c.text).join(' ');

    for (const forbidden of FORBIDDEN_PATTERNS) {
      expect(responseText).not.toContain(forbidden);
    }
  });

  it('masking pipeline redacts short patterns (AWS key, private IPs)', () => {
    const testInput = FORBIDDEN_PATTERNS.join(' | ');
    const masked = masking.mask(testInput);

    for (const forbidden of FORBIDDEN_PATTERNS) {
      expect(masked).not.toContain(forbidden);
    }
    expect(masked).toMatch(/\[REDACTED:/);
  });

  it('masking pipeline redacts full credential strings (JWT, env secrets, Azure)', () => {
    for (const credential of FULL_CREDENTIAL_PATTERNS) {
      const masked = masking.mask(credential);
      expect(masked).toContain('[REDACTED:');
      expect(masked).not.toBe(credential);
    }
  });
});
