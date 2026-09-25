import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    // web-ifc ships its own WASM loader; pre-bundling breaks its file lookup.
    exclude: ['web-ifc'],
  },
  build: {
    chunkSizeWarningLimit: 8000,
  },
})
