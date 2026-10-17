#!/usr/bin/env bash
set -euo pipefail
# Optional RPC URL is an explicit argument. No keys, environment or configuration are read.
# Only local fork execution; never broadcast. The default is the public evidence source.
rpc_url="${1:-https://ethereum-rpc.publicnode.com}"
if [ "$#" -gt 0 ]; then shift; fi
mkdir -p test/scratch
cleanup() {
  rm -f test/scratch/MainnetFork.t.sol test/scratch/V4OracleRehearsal.t.sol
}
trap cleanup EXIT
python3 - "$rpc_url" <<'PY_COPY'
import sys
from pathlib import Path
for name in ['MainnetFork.t.sol','V4OracleRehearsal.t.sol']:
    text=(Path('rehearsal/mainnet')/name).read_text()
    # Reject code/string injection into temporary Solidity. Never persist the override in delivery files.
    if any(c in sys.argv[1] for c in ['"','\\','\n','\r']): raise SystemExit('Invalid RPC URL')
    (Path('test/scratch')/name).write_text(text.replace('https://ethereum-rpc.publicnode.com',sys.argv[1]))
PY_COPY
forge test --match-path 'test/scratch/*.t.sol' --fuzz-seed 0x1d49232a44ff2493b73de50672c825b51c99d7c5f9f966576d2050bd2684d532 -vv "$@"
