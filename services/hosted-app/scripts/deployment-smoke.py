"""Run on Linux with Docker, using only a produced bundle plus an external synthetic harness."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import socket
import ssl
import subprocess
import tempfile
import urllib.error
import urllib.request

parser = argparse.ArgumentParser()
parser.add_argument('--bundle', required=True)
parser.add_argument('--driver', required=True)
args = parser.parse_args()
source, driver = Path(args.bundle).resolve(), Path(args.driver).resolve()
assert os.geteuid() == 0
root = Path(tempfile.mkdtemp(prefix='lanjian-deployment-smoke-')).resolve()
print('ISOLATED_ROOT=' + str(root), flush=True)

def clone(name):
    target = root / name
    target.mkdir()
    for file in source.iterdir():
        if file.is_file(): shutil.copy2(file, target / file.name)
    return target

def run(bundle, *arguments, success=True):
    result = subprocess.run(['bash', 'lanjian.sh', *map(str, arguments)], cwd=bundle, text=True, capture_output=True)
    if success:
        assert result.returncode == 0, result.stdout + '\n' + result.stderr
    else:
        assert result.returncode != 0, 'Expected refusal: ' + str(arguments)
    print('PASS ' + str(arguments[0]) + (' / expected refusal' if not success else ''), flush=True)
    return result

def ops(bundle):
    spec = importlib.util.spec_from_file_location('release_ops_' + bundle.name, bundle / 'operator.py')
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module

def check_web(port):
    for path in ('/', '/app', '/app/reference', '/admin', '/health'):
        with urllib.request.urlopen(f'http://127.0.0.1:{port}{path}', timeout=5) as response:
            assert response.status == 200
            if path != '/health':
                assert 'text/html' in response.headers['Content-Type']
                assert "frame-ancestors 'none'" in response.headers['Content-Security-Policy']
    for path in ('/api/me', '/api/admin/users'):
        try: urllib.request.urlopen(f'http://127.0.0.1:{port}{path}')
        except urllib.error.HTTPError as error: assert error.code == 401
        else: raise AssertionError('Private route allowed anonymous access')
    print('PASS production listener: 3 entries, health, CSP, anonymous denial', flush=True)

def harness(bundle, mode):
    operator = ops(bundle)
    result = operator.compose(['run', '--rm', '--no-deps', '-v', f'{driver}:/app/services/hosted-app/dist/deployment-driver.mjs:ro', '-v', f'{root / "evidence"}:/evidence', 'app', 'node', 'services/hosted-app/dist/deployment-driver.mjs', mode])
    print(result, flush=True)

def derived(name, broken=False):
    target = clone(name)
    manifest = json.loads((target / 'manifest.json').read_text())
    manifest['version'] = name
    if broken:
        path = target / 'compose.yaml'
        path.write_text(path.read_text().replace('    init: true', '    command: ["node", "-e", "process.exit(1)"]\n    init: true'))
    manifest['files'] = {name: hashlib.sha256((target / name).read_bytes()).hexdigest() for name in manifest['files']}
    (target / 'manifest.json').write_text(json.dumps(manifest))
    return target

first = clone('installed')
secret = root / 'synthetic-oauth-secret'; secret.write_text('synthetic-container-oauth-secret'); secret.chmod(0o600)
evidence = root / 'evidence'; evidence.mkdir(); os.chown(evidence, 10001, 10001)
port = 45431
restored = None
try:
    run(first, 'install', '--origin', 'https://novel.invalid', '--client-id', 'synthetic', '--admin-ids', '42', '--secret-file', secret, '--port', port)
    check_web(port)
    before_key = (first / 'runtime/secrets/master-key').read_bytes()
    run(first, 'install', success=False)
    assert before_key == (first / 'runtime/secrets/master-key').read_bytes()
    run(first, 'stop'); harness(first, 'seed'); run(first, 'up'); check_web(port)
    run(first, 'stop'); harness(first, 'verify'); run(first, 'up')
    run(first, 'backup')
    backup = sorted((first / 'backups').glob('*.tar.gz'))[-1]
    healthy = derived('smoke-upgrade-healthy')
    run(first, 'update', healthy); check_web(port)
    run(first, 'stop'); harness(first, 'verify'); run(first, 'up')
    broken = derived('smoke-upgrade-broken', broken=True)
    run(first, 'update', broken, success=False); check_web(port)
    assert json.loads((first / 'current.json').read_text())['directory'] == 'releases/smoke-upgrade-healthy'
    run(first, 'stop'); harness(first, 'verify'); run(first, 'up')
    restored = clone('restored')
    run(restored, 'restore', backup)
    assert before_key == (restored / 'runtime/secrets/master-key').read_bytes()
    config = restored / 'runtime/config.env'; config.write_text(config.read_text().replace('LANJIAN_BIND_PORT=45431', 'LANJIAN_BIND_PORT=45432'))
    run(restored, 'load'); run(restored, 'up'); check_web(45432)
    run(restored, 'stop'); harness(restored, 'verify')
    run(restored, 'restore', backup, success=False)
    # Caddy's localhost issuer exercises actual non-root TLS/proxy startup
    # without requesting a public certificate or requiring a real domain.
    config = first / 'runtime/config.env'
    config.write_text(config.read_text().replace('https://novel.invalid', 'https://localhost')
                      .replace('LANJIAN_PROXY=0', 'LANJIAN_PROXY=1')
                      .replace('LANJIAN_HTTP_PORT=80', 'LANJIAN_HTTP_PORT=45433')
                      .replace('LANJIAN_HTTPS_PORT=443', 'LANJIAN_HTTPS_PORT=45434'))
    run(first, 'up')
    for path in ('/', '/app', '/admin'):
        with urllib.request.urlopen('https://localhost:45434' + path, context=ssl._create_unverified_context(), timeout=10) as response:
            assert response.status == 200 and 'text/html' in response.headers['Content-Type']
    print('PASS bundled Caddy as UID 10001: real localhost TLS and three proxied entries (public ACME untested)', flush=True)
    (evidence / 'results.json').write_text(json.dumps({'status': 'passed', 'bundle': json.loads((source / 'manifest.json').read_text())['version'],
        'scenarios': ['install', 'three-entries-and-reference', 'two-owners-four-books-four-paid-tasks', 'complete-reference-copy', 'better-auth-session-persistence', 'restart', 'backup', 'upgrade', 'failed-upgrade-rollback', 'fresh-restore', 'duplicate-refusal', 'caddy-localhost-tls'],
        'publicOAuth': False, 'paidProvider': False, 'publicTLS': False}, indent=2))
    print('DEPLOYMENT PASS: archive load, real Linux production startup, synthetic OAuth/4 metered jobs, restart, upgrade, failed upgrade rollback, backup and fresh-directory restore.', flush=True)
finally:
    for bundle in [first, restored]:
        if bundle and (bundle / 'runtime/config.env').exists():
            subprocess.run(['bash', 'lanjian.sh', 'stop'], cwd=bundle, capture_output=True)
    print('Test containers stopped; evidence and backups retained at ' + str(root), flush=True)
