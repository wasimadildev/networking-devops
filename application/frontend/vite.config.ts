import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

/**
 * The dev server proxies /api to the backend rather than the frontend hard-coding
 * a host. Two reasons, and the second is the important one:
 *
 *  1. The browser only ever makes same-origin requests in development, so the
 *     CORS path is not exercised locally and a CORS bug ships unnoticed.
 *  2. VITE_API_URL stays a build-time variable. In production the SPA is served
 *     by Nginx, which proxies /api to the app tier, so the deployed bundle talks
 *     to its own origin and needs no configuration at all.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: process.env['VITE_DEV_API_TARGET'] ?? 'http://localhost:3000',
        changeOrigin: true,
      },
      '/health': {
        target: process.env['VITE_DEV_API_TARGET'] ?? 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
