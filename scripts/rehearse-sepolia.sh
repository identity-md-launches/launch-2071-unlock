#!/usr/bin/env bash
set -euo pipefail
# Read-only fork. No broadcast/signature/key. Runtime code and block checks are inside the test.
FOUNDRY_TEST=rehearsal forge test --fork-url "${1:?Supply a Sepolia archive RPC URL}" --fork-block-number 11904506 --match-contract SepoliaRehearsal -vv
