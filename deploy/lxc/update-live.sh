#!/usr/bin/env bash
set -euo pipefail

# ── FinFlow live environment updater ──────────────────────────────
#
# Runs on the LXC (CT 101 / playground / 10.1.10.225).
# Installed at /srv/playground/app/update-live.sh, owned by the
# `playground` user.
#
# What it does:
#   1. git fetch + fast-forward to origin/playground-live
#   2. Re-install deps if lockfiles changed
#   3. Rebuild the playground frontend bundle
#   4. Restart the finflow-api-live systemd service
#   5. Health-check
#
# What it does NOT do:
#   - Touch Caddy. Caddyfile changes are always manual (validate first).
#   - Force-merge. If playground-live has non-linear history relative to
#     the current HEAD, the script refuses and exits 1.
#
# Canonical copy lives in the repo at deploy/lxc/update-live.sh.
# The live copy at /srv/playground/app/update-live.sh should match.
# ──────────────────────────────────────────────────────────────────

cd /srv/playground/app

echo "▶ fetching origin..."
git fetch origin

echo "▶ current HEAD: $(git rev-parse --short HEAD)"
echo "▶ target HEAD:  $(git rev-parse --short origin/playground-live)"

# Snapshot lockfile hashes so we know if deps changed
OLD_LOCK=$(sha256sum packages/api/bun.lock packages/playground/bun.lock 2>/dev/null | sha256sum || echo "none")

# Fast-forward only — refuses to merge non-linear history
git merge --ff-only origin/playground-live

NEW_LOCK=$(sha256sum packages/api/bun.lock packages/playground/bun.lock 2>/dev/null | sha256sum || echo "none")

if [ "$OLD_LOCK" != "$NEW_LOCK" ]; then
  echo "▶ lockfiles changed — running bun install..."
  cd packages/api && /home/playground/.bun/bin/bun install
  cd ../playground && /home/playground/.bun/bin/bun install
  cd /srv/playground/app
fi

echo "▶ building playground..."
cd packages/playground && /home/playground/.bun/bin/bun run build
cd /srv/playground/app

echo "▶ restarting api service..."
sudo systemctl restart finflow-api-live

sleep 2
if sudo systemctl is-active finflow-api-live >/dev/null; then
  echo "✅ live @ $(git rev-parse --short HEAD) — api healthy"
else
  echo "❌ api failed to start — check journalctl -u finflow-api-live"
  exit 1
fi
