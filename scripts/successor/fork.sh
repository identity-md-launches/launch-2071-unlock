#!/usr/bin/env bash
set -euo pipefail
# Read-only fork of PUBLIC Sepolia (recorded block 11920551); never broadcasts or signs.
# The fork suite is copied into test/scratch only for the run, so the default verifier suite stays offline.
mkdir -p test/scratch
cleanup() { rm -f test/scratch/SuccessorFork.t.sol test/scratch/SuccessorSetupFork.t.sol; }
trap cleanup EXIT
cp rehearsal/successor/SuccessorFork.t.sol test/scratch/SuccessorFork.t.sol
cp rehearsal/successor/SuccessorSetupFork.t.sol test/scratch/SuccessorSetupFork.t.sol
forge test --match-path 'test/scratch/Successor*Fork.t.sol' --fuzz-runs 32 -vv "$@"
