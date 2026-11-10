import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: { target: 'es2022', chunkSizeWarningLimit: 900 },
  server: { port: 5173 },
});
