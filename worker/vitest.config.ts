import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    // exFAT external drive sprays AppleDouble `._*` twins — never treat as tests.
    exclude: ['**/node_modules/**', '**/._*'],
    testTimeout: 20000,
    hookTimeout: 20000,
    // One emulator/dataset shared across files — run sequentially.
    fileParallelism: false,
  },
})
