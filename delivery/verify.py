#!/usr/bin/env python3
"""Verify the exact import and release artifacts without Git writes or network access.

Run after forge build. Optional --rpc-url replays the recorded Sepolia reads;
--solc names an installed 0.8.26 compiler for the platform's saved compiler input.
No signing, broadcasting, package installation, or source modification.
"""
import argparse
import hashlib
import json
import lzma
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parent.parent
COMMIT = "f0149886ac3c09b57a0e1d676582e6aeaeb7a69f"
TREE = "0710257dd00656d130b4c56b7a669734955bb1ef"
NAMES = ("UnlkToken", "UnlkHook", "UnlkSwapRouter", "MerkleClaimEvidence", "UnlkOracle", "HookDeployer")


def read(path):
    source = ROOT / path
    if source.is_file():
        return json.loads(source.read_text())
    return json.loads(lzma.decompress(source.with_suffix(source.suffix + ".xz").read_bytes()))


def run(args, **kwargs):
    return subprocess.check_output(args, text=True, cwd=ROOT, timeout=120, **kwargs).strip()


def keccak(hexcode):
    return run(["cast", "keccak", "0x" + hexcode.removeprefix("0x")])


def git_hash(kind, contents):
    return hashlib.sha1(kind.encode() + b" " + str(len(contents)).encode() + b"\0" + contents).digest()


def tree_hash(node):
    records = []
    for name, value in node.items():
        if isinstance(value, dict):
            records.append((name.encode() + b"/", b"40000 " + name.encode() + b"\0" + tree_hash(value)))
        else:
            mode, digest = value
            records.append((name.encode(), mode.encode() + b" " + name.encode() + b"\0" + digest))
    return git_hash("tree", b"".join(body for _, body in sorted(records)))


def verify_source():
    provenance = read("delivery/provenance.json")
    assert provenance["sourceCommit"] == COMMIT and provenance["sourceTree"] == TREE
    files = read("delivery/source-files.json")
    assert len(files) == 498
    tree = {}
    for name, expected in files.items():
        path = ROOT / name
        assert path.is_file() and not path.is_symlink(), name
        data = path.read_bytes()
        digest = git_hash("blob", data)
        assert digest.hex() == expected["gitBlob"], "Published source changed: " + name
        assert hashlib.sha256(data).hexdigest() == expected["sha256"], name
        mode = "100755" if path.stat().st_mode & 0o111 else "100644"
        assert mode == expected["mode"], "Published file mode changed: " + name
        node = tree
        parts = Path(name).parts
        for part in parts[:-1]:
            node = node.setdefault(part, {})
        node[parts[-1]] = (mode, digest)
    assert tree_hash(tree).hex() == TREE, "The complete restored Git tree differs"
    print(f"PASS: {len(files)} original files and modes reconstruct published Git tree {TREE}")


def verify_artifacts():
    manifest = read("launch.json")
    assert manifest["kind"] == "univ4_hook"
    assert manifest["hook"]["constructorArgs"] == ["$poolManager", "$token", "$factory", "$owner"]
    assert manifest["hook"]["permissions"] == [
        "beforeInitialize", "afterInitialize", "beforeAddLiquidity", "afterAddLiquidity",
        "beforeRemoveLiquidity", "afterRemoveLiquidity", "beforeSwap", "afterSwap",
    ]
    assert manifest["token"] == {"contract": "UnlkToken", "name": "UNLOCK", "symbol": "UNLK", "decimals": 18}
    assert manifest["pool"] == {
        "pairedCurrency": "0x" + "00" * 20, "fee": 12500, "tickSpacing": 60,
        "initialPrice": "79228162514264337593543950336",
    }
    expected = read("docs/ARTIFACTS.json")["contracts"]
    assert set(expected) == set(NAMES)
    for name in NAMES:
        artifact = read(f"out/{name}.sol/{name}.json")
        creation = artifact["bytecode"]
        runtime = artifact["deployedBytecode"]
        assert not creation.get("linkReferences") and not runtime.get("linkReferences"), name
        constructor = next((x for x in artifact["abi"] if x["type"] == "constructor"), {"inputs": []})
        assert all(x["type"] == "address" for x in constructor["inputs"]), name
        body = bytes.fromhex(creation["object"].removeprefix("0x"))
        deployed = bytes.fromhex(runtime["object"].removeprefix("0x"))
        args = len(constructor["inputs"]) * 32
        assert len(body) < 49152 and len(body) + args <= 49152, name + " initcode limit"
        assert 0 < len(deployed) <= 24576, name + " runtime limit"
        actual = {
            "creationBodyBytes": len(body), "creationBodyKeccak256": keccak(body.hex()),
            "constructorArgsBytes": args, "initCodeBytes": len(body) + args,
            "runtimeTemplateBytes": len(deployed), "runtimeTemplateKeccak256": keccak(deployed.hex()),
            "abiSha256": hashlib.sha256((ROOT / f"docs/abi/{name}.json").read_bytes()).hexdigest(),
        }
        assert actual == expected[name], name + " differs from published artifact"
        assert artifact["abi"] == read(f"docs/abi/{name}.json"), name + " ABI mismatch"
        for suffix, code in (("creation", body), ("runtime-template", deployed)):
            export = (ROOT / f"delivery/artifacts/{name}.{suffix}.hex").read_text().strip()
            assert bytes.fromhex(export.removeprefix("0x")) == code, name + " export mismatch"
        print(f"PASS: {name}: body {len(body)}, full initcode {len(body) + args}, runtime {len(deployed)}")
    assert read("delivery/artifacts/release.json") == read("docs/ARTIFACTS.json")
    print("PASS: unchanged univ4_hook manifest, six release artifacts, ABI/code hashes and EVM sizes")


def rebuild_platform(compiler):
    assert "0.8.26+commit.8a97fa7a" in run([compiler, "--version"])
    config = read("docs/network/factory-reference.json")["stdJsonInput"]
    assert all("content" in item for item in config["sources"].values()), "Offline source content required"
    config["settings"]["outputSelection"] = {"*": {"*": [
        "abi", "evm.bytecode.object", "evm.deployedBytecode.object", "evm.deployedBytecode.immutableReferences",
    ]}}
    output = json.loads(run([compiler, "--standard-json"], input=json.dumps(config)))
    assert not any(x["severity"] == "error" for x in output.get("errors", [])), output.get("errors")
    for name, expected in read("docs/network/factory-artifacts.json").items():
        actual = output["contracts"][f"src/{name}.sol"][name]
        assert actual["abi"] == expected["abi"], name
        for part in ("bytecode", "deployedBytecode"):
            assert actual["evm"][part]["object"] == expected["evm"][part]["object"], name + " " + part
        assert len(actual["evm"]["deployedBytecode"]["object"]) // 2 <= 24576, name
        words = len(next(x for x in actual["abi"] if x["type"] == "constructor")["inputs"])
        assert len(actual["evm"]["bytecode"]["object"]) // 2 + words * 32 <= 49152, name
        print("PASS: canonical platform compilation:", name)


def replay_rpc(rpc):
    record = read("delivery/network/preflight.json")
    assert run(["cast", "chain-id", "--rpc-url", rpc]) == "11155111", "Sepolia required"
    header = json.loads(run(["cast", "block", str(record["blockNumber"]), "--json", "--rpc-url", rpc]))
    header = header.get("data", header)
    assert header["hash"] == record["blockHash"], "Recorded block changed"
    for name, expected in record["readResults"].items():
        args = expected["command"].copy()
        args[args.index("--rpc-url") + 1] = rpc
        actual = run(args)
        assert actual == expected["stdout"], name + " differs from recorded block"
        print("PASS: recorded Sepolia read:", name)
    print("This verifies recorded state only. Recheck live policy/state immediately before any broadcast.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--rpc-url", help="Optional Sepolia archive RPC; all operations are reads")
    parser.add_argument("--solc", help="Optional installed solc 0.8.26 for canonical platform rebuild")
    args = parser.parse_args()
    verify_source()
    verify_artifacts()
    if args.solc:
        rebuild_platform(args.solc)
    if args.rpc_url:
        replay_rpc(args.rpc_url)


if __name__ == "__main__":
    main()
