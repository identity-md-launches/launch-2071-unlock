#!/usr/bin/env python3
"""Check the byte-exact historical evidence archive; restore only with --restore."""
import argparse
import hashlib
import io
import json
import lzma
from pathlib import Path, PurePosixPath
import stat
import tarfile

ROOT = Path(__file__).resolve().parents[2]
FOLDER = ROOT / "docs/labs-historical-evidence"
MAX_BYTES = 20 * 1024 * 1024


def digest(data):
    return hashlib.sha256(data).hexdigest()


def safe_destination(name):
    path = PurePosixPath(name)
    if (path.is_absolute() or not path.parts or path.parts[0] not in ("docs", "delivery")
            or any(p in ("", ".", "..", ".git", ".github", "node_modules", "lib")
                   or p == ".env" or p.startswith(".env.") for p in path.parts)
            or str(path).startswith("docs/labs-historical-evidence/")
            or path.name in ("package.json", "package-lock.json", "npm-shrinkwrap.json", "pnpm-lock.yaml", "yarn.lock", "bun.lock", "bun.lockb", "foundry.toml", "foundry.lock", "remappings.txt", ".gitmodules")
            or path.name.endswith(".lock")):
        raise ValueError("Archive path is outside historical documentation: " + name)
    destination = ROOT.joinpath(*path.parts)
    for parent in [destination, *destination.parents]:
        if parent == ROOT:
            break
        if parent.is_symlink():
            raise ValueError("Archive restore refuses symlinks: " + name)
    if not destination.resolve().is_relative_to(ROOT):
        raise ValueError("Archive path escapes this repository: " + name)
    return destination


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--restore", action="store_true", help="explicitly restore original evidence paths after checking every archived byte")
    args = parser.parse_args()
    manifest = json.loads((FOLDER / "manifest.json").read_text())
    expected = manifest["files"]
    if not isinstance(expected, dict) or not 0 < len(expected) < 1000:
        raise ValueError("Invalid archive file catalog")
    packed = (FOLDER / "archive.tar.xz").read_bytes()
    if len(packed) != manifest["archiveBytes"] or digest(packed) != manifest["archiveSha256"]:
        raise ValueError("Compressed archive checksum does not match the manifest")
    decompressor = lzma.LZMADecompressor()
    raw = decompressor.decompress(packed, max_length=MAX_BYTES + 1)
    if len(raw) > MAX_BYTES or not decompressor.eof or decompressor.unused_data:
        raise ValueError("Historical archive exceeds its size bound or has trailing data")
    if len(raw) != manifest["tarBytes"] or digest(raw) != manifest["tarSha256"]:
        raise ValueError("Tar checksum does not match the manifest")
    checked = []
    with tarfile.open(fileobj=io.BytesIO(raw), mode="r:") as archive:
        members = archive.getmembers()
        if len(members) != len(expected) or {m.name for m in members} != set(expected):
            raise ValueError("Archive file catalog differs from manifest")
        for member in members:
            destination = safe_destination(member.name)
            entry = expected[member.name]
            if not member.isfile() or member.size != entry["bytes"] or member.mode != entry["mode"]:
                raise ValueError("Invalid archived file metadata: " + member.name)
            handle = archive.extractfile(member)
            if handle is None:
                raise ValueError("Missing archived data: " + member.name)
            data = handle.read(MAX_BYTES + 1)
            if len(data) != entry["bytes"] or digest(data) != entry["sha256"]:
                raise ValueError("Original evidence checksum differs: " + member.name)
            if hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest() != entry["gitBlob"]:
                raise ValueError("Original Git blob differs: " + member.name)
            if args.restore and destination.exists():
                current = digest(destination.read_bytes())
                if current not in (entry["sha256"], entry["pointerSha256"]):
                    raise ValueError("Restore refuses to overwrite a changed document: " + member.name)
            checked.append((destination, data, entry["mode"]))
    # Validate all paths and bytes before changing any file; never use extractall().
    if args.restore:
        for destination, data, mode in checked:
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(data)
            destination.chmod(stat.S_IMODE(mode))
    print(("Restored" if args.restore else "Verified without writing"), len(checked), "historical evidence files; original SHA-256, Git blob, byte lengths and modes match")


if __name__ == "__main__":
    main()
