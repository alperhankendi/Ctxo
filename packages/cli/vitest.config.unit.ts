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
      // Calibrated against @vitest/coverage-v8 5.x. The v8 provider changed how
      // it maps ranges to branches between 3.x and 5.x, so the denominators
      // moved even though no source or test changed: src/core went from
      // 1163/1300 branches (89.46%) to 1031/1198 (86.06%). Files at 100% under
      // 3.x report ~90% under 5.x (e.g. masking-pipeline 12/12 -> 5/5,
      // cluster-label-masker 21/21 -> 9/10), so the drop is measurement, not
      // lost coverage. Branches sits at 85 to keep roughly the same slack the
      // old 88 gave; the other three stay where actual numbers comfortably
      // clear them. Raise these when real coverage improves.
      thresholds: {
        'src/core/**': {
          statements: 92,
          branches: 85,
          functions: 92,
          lines: 92,
        },
      },
    },
  },
});
