import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SYMBOL_KINDS, EDGE_KINDS } from '@ctxo/plugin-api';

const here = dirname(fileURLToPath(import.meta.url));
// src/cli/__tests__ -> packages/cli
const cliRoot = resolve(here, '..', '..', '..');
const template = readFileSync(resolve(cliRoot, 'pages', 'visualize-template.html'), 'utf-8');
// The standalone visualizer lives at the repository root, not under packages/cli.
const visualizer = readFileSync(resolve(cliRoot, '..', '..', 'pages', 'ctxo-visualizer.html'), 'utf-8');

/** The text from `marker` up to the closing `};` of the object literal that it opens. */
function block(source: string, marker: string): string {
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`marker not found: ${marker}`);
  const end = source.indexOf('};', start);
  if (end < 0) throw new Error(`no closing brace after: ${marker}`);
  return source.slice(start, end + 2);
}

/** The text from `marker` up to the first closing bracket that follows it. */
function list(source: string, marker: string): string {
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`marker not found: ${marker}`);
  const end = source.indexOf(']', start);
  if (end < 0) throw new Error(`no closing bracket after: ${marker}`);
  return source.slice(start, end + 1);
}

describe('visualizer kind lists', () => {
  it('every edge kind has an EDGE_COLORS entry and a legend row in the template', () => {
    const colors = block(template, 'var EDGE_COLORS = {');
    const legend = list(template, 'var edgeKinds = [');
    for (const kind of EDGE_KINDS) {
      expect(colors, `EDGE_COLORS ${kind}`).toMatch(new RegExp(`\\b${kind}:\\s*\\{`));
      expect(legend, `legend ${kind}`).toContain(`name: '${kind}'`);
    }
    // writes must not reuse #E15759: that is the high-severity violation red.
    expect(colors).toMatch(/reads:\s*\{ color: '#76B7B2'/);
    expect(colors).toMatch(/writes:\s*\{ color: '#9C755F'/);
    expect(colors).toMatch(/executes:\s*\{ color: '#EDC948'/);
  });

  it('every edge kind has an EDGE_STYLES entry and every symbol kind a KIND_COLORS entry in the visualizer', () => {
    const edgeStyles = block(visualizer, 'const EDGE_STYLES = {');
    const kindColors = block(visualizer, 'const KIND_COLORS = {');
    for (const kind of EDGE_KINDS) {
      expect(edgeStyles, `EDGE_STYLES ${kind}`).toMatch(new RegExp(`\\b${kind}:\\s*\\{`));
    }
    for (const kind of SYMBOL_KINDS) {
      expect(kindColors, `KIND_COLORS ${kind}`).toMatch(new RegExp(`\\b${kind}:\\s*'#`));
    }
  });

  it('the visualizer loads every symbol kind through search_symbols', () => {
    const loader = list(visualizer, "for (const kind of ['class'");
    for (const kind of SYMBOL_KINDS) {
      expect(loader, `loader ${kind}`).toContain(`'${kind}'`);
    }
  });
});
