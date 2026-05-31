import { describe, it, expect } from 'vitest';
import { transcriptHasBlastCheck } from '../transcript-scan.js';

const lines = [
  JSON.stringify({ type: 'assistant', message: { content: [
    { type: 'tool_use', name: 'mcp__ctxo__get_blast_radius', input: { symbolId: 'src/foo.ts::foo::function' } },
  ] } }),
];

describe('transcriptHasBlastCheck', () => {
  it('matches an exact symbolId', () => {
    expect(transcriptHasBlastCheck(lines, 'src/foo.ts::foo::function')).toBe(true);
  });
  it('matches by file::name even if kind differs', () => {
    expect(transcriptHasBlastCheck(lines, 'src/foo.ts::foo::method')).toBe(true);
  });
  it('does not match a different symbol', () => {
    expect(transcriptHasBlastCheck(lines, 'src/bar.ts::bar::function')).toBe(false);
  });
});
