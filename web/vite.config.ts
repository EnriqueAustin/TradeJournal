import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// API_PORT lets parallel worktrees QA against their own server without clashing on :4000.
const api = `http://localhost:${process.env.API_PORT || 4000}`;

export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.WEB_PORT) || 5173,
    proxy: {
      '/api': {
        target: api,
        changeOrigin: true,
      },
      '/screenshots': {
        target: api,
        changeOrigin: true,
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          charts: ['recharts', 'lightweight-charts'],
        },
      },
    },
  },
});
