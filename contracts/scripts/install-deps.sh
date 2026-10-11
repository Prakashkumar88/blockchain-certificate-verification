#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
forge_bin="${FOUNDRY_BIN_DIR:-$HOME/.foundry/bin}/forge"
# Exact releases; no project Git initialization or submodule mutation is required.
"$forge_bin" install --no-git \
  OpenZeppelin/openzeppelin-contracts@v5.7.0 \
  foundry-rs/forge-std@v1.17.0
