#!/bin/sh
# Start-up for the hosted web client. The image is built once in CI for every
# instance, so everything instance-specific arrives here, from the environment.
set -eu

# 1. The Content-Security-Policy in /etc/caddy/Caddyfile needs the origins of
#    the four services. They are derived from the public URLs core-api already
#    advertises, so nothing is entered twice. The scheme is kept: a plain-http
#    LAN deployment gets http:// + ws:// sources, a TLS one https:// + wss://
#    (a CSP https:// source never matches http://, nor wss:// ws://).
#    A URL that cannot be parsed would leave a hole in the policy and silently
#    break the web app, so refuse to start instead.
origin() { # <prefix> <URL var>  →  exports <prefix>_HTTP and <prefix>_WS
  eval "url=\${$2:-}"
  case "$url" in
    https://* | wss://*) tls=s ;;
    http://* | ws://*) tls= ;;
    *)
      echo "web: set $2 to the public URL of that service, e.g. https://… or wss://… (got '$url')." >&2
      exit 1 ;;
  esac
  host="${url#*://}"
  host="${host%%/*}"
  case "$host" in
    "" | *[!A-Za-z0-9.:-]*)
      echo "web: '$host' (from $2) is not a hostname." >&2
      exit 1 ;;
  esac
  export "${1}_HTTP=http$tls://$host" "${1}_WS=ws$tls://$host"
}
origin AUTH DISCOVERY_AUTH_URL
origin CHAT DISCOVERY_SPACETIMEDB_URI
origin FILES MINIO_PUBLIC_ENDPOINT
origin LIVEKIT DISCOVERY_LIVEKIT_URL

# 2. The instance the browser client locks onto, read by src/lib/runtimeConfig.ts
#    through /config.js. Validated strictly because it is written into a script.
# Defaults to DISCOVERY_AUTH_URL — the auth host serves the discovery document.
url="${VITE_WEB_CONNECT_URL:-${DISCOVERY_AUTH_URL:-}}"
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
    echo "web: VITE_WEB_CONNECT_URL must start with https:// or http:// (got '$url'), e.g. https://auth.example.com." >&2
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
