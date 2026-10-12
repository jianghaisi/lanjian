"""Real Docker acceptance in a new temporary directory; synthetic OAuth only."""
import hashlib
import json
import shutil
import socket
import sqlite3
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
from pathlib import Path

bundle = Path(sys.argv[1]).resolve()
root = Path(tempfile.mkdtemp(prefix='lanjian-public-install-'))
for source in bundle.iterdir():
    if source.is_file(): shutil.copyfile(source, root / source.name)
with socket.socket() as sock:
    sock.bind(('127.0.0.1', 0))
    port = sock.getsockname()[1]

def run(*args):
    subprocess.run(['bash', str(root / 'lanjian.sh'), *args], check=True)

def read(path):
    try:
        with urllib.request.urlopen(f'http://127.0.0.1:{port}{path}', timeout=10) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as error:
        return error.code, error.read()

def rows():
    with sqlite3.connect(root / 'runtime/data/hosted.sqlite') as db:
        return db.execute('SELECT COUNT(*) FROM users').fetchone()[0]

evidence = {'directory': str(root)}
try:
    run('install', '--public-only', '--origin', 'https://novel.example.com', '--port', str(port), '--memory-limit', '384m')
    for path in ['/', '/app', '/admin', '/app/reference', '/brand-icon.svg', '/api/reference-book/export']:
        assert read(path)[0] == 200, path
    assert json.loads(read('/api/site')[1])['loginConfigured'] is False
    for path in ['/api/me', '/api/books', '/api/admin/users']:
        assert read(path)[0] == 401, path
    assert read('/api/auth/linuxdo/start')[0] == 503
    assert rows() == 0
    key = root / 'runtime/secrets/master-key'
    master_hash = hashlib.sha256(key.read_bytes()).digest()
    secret = root / 'synthetic-oauth-secret'
    secret.write_text('synthetic-test-secret')
    secret.chmod(0o600)
    run('configure-auth', '--client-id', 'synthetic-test-client', '--admin-ids', '42', '--secret-file', str(secret))
    assert json.loads(read('/api/site')[1])['loginConfigured'] is True
    assert hashlib.sha256(key.read_bytes()).digest() == master_hash and rows() == 0
    assert read('/api/admin/users')[0] == 401
    assert len(list((root / 'backups').glob('*.tar.gz'))) == 1
    run('stop')
    run('up')
    assert json.loads(read('/api/site')[1])['loginConfigured'] is True
    assert hashlib.sha256(key.read_bytes()).digest() == master_hash and rows() == 0
    evidence.update(publicInstall=True, anonymousGuards=True, enableAuth=True, backup=True, restart=True, dataAndMasterPreserved=True)
    (root / 'results.json').write_text(json.dumps(evidence, indent=2))
    print(json.dumps(evidence), flush=True)
finally:
    if (root / 'runtime/config.env').exists(): run('stop')
