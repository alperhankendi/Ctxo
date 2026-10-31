import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['src/**/__tests__/**/*.test.ts'],
    // ts-morph tests that load a sample project take over the 5 s default on a busy CI runner.
    testTimeout: 30_000,
  },
});
