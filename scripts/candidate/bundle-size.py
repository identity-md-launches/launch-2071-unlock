#!/usr/bin/env python3
"""Conservative full-source tar.gz size gate; does not read Git or host configuration.

Includes both frontend exports, source, tests, reports, assets and vendored dependencies.
The contributor uploader remains authoritative for the actual submitted archive.
"""
import gzip
import io
from pathlib import Path
import tarfile

ROOT = Path(__file__).resolve().parents[2]
LIMIT = 8 * 1024 * 1024
# Task inputs/protected paths and reproducible local build outputs are not source.
EXCLUDED = {".git", ".github", ".imd", "node_modules", "out", "cache", "broadcast", "__pycache__"}


def source_files(directory):
    for path in sorted(directory.iterdir()):
        if path.name in EXCLUDED or path.name.startswith(".env"):
            continue
        if path == ROOT / "test/scratch" or path.suffix in (".pyc", ".pyo"):
            continue
        if path.is_symlink():
            raise SystemExit("Source must contain ordinary files: " + str(path.relative_to(ROOT)))
        if path.is_dir():
            yield from source_files(path)
        elif path.is_file():
            yield path


def main():
    files = list(source_files(ROOT))
    archive = io.BytesIO()
    with gzip.GzipFile(fileobj=archive, mode="wb", mtime=0, compresslevel=6) as compressed:
        with tarfile.open(fileobj=compressed, mode="w|", format=tarfile.USTAR_FORMAT) as bundle:
            for path in files:
                contents = path.read_bytes()
                entry = tarfile.TarInfo(path.relative_to(ROOT).as_posix())
                entry.size = len(contents)
                entry.mode = 0o755 if path.stat().st_mode & 0o111 else 0o644
                bundle.addfile(entry, io.BytesIO(contents))
    size = archive.tell()
    print(f"Full-source tar.gz estimate: {size:,} bytes ({len(files)} files)")
    print(f"Upload limit: {LIMIT:,} bytes; remaining margin: {LIMIT - size:,} bytes")
    if size > LIMIT:
        raise SystemExit("Source bundle exceeds 8 MiB")
    print("PASS: all required source, vendored dependencies and both frontend exports fit")


if __name__ == "__main__":
    main()
