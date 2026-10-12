"""Real CPU ASR acceptance with a local, authored speech fixture.

Only network acquisition is replaced. Executes the production worker's acquire,
verified model, PyAV, faster-whisper, VAD, timestamps and checkpoint publication.
"""
import ast
import json
from pathlib import Path
import re
import shutil
import sys
import uuid
import wave

repo = Path(__file__).resolve().parents[2]
worker = repo / 'desktop/src/main/modules/inspiration/adapters/video/worker.py'
tree = ast.parse(worker.read_text(encoding='utf-8'))
namespace = {'__file__': str(worker)}
exec(compile(ast.Module(body=[n for n in tree.body if not isinstance(n, ast.Try)], type_ignores=[]), str(worker), 'exec'), namespace)
namespace['environment']()
import yt_dlp

fixture = Path(sys.argv[2]).resolve(strict=True)
with wave.open(str(fixture), 'rb') as audio:
    duration = audio.getnframes() / audio.getframerate()

class FixtureDownload:
    def __init__(self, options):
        self.target = Path(options['outtmpl'].replace('%(ext)s', 'wav'))
    def __enter__(self): return self
    def __exit__(self, *args): pass
    def extract_info(self, url, download=True):
        shutil.copyfile(fixture, self.target)
        return {'title': '隔离语音验收', 'duration': duration, 'uploader': '验收自制朗读'}
    def prepare_filename(self, info): return str(self.target)

yt_dlp.YoutubeDL = FixtureDownload
namespace['network_url'] = lambda _: None
try:
    namespace['acquire']('https://www.bilibili.com/video/BVacceptance', str(uuid.uuid4()))
except Exception as error:
    # Only fixture/model errors; redact any incidental URLs before diagnostics.
    print(json.dumps({'errorType': type(error).__name__, 'message': re.sub(r'https?://\S+', '[url]', str(error))}, ensure_ascii=False))
    raise SystemExit(1)
