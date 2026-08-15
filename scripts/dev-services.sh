#!/usr/bin/env bash
# Brings the dev stack up.
#
# The only non-obvious part is LIVEKIT_NODE_IP. LiveKit runs in Docker, so the
# addresses it can advertise as ICE candidates are its container IP (unreachable
# from the host) and 127.0.0.1. Browsers refuse loopback ICE candidates — Firefox
# gates them behind media.peerconnection.ice.loopback, off by default — so with
# only those on offer the web client has nothing usable and ICE fails, while the
# desktop app connects fine. Handing LiveKit this machine's LAN address gives it a
# candidate that is both routable and non-loopback; the published ports already
# forward host -> container, so nothing else changes.
#
# Detected automatically so nobody has to know any of the above. Override by
# exporting LIVEKIT_NODE_IP yourself; falls back to 127.0.0.1 (desktop-only, the
# stock behaviour) when there is no LAN address to find.
set -euo pipefail

detect_lan_ip() {
  # macOS: whichever interface actually carries the default route.
  if command -v route >/dev/null 2>&1 && command -v ipconfig >/dev/null 2>&1; then
    local iface
    iface=$(route -n get default 2>/dev/null | awk '/interface:/{print $2}') || true
    if [ -n "${iface:-}" ]; then
      ipconfig getifaddr "$iface" 2>/dev/null && return 0
    fi
  fi
  # Linux.
  if command -v hostname >/dev/null 2>&1; then
    hostname -I 2>/dev/null | awk '{print $1}' | grep -E '^[0-9]' && return 0
  fi
  return 1
}

if [ -z "${LIVEKIT_NODE_IP:-}" ]; then
  LIVEKIT_NODE_IP=$(detect_lan_ip || true)
fi

if [ -n "${LIVEKIT_NODE_IP:-}" ]; then
  export LIVEKIT_NODE_ARG="--node-ip ${LIVEKIT_NODE_IP}"
  echo "LiveKit will advertise ICE candidates on ${LIVEKIT_NODE_IP}"
else
  # Deliberately NOT falling back to 127.0.0.1: pinning it to loopback narrows the
  # offer to candidates browsers reject outright. Leaving the flag off keeps
  # LiveKit's own detection, which is strictly the better of the two.
  echo "! No LAN address found — leaving LiveKit to auto-detect its node IP."
  echo "! If the browser client fails ICE, set LIVEKIT_NODE_IP to this machine's LAN address."
fi

exec docker compose -f docker-compose.dev.yml up -d "$@"
