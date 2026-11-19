import { defineConfig } from 'vitest/config'

// Unit tests for the site's browser logic, run from the repo root (which has
// Vitest): `bunx vitest run --config site/vitest.config.ts`. They need the
// site's own `npm ci`, because site/tsconfig.json extends Astro's.
export default defineConfig({
  root: new URL('.', import.meta.url).pathname,
  resolve: { alias: { '@': new URL('./src', import.meta.url).pathname } },
  test: { include: ['src/**/*.test.ts'], environment: 'node' },
})
