import { mergeConfig } from 'vite'
import base from '../../vite.config.ts'

export default mergeConfig(base, {
  resolve: { alias: { 'livekit-client': new URL('./call-reload-livekit.ts', import.meta.url).pathname } },
  server: { host: '127.0.0.1', port: 5174, strictPort: true },
})
