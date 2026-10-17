#!/usr/bin/env bash
set -euo pipefail
# Run from the repository root. Entire default check is offline and uses the supplied fuzz seed.
python3 scripts/candidate/dependencies.py --check
forge build
python3 scripts/generate_code_checks.py --check
python3 scripts/candidate/pin.py --check
forge test --fuzz-seed 0x1fb1bda21a2a44ee9da3a358da09a0668c5135bb35baa2d687f3bfba01fc2fde
forge fmt --check
forge build --sizes --skip test --skip script
python3 scripts/candidate/artifacts.py
node web/scripts/typecheck-offline.mjs
node web/scripts/build-offline.mjs
node web/scripts/build-offline.mjs --test
(cd web && node --test ../test/scratch/frontend/*.test.mjs)
python3 scripts/candidate/bundle-size.py
