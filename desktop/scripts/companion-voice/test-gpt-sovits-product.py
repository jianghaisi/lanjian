"""Synthetic safety tests; no network, author data, GPU synthesis or unrestricted pickle."""
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest

adapter = Path(__file__).resolve().parents[2] / 'src/main/modules/companion/adapters/companion-voice'
sys.path.insert(0, str(adapter))
from gpt_sovits import LegacyHParams, plain_config, contained, verify_file, chinese_segments, safe_sovits_load


class ProductGuards(unittest.TestCase):
    def test_legacy_metadata_is_inert_bounded_plain_data(self):
        source = LegacyHParams()
        source.model = LegacyHParams()
        source.model.channels = [128, 256]
        self.assertEqual(plain_config(source), {'model': {'channels': [128, 256]}})
        for value in [object(), {1: 'bad'}, float('nan'), float('inf'), 'x' * 20001]:
            with self.assertRaises(ValueError):
                plain_config(value)
        deep = []
        for _ in range(34):
            deep = [deep]
        with self.assertRaises(ValueError):
            plain_config(deep)

    def test_hash_and_containment_fail_closed(self):
        with tempfile.TemporaryDirectory(prefix='lanjian-voice-guard-') as directory:
            root = Path(directory)
            fixture = root / 'fixture.bin'
            fixture.write_bytes(b'bounded synthetic weights')
            size = fixture.stat().st_size
            digest = hashlib.sha256(fixture.read_bytes()).hexdigest()
            self.assertEqual(verify_file(fixture, root, size, 'sha256', digest), fixture.resolve())
            for length, checksum in [(size + 1, digest), (size, '0' * 64)]:
                with self.assertRaises(ValueError):
                    verify_file(fixture, root, length, 'sha256', checksum)
            with self.assertRaises(ValueError):
                contained(root.parent, root)

    def test_assets_have_three_fixed_voices_and_pinned_source(self):
        data = json.loads((adapter / 'gpt-sovits-assets.json').read_text(encoding='utf-8'))
        self.assertEqual([voice['id'] for voice in data['voices']], ['ningguang', 'ganyu', 'keqing'])
        self.assertGreater(len(data['sourceHashes']), 50)
        selected = [m for m in data['models'] if m['key'] in {v['key'] for v in data['voices']}]
        self.assertEqual(sum(len(m['files']) for m in selected), 9)
        self.assertEqual(sum(f[1] for m in selected for f in m['files']), 722635596)

    def test_chinese_routing_has_no_language_model_download(self):
        text = '现在是2026年9月12日，18:03。继续创作《雾城来信》吗？'
        self.assertEqual(chinese_segments(text, 'zh'), [{'lang': 'zh', 'text': text}])
        with self.assertRaises(ValueError):
            chinese_segments(text, 'auto')

    def test_rejects_unsupported_pickle_global_before_execution(self):
        import torch
        class Payload:
            def __reduce__(self):
                return (eval, ('1 / 0',))
        with tempfile.TemporaryDirectory(prefix='lanjian-voice-pickle-') as directory:
            path = Path(directory) / 'synthetic.pth'
            torch.save({'weight': {}, 'config': Payload()}, path)
            with self.assertRaisesRegex(ValueError, 'Unsupported checkpoint global'):
                safe_sovits_load(path)


if __name__ == '__main__':
    unittest.main()
