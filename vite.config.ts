import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import packageJson from './package.json';

export default defineConfig({
  base: './',
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version)
  },
  build: {
    outDir: 'dist-renderer',
    emptyOutDir: true
  },
  server: {
    host: '127.0.0.1',
    port: 1420,
    strictPort: true
  }
});
