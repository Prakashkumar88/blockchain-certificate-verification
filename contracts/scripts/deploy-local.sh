#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

# Fixed loopback RPC: this wrapper cannot target an external host.
: "${INITIAL_ADMIN_ADDRESS:?Set the public admin wallet address}"
: "${DEPLOYER_ADDRESS:?Set an unlocked local Anvil account address}"
forge_bin="${FOUNDRY_BIN_DIR:-$HOME/.foundry/bin}/forge"
cast_bin="${FOUNDRY_BIN_DIR:-$HOME/.foundry/bin}/cast"
local_rpc="http://127.0.0.1:${ANVIL_PORT:-8545}"
if [[ ! "${ANVIL_PORT:-8545}" =~ ^[0-9]+$ ]]; then
  printf '%s\n' 'ANVIL_PORT must be numeric' >&2
  exit 1
fi
if [[ "$("$cast_bin" chain-id --rpc-url "$local_rpc")" != 31337 ]]; then
  printf '%s\n' 'Refusing deployment: expected local chain ID 31337' >&2
  exit 1
fi
"$forge_bin" script script/DeployLocal.s.sol:DeployLocal \
  --rpc-url "$local_rpc" --sender "$DEPLOYER_ADDRESS" --unlocked --broadcast
