#!/usr/bin/env python3
"""Run the supplied files unchanged, with synthetic test probe values only.
No host configuration or environment is inspected. This is not a deployment manifest.
"""
import json
import pathlib
import shlex
import shutil
import subprocess

root = pathlib.Path(__file__).resolve().parents[2]
target = root / "test/scratch/protected"
inputs = root / ".imd/reads/protected/univ4_hook"
target.mkdir(parents=True, exist_ok=True)
names = ["Hook.protected.t.sol", "Token.protected.t.sol"]
for name in names:
    shutil.copyfile(inputs / name, target / name)

def addr(label):
    return "0x" + subprocess.check_output(["cast", "keccak", label], text=True).strip()[-40:]

def bytecode(name):
    return json.loads((root / f"out/{name}.sol/{name}.json").read_text())["bytecode"]["object"]

manager, token, factory, owner = [addr("candidate protected test " + role) for role in ["manager", "token", "factory", "owner"]]
args = subprocess.check_output(["cast", "abi-encode", "f(address,address,address,address)", manager, token, factory, owner], text=True).strip()
manifest = json.loads((root / "launch.json").read_text())
values = {
    "IMD_EXPECTED_SUPPLY": str(10**27), "IMD_TOKEN_DECIMALS": "18", "IMD_PROJECT_CHAIN_ID": "31337",
    "IMD_HOOK_CREATION_CODE": bytecode("UnlkHookV2") + args[2:], "IMD_HOOK_FLAGS": str(0x3fc4),
    "IMD_HOOK_NAME": "UnlkHookV2", "IMD_POOL_MANAGER": manager, "IMD_TOKEN_PROBE": token,
    "IMD_TOKEN_CREATION_CODE": bytecode("UnlkToken"), "IMD_FACTORY_PROBE": factory,
    "IMD_PAIRED_CURRENCY": "0x0000000000000000000000000000000000000000",  # v4 native currency sentinel
    "IMD_POOL_FEE": "12500", "IMD_TICK_SPACING": "60", "IMD_SQRT_PRICE": str(manifest["pool"]["initialPrice"]),
}
command = " ".join(f"{key}={shlex.quote(value)}" for key, value in values.items())
command += " forge test --match-path 'test/scratch/protected/*.sol' -vv"
try:
    result = subprocess.run(["bash", "-c", command], cwd=root)
finally:
    shutil.rmtree(target)
print("Owners.protected.t.sol NOT RUN: supplied OwnerChecks.sol and Swapper.sol harness dependencies are absent.")
raise SystemExit(result.returncode)
