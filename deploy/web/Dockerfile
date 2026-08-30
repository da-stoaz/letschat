# Hosted web client: build the React/Vite SPA, then serve it as static files.
#
# Published as ghcr.io/<owner>/letschat-web by .github/workflows/release.yml, so
# a deployment PULLS this rather than compiling the frontend on the server. That
# matters: `bun install` + `vite build` is the heaviest step in the whole stack
# and the most likely thing to exhaust RAM on a small VPS — and it would do so
# after the old containers are already down.
#
# The image is INSTANCE-AGNOSTIC. Configuration arrives at runtime through
# /config.js (see deploy/web/Caddyfile), not through build args, because a
# baked-in connect URL is exactly what made this image unpublishable before.

# ── build stage ──────────────────────────────────────────────────────────────
FROM oven/bun:1 AS build
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
