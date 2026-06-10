import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    // This repo lives on an exFAT external drive where macOS sprays AppleDouble
    // `._*` resource-fork twins next to edited files. Without this, vitest tries
    // to transform `._rules.test.ts` as a suite and the run fails spuriously.
    exclude: ['**/node_modules/**', '**/._*'],
    testTimeout: 15000,
    hookTimeout: 15000,
    // Rules tests share a single emulator instance, so sequential execution
    // avoids cross-test data races on the dataset between cleanups.
    fileParallelism: false,
  },
})
