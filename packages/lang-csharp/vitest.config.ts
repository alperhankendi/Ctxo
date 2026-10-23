import { configDefaults, defineConfig } from 'vitest/config';

const INTEGRATION = 'src/**/__tests__/**/*.integration.test.ts';

export default defineConfig({
  test: {
    globals: true,
    testTimeout: 30_000,
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['src/**/__tests__/**/*.test.ts'],
          exclude: [...configDefaults.exclude, INTEGRATION],
        },
      },
      {
        // The integration files all run the same ctxo-roslyn helper: build it
        // once, then run the files one at a time.
        extends: true,
        test: {
          name: 'dotnet',
          include: [INTEGRATION],
          globalSetup: ['src/__tests__/setup/build-roslyn-helper.ts'],
          fileParallelism: false,
        },
      },
    ],
  },
});
