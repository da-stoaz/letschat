#!/bin/sh
# Start-up for the hosted web client. The image is built once in CI for every
# instance, so everything instance-specific arrives here, from the environment.
set -eu

# 1. The Content-Security-Policy in /etc/caddy/Caddyfile is built from these
#    four hostnames. An empty one leaves a bare `https://` in the policy and the
#    browser blocks that service; one with a scheme or path yields
#    `https://https://…`. Either way the web app silently stops working, so
#    refuse to start instead.
for name in AUTH_DOMAIN CHAT_DOMAIN FILES_DOMAIN LIVEKIT_DOMAIN; do
  eval "value=\${$name:-}"
  case "$value" in
    "")
      echo "web: $name is not set. Set it to the service's public hostname, e.g. auth.example.com." >&2
      exit 1 ;;
    *://* | */*)
      echo "web: $name must be a hostname only, without https:// or a path (got '$value')." >&2
      exit 1 ;;
  esac
done

# 2. The instance the browser client locks onto, read by src/lib/runtimeConfig.ts
#    through /config.js. Validated strictly because it is written into a script.
url="${VITE_WEB_CONNECT_URL:-}"
compression="${VITE_WEB_WS_COMPRESSION:-gzip}"
case "$url" in
  "") ;; # no hosted web client: the page falls back to the Setup screen
  http://* | https://*)
    case "$url" in
      *[!A-Za-z0-9.:/_-]*)
        echo "web: VITE_WEB_CONNECT_URL contains characters a URL of this kind never needs (got '$url')." >&2
        exit 1 ;;
    esac ;;
  *)
    echo "web: VITE_WEB_CONNECT_URL must start with https:// (got '$url'), e.g. https://auth.example.com." >&2
    exit 1 ;;
esac
case "$compression" in
  gzip | none) ;;
  *)
    echo "web: VITE_WEB_WS_COMPRESSION must be gzip or none (got '$compression')." >&2
    exit 1 ;;
esac
printf 'window.__LETSCHAT_CONFIG__ = {"webConnectUrl":"%s","wsCompression":"%s"}\n' \
  "$url" "$compression" > /srv/config.js

exec "$@"
