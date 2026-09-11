import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

// Read package.json with require, NOT `import`. An `import` here would register
// package.json as a Vite *config dependency*, so every `npm install` — which the
// launcher runs on startup — would touch it and restart a live dev server
// mid-session. require() is invisible to that dependency tracking.
const requireJson = createRequire(import.meta.url)
const packageJson = requireJson('./package.json') as { version: string }

// Absolute, forward-slashed glob for a folder directly under the project root.
// The watcher matches absolute paths, so root-anchored globs are the only way
// to ignore `<root>/data` without also ignoring `src/data`.
const projectRoot = fileURLToPath(new URL('.', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '')
const rootGlob = (dir: string) => `${projectRoot}/${dir}/**`

// The API binds 127.0.0.1 (IPv4 only). Targeting "localhost" instead would
// resolve to ::1 first on most Windows boxes, leaving the proxy to limp along on
// Node's happy-eyeballs fallback. Address it directly.
const API_TARGET = 'http://127.0.0.1:3001'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version),
  },
  // Use relative asset paths so index.html works when loaded via Electron's
  // loadFile() (file:// protocol). Without this, Vite emits /assets/... which
  // resolves to the filesystem root, not the dist folder.
  base: './',
  server: {
    host: process.env.HOST || '127.0.0.1',
    // Pinned, not merely preferred. On a drift to 5174 the API's CORS allowlist
    // (server.js) no longer matches the origin, so every request fails while both
    // processes still look healthy. Failing to start is far easier to diagnose.
    port: 5173,
    strictPort: true,
    // Non-app folders live inside the project root (planning docs, campaign
    // JSON the server writes at runtime, tool output). Editing anything in
    // them would otherwise trigger a full page reload mid-session. Anchored to
    // the project root so nested app folders (e.g. src/data) still hot-reload.
    watch: {
      ignored: [
        rootGlob('Upgrade'),
        rootGlob('TRASH'),
        rootGlob('graphify-out'),
        rootGlob('data'),
        rootGlob('playwright-report'),
        rootGlob('.claude'),
        // World/lore content, routinely edited *during* a session.
        rootGlob('Custom_Setup'),
        rootGlob('Example_Setup'),
      ],
    },
    proxy: {
      '/api': {
        target: API_TARGET,
        changeOrigin: true,
      },
      // Scoped to exactly the two mounts Express serves. A blanket '/assets'
      // rule also swallowed /assets/tilesets, /assets/textures and /assets/props,
      // which live in public/ and are Vite's to serve — the proxy middleware runs
      // before the public-dir middleware, so those 404'd in dev only.
      '/assets/portraits': {
        target: API_TARGET,
        changeOrigin: true,
      },
      '/assets/campaigns': {
        target: API_TARGET,
        changeOrigin: true,
      },
    },
  },
})
