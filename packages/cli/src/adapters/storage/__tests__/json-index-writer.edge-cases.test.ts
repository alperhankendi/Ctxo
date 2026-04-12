import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JsonIndexWriter } from '../json-index-writer.js';
import { buildFileIndex } from './test-fixtures.js';

describe('JsonIndexWriter — path traversal protection', () => {
  let tempDir: string;
  let writer: JsonIndexWriter;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'ctxo-path-'));
    writer = new JsonIndexWriter(tempDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('throws on path traversal via ../', () => {
    const fileIndex = buildFileIndex({ file: '../../etc/passwd' });
    expect(() => writer.write(fileIndex)).toThrow('Path traversal detected');
  });

  it('throws on path traversal via delete', () => {
    expect(() => writer.delete('../../etc/passwd')).toThrow('Path traversal detected');
  });

  it('allows normal nested paths', () => {
    const fileIndex = buildFileIndex({ file: 'src/deep/nested/file.ts' });
    expect(() => writer.write(fileIndex)).not.toThrow();
  });
});
