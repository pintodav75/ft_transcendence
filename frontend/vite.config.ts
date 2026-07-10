import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
// tanstackRouter is the auto generation of the routeTree.gen.ts

// https://vite.dev/config/
export default defineConfig({
  plugins: [tanstackRouter({ target: 'react', autoCodeSplitting: true }), react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // this makes imports like @/components/ui/button work instead of ../../components/ui/button.
    },
  },
  server: {
    host: true,
    port: 5173,
    watch: {
      usePolling: true,
      // idk alternative way of hot reload that works on Windows too
    },
  },
});
