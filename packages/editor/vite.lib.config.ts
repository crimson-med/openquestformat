import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

/**
 * The library build: `dist/lib/index.js` plus `dist/lib/styles.css`.
 *
 * React and every `@oqf/*` package are external, so a host app shares one React
 * and one copy of the canonical model. `@xyflow/react` and `@dagrejs/dagre` are
 * bundled, since they are the editor's own furniture and nothing else needs to
 * agree with it on them.
 *
 * Type declarations come from `tsc -p tsconfig.lib.json`, which resolves the
 * `@oqf/*` specifiers through node_modules to the sibling packages' `dist`, so
 * the emitted `.d.ts` files keep the bare specifiers a consumer can resolve.
 * That means the sibling packages must be built first, which `pnpm -r build`
 * does in topological order.
 */
const external = [
  'react',
  'react-dom',
  'react-dom/client',
  'react/jsx-runtime',
  'react/jsx-dev-runtime',
  '@oqf/core',
  '@oqf/dialogue',
  '@oqf/i18n',
  '@oqf/runtime',
]

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist/lib',
    emptyOutDir: true,
    sourcemap: true,
    lib: {
      entry: fileURLToPath(new URL('src/index.ts', import.meta.url)),
      formats: ['es'],
      fileName: () => 'index.js',
      cssFileName: 'styles',
    },
    rollupOptions: {
      external: (id) => external.includes(id) || id.startsWith('@oqf/'),
    },
  },
})
