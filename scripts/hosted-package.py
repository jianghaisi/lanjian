"""Build a narrowly enumerated Docker context and notices. Never copy a workspace tree."""
import json
import shutil
import sys
from pathlib import Path

repo, context, output = map(lambda p: Path(p).resolve(), sys.argv[1:4])
context.mkdir(parents=True, exist_ok=False)
output.mkdir(parents=True, exist_ok=False)

def copy(relative):
    source = (repo / relative).resolve()
    if not source.is_relative_to(repo) or source.is_symlink():
        raise RuntimeError('Source escaped repository')
    target = context / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, target)

for package in ('packages/hosted-contracts', 'services/hosted-app'):
    for name in ('package.json', 'package-lock.json'):
        copy(f'{package}/{name}')
    for path in (repo / package / 'src').rglob('*.ts'):
        copy(path.relative_to(repo))
copy('packages/hosted-contracts/tsconfig.json')
copy('services/hosted-app/scripts/build.mjs')
copy('services/hosted-app/src/reference/guest-snapshot.json')
inputs = json.loads((repo / 'services/hosted-app/dist/inputs.json').read_text(encoding='utf-8'))
for name in inputs:
    path = (repo / 'services/hosted-app' / name).resolve()
    if path.is_relative_to(repo / 'desktop/src') or path.is_relative_to(repo / 'packages/writing-plugin-contracts/src'):
        if path.suffix not in ('.ts', '.json'):
            raise RuntimeError('Unexpected source format')
        copy(path.relative_to(repo))
# Enumerate this build, not stale chunks left by earlier builds or another tool.
web_manifest = json.loads((repo / 'web/dist/.vite/manifest.json').read_text(encoding='utf-8'))
web_files = {'index.html', 'login.html', 'studio.html', 'admin.html', 'reference.html', 'experience-demo.png', 'brand-icon.svg'}
for entry in web_manifest.values():
    web_files.add(entry['file'])
    web_files.update(entry.get('css', []))
    web_files.update(entry.get('assets', []))
# Runtime public assets emitted by the Vite plugin are not module-manifest
# dependencies. Enumerate their reviewed source directories explicitly.
for asset in (repo / 'desktop/public').rglob('*'):
    if asset.is_file() and asset.suffix not in ('.cmo3', '.wav'):
        web_files.add(asset.relative_to(repo / 'desktop/public').as_posix())
for asset in (repo / 'web/media/public').rglob('*'):
    if asset.is_file(): web_files.add(asset.relative_to(repo / 'web/media/public').as_posix())
web_files.update(f'third-party/{name}-LICENSE.txt' for name in ('threeui', 'animatedlogin-react', 'soybean-admin', 'pixi.js', 'pixi-unsafe-eval'))
web_files.add('third-party/NOTICES.txt')
for name in sorted(web_files):
    path = Path(name)
    if path.is_absolute() or '..' in path.parts or path.suffix not in ('.html', '.js', '.css', '.png', '.svg', '.ico', '.woff2', '.woff', '.ttf', '.json', '.webp', '.jpg', '.jpeg', '.glb', '.bin', '.moc3', '.mp3', '.wav', '.ogg', '.wasm', '.txt', '.webm'):
        raise RuntimeError('Unexpected frontend artifact')
    copy(Path('web/dist') / path)
shutil.copyfile(repo / 'deploy/hosted/Dockerfile', context / 'Dockerfile')
for name in ('compose.yaml', 'Caddyfile', 'operator.py', 'lanjian.sh', 'config.example', 'LICENSE'):
    shutil.copyfile(repo / 'deploy/hosted' / name, output / name)
shutil.copyfile(repo / 'docs/HOSTED-DEPLOYMENT.md', output / 'README.md')
notices = ['Third-party license notices for included runtime/frontend and build tools.\n']
seen = set()
for package in ('services/hosted-app', 'web', 'packages/hosted-contracts'):
    for metadata in (repo / package / 'node_modules').rglob('package.json'):
        try:
            data = json.loads(metadata.read_text(encoding='utf-8'))
        except (ValueError, OSError):
            continue
        identity = str(data.get('name', '')) + '@' + str(data.get('version', ''))
        if identity in seen or not data.get('name'):
            continue
        seen.add(identity)
        notices.append('\n--- ' + identity + ' | ' + str(data.get('license', 'See component license')) + ' ---\n')
        for path in sorted(metadata.parent.iterdir()):
            if path.is_file() and path.name.lower().split('.')[0] in ('license', 'licence', 'copying', 'notice'):
                notices.append(path.read_text(encoding='utf-8', errors='replace') + '\n')
(output / 'THIRD-PARTY-NOTICES.txt').write_text(''.join(notices), encoding='utf-8')
files = [str(p.relative_to(context)).replace('\\', '/') for p in context.rglob('*') if p.is_file()]
(context.parent / (context.name + '-inventory.json')).write_text(json.dumps(sorted(files), indent=2), encoding='utf-8')
print(f'Whitelisted context: {len(files)} files; no user data or host node_modules.')
