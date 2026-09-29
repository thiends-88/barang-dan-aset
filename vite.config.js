import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { getBuildInfo } from './scripts/build-info.mjs';

// Info versi dihitung sekali per proses build/dev (commit, waktu build WIB, dll.)
const buildInfo = getBuildInfo();

/** Tulis dist/build-info.json agar server bisa melaporkan versi frontend yang tersaji. */
function buildInfoPlugin() {
  return {
    name: 'sim-aset-build-info',
    apply: 'build',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'build-info.json',
        source: JSON.stringify(buildInfo, null, 2) + '\n'
      });
    }
  };
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), buildInfoPlugin()],
  define: {
    // Dipakai VersionBadge untuk membandingkan versi di browser vs di server
    __APP_BUILD__: JSON.stringify(buildInfo)
  },
  server: {
    host: '0.0.0.0',
    port: 3000,
    allowedHosts: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
      }
    }
  }
});
