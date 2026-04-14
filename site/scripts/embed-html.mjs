// Embed a pages/*.html file as a VitePress md page (layout: false)
// Usage: node scripts/embed-html.mjs <source.html> <dest.md> <title>

import { readFile, writeFile } from 'node:fs/promises';
import { argv } from 'node:process';

const [src, dest, title] = argv.slice(2);
if (!src || !dest || !title) {
  console.error('usage: embed-html.mjs <src.html> <dest.md> <title>');
  process.exit(1);
}

const html = await readFile(src, 'utf8');

// Extract <style>...</style> and <body>...</body>
const styleMatch = html.match(/<style[^>]*>([\s\S]*?)<\/style>/);
const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/);
if (!styleMatch || !bodyMatch) {
  console.error('could not locate <style> and <body> in', src);
  process.exit(1);
}

const style = styleMatch[1];
let body = bodyMatch[1];

// Rewrite relative links to absolute (deployed at /Ctxo/)
body = body
  .replace(/href="index\.html"/g, 'href="/Ctxo/"')
  .replace(/href="ctxo-visualizer\.html"/g, 'href="/Ctxo/ctxo-visualizer.html"')
  .replace(
    /href="blast-radius-comparison\.html"/g,
    'href="/Ctxo/docs/comparisons/blast-radius"'
  )
  .replace(
    /href="dead-code-comparison\.html"/g,
    'href="/Ctxo/docs/comparisons/dead-code"'
  )
  .replace(/href="docs\/"/g, 'href="/Ctxo/docs/"');

// Strip blank lines from body so md parser sees one HTML block
body = body
  .split('\n')
  .filter((line) => line.trim().length > 0)
  .join('\n');

const md = `---
layout: false
title: ${title.replace(/"/g, '\\"')}
---

<style>
${style.trim()}
</style>

${body.trim()}
`;

await writeFile(dest, md, 'utf8');
console.log(`[embed-html] ${src} -> ${dest}`);
