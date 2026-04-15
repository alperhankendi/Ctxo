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
});
