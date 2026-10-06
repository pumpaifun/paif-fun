#!/usr/bin/env bash
set -Eeuo pipefail
pnpm install --frozen-lockfile
# The port reuses the existing schema and data. Never force a schema push here.
pnpm run typecheck:libs
