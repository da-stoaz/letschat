#!/bin/sh
# The Content-Security-Policy in /etc/caddy/Caddyfile is built from these four
# hostnames. An empty one leaves a bare `https://` in the policy and the browser
# blocks that service; one with a scheme or path yields `https://https://…`.
# Either way the web app silently stops working, so refuse to start instead.
for name in AUTH_DOMAIN CHAT_DOMAIN FILES_DOMAIN LIVEKIT_DOMAIN; do
  eval "value=\${$name}"
  case "$value" in
    "")
      echo "web: $name is not set. Set it to the service's public hostname, e.g. auth.example.com." >&2
      exit 1 ;;
    *://* | */*)
      echo "web: $name must be a hostname only, without https:// or a path (got '$value')." >&2
      exit 1 ;;
  esac
done
exec "$@"
