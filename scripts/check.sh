#!/usr/bin/env bash
set -euo pipefail
forge build
python3 scripts/generate_code_checks.py --check
forge test
python3 -B -m unittest discover -s test -p 'test_release_artifacts.py' -v
forge fmt --check
forge lint src --severity high med
python3 scripts/verify_network.py
python3 scripts/export_abis.py
python3 scripts/release_artifacts.py
sha256sum -c docs/SOURCE_SHA256SUMS
