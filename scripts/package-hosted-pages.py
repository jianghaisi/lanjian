"""Package selected, verified Vite pages without the unfinished studio or server."""
import argparse
import hashlib
import io
import json
import re
import tarfile
from pathlib import Path, PurePosixPath


def package(dist: Path, output: Path, version: str, pages: list[str]):
    if not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}', version):
        raise ValueError('Invalid page release version')
    dist = dist.resolve()
    manifest = json.loads((dist / '.vite/manifest.json').read_text(encoding='utf-8'))
    selected, visited = set(), set()

    def visit(key):
        if key in visited:
            return
        visited.add(key)
        entry = manifest[key]
        selected.add(entry['file'])
        selected.update(entry.get('css', []))
        selected.update(entry.get('assets', []))
        for child in entry.get('imports', []) + entry.get('dynamicImports', []):
            visit(child)

    for page in pages:
        name = page + '.html'
        if page not in ('index', 'login', 'admin', 'reference'):
            raise ValueError('Unapproved page')
        html = (dist / name).read_text(encoding='utf-8')
        if f'/ui-pages/{version}/assets/' not in html:
            raise ValueError('Build with LANJIAN_WEB_BASE matching this release')
        selected.add(name)
        visit(name)
    selected.add('brand-icon.svg')
    selected.update(p.relative_to(dist).as_posix() for p in (dist / 'third-party').glob('*.txt'))
    files = {}
    for name in sorted(selected):
        path = PurePosixPath(name)
        source = dist / name
        if path.is_absolute() or '..' in path.parts or '\\' in name or source.is_symlink() or not source.resolve().is_relative_to(dist):
            raise ValueError('Invalid static artifact')
        if path.suffix not in ('.html', '.js', '.css', '.png', '.jpg', '.jpeg', '.webp', '.svg', '.ico', '.woff', '.woff2', '.ttf', '.txt', '.mp3'):
            raise ValueError('Unexpected static type')
        files[name] = source.read_bytes()
    inventory = {'version': version, 'entries': pages, 'base': f'/ui-pages/{version}/',
                 'files': {name: hashlib.sha256(data).hexdigest() for name, data in files.items()}}
    files['page-release.json'] = json.dumps(inventory, ensure_ascii=False, indent=2).encode('utf-8')
    output.mkdir(parents=True, exist_ok=True)
    artifact = output / f'pages-{version}.tar.gz'
    with artifact.open('xb') as target, tarfile.open(fileobj=target, mode='w:gz') as archive:
        for name, data in files.items():
            entry = tarfile.TarInfo(f'{version}/{name}')
            entry.size, entry.mode = len(data), 0o644
            archive.addfile(entry, io.BytesIO(data))
    digest = hashlib.sha256(artifact.read_bytes()).hexdigest()
    artifact.with_suffix(artifact.suffix + '.sha256').write_text(f'{digest}  {artifact.name}\n', encoding='ascii')
    print(json.dumps({'artifact': str(artifact), 'sha256': digest, 'files': len(files), 'bytes': artifact.stat().st_size}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dist', type=Path, default=Path('web/dist'))
    parser.add_argument('--output', type=Path, default=Path('deploy/hosted/output'))
    parser.add_argument('--version', required=True)
    parser.add_argument('--pages', nargs='+', choices=['index', 'login', 'admin', 'reference'], required=True)
    args = parser.parse_args()
    package(args.dist, args.output, args.version, args.pages)
