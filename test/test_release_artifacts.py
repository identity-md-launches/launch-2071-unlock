"""Exercise the release gate itself, using isolated copies of real build artifacts.

Run after forge build: python3 -B -m unittest discover -s test -p 'test_release_artifacts.py' -v
"""
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parent.parent
NAMES = ("UnlkToken", "UnlkHook", "UnlkSwapRouter", "MerkleClaimEvidence", "UnlkOracle", "HookDeployer")


class ReleaseArtifactsTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="unlk-release-gate-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        (self.root / "scripts").mkdir()
        (self.root / "docs/abi").mkdir(parents=True)
        shutil.copyfile(ROOT / "scripts/release_artifacts.py", self.root / "scripts/release_artifacts.py")
        for name in NAMES:
            path = Path("out") / (name + ".sol") / (name + ".json")
            (self.root / path).parent.mkdir(parents=True)
            shutil.copyfile(ROOT / path, self.root / path)
            shutil.copyfile(ROOT / "docs/abi" / (name + ".json"), self.root / "docs/abi" / (name + ".json"))
        for name in ("foundry.toml", "remappings.txt", "dependencies.lock.json", "launch.json"):
            shutil.copyfile(ROOT / name, self.root / name)

    def gate(self):
        return subprocess.run(
            ["python3", str(self.root / "scripts/release_artifacts.py")],
            capture_output=True, text=True, check=False,
        )

    def artifact_path(self, name):
        return self.root / "out" / (name + ".sol") / (name + ".json")

    def test_real_release_artifacts_pass(self):
        result = self.gate()
        self.assertEqual(result.returncode, 0, result.stderr)
        report = json.loads((self.root / "docs/ARTIFACTS.json").read_text())["contracts"]
        self.assertEqual(set(report), set(NAMES))
        self.assertEqual(report["UnlkHook"]["constructorArgsBytes"], 128)
        self.assertEqual(report["HookDeployer"]["constructorArgsBytes"], 0)

    def test_every_runtime_is_checked_including_helper(self):
        for name in NAMES:
            with self.subTest(contract=name):
                path = self.artifact_path(name)
                original = path.read_text()
                artifact = json.loads(original)
                artifact["deployedBytecode"]["object"] = "0x" + "00" * 24577
                path.write_text(json.dumps(artifact))
                result = self.gate()
                path.write_text(original)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn(name + " exceeds EIP-170 runtime size", result.stderr)

    def test_every_creation_body_is_checked_including_helper(self):
        for name in NAMES:
            with self.subTest(contract=name):
                path = self.artifact_path(name)
                original = path.read_text()
                artifact = json.loads(original)
                artifact["bytecode"]["object"] = "0x" + "00" * 49153
                path.write_text(json.dumps(artifact))
                result = self.gate()
                path.write_text(original)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn(name + " exceeds EVM initcode size", result.stderr)

    def test_constructor_arguments_count_towards_initcode_limit(self):
        path = self.artifact_path("UnlkHook")
        artifact = json.loads(path.read_text())
        # The body alone fits; its four address words make the full initcode one byte too large.
        artifact["bytecode"]["object"] = "0x" + "00" * (49152 - 128 + 1)
        path.write_text(json.dumps(artifact))
        result = self.gate()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("UnlkHook exceeds EVM initcode size", result.stderr)

    def test_exact_evm_limits_with_constructor_arguments_pass(self):
        path = self.artifact_path("UnlkHook")
        artifact = json.loads(path.read_text())
        artifact["bytecode"]["object"] = "0x" + "00" * (49152 - 128)
        artifact["deployedBytecode"]["object"] = "0x" + "00" * 24576
        path.write_text(json.dumps(artifact))
        result = self.gate()
        self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == "__main__":
    unittest.main()
