function fileAndName(symbolId: string): string {
  const [file, name] = symbolId.split('::');
  return `${file}::${name}`;
}

/**
 * True if any transcript line records a get_blast_radius tool call whose
 * symbolId argument matches `symbolId` by file::name (kind-insensitive).
 */
export function transcriptHasBlastCheck(lines: readonly string[], symbolId: string): boolean {
  const target = fileAndName(symbolId);
  for (const line of lines) {
    if (!line.includes('get_blast_radius')) continue;
    let entry: unknown;
    try { entry = JSON.parse(line); } catch { continue; }
    const content = (entry as { message?: { content?: unknown[] } })?.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      const b = block as { type?: string; name?: string; input?: { symbolId?: string } };
      if (b?.type === 'tool_use' && typeof b.name === 'string' && b.name.includes('get_blast_radius')) {
        const id = b.input?.symbolId;
        if (typeof id === 'string' && fileAndName(id) === target) return true;
      }
    }
  }
  return false;
}
