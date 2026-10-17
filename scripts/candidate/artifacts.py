#!/usr/bin/env python3
"""Export candidate ABI/templates and enforce deployable artifact size and link constraints offline."""
from pathlib import Path
import hashlib
import json
import subprocess

root = Path(__file__).resolve().parents[2]
out = root / "docs/candidate"
(out / "abi").mkdir(exist_ok=True)
names = ["UnlkHookV2", "UnlkRouterV2", "NftFeeVault", "SetupVerifierV2", "HookDeployerV2", "UnlkToken", "UnlkOracle", "MerkleClaimEvidence"]
result = {"compiler": "0.8.26", "evmVersion": "cancun", "optimizerRuns": 200, "bytecodeHash": "none",
          "status": "undeployed; independent review pending; standard-router attribution blocks release",
          "warning": "Runtime template hashes have unresolved immutables. They are not deployed code hashes.", "contracts": {}}
for name in names:
    artifact = json.loads((root / f"out/{name}.sol/{name}.json").read_text())
    creation, runtime = artifact["bytecode"], artifact["deployedBytecode"]
    assert not creation.get("linkReferences") and not runtime.get("linkReferences"), name + ": unlinked library"
    ctor = next((x for x in artifact["abi"] if x["type"] == "constructor"), {"inputs": []})
    assert len(ctor["inputs"]) <= 16
    assert all(x["type"] == "address" for x in ctor["inputs"]), "review dynamic constructor sizing"
    code = creation["object"]
    runtime_code = runtime["object"]
    creation_size = len(bytes.fromhex(code.removeprefix("0x"))) + 32 * len(ctor["inputs"])
    runtime_size = len(bytes.fromhex(runtime_code.removeprefix("0x")))
    assert creation_size <= 49152 and runtime_size <= 24576, name + ": EVM size exceeded"
    (out / f"abi/{name}.json").write_text(json.dumps(artifact["abi"], indent=2) + "\n")
    result["contracts"][name] = {"initCodeWithArgsBytes": creation_size, "runtimeTemplateBytes": runtime_size,
        "creationBodyKeccak256": subprocess.check_output(["cast", "keccak", code], text=True).strip(),
        "runtimeTemplateKeccak256": subprocess.check_output(["cast", "keccak", runtime_code], text=True).strip()}
(out / "ARTIFACTS.json").write_text(json.dumps(result, indent=2) + "\n")
print("Exported and size-checked", len(names), "deployable contracts")
