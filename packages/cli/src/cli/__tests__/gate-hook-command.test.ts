import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GateHookCommand } from '../gate-hook-command.js';

/** Repo where A is called by B,C,D -> 3 confirmed dependents, highest PageRank. */
function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'ctxo-gh-'));
  const idxDir = join(root, '.ctxo', 'index', 'src');
  mkdirSync(idxDir, { recursive: true });
  writeFileSync(join(idxDir, 'a.ts.json'), JSON.stringify({
    file: 'src/a.ts', lastModified: 0,
    symbols: [{ symbolId: 'src/a.ts::A::function', name: 'A', kind: 'function', startLine: 1, endLine: 5 }],
    edges: [], intent: [], antiPatterns: [],
  }));
  for (const n of ['B', 'C', 'D']) {
    writeFileSync(join(idxDir, `${n.toLowerCase()}.ts.json`), JSON.stringify({
      file: `src/${n.toLowerCase()}.ts`, lastModified: 0,
      symbols: [{ symbolId: `src/${n.toLowerCase()}.ts::${n}::function`, name: n, kind: 'function', startLine: 1, endLine: 3 }],
      edges: [{ from: `src/${n.toLowerCase()}.ts::${n}::function`, to: 'src/a.ts::A::function', kind: 'calls' }],
      intent: [], antiPatterns: [],
    }));
  }
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src', 'a.ts'), 'export function A() {\n  return 1;\n}\n');
  return root;
}

describe('GateHookCommand.evaluate', () => {
  it('blocks an Edit to a high-impact symbol not yet checked', () => {
    const root = fixture();
    const res = new GateHookCommand(root).evaluate({
      session_id: 's1',
      transcript_path: join(root, 'nonexistent.jsonl'),
      tool_name: 'Edit',
      tool_input: { file_path: join(root, 'src', 'a.ts'), old_string: 'return 1;', new_string: 'return 2;' },
    });
    expect(res.block).toBe(true);
    expect(res.reason).toContain('high-impact');
    rmSync(root, { recursive: true, force: true });
  });

  it('does not block a non-Edit tool', () => {
    const root = fixture();
    const res = new GateHookCommand(root).evaluate({
      session_id: 's1', transcript_path: '', tool_name: 'Read', tool_input: { file_path: 'x' },
    });
    expect(res.block).toBe(false);
    rmSync(root, { recursive: true, force: true });
  });

  it('fails open when the edited file is not indexed', () => {
    const root = fixture();
    const res = new GateHookCommand(root).evaluate({
      session_id: 's1', transcript_path: '', tool_name: 'Edit',
      tool_input: { file_path: join(root, 'src', 'unknown.ts'), old_string: 'x', new_string: 'y' },
    });
    expect(res.block).toBe(false);
    rmSync(root, { recursive: true, force: true });
  });

  it('passes silently on the second edit of the same symbol (block once)', () => {
    const root = fixture();
    const cmd = new GateHookCommand(root);
    const payload = {
      session_id: 's1', transcript_path: join(root, 'none.jsonl'), tool_name: 'Edit',
      tool_input: { file_path: join(root, 'src', 'a.ts'), old_string: 'return 1;', new_string: 'return 2;' },
    };
    expect(cmd.evaluate(payload).block).toBe(true);
    expect(cmd.evaluate(payload).block).toBe(false);
    rmSync(root, { recursive: true, force: true });
  });

  it('respects gate.enabled:false in config', () => {
    const root = fixture();
    writeFileSync(join(root, '.ctxo', 'config.yaml'), 'version: "1.0"\ngate:\n  enabled: false\n');
    const res = new GateHookCommand(root).evaluate({
      session_id: 's1', transcript_path: '', tool_name: 'Edit',
      tool_input: { file_path: join(root, 'src', 'a.ts'), old_string: 'return 1;', new_string: 'return 2;' },
    });
    expect(res.block).toBe(false);
    rmSync(root, { recursive: true, force: true });
  });
});
