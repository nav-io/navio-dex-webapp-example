/**
 * Application entry point
 * =======================
 *
 * Two things happen here, and the ORDER is load-bearing:
 *
 * 1. `globalThis.Buffer = Buffer` — navio-sdk and navio-blsct assume a
 *    Node-style global Buffer. This assignment must run before ANY module
 *    that touches the SDK is evaluated, which is why it sits at the very
 *    top of the entry file rather than inside a component.
 *
 * 2. `initBlsct()` — the BLSCT cryptography (range proofs, key derivation,
 *    transaction signing) is a WebAssembly module that must be fetched and
 *    instantiated before `NavioClient` can be constructed. We block the
 *    first render on it and show a plain loading screen meanwhile; every
 *    later import of `navio-blsct` then finds the module ready.
 *
 * Everything after that is ordinary React.
 */
import { Buffer } from 'buffer';
(globalThis as any).Buffer = Buffer;

import React from 'react';
import { createRoot } from 'react-dom/client';
import { initBlsct } from './lib/blsct';
import { App } from './App';
import './styles.css';

const root = createRoot(document.getElementById('root')!);

root.render(
  <div className="boot">
    <div className="boot-mark">◈</div>
    <p>Loading BLSCT cryptography…</p>
  </div>,
);

initBlsct()
  .then(() => {
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>,
    );
  })
  .catch((err) => {
    root.render(
      <div className="boot">
        <div className="boot-mark">◈</div>
        <p>Failed to load the cryptography module.</p>
        <pre>{String(err)}</pre>
      </div>,
    );
  });
