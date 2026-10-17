# Historical evidence, preserved byte for byte

The repository's conservative8MiB source-upload gate initially failed after this implementation. To retain contracts, tests, dependencies, both frontend exports and all evidence,141 historical text check records are stored together in `historical-checks.tar.xz`; two older canonical platform JSON records are stored as `.json.xz` beside their original paths. These are ordinary committed files, requiring only standard Python lzma/tarfile to read. No build configuration, dependency, live deployment configuration or live export was changed for packaging.

`historical-checks.json` records every original path, byte length, SHA256, Git blob and mode, plus the tar/compressed hashes. `historical-json.json` records the two original/compressed hashes and lengths. `check-archives.py` verifies every byte without extraction. Original log paths contain short archive pointers, keeping old links useful. Historical checksum tools can use the original bytes after restoring them locally:

```sh
python3 scripts/unlock-gates/check-archives.py
tar -xJf docs/unlock-gates/historical-checks.tar.xz
python3 - <<'PY'
import json, lzma
from pathlib import Path
for item in json.loads(Path('docs/unlock-gates/historical-json.json').read_text()):
    Path(item['original']).write_bytes(lzma.decompress(Path(item['archive']).read_bytes()))
PY
```

Current final-source logs remain plain text under `docs/unlock-gates/checks/` and are not archived. The three older JSON-consuming scripts now decode the identical archived bytes; none of their existing identity/hash/bytecode/size comparisons was removed or relaxed. The root historical `launch.json`, original artifact expectations and original source manifests remain unchanged. Those manifests describe earlier commits and are not claims that intentionally changed source still matches an old release.
