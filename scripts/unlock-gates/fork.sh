#!/usr/bin/env bash
set -euo pipefail
# Local fork tests only. Explicit public RPC override; no environment, wallet, signing or broadcast.
rpc_url="${1:-https://eth.drpc.org}"
if [ "$#" -gt 0 ]; then shift; fi
mkdir -p test/scratch/unlock-gates
trap 'rm -f test/scratch/unlock-gates/MainnetHandoff.t.sol' EXIT
python3 - "$rpc_url" <<'PY'
from pathlib import Path
import sys
from urllib.parse import urlparse
url = sys.argv[1]
parsed = urlparse(url)
if parsed.scheme not in ("http", "https") or not parsed.netloc:
    raise SystemExit("Explicit HTTP(S) RPC URL required")
if any(c in url for c in ['"', '\\', '\n', '\r']):
    raise SystemExit('Invalid RPC URL')
p = Path('rehearsal/unlock-gates/MainnetHandoff.t.sol')
Path('test/scratch/unlock-gates/MainnetHandoff.t.sol').write_text(p.read_text().replace('https://ethereum-rpc.publicnode.com', url))
PY
forge test --match-path 'test/scratch/unlock-gates/MainnetHandoff.t.sol' \
  --fuzz-seed 0xa9a85f3e917f851909cc56d729dafbccc481a7a8bd1cc34be8bf4db901b32cb0 -vv "$@"
