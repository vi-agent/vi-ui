#!/usr/bin/env bash
# Deploy vi-ui to production.
# Run from ~/workplace/vi-ui after pushing changes to origin/main.
# Pulls latest into ~/vi-ui, rebuilds, and restarts the systemd user service.

set -euo pipefail

PROD="$HOME/vi-ui"
SERVICE="vi-ui"  # systemctl --user unit name (to be created)

echo "==> Pulling latest on prod..."
cd "$PROD"
git pull --ff-only origin main

echo "==> Installing dependencies..."
# Force devDeps: prod shell has NODE_ENV=production, which npm honors over
# --include=dev and skips devDependencies. That breaks the husky `prepare`
# hook and the vite/tsc build below, so override for the install step.
NODE_ENV=development npm ci

echo "==> Building client + server..."
npm run build

if systemctl --user list-unit-files "${SERVICE}.service" >/dev/null 2>&1; then
    echo "==> Restarting ${SERVICE}..."
    systemctl --user restart "${SERVICE}"
    systemctl --user status "${SERVICE}" --no-pager -l | tail -5
else
    echo "WARNING: systemd unit ${SERVICE}.service not installed. Skipping restart."
    echo "         Start manually with: (cd $PROD && npm run server)"
fi

echo "==> Done."
