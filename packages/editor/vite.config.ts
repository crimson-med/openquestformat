import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@oqf/core': fileURLToPath(new URL('../core/src/index.ts', import.meta.url)),
      '@oqf/dialogue': fileURLToPath(new URL('../dialogue/src/index.ts', import.meta.url)),
    },
  },
  server: {
    fs: {
      allow: ['../..'],
    },
  },
})
