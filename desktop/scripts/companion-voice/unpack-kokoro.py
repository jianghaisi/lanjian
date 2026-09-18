"""Explicit, data-only setup. No upstream scripts executed, no existing files replaced."""
import hashlib
import json
from pathlib import Path, PurePosixPath
import tarfile
import tempfile

ROOT = Path(__file__).resolve().parents[4] / '.local/companion-voice/models'
NAME = 'kokoro-int8-multi-lang-v1_1'
DIGEST = 'a1e94694776049035c4f2c6529f003aaece993c76aae9a78995831c3c4dcafc6'
archive = (ROOT / 'kokoro-package' / (NAME + '.tar.bz2')).resolve(strict=True)
if not archive.is_relative_to(ROOT.resolve(strict=True)):
    raise ValueError('Archive escaped dedicated model root')
with archive.open('rb') as source:
    if hashlib.file_digest(source, 'sha256').hexdigest() != DIGEST:
        raise ValueError('Archive hash mismatch')
destination = ROOT / NAME
if destination.exists():
    raise ValueError('Existing model preserved; verify instead of overwriting')
staging = Path(tempfile.mkdtemp(prefix='kokoro-unpack-', dir=ROOT)).resolve(strict=True)
manifest = {}
total = 0
with tarfile.open(archive, 'r:bz2') as tar:
    for member in tar:
        path = PurePosixPath(member.name)
        if path.is_absolute() or '..' in path.parts or '\\' in member.name or ':' in member.name or path.parts[0] != NAME:
            raise ValueError('Unsafe archive path')
        if not member.isdir() and not member.isfile():
            raise ValueError('Links and special files are not accepted')
        relative = Path(*path.parts[1:])
        if member.isdir():
            continue
        # Model distribution contains a dictionary-generation script; never install/execute it.
        if relative.suffix.lower() in ('.py', '.sh', '.exe', '.dll', '.bat', '.cmd'):
            continue
        total += member.size
        if member.size > 200_000_000 or total > 600_000_000 or len(manifest) > 1000:
            raise ValueError('Archive exceeds allowed model size')
        target = (staging / relative).resolve()
        if not target.is_relative_to(staging):
            raise ValueError('Unsafe destination')
        target.parent.mkdir(parents=True, exist_ok=True)
        data = tar.extractfile(member).read()
        with target.open('xb') as output:
            output.write(data)
        manifest[relative.as_posix()] = {'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}
for required in ('model.int8.onnx', 'voices.bin', 'tokens.txt', 'lexicon-zh.txt', 'lexicon-us-en.txt', 'espeak-ng-data/phondata'):
    if required not in manifest:
        raise ValueError('Incomplete model package')
(staging / 'verified-files.json').write_text(json.dumps({'archiveSha256': DIGEST, 'files': manifest}, indent=2), encoding='utf-8')
# Both resolved endpoints are contained in the dedicated model root; never overwrite an existing model.
if not staging.is_relative_to(ROOT.resolve()) or not destination.resolve().is_relative_to(ROOT.resolve()):
    raise ValueError('Publish escaped model root')
staging.rename(destination)
print(json.dumps({'model': NAME, 'files': len(manifest), 'bytes': total}))
