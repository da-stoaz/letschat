# Hosted web client: build the React/Vite SPA, then serve it as static files.
# Built once per release by GitHub Actions and pulled by every instance; the
# instance-specific settings are written at container start (entrypoint.sh).

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
COPY --chmod=755 deploy/web/entrypoint.sh /usr/local/bin/entrypoint.sh
COPY --from=build /app/dist /srv
EXPOSE 80
# Checks the *_DOMAIN values and writes /srv/config.js (see the script).
# Setting ENTRYPOINT resets the base image's CMD, so it is restated here.
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
