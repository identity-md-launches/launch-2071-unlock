#!/usr/bin/env python3
"""Offline mainnet manifest regression gate; this is not platform admission."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PERMISSIONS = [
    "beforeInitialize", "afterInitialize", "beforeAddLiquidity", "afterAddLiquidity",
    "beforeRemoveLiquidity", "afterRemoveLiquidity", "beforeSwap", "afterSwap",
    "beforeSwapReturnDelta", "afterSwapReturnDelta",
]


def validate(manifest):
    notes = manifest.get("notes", "")
    assert isinstance(notes, str), "notes must be a string"
    # The platform's JavaScript schema measures string length in UTF-16 code units.
    assert len(notes.encode("utf-16-le", errors="surrogatepass")) // 2 <= 4000, "notes exceed 4000 characters"
    assert manifest["kind"] == "univ4_hook", "wrong launch kind"
    assert manifest["hook"]["contract"] == "UnlkImdHook", "wrong hook"
    assert manifest["hook"]["constructorArgs"] == [
        "$poolManager", "$token", "$factory", "$owner"
    ], "wrong constructor bindings"
    assert sorted(manifest["hook"]["permissions"]) == sorted(PERMISSIONS), "wrong permissions"
    assert manifest["token"] == {
        "contract": "UnlkToken", "name": "UNLOCK", "symbol": "UNLK", "decimals": 18
    }, "wrong token"
    assert manifest["pool"] == {
        "pairedCurrency": "0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7",
        "fee": 12500, "tickSpacing": 60, "initialPrice": "79228162514264337593543950336"
    }, "wrong pool"


def check_artifacts():
    for name, inputs in [("UnlkToken", []), ("UnlkImdHook", ["address"] * 4)]:
        artifact = json.loads((ROOT / "out" / (name + ".sol") / (name + ".json")).read_text())
        constructor = next(x for x in artifact["abi"] if x["type"] == "constructor")
        assert [x["type"] for x in constructor["inputs"]] == inputs, name + " constructor ABI"
        assert constructor["stateMutability"] == "nonpayable", name + " payable constructor"
        assert not artifact["bytecode"].get("linkReferences"), name + " unlinked code"


if __name__ == "__main__":
    manifest = json.loads((ROOT / "launch.json").read_text())
    validate(manifest)
    check_artifacts()
    print("Mainnet manifest, ten permissions (0x3fcc), pair, token and factory constructors match.")
    print(f"Notes: {len(manifest.get('notes', '').encode('utf-16-le', errors='surrogatepass')) // 2}/4000 UTF-16 code units.")
