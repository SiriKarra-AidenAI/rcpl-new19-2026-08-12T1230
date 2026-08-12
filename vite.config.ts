import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// /api, /auth, and /session all forward to the Python backend (backend/, uvicorn),
// which holds the API key/IMAP/SMTP secrets server-side. If it isn't running, the
// frontend falls back to regex extraction. All server-side "memory" (intake, auth,
// session storage) lives in this one backend.
//
// The target is configurable so the SAME build works in dev and when deployed:
//   • dev  (`vite`)         → defaults to the local uvicorn on :8090
//   • prod (`vite preview`) → the deploy pipeline injects VITE_BACKEND_ORIGIN=
//                             http://localhost:<backendPort> (the port the backend
//                             was just deployed to on the same host), so /api etc.
//                             proxy to the real backend instead of 404ing.
// Read from the Node env at config-eval time, so systemd's Environment= on the
// deploy unit is enough — no source edit per deploy. Accessed via globalThis so
// it type-checks under `tsc -b` even without @types/node (this config runs in
// Node at build/preview time, where process exists).
const nodeEnv = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
const backendOrigin = nodeEnv?.VITE_BACKEND_ORIGIN || 'http://localhost:8090'
const proxy = {
  '/api':     backendOrigin,
  '/auth':    backendOrigin,
  '/session': backendOrigin,
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3002,
    // Never silently switch ports: localStorage (created leads, shortlist) is per-origin,
    // so a port bump would make persisted data "disappear". Fail loudly instead.
    strictPort: true,
    open: false,
    proxy,
  },
  // `vite preview` (what the deploy pipeline runs: `npm run build && npm run preview`)
  // does NOT read server.proxy — it has its own. Without this block, a deployed build's
  // /api, /auth, /session calls hit the frontend's own origin (nothing there) and fail;
  // the app then silently degrades to client-side regex/localStorage only. Mirror the
  // dev proxy so the deployed frontend reaches the deployed backend.
  preview: {
    proxy,
  },
})
