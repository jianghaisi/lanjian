import importlib.util
import contextlib
import io
import json
import os
import tarfile
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from types import SimpleNamespace

spec = importlib.util.spec_from_file_location('hosted_operator', Path(__file__).resolve().parents[1] / 'operator.py')
ops = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ops)

class Operations(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='lanjian-ops-test-')
        self.root = Path(self.temp.name).resolve()
        self.patches = [patch.object(ops, 'ROOT', self.root), patch.object(ops, 'RUNTIME', self.root / 'runtime'), patch.object(ops, 'CONFIG', self.root / 'runtime/config.env')]
        for p in self.patches: p.start()

    def tearDown(self):
        for p in reversed(self.patches): p.stop()
        assert self.root.is_relative_to(Path(tempfile.gettempdir()).resolve()) and self.root.name.startswith('lanjian-ops-test-')
        self.temp.cleanup()

    def manifest(self):
        for name in ops.PROGRAM_FILES: (self.root / name).write_text('fixture', encoding='utf-8')
        value = dict(version='test-01', platform='linux/amd64', schema=3, authSchema=1, minSchema=0, bookSchema=48, image='test:01', proxyImage='proxy:01', files={name: ops.sha(self.root / name) for name in ops.PROGRAM_FILES})
        (self.root / 'manifest.json').write_text(json.dumps(value), encoding='utf-8')
        return value

    def test_hash_and_architecture_fail_closed(self):
        self.manifest()
        with patch.object(ops.platform, 'machine', return_value='x86_64'): ops.verify(self.root)
        with patch.object(ops.platform, 'machine', return_value='aarch64'), self.assertRaisesRegex(RuntimeError, 'amd64'): ops.verify(self.root)
        (self.root / 'compose.yaml').write_text('changed')
        with self.assertRaisesRegex(RuntimeError, '校验失败'): ops.verify(self.root)

    def test_duplicate_install_preserves_config_and_key(self):
        self.manifest(); (self.root / 'runtime').mkdir(); secret = self.root / 'runtime/master-key'; secret.write_text('preserve')
        with self.assertRaisesRegex(RuntimeError, '重复安装'): ops.install(None)
        self.assertEqual(secret.read_text(), 'preserve')

    def install_public(self):
        self.manifest()
        args = SimpleNamespace(origin='https://novel.example.com', client_id=None, admin_ids=None, secret_file=None, port=43130, proxy=False, public_only=True, memory_limit='384m')
        with patch.object(ops, 'load'), patch.object(ops, 'up'), patch.object(ops, 'ports_available'), patch.object(ops.os, 'chown', create=True), patch('builtins.input', side_effect=AssertionError('public install must not prompt')), patch.object(ops.getpass, 'getpass', side_effect=AssertionError('must not ask for a fake secret')):
            ops.install(args)

    def test_public_install_has_no_credentials_and_rejects_partial_auth(self):
        self.install_public()
        values = ops.config()
        self.assertEqual(values['LANJIAN_MEMORY_LIMIT'], '384m')
        self.assertEqual(values['LINUXDO_CLIENT_ID'], '')
        self.assertEqual(values['LANJIAN_ADMIN_LINUXDO_IDS'], '')
        self.assertEqual((ops.RUNTIME / 'secrets/linuxdo-client').read_text().strip(), '')
        self.assertEqual(len(ops.base64.b64decode((ops.RUNTIME / 'secrets/master-key').read_text())), 32)
        for key, value in [('LINUXDO_CLIENT_ID', 'test-client'), ('LANJIAN_ADMIN_LINUXDO_IDS', '42')]:
            with self.assertRaises(RuntimeError): ops.validate_config({**values, key: value})
        (ops.RUNTIME / 'secrets/linuxdo-client').write_text('synthetic-stray-secret')
        with self.assertRaisesRegex(RuntimeError, '同时'): ops.config()

    def test_enable_auth_preserves_master_and_refuses_reconfiguration(self):
        self.install_public()
        master = (ops.RUNTIME / 'secrets/master-key').read_bytes()
        args = SimpleNamespace(client_id='test-client', admin_ids='42', secret_file=None)
        with patch.object(ops, 'backup') as backup, patch.object(ops, 'up'), patch.object(ops.os, 'chown', create=True), patch.object(ops.getpass, 'getpass', return_value='synthetic-secret'):
            ops.configure_auth(args)
            backup.assert_called_once_with(restart=False)
            with self.assertRaisesRegex(RuntimeError, '已经配置'): ops.configure_auth(args)
        self.assertEqual(ops.config()['LANJIAN_ADMIN_LINUXDO_IDS'], '42')
        self.assertEqual((ops.RUNTIME / 'secrets/master-key').read_bytes(), master)

    def test_enable_auth_failure_restores_public_config_and_secret(self):
        self.install_public()
        original = {p: p.read_bytes() for p in [ops.CONFIG, ops.RUNTIME / 'secrets/master-key', ops.RUNTIME / 'secrets/linuxdo-client']}
        args = SimpleNamespace(client_id='test-client', admin_ids='42', secret_file=None)
        with patch.object(ops, 'backup'), patch.object(ops, 'compose') as compose, patch.object(ops, 'up', side_effect=[RuntimeError('synthetic boot failure'), None]), patch.object(ops.os, 'chown', create=True), patch.object(ops.getpass, 'getpass', return_value='synthetic-secret'):
            with self.assertRaisesRegex(RuntimeError, 'synthetic boot failure'): ops.configure_auth(args)
            compose.assert_called_once_with(['stop', '--timeout', '60'])
        for path, content in original.items(): self.assertEqual(path.read_bytes(), content)
        self.assertEqual(ops.config()['LINUXDO_CLIENT_ID'], '')

    def test_missing_config_space_and_port(self):
        with self.assertRaisesRegex(RuntimeError, '尚未安装'): ops.config()
        with patch.object(ops.shutil, 'disk_usage', return_value=type('Usage', (), {'free': 1})()), self.assertRaisesRegex(RuntimeError, '磁盘空间'): ops.free_space(self.root, 2)
        import socket
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0)); sock.listen()
            with self.assertRaisesRegex(RuntimeError, '占用'): ops.ports_available({'LANJIAN_BIND_PORT': str(sock.getsockname()[1]), 'LANJIAN_PROXY': '0'})

    def test_book_and_account_schema_both_guard_compatibility(self):
        import sqlite3
        data = self.root / 'runtime/data'
        book = data / 'users/synthetic/books/synthetic/.webnovel'
        book.mkdir(parents=True)
        for path, version in [(data / 'hosted.sqlite', 2), (book / 'workspace.sqlite', 49)]:
            with contextlib.closing(sqlite3.connect(path)) as db: db.execute(f'PRAGMA user_version={version}')
        versions = ops.schemas()
        self.assertFalse(ops.compatible({'schema': 2, 'bookSchema': 48}, versions))
        self.assertFalse(ops.compatible({'schema': 1, 'bookSchema': 49}, versions))
        self.assertTrue(ops.compatible({'schema': 2, 'bookSchema': 49}, versions))
        with contextlib.closing(sqlite3.connect(data / 'auth.sqlite')) as db: db.execute('PRAGMA user_version=1')
        versions = ops.schemas()
        self.assertFalse(ops.compatible({'schema': 3, 'bookSchema': 49}, versions))
        self.assertTrue(ops.compatible({'schema': 3, 'authSchema': 1, 'bookSchema': 49}, versions))

    @unittest.skipUnless(os.name == 'posix', 'Linux socket rebinding contract')
    def test_stopped_listener_with_time_wait_is_available(self):
        import socket
        with socket.socket() as server:
            server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            server.bind(('127.0.0.1', 0)); server.listen()
            port = server.getsockname()[1]
            with socket.create_connection(('127.0.0.1', port)) as client:
                peer, _ = server.accept()
                peer.close()  # Server actively closes: TIME_WAIT remains after stop.
                self.assertEqual(client.recv(1), b'')
        ops.ports_available({'LANJIAN_BIND_PORT': str(port), 'LANJIAN_PROXY': '0'})

    def test_restore_rejects_traversal_links_and_existing_data(self):
        self.manifest()
        for name, kind in [('../outside', tarfile.REGTYPE), ('runtime/secrets/key', tarfile.SYMTYPE)]:
            path = self.root / 'test.tar.gz'
            with tarfile.open(path, 'w:gz') as archive:
                member = tarfile.TarInfo(name); member.type = kind
                if kind == tarfile.SYMTYPE: member.linkname = '/outside'
                archive.addfile(member, io.BytesIO(b''))
            path.with_name(path.name + '.sha256').write_text(ops.sha(path))
            with self.assertRaisesRegex(RuntimeError, '不安全'): ops.restore(type('Args', (), {'backup': str(path)})())
        (self.root / 'runtime').mkdir()
        with self.assertRaisesRegex(RuntimeError, '新部署目录'): ops.restore(type('Args', (), {'backup': str(path)})())

if __name__ == '__main__': unittest.main()
