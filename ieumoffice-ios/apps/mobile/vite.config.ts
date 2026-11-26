import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'

export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  base: './',
  // AllEditor: no rhwp-studio copy (dist/studio, 45 MB) — 한글 runs inside the office suite (office/hwp/studio)
  plugins: [react()],
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
    target: 'es2022',
  },
  server: {
    port: 5185,
    strictPort: true,
  },
})
