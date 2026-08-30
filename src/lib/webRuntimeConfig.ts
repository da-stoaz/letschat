/**
 * Hosted-web runtime configuration.
 *
 * Two sources, in order:
 *
 * 1. `window.__LETSCHAT_CONFIG__`, served by the hosted-web container as
 *    `/config.js` and filled from its environment at request time. This is what
 *    makes the published `letschat-web` image instance-agnostic.
 * 2. `import.meta.env.VITE_WEB_*`, baked at build time. Still honoured so a
 *    locally-built, single-tenant bundle keeps working unchanged.
 *
 * Both are absent on desktop builds and in local dev, where the normal Setup
 * flow picks the instance instead.
 */

type RuntimeConfig = {
  connectUrl?: string
  wsCompression?: string
}

function runtime(): RuntimeConfig {
  if (typeof window === 'undefined') return {}
  return (window as { __LETSCHAT_CONFIG__?: RuntimeConfig }).__LETSCHAT_CONFIG__ ?? {}
}

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

/**
 * The auth base URL this hosted build is locked to (e.g. https://auth.example.com),
 * or `undefined` on desktop / dev / an unconfigured web container.
 */
export function webConnectUrl(): string | undefined {
  return (
    clean(runtime().connectUrl) ??
    clean(import.meta.env.VITE_WEB_CONNECT_URL as string | undefined)
  )
}

/**
 * Operator override for the database WebSocket's compression: `'none'` disables
 * it. Anything else (including unset) leaves the default in place.
 */
export function webWsCompression(): string | undefined {
  return (
    clean(runtime().wsCompression) ??
    clean(import.meta.env.VITE_WEB_WS_COMPRESSION as string | undefined)
  )
}
