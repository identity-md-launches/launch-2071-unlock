#!/usr/bin/env python3
"""Export ABIs from forge build artifacts using only Python's standard library."""
import lzma
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONTRACTS = {
    "UnlkToken": "UnlkToken.sol",
    "UnlkHook": "UnlkHook.sol",
    "UnlkOracle": "UnlkOracle.sol",
    "UnlkSwapRouter": "UnlkSwapRouter.sol",
    "MerkleClaimEvidence": "MerkleClaimEvidence.sol",
    "HookDeployer": "HookDeployer.sol",
    "IClaimEvidence": "IIntegration.sol",
    "IMerkleDistributor": "IIntegration.sol",
    "IRouteContext": "IIntegration.sol",
    "IChainlinkEthUsd": "IIntegration.sol",
    "ILaunchFactoryView": "IIntegration.sol",
    "ILaunchRegistryView": "IIntegration.sol",
    "IPoolManager": "IPoolManager.sol",
    "IHooks": "IHooks.sol",
    "Stage2": "Stage2.s.sol",
    "CheckReleaseConfig": "CheckReleaseConfig.s.sol",
}
for name, source in CONTRACTS.items():
    artifact = json.loads((ROOT / "out" / source / (name + ".json")).read_text())
    target = ROOT / "docs" / "abi" / (name + ".json")
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(artifact["abi"], indent=2) + "\n")
verified = json.loads(lzma.decompress((ROOT / "docs/network/factory-artifacts.json.xz").read_bytes()))
for name, artifact in verified.items():
    (ROOT / "docs/abi" / (name + ".json")).write_text(json.dumps(artifact["abi"], indent=2) + "\n")
print(f"Exported {len(CONTRACTS) + len(verified)} ABIs, including the verified platform contracts")
