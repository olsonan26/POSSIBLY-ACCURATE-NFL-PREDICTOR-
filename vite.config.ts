import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  define: {
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    __GIT_COMMIT__: JSON.stringify(process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA || 'local'),
    __DEPLOY_ENV__: JSON.stringify(process.env.VERCEL_ENV || process.env.NODE_ENV || 'local')
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./', import.meta.url)),
      './services/validatedPredictionService': fileURLToPath(new URL('./services/uiPredictionService.ts', import.meta.url))
    },
  },
  server: {
    host: '0.0.0.0',
    port: 3000,
  },
});
