import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { VersionsCheck } from '../checks/versions-check.js';
import type { CheckContext } from '../../../core/diagnostics/types.js';

function makeCtx(projectRoot: string): CheckContext {
  return { projectRoot, ctxoRoot: join(projectRoot, '.ctxo') };
}

describe('VersionsCheck', () => {
  const check = new VersionsCheck();

  it('has stable id and title', () => {
    expect(check.id).toBe('versions');
    expect(check.title).toBe('Versions');
  });

  it('reports pass when projectRoot has no plugins', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'ctxo-versions-'));
    try {
      const result = await check.run(makeCtx(tmp));
      // Passes because our own monorepo walk-up still finds plugins, or "no plugins" path.
      // Either way the check must not fail.
      expect(result.status).not.toBe('fail');
      expect(result.message).toContain('ctxo ');
      expect(result.message).toContain('API ');
      expect(result.value).toBeDefined();
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('includes verbose payload in the value field', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'ctxo-versions-'));
    try {
      const result = await check.run(makeCtx(tmp));
      expect(result.value).toContain('Plugin API:');
      expect(result.value).toContain('Runtime:');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
