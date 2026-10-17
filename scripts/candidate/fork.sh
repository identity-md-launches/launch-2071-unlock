#!/usr/bin/env bash
set -euo pipefail
# Read-only fork against PUBLIC Sepolia archive RPC; never broadcasts or signs.
# Scratch tests are cleaned even on failure so the normal verifier suite remains entirely offline.
mkdir -p test/scratch
cleanup() {
  python3 - <<'PY'
from pathlib import Path
for name in ("RouterFork.t.sol", "SetupFork.t.sol"):
    Path("test/scratch", name).unlink(missing_ok=True)
PY
}
trap cleanup EXIT
cp rehearsal/candidate/RouterFork.t.sol test/scratch/RouterFork.t.sol
cp rehearsal/candidate/SetupFork.t.sol test/scratch/SetupFork.t.sol
forge test --match-path 'test/scratch/*Fork.t.sol' -vv
