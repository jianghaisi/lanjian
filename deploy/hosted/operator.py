"""Single-instance deployment operations. No third-party Python dependencies."""
import argparse
import base64
import contextlib
import datetime
import getpass
import hashlib
import json
import os
import platform
import re
import secrets
import shutil
import socket
import sqlite3
import subprocess
import sys
import tarfile
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
RUNTIME = ROOT / 'runtime'
CONFIG = RUNTIME / 'config.env'
PROGRAM_FILES = {'compose.yaml', 'Caddyfile', 'operator.py', 'lanjian.sh', 'config.example', 'README.md', 'LICENSE', 'THIRD-PARTY-NOTICES.txt', 'image.tar'}
CONFIG_KEYS = {'LANJIAN_PUBLIC_ORIGIN', 'LINUXDO_CLIENT_ID', 'LANJIAN_ADMIN_LINUXDO_IDS', 'LANJIAN_BIND_PORT', 'LANJIAN_MEMORY_LIMIT', 'LANJIAN_PROXY', 'LANJIAN_HTTP_PORT', 'LANJIAN_HTTPS_PORT'}

def require(condition, message):
    if not condition:
        raise RuntimeError(message)

def atomic(path, value, mode=0o600):
    temp = path.with_name(path.name + '.new-' + secrets.token_hex(4))
    with temp.open('x', encoding='utf-8', newline='\n') as handle:
        os.chmod(temp, mode)
        handle.write(value)
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temp, path)

def sha(path):
    result = hashlib.sha256()
    with path.open('rb') as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b''):
            result.update(chunk)
    return result.hexdigest()

def verify(bundle):
    manifest = json.loads((bundle / 'manifest.json').read_text(encoding='utf-8'))
    require(manifest.get('platform') == 'linux/amd64' and platform.machine().lower() in ('x86_64', 'amd64'), '此部署包仅验证 Linux amd64，请使用匹配的服务器。')
    require(set(manifest['files']) == PROGRAM_FILES, '发布包文件清单不完整。')
    for name, expected in manifest['files'].items():
        path = bundle / name
        require(path.is_file() and not path.is_symlink() and sha(path) == expected, '发布文件校验失败：' + name)
    require(re.fullmatch(r'[a-z0-9][a-z0-9._-]{1,79}', manifest['version']), '无效发布版本。')
    for key in ('image', 'proxyImage'):
        require(re.fullmatch(r'[a-z0-9./:_-]+', manifest[key]), '无效镜像名称。')
    require(manifest['schema'] == 3 and manifest.get('authSchema') == 1 and manifest['minSchema'] == 0 and isinstance(manifest['bookSchema'], int) and 1 <= manifest['bookSchema'] <= 10000, '当前运维脚本不支持此 schema。')
    return manifest

def active_bundle():
    pointer = ROOT / 'current.json'
    if not pointer.exists():
        return ROOT
    relative = json.loads(pointer.read_text(encoding='utf-8'))['directory']
    require(re.fullmatch(r'releases/[a-z0-9][a-z0-9._-]{1,79}', relative), '无效当前版本指针。')
    path = (ROOT / relative).resolve()
    require(path.is_relative_to(ROOT), '当前版本越出部署目录。')
    return path

def config():
    require(CONFIG.is_file(), '尚未安装。请先运行 install。')
    result = {}
    for line in CONFIG.read_text(encoding='utf-8').splitlines():
        if not line.strip() or line.startswith('#'):
            continue
        key, sep, value = line.partition('=')
        require(sep and key in CONFIG_KEYS and key not in result and not re.search(r'[\s$\x00-\x1f]', value), '配置文件格式错误。')
        result[key] = value
    validate_config(result)
    require((RUNTIME / 'secrets/master-key').is_file() and (RUNTIME / 'secrets/linuxdo-client').is_file(), '密钥文件缺失；请从完整备份恢复，不要重新生成主密钥。')
    require(bool(result['LINUXDO_CLIENT_ID']) == bool((RUNTIME / 'secrets/linuxdo-client').read_text(encoding='utf-8').strip()), 'Linux DO Client ID 与 Secret 必须同时配置或同时留空。')
    return result

def validate_config(value):
    require(set(value) == CONFIG_KEYS, '配置字段缺失或有未知字段。')
    origin = urllib.parse.urlsplit(value['LANJIAN_PUBLIC_ORIGIN'])
    require(origin.scheme == 'https' and origin.hostname and not origin.username and not origin.password and not origin.query and not origin.fragment and not origin.path and re.fullmatch(r'https://[a-zA-Z0-9.:-]+', value['LANJIAN_PUBLIC_ORIGIN']), '公网地址必须是完整 HTTPS 域名源，如 https://novel.example.com（无末尾斜线）。')
    if value['LINUXDO_CLIENT_ID'] or value['LANJIAN_ADMIN_LINUXDO_IDS']:
        require(re.fullmatch(r'[a-zA-Z0-9._:-]{1,300}', value['LINUXDO_CLIENT_ID']), '请填写真实 Linux DO Client ID。')
        require(re.fullmatch(r'[1-9][0-9]{0,29}(,[1-9][0-9]{0,29})*', value['LANJIAN_ADMIN_LINUXDO_IDS']), '管理员必须是 Linux DO 数字 ID，多个用逗号分隔。')
    for key in ('LANJIAN_BIND_PORT', 'LANJIAN_HTTP_PORT', 'LANJIAN_HTTPS_PORT'):
        require(value[key].isdigit() and 1 <= int(value[key]) <= 65535, '端口配置无效。')
    require(re.fullmatch(r'[1-9][0-9]{1,5}[mg]', value['LANJIAN_MEMORY_LIMIT']) and value['LANJIAN_PROXY'] in ('0', '1'), '内存或代理配置无效。')

def command(args, env=None, visible=False):
    result = subprocess.run(args, cwd=ROOT, env=env, text=True, stdout=None if visible else subprocess.PIPE, stderr=None if visible else subprocess.PIPE)
    require(result.returncode == 0, '命令执行失败：' + ' '.join(args[:3]) + '；配置和数据已保留。\n' + (result.stderr or '')[-1800:])
    return (result.stdout or '').strip()

def prerequisites():
    require(sys.platform == 'linux', '运维入口请在 Linux 服务器运行。')
    require(os.geteuid() == 0, '请使用 sudo bash lanjian.sh，以设置独立服务用户的数据权限。')
    require(shutil.which('docker'), '请先安装 Docker Engine 与 Compose v2。')
    command(['docker', 'info', '--format', '{{.OSType}}'])
    command(['docker', 'compose', 'version'])

def compose(action, bundle=None, visible=False):
    bundle = bundle or active_bundle()
    manifest = json.loads((bundle / 'manifest.json').read_text(encoding='utf-8'))
    values = config()
    env = {**os.environ, **values, 'LANJIAN_IMAGE': manifest['image'], 'LANJIAN_PROXY_IMAGE': manifest['proxyImage'], 'LANJIAN_RUNTIME_DIR': str(RUNTIME), 'LANJIAN_BUNDLE_DIR': str(bundle)}
    project = 'lanjian-' + hashlib.sha256(str(ROOT).encode()).hexdigest()[:10]
    args = ['docker', 'compose', '--project-name', project, '--project-directory', str(ROOT), '--env-file', str(CONFIG), '-f', str(bundle / 'compose.yaml')]
    if values['LANJIAN_PROXY'] == '1':
        args += ['--profile', 'proxy']
    return command(args + action, env=env, visible=visible)

def running():
    ids = compose(['ps', '--status', 'running', '-q', 'app'])
    return bool(ids)

def free_space(path, required):
    require(shutil.disk_usage(path).free >= required, '可用磁盘空间不足；未改动现有数据。')

def schemas(data=None):
    data = data or RUNTIME / 'data'
    values = {}
    if data.exists():
        for path in sorted(data.rglob('*.sqlite')):
            require(not path.is_symlink(), '数据库路径不能是链接。')
            if path.name not in ('hosted.sqlite', 'auth.sqlite', 'workspace.sqlite'):
                continue
            with contextlib.closing(sqlite3.connect(path.as_uri() + '?mode=ro', uri=True)) as db:
                values[str(path.relative_to(data))] = db.execute('PRAGMA user_version').fetchone()[0]
    return values

def compatible(manifest, versions):
    return all(version <= (manifest['schema'] if name == 'hosted.sqlite' else manifest.get('authSchema', 0) if name == 'auth.sqlite' else manifest['bookSchema']) for name, version in versions.items())

def ports_available(values):
    ports = [('127.0.0.1', int(values['LANJIAN_BIND_PORT']))]
    if values['LANJIAN_PROXY'] == '1':
        ports += [('0.0.0.0', int(values[k])) for k in ('LANJIAN_HTTP_PORT', 'LANJIAN_HTTPS_PORT')]
    for host, port in ports:
        with socket.socket() as sock:
            # A stopped HTTP listener can leave accepted sockets in TIME_WAIT.
            # Match normal server rebinding; an active listener still rejects bind.
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                sock.bind((host, port))
            except OSError:
                raise RuntimeError(f'端口 {port} 已被占用，请修改 runtime/config.env 后重试。') from None

def load(bundle):
    manifest = verify(bundle)
    free_space(ROOT, (bundle / 'image.tar').stat().st_size * 2 + 256 * 1024 * 1024)
    command(['docker', 'load', '-i', str(bundle / 'image.tar')])
    for key, id_key in [('image', 'imageId'), ('proxyImage', 'proxyImageId')]:
        require(command(['docker', 'image', 'inspect', '--format', '{{.Id}}', manifest[key]]) == manifest[id_key], '加载后的镜像身份与发布清单不一致。')
    return manifest

def health():
    url = 'http://127.0.0.1:' + config()['LANJIAN_BIND_PORT'] + '/health'
    for _ in range(60):
        try:
            with urllib.request.urlopen(url, timeout=2) as response:
                if response.status == 200 and json.load(response).get('status') == 'ok':
                    return
        except (OSError, ValueError):
            pass
        time.sleep(1)
    raise RuntimeError('服务未通过健康检查；数据已保留。请运行 logs。')

def up(bundle=None):
    bundle = bundle or active_bundle()
    manifest = verify(bundle)
    require(compatible(manifest, schemas()), '数据 schema 比程序新，拒绝启动旧程序。')
    if not running():
        ports_available(config())
    compose(['up', '-d', '--no-build', '--pull', 'never', '--wait', '--wait-timeout', '90'], bundle)
    health()

def install(args):
    verify(ROOT)
    require(not RUNTIME.exists(), '已经有 runtime 目录，拒绝重复安装覆盖。请使用 up 或备份恢复。')
    public_only = getattr(args, 'public_only', False)
    require(not public_only or not any((args.client_id, args.admin_ids, args.secret_file)), '--public-only 不接受登录凭据，请稍后使用 configure-auth。')
    values = dict(LANJIAN_PUBLIC_ORIGIN=args.origin or input('HTTPS 域名源：').strip(), LINUXDO_CLIENT_ID='' if public_only else args.client_id or input('Linux DO Client ID：').strip(), LANJIAN_ADMIN_LINUXDO_IDS='' if public_only else args.admin_ids or input('管理员 Linux DO 数字 ID：').strip(), LANJIAN_BIND_PORT=str(args.port), LANJIAN_MEMORY_LIMIT=getattr(args, 'memory_limit', '768m'), LANJIAN_PROXY='1' if args.proxy else '0', LANJIAN_HTTP_PORT='80', LANJIAN_HTTPS_PORT='443')
    validate_config(values)
    secret = '' if public_only else auth_secret(args)
    ports_available(values)
    load(ROOT)
    RUNTIME.mkdir(mode=0o700)
    for name in ('data', 'secrets', 'proxy-data', 'proxy-config'):
        directory = RUNTIME / name
        directory.mkdir(mode=0o700)
        os.chown(directory, 10001, 10001)
    atomic(CONFIG, ''.join(f'{k}={v}\n' for k, v in values.items()))
    for name, content in [('master-key', base64.b64encode(secrets.token_bytes(32)).decode()), ('linuxdo-client', secret)]:
        path = RUNTIME / 'secrets' / name
        atomic(path, content + '\n')
        os.chown(path, 10001, 10001)
    up(ROOT)
    print('安装完成。三个入口：/、/app、/admin。' + ('目前仅公开介绍和参考书；申请 Linux DO 应用后运行 configure-auth 启用登录。' if public_only else '首次登录赠送 10 积分；管理员登录后配置模型和费率。'))

def auth_secret(args):
    secret = Path(args.secret_file).read_text(encoding='utf-8').strip() if args.secret_file else getpass.getpass('Linux DO Client Secret（不回显）：').strip()
    require(secret and '\n' not in secret and '\r' not in secret and len(secret) <= 8192, 'Client Secret 格式无效。')
    return secret

def configure_auth(args):
    values = config()
    require(not values['LINUXDO_CLIENT_ID'], '登录已经配置；此命令仅用于首次启用，不更换现有身份提供商。')
    values['LINUXDO_CLIENT_ID'] = args.client_id or input('Linux DO Client ID：').strip()
    values['LANJIAN_ADMIN_LINUXDO_IDS'] = args.admin_ids or input('管理员 Linux DO 数字 ID：').strip()
    require(values['LINUXDO_CLIENT_ID'] and values['LANJIAN_ADMIN_LINUXDO_IDS'], '启用登录需要真实 Client ID 和管理员数字 ID。')
    validate_config(values)
    secret = auth_secret(args)
    old_config = CONFIG.read_text(encoding='utf-8')
    path = RUNTIME / 'secrets/linuxdo-client'
    old_secret = path.read_text(encoding='utf-8')
    backup(restart=False)
    try:
        atomic(path, secret + '\n')
        os.chown(path, 10001, 10001)
        atomic(CONFIG, ''.join(f'{k}={v}\n' for k, v in values.items()))
        up()
    except Exception:
        atomic(path, old_secret)
        os.chown(path, 10001, 10001)
        atomic(CONFIG, old_config)
        compose(['stop', '--timeout', '60'])
        up()
        raise
    print('登录配置已启用；请使用真实 Linux DO 账号核对登录和后台权限。主密钥、作品和积分已保留。')

def backup(restart=True):
    bundle = active_bundle()
    was_running = running()
    size = sum(p.stat().st_size for p in RUNTIME.rglob('*') if p.is_file())
    free_space(ROOT, size + 256 * 1024 * 1024)
    destination = ROOT / 'backups'
    destination.mkdir(mode=0o700, exist_ok=True)
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '-' + secrets.token_hex(3)
    path = destination / ('lanjian-' + stamp + '.tar.gz')
    compose(['stop', '--timeout', '60'])
    try:
        for p in RUNTIME.rglob('*'):
            require(not p.is_symlink(), '数据中存在链接，拒绝不完整备份。')
        with tarfile.open(path, 'x:gz') as archive:
            os.chmod(path, 0o600)
            archive.add(RUNTIME, arcname='runtime')
        atomic(path.with_name(path.name + '.sha256'), sha(path) + '\n')
    finally:
        if restart and was_running:
            up(bundle)
    print('备份已创建（含密钥，请妥善保管）：' + str(path))
    return path

def restore(args):
    manifest = verify(active_bundle())
    require(not RUNTIME.exists(), '恢复只允许在没有 runtime 的新部署目录进行。原数据未改动。')
    path = Path(args.backup).resolve()
    require(path.is_file() and path.with_name(path.name + '.sha256').is_file(), '需要备份文件及同名 .sha256 校验文件。')
    require(sha(path) == path.with_name(path.name + '.sha256').read_text().strip(), '备份校验失败。')
    with tarfile.open(path, 'r:gz') as archive:
        members = archive.getmembers()
        for member in members:
            parts = Path(member.name).parts
            require(parts and parts[0] == 'runtime' and not Path(member.name).is_absolute() and '..' not in parts and (member.isfile() or member.isdir()), '备份含不安全路径或链接。')
        require(len({m.name for m in members}) == len(members), '备份有重复路径。')
        free_space(ROOT, sum(m.size for m in members) + 256 * 1024 * 1024)
        staging = ROOT / ('restore-staging-' + secrets.token_hex(5))
        staging.mkdir(mode=0o700)
        for member in members:
            target = staging / member.name
            if member.isdir():
                target.mkdir(mode=0o700, parents=True, exist_ok=True)
            else:
                target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
                with archive.extractfile(member) as source, target.open('xb') as output:
                    os.chmod(target, 0o600)
                    shutil.copyfileobj(source, output)
        restored = staging / 'runtime'
        require((restored / 'config.env').is_file() and (restored / 'secrets/master-key').is_file(), '备份缺少配置或主密钥。保留 staging 以检查。')
        require((restored / 'data/hosted.sqlite').is_file() and compatible(manifest, schemas(restored / 'data')), '备份 schema 不受支持，未覆盖任何目录。')
        for name in ('data', 'secrets', 'proxy-data', 'proxy-config'):
            (restored / name).mkdir(mode=0o700, exist_ok=True)
            for p in [restored / name, *(restored / name).rglob('*')]:
                os.chown(p, 10001, 10001)
        restored.rename(RUNTIME)
        staging.rmdir()
    print('已恢复到新目录，尚未启动。检查 runtime/config.env 的域名/端口，然后运行 load 和 up。')

def update(args):
    new = Path(args.bundle).resolve()
    manifest = verify(new)
    require(compatible(manifest, schemas()), '新包不支持当前数据 schema。')
    target = ROOT / 'releases' / manifest['version']
    require(not target.exists(), '此版本已经导入，拒绝覆盖发布目录。')
    load(new)
    free_space(ROOT, sum(p.stat().st_size for p in new.iterdir() if p.is_file()) + 256 * 1024 * 1024)
    target.mkdir(parents=True)
    for name in PROGRAM_FILES | {'manifest.json', 'SHA256SUMS'}:
        shutil.copy2(new / name, target / name)
    verify(target)
    old = active_bundle()
    old_schema = schemas()
    backup(restart=False)
    try:
        up(target)
    except Exception:
        compose(['stop', '--timeout', '60'], target)
        if schemas() == old_schema:
            up(old)
            print('新程序启动失败，已恢复原程序；没有回退或覆盖数据。', file=sys.stderr)
        else:
            print('数据 schema 已变化；服务保持停止。请用完整备份恢复到新目录。', file=sys.stderr)
        raise
    atomic(ROOT / 'current.json', json.dumps({'directory': str(target.relative_to(ROOT)).replace(os.sep, '/')}) + '\n')
    for name in ('operator.py', 'lanjian.sh'):
        atomic(ROOT / name, (target / name).read_text(encoding='utf-8'), 0o755)
    print('更新完成，旧程序与更新前备份已保留。')

def main():
    parser = argparse.ArgumentParser(description='岚笺服务器运维（Docker Compose v2 + Python 3.9+）')
    sub = parser.add_subparsers(dest='action', required=True)
    install_parser = sub.add_parser('install')
    for option in ('origin', 'client-id', 'admin-ids', 'secret-file'):
        install_parser.add_argument('--' + option)
    install_parser.add_argument('--port', type=int, default=43130)
    install_parser.add_argument('--public-only', action='store_true', help='先开放介绍和参考书，暂不启用登录')
    install_parser.add_argument('--memory-limit', default='768m', help='应用内存上限，例如 384m')
    install_parser.add_argument('--proxy', action='store_true', help='由随包 Caddy 提供 HTTPS，需要空闲 80/443')
    for name in ('up', 'stop', 'status', 'logs', 'load', 'verify', 'backup'):
        sub.add_parser(name)
    auth_parser = sub.add_parser('configure-auth')
    for option in ('client-id', 'admin-ids', 'secret-file'):
        auth_parser.add_argument('--' + option)
    sub.add_parser('update').add_argument('bundle')
    sub.add_parser('restore').add_argument('backup')
    args = parser.parse_args()
    if args.action == 'verify':
        print(json.dumps(verify(active_bundle()), ensure_ascii=False, indent=2))
        return
    prerequisites()
    import fcntl
    with (ROOT / '.operation.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError('已有运维操作运行中，请等待完成。') from None
        if args.action == 'install': install(args)
        elif args.action == 'configure-auth': configure_auth(args)
        elif args.action == 'load': load(active_bundle())
        elif args.action == 'up': up()
        elif args.action == 'stop': compose(['stop', '--timeout', '60'])
        elif args.action == 'status': compose(['ps'], visible=True)
        elif args.action == 'logs': compose(['logs', '--tail', '100'], visible=True)
        elif args.action == 'backup': backup()
        elif args.action == 'restore': restore(args)
        elif args.action == 'update': update(args)

if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, OSError, ValueError, KeyError, tarfile.TarError) as error:
        print('操作未完成：' + str(error), file=sys.stderr)
        sys.exit(1)
