import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    // The first test in each worker pays one-time module init (language plugins
    // + sql.js WASM): 6-11s on a cold CI runner vs ~0.8s warm. The 5s default
    // flaked on Node 22 (PR #122) and Node 20. Matches the e2e config budget.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    include: ['src/**/__tests__/**/*.test.ts'],
    reporters: ['default', 'junit'],
    outputFile: {
      junit: 'test-results/junit-unit.xml',
    },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/__tests__/**', 'src/index.ts'],
      reporter: ['text', 'text-summary', 'json-summary', 'html'],
      thresholds: {
        'src/core/**': {
          statements: 88,
          branches: 88,
          functions: 90,
          lines: 88,
        },
      },
    },
  },
});
