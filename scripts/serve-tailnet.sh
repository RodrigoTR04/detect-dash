#!/usr/bin/env bash
# Serve detect-dash to the tailnet by binding to this machine's Tailscale IPv4.
# That address is only reachable from tailnet devices (and this host); traffic
# is encrypted by WireGuard, so plain HTTP is fine.
set -euo pipefail
cd "$(dirname "$0")/.."

PORT="${PORT:-8080}"
status="$(tailscale status --json)"
if [[ "$(jq -r .BackendState <<<"$status")" != "Running" ]]; then
  echo "Tailscale is not running; start it with 'tailscale up'." >&2
  exit 1
fi
ip="$(jq -r '.Self.TailscaleIPs[] | select(contains("."))' <<<"$status" | head -n1)"
name="$(jq -r '.Self.DNSName | rtrimstr(".")' <<<"$status")"

echo "detect-dash on the tailnet: http://$name:$PORT (http://$ip:$PORT)"
NODE_ENV=production HOST="$ip" PORT="$PORT" exec bun src/server/index.ts
