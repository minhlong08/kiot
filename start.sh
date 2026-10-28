#!/usr/bin/env bash
# Quick start for macOS / Linux:  ./start.sh
# Installs what is missing (Node.js 24 via nvm after asking, pnpm, dependencies), starts the app and opens the browser.
set -eo pipefail
cd "$(dirname "$0")"

NVM_VERSION=v0.40.3
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
# shellcheck disable=SC1091
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

node_major() { command -v node >/dev/null 2>&1 && node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0; }

if [ "$(node_major)" -lt 24 ]; then
  if command -v nvm >/dev/null 2>&1; then
    echo "▶ Switching to Node.js 24 with nvm…"
    # Use an installed Node 24 if there is one; download only when there isn't.
    nvm use 24 >/dev/null 2>&1 || { nvm install 24 && nvm use 24 >/dev/null; }
  else
    echo
    echo "PhuongDong POS needs Node.js 24, which isn't installed."
    echo "It will be installed for your user only with nvm (https://github.com/nvm-sh/nvm), nothing system-wide."
    read -r -p "Install it now? [Y/n] " answer
    case "$answer" in [nN]*) echo "Install Node.js 24 from https://nodejs.org and start again."; exit 1 ;; esac
    curl -fsSL "https://raw.githubusercontent.com/nvm-sh/nvm/${NVM_VERSION}/install.sh" | bash
    # shellcheck disable=SC1091
    . "$NVM_DIR/nvm.sh"
    nvm install 24
    nvm use 24
  fi
fi

exec node scripts/launch.mjs "$@"
