import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Single self-contained index.html (JS + CSS + worker inlined); the binary
// city data stays in dist/data/ and is fetched at runtime.
export default defineConfig({
  base: './',
  plugins: [viteSingleFile({ removeViteModuleLoader: true })],
  build: {
    target: 'es2022',
    assetsInlineLimit: 100000000,
    chunkSizeWarningLimit: 5000,
    reportCompressedSize: false,
  },
  worker: { format: 'es' },
  server: { host: true },
});
