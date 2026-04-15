// Build script: bundles pages/report/*.ts into a single IIFE and emits
// pages/report-template.html with the bundle inlined alongside the
// data placeholder. Run by tsup onSuccess.

import { build } from 'esbuild';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pagesDir = resolve(__dirname, '..', 'pages');
const entry = join(pagesDir, 'report', 'shell.ts');
const templatePath = join(pagesDir, 'report-template.html');

const CSS = /* css */ `
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
:root {
  --bg: #0f0f1a;
  --bg-panel: #161627;
  --bg-panel-2: #1d1d33;
  --border: #2a2a4e;
  --border-strong: #3a3a66;
  --text: #eaeaf2;
  --text-muted: #9a9ab8;
  --text-dim: #6b6b88;
  --accent: #7a7aff;
  --accent-soft: rgba(122, 122, 255, 0.15);
  --ok: #6ee7b7;
  --warn: #fbbf24;
  --bad: #f87171;
  --shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
}
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, sans-serif;
  background: var(--bg);
  color: var(--text);
  min-height: 100vh;
  -webkit-font-smoothing: antialiased;
}
.app {
  max-width: 1280px;
  margin: 0 auto;
  padding: 32px 40px 80px;
}
.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
}
.brand {
  display: flex;
  align-items: baseline;
  gap: 12px;
}
.brand-name {
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--accent);
}
.brand-title {
  font-size: 15px;
  color: var(--text-muted);
}
.tabbar {
  display: flex;
  gap: 4px;
  padding: 4px;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 12px;
  margin-bottom: 24px;
  overflow-x: auto;
}
.tab {
  appearance: none;
  background: transparent;
  color: var(--text-muted);
  border: 0;
  padding: 10px 18px;
  font: inherit;
  font-size: 13px;
  font-weight: 500;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
  white-space: nowrap;
}
.tab:hover { color: var(--text); }
.tab.active {
  background: var(--accent-soft);
  color: var(--text);
}
.overview-header { margin-bottom: 24px; }
.overview-header h1 {
  font-size: 28px;
  font-weight: 700;
  letter-spacing: -0.01em;
  margin-bottom: 8px;
}
.overview-sub { display: flex; gap: 8px; flex-wrap: wrap; }
.chip {
  display: inline-flex;
  align-items: center;
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 12px;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  color: var(--text-muted);
}
.chip-muted { color: var(--text-dim); }
.kpi-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
  margin-bottom: 28px;
}
@media (max-width: 960px) {
  .kpi-grid { grid-template-columns: repeat(2, 1fr); }
}
.kpi-card {
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 18px 20px;
  position: relative;
  box-shadow: var(--shadow);
}
.kpi-label {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--text-muted);
  margin-bottom: 10px;
}
.kpi-value {
  font-size: 32px;
  font-weight: 700;
  letter-spacing: -0.01em;
  line-height: 1;
  margin-bottom: 8px;
}
.kpi-meta {
  font-size: 12px;
  color: var(--text-muted);
}
.kpi-sparkline {
  position: absolute;
  right: 18px;
  top: 18px;
  opacity: 0.7;
}
.kpi-ok .kpi-value { color: var(--ok); }
.kpi-warn .kpi-value { color: var(--warn); }
.kpi-bad .kpi-value { color: var(--bad); }
.kpi-muted .kpi-value { color: var(--text-muted); }
.panel {
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 20px 24px;
  margin-bottom: 20px;
}
.panel-header {
  display: flex;
  align-items: baseline;
  gap: 12px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}
.panel-header h2 {
  font-size: 16px;
  font-weight: 600;
}
.panel-sub {
  font-size: 12px;
  color: var(--text-muted);
}
.empty {
  font-size: 13px;
  color: var(--text-muted);
  padding: 12px 0;
}
.empty-state {
  padding: 80px 20px;
  text-align: center;
  color: var(--text-muted);
}
.empty-state h2 { font-size: 20px; margin-bottom: 8px; color: var(--text); }
.empty-state code {
  background: var(--bg-panel);
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 13px;
  color: var(--accent);
}
.godnode-list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.godnode-list li {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 14px;
  background: var(--bg-panel-2);
  border: 1px solid var(--border);
  border-radius: 8px;
}
.godnode-name {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  color: var(--text);
}
.godnode-meta {
  font-size: 12px;
  color: var(--text-muted);
}
.hints {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 24px;
}
.hint {
  padding: 12px 16px;
  border-left: 3px solid var(--accent);
  background: var(--accent-soft);
  border-radius: 4px;
  font-size: 13px;
  color: var(--text);
}
`;

async function main(): Promise<void> {
  console.error('[report-template] Bundling pages/report/shell.ts ...');
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    format: 'iife',
    target: 'es2020',
    write: false,
    minify: true,
    legalComments: 'none',
    platform: 'browser',
    treeShaking: true,
    logLevel: 'warning',
  });

  const outputFile = result.outputFiles[0];
  if (!outputFile) {
    throw new Error('esbuild produced no output for report bundle');
  }
  const bundle = outputFile.text;
  console.error(`[report-template] Bundle size: ${(bundle.length / 1024).toFixed(1)} KB`);

  const html = buildHtml(bundle);
  mkdirSync(dirname(templatePath), { recursive: true });
  writeFileSync(templatePath, html, 'utf-8');
  console.error(`[report-template] Wrote ${templatePath} (${(html.length / 1024).toFixed(1)} KB)`);
}

function buildHtml(bundle: string): string {
  // Neutralize </script> inside the bundle to guard against payload bleed.
  const safeBundle = bundle.replace(/<\/script/gi, '<\\/script');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="generator" content="Ctxo report" />
<title>Ctxo Report</title>
<style>${CSS}</style>
</head>
<body>
<div class="app">
  <div class="topbar">
    <div class="brand">
      <span class="brand-name">Ctxo</span>
      <span class="brand-title" data-title>Architectural Report</span>
    </div>
  </div>
  <nav class="tabbar" data-tabs role="tablist"></nav>
  <main data-content></main>
</div>
<script>window.CTXO_REPORT_DATA = /*__CTXO_REPORT_DATA__*/null;</script>
<script>${safeBundle}</script>
</body>
</html>
`;
}

main().catch((err) => {
  console.error('[report-template] build failed:', err);
  process.exit(1);
});
