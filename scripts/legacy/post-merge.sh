#!/usr/bin/env bash
set -Eeuo pipefail

# Post-merge runs without stdin. Keep installs quiet and non-interactive, and
# bound schema sync so a database/network stall cannot hang the merge forever.
npm install --no-audit --no-fund
timeout --foreground 90s npm run db:push -- --force
