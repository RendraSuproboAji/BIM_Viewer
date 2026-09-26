import basicSsl from '@vitejs/plugin-basic-ssl'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
// WebXR needs a secure context: `npm run dev:xr` (`vite --mode xr`) serves HTTPS
// (self-signed) on the LAN so a headset or phone can open the dev build.
export default defineConfig(({ mode }) => {
  const xrHttps = mode === 'xr'
  return {
    plugins: [react(), ...(xrHttps ? [basicSsl()] : [])],
    // The API server (server/) runs on :3001; `npm run dev` starts both.
    server: { proxy: { '/api': 'http://127.0.0.1:3001' }, ...(xrHttps ? { host: true } : {}) },
    preview: { proxy: { '/api': 'http://127.0.0.1:3001' } },
    resolve: {
      // One three.js for the app, R3F, the XR and UI libraries.
      dedupe: ['three'],
    },
    optimizeDeps: {
      // web-ifc ships its own WASM loader; pre-bundling breaks its file lookup.
      exclude: ['web-ifc'],
      // XR code is only imported lazily; pre-bundle it with everything else so the
      // dev server doesn't re-optimise (and duplicate three.js) on first use.
      include: ['@react-three/xr', '@react-three/uikit'],
    },
    build: {
      chunkSizeWarningLimit: 8000,
    },
  }
})
