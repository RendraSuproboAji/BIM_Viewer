import basicSsl from '@vitejs/plugin-basic-ssl'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'

/**
 * Production builds never enable the WebXR emulator, but @pmndrs/xr imports it
 * lazily, which would still ship ~5 MB of emulator code and room scans in dist/.
 */
const noXREmulator = (): Plugin => ({
  name: 'no-xr-emulator',
  apply: 'build',
  enforce: 'pre',
  resolveId(source, importer) {
    if (source === './emulate.js' && importer && /@pmndrs[\\/]xr[\\/]/.test(importer)) return '\0no-xr-emulator'
  },
  load(id) {
    if (id === '\0no-xr-emulator') return 'export function emulate() { throw new Error("The XR emulator is only included in development builds") }'
  },
})

/**
 * @thatopen/fragments falls back to `new URL("./Worker/worker.mjs", import.meta.url)`
 * when no worker URL is given, which makes the build emit the unminified 3.3 MB
 * worker even though the engine always passes the minified one (see the alias below).
 */
const minifiedFragmentsWorker = (): Plugin => ({
  name: 'minified-fragments-worker',
  apply: 'build',
  transform(code, id) {
    if (!/@thatopen[\\/]fragments[\\/]dist[\\/]index\.mjs$/.test(id)) return
    return { code: code.replaceAll('"./Worker/worker.mjs"', '"./Worker/worker.min.mjs"'), map: null }
  },
})

// https://vite.dev/config/
// WebXR needs a secure context: `npm run dev:xr` (`vite --mode xr`) serves HTTPS
// (self-signed) on the LAN so a headset or phone can open the dev build.
export default defineConfig(({ mode, command }) => {
  const xrHttps = mode === 'xr'
  return {
    plugins: [react(), noXREmulator(), minifiedFragmentsWorker(), ...(xrHttps ? [basicSsl()] : [])],
    // The API server (server/) runs on :3001; `npm run dev` starts both.
    server: { proxy: { '/api': 'http://127.0.0.1:3001' }, ...(xrHttps ? { host: true } : {}) },
    preview: { proxy: { '/api': 'http://127.0.0.1:3001' } },
    resolve: {
      // One three.js for the app, R3F, the XR and UI libraries.
      dedupe: ['three'],
      // The fragments worker loads on startup: production uses the package's minified
      // build (1.4 MB instead of 3.3 MB), which its exports map doesn't expose. (Dev keeps
      // the package path, which the dev server serves as a plain asset URL.)
      alias:
        command === 'build'
          ? [
              {
                find: /^@thatopen\/fragments\/worker(?=\?|$)/,
                replacement: fileURLToPath(new URL('./node_modules/@thatopen/fragments/dist/Worker/worker.min.mjs', import.meta.url)),
              },
            ]
          : [],
    },
    optimizeDeps: {
      // web-ifc ships its own WASM loader; pre-bundling breaks its file lookup.
      exclude: ['web-ifc'],
      // XR code is only imported lazily; pre-bundle it with everything else so the
      // dev server doesn't re-optimise (and duplicate three.js) on first use.
      include: ['@react-three/xr', '@react-three/uikit'],
    },
    // The IFC conversion worker is bundled separately and imports fragments too.
    worker: { plugins: () => [minifiedFragmentsWorker()] },
    build: {
      chunkSizeWarningLimit: 8000,
      rolldownOptions: {
        output: {
          // Libraries in their own long-cached chunks, so an app update doesn't make
          // returning users download three.js, React and fragments again.
          advancedChunks: {
            groups: [
              { name: 'react', test: /[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
              { name: 'three', test: /[\\/]node_modules[\\/]three[\\/]build[\\/]/ },
              { name: 'fragments', test: /[\\/]node_modules[\\/]@thatopen[\\/]fragments[\\/]/ },
            ],
          },
        },
      },
    },
  }
})
