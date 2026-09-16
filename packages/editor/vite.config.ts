import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

/**
 * The dev server and the static site build.
 *
 * Both alias the sibling packages to their `src`, so the editor runs and builds
 * without a prior `pnpm -r build`. The library build does the opposite: see
 * `vite.lib.config.ts`, which externalizes the same packages so a host app ends
 * up with one copy of the model.
 *
 * The site build uses a relative base so `dist/app` can be served from any path
 * on a plain static server.
 */
export default defineConfig(({ command }) => ({
  base: command === 'build' ? './' : '/',
  plugins: [react()],
  resolve: {
    alias: {
      '@oqf/core': fileURLToPath(new URL('../core/src/index.ts', import.meta.url)),
      '@oqf/dialogue': fileURLToPath(new URL('../dialogue/src/index.ts', import.meta.url)),
      '@oqf/i18n': fileURLToPath(new URL('../i18n/src/index.ts', import.meta.url)),
      '@oqf/runtime': fileURLToPath(new URL('../runtime/src/index.ts', import.meta.url)),
    },
  },
  build: {
    outDir: 'dist/app',
    emptyOutDir: true,
  },
  server: {
    fs: {
      allow: ['../..'],
    },
  },
}))
