import { defineConfig } from 'vite'

// base './' makes the build work from any sub-path, e.g. GitHub Pages at /<repo>/
export default defineConfig({
  base: './',
  server: { port: 5179, strictPort: true, open: false },
  build: { target: 'es2022', chunkSizeWarningLimit: 4000 },
})
