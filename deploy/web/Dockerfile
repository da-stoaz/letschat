# Hosted web client: build the React/Vite SPA, then serve it as static files.
# Built once per release by GitHub Actions and pulled by every instance; the
# instance-specific settings are served directly by Caddy at /config.js.

# ── build stage ──────────────────────────────────────────────────────────────
# The bundle is platform-independent, so it is built natively once instead of
# under emulation for every target architecture.
FROM --platform=$BUILDPLATFORM oven/bun:1 AS build
WORKDIR /app

# Install deps first for layer caching.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .
RUN bun run build

# ── serve stage ──────────────────────────────────────────────────────────────
# Static file server only — no app runtime. Caddy gives HTTP/2, compression and
# automatic SPA fallback with a tiny, reliable footprint.
FROM caddy:2-alpine
COPY deploy/web/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist /srv
EXPOSE 80
# Use the base image's standard Caddy command; no custom entrypoint.
