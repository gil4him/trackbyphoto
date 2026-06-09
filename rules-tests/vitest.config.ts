import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    testTimeout: 15000,
    hookTimeout: 15000,
    // Rules tests share a single emulator instance, so sequential execution
    // avoids cross-test data races on the dataset between cleanups.
    fileParallelism: false,
  },
})
