"""Pinned offline V2 speech adapter. No server, training, unrestricted pickle or audio cache."""
import gc
import hashlib
import json
import math
import os
from pathlib import Path
import re
import sys
import time
from collections import OrderedDict


class LegacyHParams:
    """Inert data carrier, never import or execute a checkpoint's utils.HParams class."""
    pass


class SpeechRuntimeError(RuntimeError):
    """Fixed error category, never a third-party traceback or path."""
    pass


def plain_config(value, depth=0):
    if depth > 32:
        raise ValueError('Invalid voice configuration depth')
    if type(value) is LegacyHParams:
        value = vars(value)
    if type(value) is dict:
        if len(value) > 1000 or any(type(key) is not str or len(key) > 200 for key in value):
            raise ValueError('Invalid voice configuration keys')
        return {key: plain_config(item, depth + 1) for key, item in value.items()}
    if type(value) in (list, tuple):
        if len(value) > 2000:
            raise ValueError('Invalid voice configuration list')
        return [plain_config(item, depth + 1) for item in value]
    if type(value) is float and not math.isfinite(value):
        raise ValueError('Invalid voice configuration number')
    if value is None or type(value) in (bool, int, float):
        return value
    if type(value) is str and len(value) <= 20000:
        return value
    raise ValueError('Invalid voice configuration value')


def safe_sovits_load(path):
    import torch
    unknown = set(torch.serialization.get_unsafe_globals_in_checkpoint(path))
    if unknown - {'utils.HParams'}:
        raise ValueError('Unsupported checkpoint global')
    with torch.serialization.safe_globals([(LegacyHParams, 'utils.HParams')]):
        result = torch.load(path, map_location='cpu', weights_only=True)
    if type(result) not in (dict, OrderedDict) or type(result.get('weight')) not in (dict, OrderedDict):
        raise ValueError('Invalid voice weights')
    result['config'] = plain_config(result.get('config'))
    return result


def contained(path, root):
    path, root = Path(path).resolve(strict=True), Path(root).resolve(strict=True)
    if not path.is_relative_to(root):
        raise ValueError('Voice asset escapes runtime')
    return path


def verify_file(path, root, size, kind, digest):
    path = contained(path, root)
    if path.stat().st_size != size:
        raise ValueError('Voice asset size mismatch')
    checksum = hashlib.sha1() if kind == 'git' else hashlib.sha256()
    if kind == 'git':
        checksum.update(f'blob {size}\0'.encode())
    with path.open('rb') as source:
        for chunk in iter(lambda: source.read(4 * 1024**2), b''):
            checksum.update(chunk)
    if checksum.hexdigest() != digest:
        raise ValueError('Voice asset hash mismatch')
    return path


def chinese_segments(text, default_lang=''):
    # all_zh should not invoke an implicit fastText downloader. Chinese punctuation,
    # digits, book titles and Latin abbreviations remain input to the Chinese normalizer.
    if default_lang != 'zh' or not isinstance(text, str) or len(text) > 2000:
        raise ValueError('Unsupported speech language')
    return [{'lang': 'zh', 'text': text}]


class GptSovits:
    def __init__(self, root):
        self.root = Path(root)
        self.assets = json.loads(Path(__file__).with_name('gpt-sovits-assets.json').read_text(encoding='utf-8'))
        self.source = contained(self.root / 'gpt-sovits-audition/source', self.root)
        patch = contained(self.source / 'GPT_SoVITS/text/g2pw/g2pw.py', self.source)
        if hashlib.sha256(patch.read_bytes()).hexdigest() != self.assets['safeG2pwSha256']:
            raise ValueError('Reviewed source patch missing')
        for name, digest in self.assets['sourceHashes'].items():
            source_file = contained(self.source / name, self.source)
            if hashlib.sha256(source_file.read_bytes()).hexdigest() != digest:
                raise ValueError('Pinned inference source changed')
        self.engine = None
        self.voice_id = None
        self.verified = set()
        self.initialized = False
        self.load_metrics = {}
        self.prepared_voice = None

    def verify(self, voice):
        # Preserve old audition assets, but V2 does not load Pro/vocoder/reference weights.
        for model in self.assets['models']:
            if model['key'] not in ('gpt-sovits', 'gpt-sovits-g2pw', voice['key']):
                continue
            for name, size, kind, digest in model['files']:
                if model['key'] == 'gpt-sovits' and not name.startswith(('chinese-hubert-base/', 'chinese-roberta-wwm-ext-large/')):
                    continue
                path = self.root / 'models' / model['key'] / name
                if str(path) not in self.verified:
                    verify_file(path, self.root, size, kind, digest)
                    self.verified.add(str(path))

    def initialize(self):
        sys.path[:0] = [str(self.source / 'GPT_SoVITS'), str(self.source)]
        # Upstream paths are relative; source contains no author data.
        os.chdir(self.source)
        import torch
        if os.environ.get('TORCH_FORCE_WEIGHTS_ONLY_LOAD') != '1':
            raise RuntimeError('Restricted weight loading is required')
        if not torch.cuda.is_available():
            raise SpeechRuntimeError('VOICE_CUDA_UNAVAILABLE')
        torch.set_num_threads(4)
        torch.set_num_interop_threads(2)
        import jieba
        import jieba.posseg
        sys.modules['jieba_fast'] = jieba
        sys.modules['jieba_fast.posseg'] = jieba.posseg
        import process_ckpt
        process_ckpt.load_sovits_new = safe_sovits_load
        from text.g2pw import onnx_api
        onnx_api.download_and_decompress = lambda _path: str(contained(self.root / 'models/gpt-sovits-g2pw/text/G2PWModel', self.root))
        os.environ['bert_path'] = str(self.root / 'models/gpt-sovits/chinese-roberta-wwm-ext-large')
        from TTS_infer_pack.TTS import TTS, TTS_Config
        from text.LangSegmenter import LangSegmenter
        LangSegmenter.getTexts = staticmethod(chinese_segments)
        class VolatileConfig(TTS_Config):
            def save_configs(self, configs_path=None):
                # Model selection and prompt paths must not rewrite upstream/global config.
                return None
        self.TTS, self.Config = TTS, VolatileConfig
        self.initialized = True

    def select(self, voice, progress=lambda _stage: None):
        started = time.perf_counter()
        progress('verify')
        try:
            self.verify(voice)
        except (OSError, ValueError):
            raise SpeechRuntimeError('VOICE_ASSETS_INVALID') from None
        verified = time.perf_counter()
        progress('runtime')
        if not self.initialized:
            self.initialize()
        initialized = time.perf_counter()
        import torch
        progress('weights')
        if self.voice_id == voice['id']:
            return
        self.engine = None
        self.voice_id = None
        self.prepared_voice = None
        gc.collect()
        torch.cuda.empty_cache()
        folder = self.root / 'models' / voice['key'] / voice['prefix']
        config = self.Config({'custom': {
            'version': 'v2', 'device': 'cuda', 'is_half': True,
            't2s_weights_path': str(folder / voice['gpt']),
            'vits_weights_path': str(folder / voice['sovits']),
            'bert_base_path': str(self.root / 'models/gpt-sovits/chinese-roberta-wwm-ext-large'),
            'cnhuhbert_base_path': str(self.root / 'models/gpt-sovits/chinese-hubert-base'),
        }})
        self.engine = self.TTS(config)
        if self.engine.configs.version != 'v2':
            raise ValueError('Unexpected voice model version')
        self.voice_id = voice['id']
        self.prepared_voice = None
        self.load_metrics = {'verifySeconds': verified-started, 'importSeconds': initialized-verified,
                             'modelSeconds': time.perf_counter()-initialized}

    def prepare(self, voice_id, progress=lambda _stage: None):
        if self.prepared_voice == voice_id:
            return
        # Fixed local warm-up, discarded immediately; no author text or audible event.
        self.synthesize('欢迎回来。', voice_id, lambda _pcm: None, progress)
        self.prepared_voice = voice_id

    def synthesize(self, text, voice_id, on_chunk, progress=lambda _stage: None):
        if not isinstance(text, str) or not text.strip() or len(text) > 180:
            raise ValueError('Invalid speech text')
        voice = next((v for v in self.assets['voices'] if v['id'] == voice_id), None)
        if voice is None:
            raise ValueError('Invalid speech voice')
        started = time.perf_counter()
        self.select(voice, progress)
        progress('warmup')
        import numpy as np
        from scipy.signal import resample_poly
        count = 0
        first = None
        square_sum = 0.0
        # Sentence fragments permit playback before the entire reply finishes.
        for rate, samples in self.engine.run({
            'text': text, 'text_lang': 'all_zh', 'prompt_lang': 'all_zh',
            'prompt_text': voice['prompt'],
            'ref_audio_path': str(self.root / 'models' / voice['key'] / voice['prefix'] / voice['reference']),
            'text_split_method': 'cut5', 'batch_size': 1, 'split_bucket': False,
            'return_fragment': True, 'streaming_mode': False, 'parallel_infer': True,
            'seed': 803, 'top_k': 15, 'top_p': 1, 'temperature': 1,
            'speed_factor': 1, 'fragment_interval': .18, 'super_sampling': False,
        }):
            if rate != 32000 or samples.ndim != 1 or samples.dtype != np.int16 or not samples.size:
                raise ValueError('Invalid engine audio')
            audio = resample_poly(samples.astype(np.float32) / 32768, 3, 4)
            if not np.isfinite(audio).all() or count + audio.size > 30 * 24000:
                raise ValueError('Speech exceeds PCM budget')
            count += audio.size
            square_sum += float(np.sum(audio ** 2))
            if first is None:
                first = time.perf_counter() - started
            pcm = (np.clip(audio, -1, 1) * 32767).astype('<i2').tobytes()
            # Small bounded IPC frames, not a duplicate whole-wave terminal payload.
            for offset in range(0, len(pcm), 24000):
                on_chunk(pcm[offset:offset + 24000])
        if count < 2400 or square_sum / count < 1e-6:
            raise ValueError('Speech is silent or empty')
        import torch
        import psutil
        return {'sampleRate': 24000, 'duration': count / 24000, 'seconds': time.perf_counter()-started,
                'firstAudioSeconds': first, 'profile': 'gpt-sovits-v2-fp16', 'voice': voice_id,
                'load': self.load_metrics,
                'rssBytes': psutil.Process().memory_info().rss,
                'cudaAllocatedBytes': torch.cuda.memory_allocated(), 'cudaReservedBytes': torch.cuda.memory_reserved()}
