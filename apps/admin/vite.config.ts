import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    open: !process.env.CI && !process.env.NO_OPEN,
    proxy: {
      '/api': 'http://localhost:3000',
      '/files': 'http://localhost:3000',
      '/sale': { target: 'http://localhost:5174', ws: true },
    },
  },
});
