/**
 * Per-instance settings of the hosted web client, read at runtime.
 *
 * The web image is built once in CI for every instance, so the server address
 * cannot be baked in. Caddy serves `/config.js` directly from its
 * environment (deploy/web/Caddyfile), and `index.html` loads it
 * before the app. Desktop and dev ship an empty default (public/config.js), and
 * a self-built bundle may still bake the VITE_* values in as a fallback.
 */
type RuntimeConfig = {
  webConnectUrl?: string
  wsCompression?: string
}

const runtime: RuntimeConfig =
  (globalThis as { __LETSCHAT_CONFIG__?: RuntimeConfig }).__LETSCHAT_CONFIG__ ?? {}

/** The instance this hosted web client is locked to (e.g. https://auth.example.com). */
export const WEB_CONNECT_URL: string | undefined =
  (runtime.webConnectUrl || (import.meta.env.VITE_WEB_CONNECT_URL as string | undefined))?.trim() || undefined

/** `'none'` turns WebSocket compression off for this instance's browsers. */
export const WEB_WS_COMPRESSION: string | undefined =
  runtime.wsCompression || (import.meta.env.VITE_WEB_WS_COMPRESSION as string | undefined)
