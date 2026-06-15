# Hosted web client: build the React/Vite SPA, then serve it as static files.
# Built by the `web` service in docker-compose.prod.base.yml.

# ── build stage ──────────────────────────────────────────────────────────────
FROM oven/bun:1 AS build
WORKDIR /app

# Install deps first for layer caching.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# The connect URL (and optional WS-compression override) are baked into the
# bundle at build time so the hosted SPA is locked to this deployment.
ARG VITE_WEB_CONNECT_URL
ARG VITE_WEB_WS_COMPRESSION=gzip
ENV VITE_WEB_CONNECT_URL=${VITE_WEB_CONNECT_URL}
ENV VITE_WEB_WS_COMPRESSION=${VITE_WEB_WS_COMPRESSION}

COPY . .
RUN bun run build

# ── serve stage ──────────────────────────────────────────────────────────────
# Static file server only — no app runtime. Caddy gives HTTP/2, compression and
# automatic SPA fallback with a tiny, reliable footprint.
FROM caddy:2-alpine
COPY deploy/web/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist /srv
EXPOSE 80
