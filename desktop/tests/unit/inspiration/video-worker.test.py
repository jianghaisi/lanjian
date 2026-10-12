"""Test worker integrity/recovery helpers without preparing or loading ASR."""
import ast
import hashlib
import json
import os
import re
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


WORKER = Path(__file__).resolve().parents[3] / "src/main/modules/inspiration/adapters/video/worker.py"
TREE = ast.parse(WORKER.read_text(encoding="utf-8"), filename=str(WORKER))
HELPERS = ast.Module(body=[node for node in TREE.body if isinstance(node, ast.FunctionDef)
    and node.name in {"contained", "write_json", "model_verified", "failure_code"}], type_ignores=[])


class VideoWorkerIntegrity(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="lanjian-worker-check-")
        self.root = Path(self.temp.name).resolve()
        self.env = {"Path": Path, "ROOT": self.root, "os": os, "re":re, "json": json, "hashlib": hashlib}
        exec(compile(HELPERS, str(WORKER), "exec"), self.env)

    def tearDown(self):
        self.temp.cleanup()

    def test_same_size_tampering_fails_full_model_verification(self):
        (self.root / "model").mkdir()
        files = []
        for name, value, kind in [("model.bin", b"original weight", "sha256"),
                                   ("config.json", b'{"a":1}', "gitBlob")]:
            (self.root / "model" / name).write_bytes(value)
            digest = hashlib.sha256(value).hexdigest() if kind == "sha256" else hashlib.sha1(
                f"blob {len(value)}\0".encode() + value).hexdigest()
            files.append({"name": name, "bytes": len(value), kind: digest})
        self.env["LOCK"] = {"model": {"files": files}}
        verified = self.env["model_verified"]
        self.assertTrue(verified(full=True))
        for item in files:
            path = self.root / "model" / item["name"]
            original = path.read_bytes()
            path.write_bytes(b"!" + original[1:])
            self.assertTrue(verified())
            self.assertFalse(verified(full=True))
            path.write_bytes(original)

    def test_interrupted_publication_preserves_previous_partial(self):
        destination = self.root / "transcript.partial.json"
        self.env["write_json"](destination, [{"text": "已经完成的语音"}])
        before = destination.read_bytes()
        with patch.object(os, "replace", side_effect=OSError("interrupted before publication")):
            with self.assertRaises(OSError):
                self.env["write_json"](destination, [{"text": "后来一段"}])
        self.assertEqual(destination.read_bytes(), before)
        self.env["write_json"](destination, [{"text": "完整的新结果"}])
        self.assertEqual(json.loads(destination.read_text(encoding="utf-8"))[0]["text"], "完整的新结果")
        acquire = next(node for node in TREE.body if isinstance(node, ast.FunctionDef) and node.name == "acquire")
        # Speech is checkpointed during iteration, before ASR can fail later.
        self.assertTrue(any(isinstance(node, ast.For) and any(isinstance(child, ast.Call)
            and isinstance(child.func, ast.Name) and child.func.id == "write_json"
            for child in ast.walk(node)) for node in ast.walk(acquire)))

    def test_worker_cannot_publish_outside_owned_root(self):
        outside = self.root.parent / "other-job-transcript.json"
        with self.assertRaises(ValueError):
            self.env["write_json"](outside, [{"text": "不能写出私有目录"}])
        self.assertFalse(outside.exists())

    def test_platform_failures_keep_a_safe_actionable_classification(self):
        code = self.env['failure_code']
        for text, expected in [('HTTP Error 429 secret-url', 'PLATFORM_RATE_LIMIT'),
                               ('Fresh cookies are needed', 'PLATFORM_AUTH_REQUIRED'),
                               ('[Douyin] 6961737553342991651: Fresh cookies are needed', 'PLATFORM_AUTH_REQUIRED'),
                               ('HTTP Error 404', 'VIDEO_UNAVAILABLE'),
                               ('MEDIA_SIZE', 'MEDIA_SIZE'), ('VIDEO_DURATION', 'VIDEO_DURATION'),
                               ('Connection timed out', 'VIDEO_NETWORK')]:
            self.assertEqual(code(Exception(text)), expected)

    def test_pinned_decoder_accepts_the_asr_metadata_api(self):
        lock = json.loads(WORKER.with_name('runtime-lock.json').read_text(encoding='utf-8'))
        self.assertEqual(next(p['version'] for p in lock['packages'] if p['name'] == 'av'), '16.1.0')
        native = WORKER.parent.parent / 'native-video.ts'
        self.assertIn("['-I','-B','-u'", native.read_text(encoding='utf-8'))


if __name__ == "__main__":
    unittest.main()
