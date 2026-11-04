import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { '/api': { target: process.env.AGENTVIEW_API ?? 'http://127.0.0.1:8787', rewrite: (p) => p.replace(/^\/api/, '') } },
  },
});
