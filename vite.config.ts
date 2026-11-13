import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import { editorPlugin } from './scripts/editor-plugin.ts'

export default defineConfig({
  base: './',
  plugins: [editorPlugin()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    // three.js is a known large dependency and is already split into its own
    // cacheable chunk, so the default 500 kB warning is not useful here.
    chunkSizeWarningLimit: 700,
    rolldownOptions: {
      output: {
        advancedChunks: {
          groups: [{ name: 'three', test: /node_modules[\\/]three/ }],
        },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
})
