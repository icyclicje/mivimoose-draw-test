import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// One .env at the repo root feeds both the server and the client, so there is
// a single place to paste your Discord credentials.
const ENV_DIR = path.resolve(__dirname, '..');

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ENV_DIR, '');
  const server = env.VITE_SERVER_URL || 'http://localhost:3001';

  return {
    envDir: ENV_DIR,
    plugins: [react()],
    server: {
      port: 3000,
      // Discord serves the Activity from <app-id>.discordsays.com and proxies
      // everything under /.proxy to your server. Mirroring that path locally
      // means the same client build works in both places.
      proxy: {
        '/.proxy/api': { target: server, changeOrigin: true, rewrite: (p) => p.replace(/^\/\.proxy/, '') },
        '/.proxy/socket.io': { target: server, changeOrigin: true, ws: true, rewrite: (p) => p.replace(/^\/\.proxy/, '') },
        '/api': { target: server, changeOrigin: true },
        '/socket.io': { target: server, changeOrigin: true, ws: true },
      },
      hmr: { clientPort: 3000 },
      // Required so the dev server is reachable through a tunnel.
      allowedHosts: true,
    },
    build: {
      outDir: 'dist',
      sourcemap: true,
      rollupOptions: {
        output: {
          manualChunks: {
            vendor: ['react', 'react-dom', 'zustand'],
            motion: ['framer-motion'],
            net: ['socket.io-client', '@discord/embedded-app-sdk'],
          },
        },
      },
    },
  };
});
