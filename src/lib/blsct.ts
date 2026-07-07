/**
 * BLSCT WebAssembly bootstrap
 * ===========================
 *
 * navio-blsct ships two builds:
 *
 *  - a native Node addon (used by navio-sdk on the server / in tests), and
 *  - a WebAssembly build under `dist/browser/` + `wasm/` (what we use).
 *
 * The WASM build is not self-starting. It consists of:
 *
 *  - `wasm/blsct.js`  — the Emscripten "glue" script. It is a CLASSIC script
 *    (not an ES module), so we inject it with a <script> tag instead of
 *    importing it.
 *  - `wasm/blsct.wasm` — the compiled module. We fetch it ourselves and pass
 *    the bytes to `loadBlsctModule({ wasmBinary })`. Handing the binary over
 *    explicitly sidesteps the glue script's own URL-guessing, which breaks
 *    under a bundler because the .wasm ends up content-hashed in /assets.
 *
 * Vite's `?url` import suffix gives us the final hosted URL of each asset,
 * whatever the bundler renamed it to.
 *
 * Call `initBlsct()` exactly once, before the first `NavioClient` is
 * constructed. The SDK itself calls navio-blsct's `setChain(...)` when a
 * client is created, and that call requires the module to be loaded.
 */
// @ts-expect-error - Vite resolves ?url imports at build time
import blsctWasmUrl from 'navio-blsct/wasm/blsct.wasm?url';
// @ts-expect-error - Vite resolves ?url imports at build time
import blsctJsUrl from 'navio-blsct/wasm/blsct.js?url';

let loaded: Promise<void> | null = null;

function loadScript(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = url;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Failed to load script: ${url}`));
    document.head.appendChild(s);
  });
}

export function initBlsct(): Promise<void> {
  if (!loaded) {
    loaded = (async () => {
      await loadScript(blsctJsUrl);
      const wasmBinary = await fetch(blsctWasmUrl).then((r) => {
        if (!r.ok) throw new Error(`WASM fetch failed: HTTP ${r.status}`);
        return r.arrayBuffer();
      });
      // The published type declarations describe the Node build; the
      // browser entry (selected by the vite alias) additionally exports
      // the WASM loader, so we go through `any` for this one call.
      const { loadBlsctModule } = (await import('navio-blsct')) as any;
      await loadBlsctModule({ wasmBinary });
    })();
  }
  return loaded;
}
