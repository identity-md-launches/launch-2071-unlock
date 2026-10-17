"""Measure a complete current-tree Git bundle in /tmp, without writing the checkout's .git."""
import json
import os
from pathlib import Path
import subprocess
import tempfile

root = Path(__file__).resolve().parents[2]
paths = subprocess.check_output(
    ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"], cwd=root
).decode().split("\0")
paths = sorted(set(p for p in paths if p and (root / p).exists()
    and not p.startswith((".imd/", "test/scratch/", ".playwright-mcp/"))))
assert not any("node_modules" in Path(p).parts for p in paths)
assert "web/evidence/revision-responses.json" in paths and "dist/index.html" in paths
assert "web/evidence/validation.md" in paths
assert "artifacts/validation.md" in paths and "artifacts/terminal-desktop.jpg" in paths
with tempfile.TemporaryDirectory(prefix="unlk-submission-") as temp:
    temp = Path(temp)
    gitdir = temp / "gitdir"
    subprocess.run(["git", "init", "--bare", "--quiet", str(gitdir)], check=True)
    git = ["git", f"--git-dir={gitdir}", f"--work-tree={root}"]
    pathspec = temp / "paths"
    pathspec.write_bytes(b"\0".join(p.encode() for p in paths) + b"\0")
    subprocess.run(git + ["add", "--force", "--pathspec-file-nul", f"--pathspec-from-file={pathspec}"], cwd=root, check=True)
    tree = subprocess.check_output(git + ["write-tree"], text=True).strip()
    # This temporary size-probe commit is not the submission or a claimed delivery commit.
    identity = {**os.environ, "GIT_AUTHOR_NAME": "Submission size probe", "GIT_COMMITTER_NAME": "Submission size probe",
                "GIT_AUTHOR_EMAIL": "size-probe@localhost", "GIT_COMMITTER_EMAIL": "size-probe@localhost"}
    commit = subprocess.check_output(git + ["commit-tree", tree, "-m", "Current-tree size measurement"], env=identity, text=True).strip()
    subprocess.run(git + ["update-ref", "refs/heads/snapshot", commit], check=True)
    bundle = temp / "submission.bundle"
    subprocess.run(git + ["bundle", "create", str(bundle), "refs/heads/snapshot"], check=True)
    size = bundle.stat().st_size
    # Reserve room for this report's own final update; no archive is added to the submission.
    reserve = 16384
    assert size + reserve < 8388608, f"Submission bundle too large: {size} bytes"
    report = root / "web/evidence/submission-check.json"
    data = json.loads(report.read_text())
    data.update({"snapshotBundleBytes": size, "reportUpdateReserveBytes": reserve,
                 "bundleBudgetUpperBoundBytes": size + reserve, "bundleWithinBudget": True,
                 "submissionFiles": len(paths), "measurementCommand": "python3 web/scripts/check-bundle.py",
                 "measurementScope": "Standalone Git bundle of all current submitted files, including source, dependencies already tracked in lib, runtime assets and evidence; temporary metadata in /tmp only. No build/install caches or source history in this snapshot bundle."})
    report.write_text(json.dumps(data, indent=2) + "\n")
    print(f"Complete tree snapshot bundle: {size} bytes; with report reserve: {size + reserve} / 8388608 bytes. {len(paths)} files.")
