import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@oqf/core': fileURLToPath(new URL('packages/core/src/index.ts', import.meta.url)),
      '@oqf/dialogue': fileURLToPath(new URL('packages/dialogue/src/index.ts', import.meta.url)),
      '@oqf/i18n': fileURLToPath(new URL('packages/i18n/src/index.ts', import.meta.url)),
      '@oqf/runtime': fileURLToPath(new URL('packages/runtime/src/index.ts', import.meta.url)),
    },
  },
  test: {
    include: ['packages/*/src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts'],
      exclude: ['**/*.test.ts', 'packages/cli/src/index.ts'],
    },
  },
})
