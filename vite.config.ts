/**
 * Vite configuration
 * ==================
 *
 * navio-sdk and navio-blsct need a little help to run in a browser. This
 * config is the distilled version of what the navio-sdk `examples/web-wallet`
 * does, and every line exists for a reason:
 *
 * - `navio-blsct` alias → the package's browser entry. The package's `main`
 *   points at the Node build (a native .node addon); browsers must use the
 *   WebAssembly build under `dist/browser/`. Vite resolves the `browser`
 *   export condition in many cases, but the explicit alias makes the choice
 *   deterministic for both dev and build.
 *
 * - `optimizeDeps.exclude` for the two navio packages: Vite's dependency
 *   pre-bundling (esbuild) would eagerly follow the Node-only code paths and
 *   choke on `.node`/`fs` references. Excluding them keeps the packages as
 *   plain ESM resolved at runtime.
 *
 * - `build.target: 'esnext'`: the WASM loader uses top-level await and
 *   BigInt, which older targets refuse to emit.
 *
 * - `define: {'process.env': {}}`: some transitive code probes process.env;
 *   an empty object is enough. Buffer is polyfilled in src/main.tsx (it must
 *   be a *global* before any SDK import, which a bundler define can't do).
 *
 * - `assetsInclude: ['**\/*.wasm']`: lets `?url` imports of the blsct wasm
 *   binary work so we can fetch it ourselves and hand the bytes to the
 *   loader (see src/lib/blsct.ts).
 *
 * Note there are NO cross-origin-isolation headers here: the blsct WASM
 * build is single-threaded, so SharedArrayBuffer is not needed.
 */
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const resolve = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      // Order matters: the subpath alias must come before the bare package
      // alias, or `navio-blsct/wasm/...` imports would be rewritten wrongly.
      { find: /^navio-blsct\/wasm/, replacement: resolve('./node_modules/navio-blsct/wasm') },
      { find: /^navio-blsct$/, replacement: resolve('./node_modules/navio-blsct/dist/browser/index.browser.js') },
    ],
  },
  optimizeDeps: {
    include: ['buffer', 'react', 'react-dom'],
    exclude: ['navio-sdk', 'navio-blsct'],
  },
  build: {
    target: 'esnext',
  },
  define: {
    'process.env': {},
  },
  assetsInclude: ['**/*.wasm'],
});
