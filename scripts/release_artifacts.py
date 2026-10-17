#!/usr/bin/env python3
"""Record reproducible source/ABI digests and compiler artifacts; never claim deployed runtime hashes."""
import hashlib
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
NAMES = ["UnlkToken", "UnlkHook", "UnlkSwapRouter", "MerkleClaimEvidence", "UnlkOracle", "HookDeployer"]

def keccak(code):
    return subprocess.check_output(["cast", "keccak", code], text=True).strip()

artifacts = {}
for name in NAMES:
    a = json.loads((ROOT / "out" / (name + ".sol") / (name + ".json")).read_text())
    creation = a["bytecode"]
    runtime = a["deployedBytecode"]
    assert not creation.get("linkReferences") and not runtime.get("linkReferences"), "unlinked library"
    init_bytes = len(bytes.fromhex(creation["object"].removeprefix("0x")))
    runtime_bytes = len(bytes.fromhex(runtime["object"].removeprefix("0x")))
    # Every release artifact is checked, including helpers. EIP-3860 counts the constructor arguments too.
    constructor = next((entry for entry in a["abi"] if entry["type"] == "constructor"), {"inputs": []})
    assert all(arg["type"] == "address" for arg in constructor["inputs"]), name + " needs initcode sizing review"
    constructor_bytes = 32 * len(constructor["inputs"])
    assert init_bytes < 49152 and init_bytes + constructor_bytes <= 49152, name + " exceeds EVM initcode size"
    assert runtime_bytes <= 24576, name + " exceeds EIP-170 runtime size"
    artifacts[name] = {
        "creationBodyBytes": init_bytes,
        "creationBodyKeccak256": keccak(creation["object"]),
        "constructorArgsBytes": constructor_bytes,
        "initCodeBytes": init_bytes + constructor_bytes,
        "runtimeTemplateBytes": runtime_bytes,
        "runtimeTemplateKeccak256": keccak(runtime["object"]),
        "abiSha256": hashlib.sha256((ROOT / "docs/abi" / (name + ".json")).read_bytes()).hexdigest(),
    }

files = []
for directory in ("src", "lib", "script", "test", "rehearsal", "scripts", "docs/abi"):
    for path in (ROOT / directory).rglob("*"):
        if path.is_file() and "scratch" not in path.relative_to(ROOT).parts and "__pycache__" not in path.parts:
            files.append(path)
for name in ("foundry.toml", "remappings.txt", "dependencies.lock.json", "launch.json"):
    files.append(ROOT / name)
lines = [hashlib.sha256(p.read_bytes()).hexdigest() + "  " + p.relative_to(ROOT).as_posix()
         for p in sorted(files)]
listing = "\n".join(lines) + "\n"
(ROOT / "docs/SOURCE_SHA256SUMS").write_text(listing)
result = {
    "compiler": "0.8.26+commit.8a97fa7a", "evmVersion": "cancun", "optimizerRuns": 200,
    "bytecodeHash": "none", "sourceDigestListSha256": hashlib.sha256(listing.encode()).hexdigest(),
    "warning": "Templates contain unresolved immutable values. These are NOT public deployment runtime hashes or a Git commit.",
    "contracts": artifacts,
}
(ROOT / "docs/ARTIFACTS.json").write_text(json.dumps(result, indent=2) + "\n")
print("Recorded", len(artifacts), "contract artifacts and", len(files), "source/ABI digests")
