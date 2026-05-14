#!/usr/bin/env bash
set -euo pipefail

prev="${1:-}"
curr="${2:-}"

if [ -z "$prev" ] || [ -z "$curr" ]; then
  exit 0
fi

if ! git rev-parse --verify --quiet "$prev" >/dev/null 2>&1; then exit 0; fi
if ! git rev-parse --verify --quiet "$curr" >/dev/null 2>&1; then exit 0; fi

if ! git diff --quiet "$prev" "$curr" -- pnpm-lock.yaml; then
  echo "pnpm-lock.yaml changed between $prev and $curr — running pnpm install..."
  pnpm install
fi
