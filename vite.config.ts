import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { noiseSuppressionAudioWorkletVitePlugin } from '@workadventure/noise-suppression/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), noiseSuppressionAudioWorkletVitePlugin()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  server: {
    proxy: {
      '/livekit': {
        target: 'http://localhost:7880',
        changeOrigin: true,
        secure: false,
        ws: true,
      },
    },
  },
})
