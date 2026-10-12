"""Publish selected static pages behind an existing Lanjian Nginx server."""
import argparse, hashlib, json, os, re, subprocess, tarfile, time
from pathlib import Path

p = argparse.ArgumentParser()
p.add_argument('--bundle', required=True)
p.add_argument('--sha256', required=True)
p.add_argument('--site', default='/etc/nginx/sites-available/lanjian-app')
p.add_argument('--origin', default='https://lanjian.jiangai.space')
args = p.parse_args()
if not re.fullmatch(r'https://[a-zA-Z0-9.-]+', args.origin): raise SystemExit('Invalid origin')
bundle = Path(args.bundle)
if hashlib.sha256(bundle.read_bytes()).hexdigest() != args.sha256: raise SystemExit('Bundle hash mismatch')
root = Path('/var/www/lanjian-pages')
site = Path(args.site)
snippet = Path('/etc/nginx/snippets/lanjian-pages.conf')
statefile = Path('/etc/nginx/lanjian-page-routes.json')
backup = bundle.parent / 'nginx-publish-backup'
backup.mkdir(mode=0o700, exist_ok=False)
before = {path: path.read_bytes() if path.exists() else None for path in (site, snippet, statefile)}
for path, data in before.items():
    if data is not None: (backup / path.name).write_bytes(data)
site_text = before[site].decode()
if f'server_name {args.origin[8:]};' not in site_text: raise SystemExit('Wrong Nginx site')
with tarfile.open(bundle) as archive:
    members = archive.getmembers()
    if len(members) > 500 or sum(x.size for x in members) > 80 * 1024 * 1024: raise SystemExit('Static package exceeds bounds')
    if any(not x.isfile() or x.name.startswith('/') or '..' in Path(x.name).parts for x in members): raise SystemExit('Invalid archive entry')
    manifests = [x for x in members if x.name.endswith('/page-release.json')]
    if len(manifests) != 1: raise SystemExit('Missing manifest')
    manifest = json.load(archive.extractfile(manifests[0]))
    version = manifest['version']
    if not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}', version): raise SystemExit('Invalid version')
    routes = {'index': '/', 'login': '/login', 'admin': '/admin', 'reference': '/app/reference'}
    if not manifest['entries'] or any(x not in routes for x in manifest['entries']): raise SystemExit('Invalid page set')
    expected = {version + '/' + key for key in manifest['files']} | {version + '/page-release.json'}
    if len(expected) != len(members) or {x.name for x in members} != expected: raise SystemExit('Unexpected artifact')
    target = root / version
    if target.exists(): raise SystemExit('Release exists; choose a new version')
    staging = root / (version + '.staging')
    staging.mkdir(mode=0o755, parents=True, exist_ok=False)
    for item in members:
        relative = item.name[len(version) + 1:]
        data = archive.extractfile(item).read()
        if relative != 'page-release.json' and hashlib.sha256(data).hexdigest() != manifest['files'][relative]: raise SystemExit('File hash mismatch')
        destination = staging / relative
        if not destination.resolve().is_relative_to(staging.resolve()): raise SystemExit('Path escaped release')
        destination.parent.mkdir(parents=True, exist_ok=True, mode=0o755)
        destination.write_bytes(data)
        destination.chmod(0o644)
    staging.rename(target)
state = json.loads(before[statefile]) if before[statefile] is not None else {}
for entry in manifest['entries']: state[entry] = version
security = """    add_header X-Content-Type-Options nosniff always;
    add_header Referrer-Policy no-referrer always;
    add_header X-Frame-Options DENY always;
    add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'" always;
"""
redirect = f'    if ($scheme = http) {{ return 308 {args.origin}$request_uri; }}\n'
config = '# Managed independent page releases; APIs and studio stay on the app upstream.\n'
config += 'location ^~ /ui-pages/ {\n' + redirect + '    rewrite ^/ui-pages/(.*)$ /$1 break;\n    root /var/www/lanjian-pages;\n    autoindex off;\n    add_header Cache-Control "public, max-age=31536000, immutable" always;\n' + security + '}\n'
for entry, release in state.items():
    if entry not in routes or not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}', release): raise SystemExit('Invalid prior routes')
    config += f'location = {routes[entry]} {{\n' + redirect + f'    root {root}/{release};\n    try_files /{entry}.html =404;\n    default_type text/html;\n    add_header Cache-Control "no-store" always;\n' + security + '}\n'
include = '    include /etc/nginx/snippets/lanjian-pages.conf;\n'
if include not in site_text:
    marker = '    location / {'
    if site_text.count(marker) != 1: raise SystemExit('Cannot locate app upstream')
    site_text = site_text.replace(marker, include + marker)
def atomic(path, data):
    temporary = path.with_name(path.name + '.new')
    temporary.write_bytes(data)
    temporary.chmod(0o644)
    os.replace(temporary, path)
try:
    atomic(snippet, config.encode())
    atomic(site, site_text.encode())
    subprocess.run(['nginx', '-t'], check=True)
    subprocess.run(['systemctl', 'reload', 'nginx'], check=True)
    # Reload is asynchronous. Verify actual HTTPS bytes, not just nginx syntax.
    for entry in manifest['entries']:
        expected_html = (target / (entry + '.html')).read_bytes()
        for attempt in range(10):
            response = subprocess.run(['curl', '-fsS', '--max-time', '5', '--resolve', args.origin[8:] + ':443:127.0.0.1', args.origin + routes[entry]], capture_output=True)
            if response.returncode == 0 and response.stdout == expected_html: break
            time.sleep(.25)
        else: raise RuntimeError('Published HTML verification failed')
    atomic(statefile, json.dumps(state, indent=2).encode())
except BaseException:
    for path, data in before.items():
        if data is None: path.unlink(missing_ok=True)
        else: atomic(path, data)
    subprocess.run(['nginx', '-t'], check=True)
    subprocess.run(['systemctl', 'reload', 'nginx'], check=True)
    raise
print(json.dumps({'published': {routes[x]: version for x in manifest['entries']}, 'backup': str(backup)}))
