import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'node20',
  external: [
    'tree-sitter',
    'tree-sitter-go',
    'tree-sitter-c-sharp',
    'graphology',
    'graphology-communities-louvain',
  ],
  banner: {
    js: '#!/usr/bin/env node',
  },
  // Build the static report template (pages/report-template.html) after the
  // main CLI bundle. The template inlines a minified IIFE of pages/report/*.ts
  // and is shipped via package.json files[] for runtime lookup.
  onSuccess: 'tsx scripts/build-report-template.ts',
});
