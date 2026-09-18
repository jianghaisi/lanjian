"""Guardrail tests use temporary paths; do not load any model or open sockets."""
import importlib.util
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

source = Path(__file__).with_name('probe-gpt-sovits.py')
spec = importlib.util.spec_from_file_location('audition_probe', source)
probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)


class AuditionGuards(unittest.TestCase):
    def test_environment_excludes_credentials_and_proxy(self):
        with patch.dict(os.environ, {'OPENAI_API_KEY': 'private-marker', 'HTTPS_PROXY': 'private-proxy',
                                     'PATH': 'bin', 'TEMP': 'temp'}, clear=True):
            env = probe.environment()
        self.assertEqual(env['PATH'], 'bin')
        self.assertNotIn('OPENAI_API_KEY', env)
        self.assertNotIn('HTTPS_PROXY', env)
        self.assertEqual(env['HF_HUB_OFFLINE'], '1')
        self.assertEqual(env['TORCH_FORCE_WEIGHTS_ONLY_LOAD'], '1')

    def test_containment_and_missing_path_fail_closed(self):
        with tempfile.TemporaryDirectory(prefix='lanjian-voice-probe-') as directory:
            root = Path(directory) / 'owned'
            root.mkdir()
            with self.assertRaises(ValueError):
                probe.contained(Path(directory), root)
            with self.assertRaises(FileNotFoundError):
                probe.contained(root / 'missing', root)
            self.assertEqual(probe.contained(root, root), root.resolve())

    def test_no_microphone_manuscript_or_arbitrary_text_inputs(self):
        self.assertEqual(len(probe.CASES), 3)
        for name, text in probe.CASES:
            self.assertRegex(name, r'^[a-z-]+$')
            self.assertLessEqual(len(text), 80)
            self.assertNotIn('作品文件', text)
        self.assertEqual(len(probe.SOURCE_REVISION), 40)

    def test_fixed_chinese_never_needs_language_detection(self):
        for text in [probe.REFERENCE_TEXT] + [text for _, text in probe.CASES]:
            self.assertEqual(probe.fixed_chinese_segments(text, 'zh'), [{'lang': 'zh', 'text': text}])
        for text, language in [('hello', 'zh'), ('你好。', 'auto'), ('你好 Live2D', 'zh'), ('こんにちは', 'zh')]:
            with self.assertRaises(ValueError):
                probe.fixed_chinese_segments(text, language)


if __name__ == '__main__':
    unittest.main()
