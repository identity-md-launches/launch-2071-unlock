#!/usr/bin/env bash
set -euo pipefail
# Offline canonical checks, no installs, signing, broadcasting, host configuration or dependency changes.
forge build
python3 scripts/unlock-gates/check-archives.py
python3 scripts/mainnet/artifacts.py --check
python3 scripts/generate_code_checks.py --check
python3 scripts/candidate/pin.py --check
python3 scripts/candidate/dependencies.py --check
forge test --fuzz-seed 0xda8bb4c7a1dfecbe1d2824491108f08053450070bcb18434381100e02a366653
forge fmt --check
python3 -B -m unittest discover -s test -p 'test_release_artifacts.py' -v
node web/scripts/typecheck-offline.mjs
node web/scripts/build-offline.mjs
node web/scripts/build-offline.mjs --test
(cd web && node --test ../test/scratch/frontend/*.test.mjs)
