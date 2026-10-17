"""Reproduce imported stale-manifest finding and guard the new launch's exact factory inputs."""
import copy
import importlib.util
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("mainnet_manifest", ROOT / "scripts/mainnet/check-manifest.py")
check = importlib.util.module_from_spec(spec)
spec.loader.exec_module(check)


class MainnetManifestTest(unittest.TestCase):
    def setUp(self):
        self.manifest = json.loads((ROOT / "launch.json").read_text())

    def test_current_manifest_and_compiled_constructors(self):
        check.validate(self.manifest)
        check.check_artifacts()

    def test_imported_sepolia_manifest_is_rejected_and_archived(self):
        old = json.loads((ROOT / "docs/mainnet/release/imported-sepolia-manifest.json").read_text())
        self.assertEqual(old["hook"]["contract"], "UnlkHook")
        self.assertEqual(old["pool"]["pairedCurrency"], "0x" + "00" * 20)
        with self.assertRaises(AssertionError):
            check.validate(old)

    def test_notes_length_boundary(self):
        for notes in ("", "a" * 4000, "\U0001f680" * 2000):
            with self.subTest(length=len(notes)):
                manifest = copy.deepcopy(self.manifest)
                manifest["notes"] = notes
                check.validate(manifest)
        for notes in ("a" * 4001, "\U0001f680" * 2000 + "a"):
            with self.subTest(length=len(notes)):
                manifest = copy.deepcopy(self.manifest)
                manifest["notes"] = notes
                with self.assertRaisesRegex(AssertionError, "notes exceed 4000 characters"):
                    check.validate(manifest)

    def test_notes_must_be_a_string(self):
        for notes in (None, 4000, [], {}):
            with self.subTest(notes=notes):
                manifest = copy.deepcopy(self.manifest)
                manifest["notes"] = notes
                with self.assertRaisesRegex(AssertionError, "notes must be a string"):
                    check.validate(manifest)

    def test_each_wrong_launch_input_is_rejected(self):
        mutations = [
            ("hook", "contract", "UnlkHook"),
            ("hook", "constructorArgs", ["$poolManager", "$token", "$factory", "$factory"]),
            ("hook", "permissions", check.PERMISSIONS[:-1]),
            ("hook", "permissions", check.PERMISSIONS + ["beforeInitialize"]),
            ("pool", "pairedCurrency", "0x" + "00" * 20),
            ("pool", "fee", 0), ("pool", "fee", 0x800000),
            ("pool", "tickSpacing", 200), ("token", "decimals", 6),
        ]
        for section, key, value in mutations:
            with self.subTest(section=section, key=key, value=value):
                manifest = copy.deepcopy(self.manifest)
                manifest[section][key] = value
                with self.assertRaises(AssertionError):
                    check.validate(manifest)


if __name__ == "__main__":
    unittest.main()
