#!/usr/bin/env python3
"""Verify lossless historical evidence packaging, without extracting or changing a file."""
import hashlib
import io
import json
import lzma
from pathlib import Path, PurePosixPath
import tarfile

ROOT = Path(__file__).resolve().parents[2]
FOLDER = ROOT / 'docs/unlock-gates'
index = json.loads((FOLDER / 'historical-checks.json').read_text())
packed = (ROOT / index['archive']).read_bytes()
assert hashlib.sha256(packed).hexdigest() == index['archiveSha256']
raw = lzma.decompress(packed)
assert hashlib.sha256(raw).hexdigest() == index['tarSha256']
with tarfile.open(fileobj=io.BytesIO(raw), mode='r:') as archive:
    assert {m.name for m in archive.getmembers()} == set(index['files'])
    for member in archive.getmembers():
        path = PurePosixPath(member.name)
        assert not path.is_absolute() and '..' not in path.parts and member.isfile()
        expected = index['files'][member.name]
        data = archive.extractfile(member).read()
        assert len(data) == expected['bytes']
        assert hashlib.sha256(data).hexdigest() == expected['sha256'], member.name
        assert hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest() == expected['gitBlob']
        assert oct(member.mode) == expected['mode']
print('Verified byte-exact historical text archive:', len(index['files']), 'files, SHA256/Git blob/modes')
for item in json.loads((FOLDER / 'historical-json.json').read_text()):
    packed = (ROOT / item['archive']).read_bytes()
    assert hashlib.sha256(packed).hexdigest() == item['archiveSha256']
    raw = lzma.decompress(packed)
    assert len(raw) == item['originalBytes'] and hashlib.sha256(raw).hexdigest() == item['sha256']
    json.loads(raw)
    print('Verified byte-exact archived JSON:', item['original'])
