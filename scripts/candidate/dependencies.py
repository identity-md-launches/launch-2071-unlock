#!/usr/bin/env python3
"""Hash only vendored project dependencies. No package manager, network or host configuration."""
import argparse
import hashlib
import json
import os
from pathlib import Path

root = Path(__file__).resolve().parents[2]
manifest = root / "docs/candidate/DEPENDENCIES.json"
parser = argparse.ArgumentParser()
parser.add_argument("--write", action="store_true")
parser.add_argument("--check", action="store_true")
args = parser.parse_args()
files = {}
for folder in (root / "lib", root / "web/vendor"):
    for parent, directories, names in os.walk(folder):
        directories[:] = sorted(d for d in directories if d not in (".git", ".github", "node_modules"))
        for name in sorted(names):
            if name == ".env" or name.startswith(".env."):
                continue
            path = Path(parent) / name
            if path.is_symlink():
                raise SystemExit("Dependencies must be ordinary files: " + str(path.relative_to(root)))
            files[str(path.relative_to(root))] = hashlib.sha256(path.read_bytes()).hexdigest()
if args.write:
    manifest.write_text(json.dumps({"algorithm": "SHA-256", "files": files}, indent=2) + "\n")
else:
    expected = json.loads(manifest.read_text())["files"]
    changed = [name for name in sorted(set(files) | set(expected)) if files.get(name) != expected.get(name)]
    if changed:
        raise SystemExit("Dependency integrity mismatch: " + ", ".join(changed))
print("Verified", len(files), "ordinary vendored dependency files")
