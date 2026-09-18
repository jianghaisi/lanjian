"""Bounded, offline developer audition. Never imported by the application."""
import argparse
import faulthandler
import hashlib
import json
import os
import re
from pathlib import Path
import subprocess
import sys
import threading
import time
import wave

FRONTEND = Path(__file__).resolve().parents[2]
ROOT = FRONTEND.parent.parent / '.local/companion-voice'
EXPERIMENT = ROOT / 'gpt-sovits-audition'
SOURCE = EXPERIMENT / 'source'
SITE = EXPERIMENT / 'venv/Lib/site-packages'
SOURCE_REVISION = '48b1a0169a28582a8984402f82cf438d3bfa6aca'
SAFE_G2PW_SHA256 = 'e880e8dc1f2b07e505965a0e078ef53133b84d7a2f2c38cc30db466f38542ea0'
REFERENCE_TEXT = '希望你以后能够做的比我还好呦。'
CASES = [
    ('greeting', '欢迎回来。今天想从哪个世界继续？我在这里陪着你。'),
    ('cheerful-wording', '太好了！这一章终于写完啦。辛苦了，接下来的故事一定也很精彩！'),
    ('comforting-wording', '没关系，慢慢来。暂时没有灵感也不要紧，我们先写下眼前最清晰的画面。'),
]


def contained(path, root):
    path, root = Path(path).resolve(strict=True), Path(root).resolve(strict=True)
    if not path.is_relative_to(root):
        raise ValueError('Audition path escapes its owned root')
    return path


def verify_assets():
    # Reuse the one pinned JS manifest; do not invent a second hash authority.
    script = "import {gptSovitsModels as m} from './scripts/companion-voice/gpt-sovits-model.mjs'; console.log(JSON.stringify(m))"
    result = subprocess.run(['node', '--input-type=module', '-e', script], cwd=FRONTEND,
                            check=True, capture_output=True, text=True, timeout=20)
    models = json.loads(result.stdout)
    for model in models:
        for name, size, kind, digest in model['files']:
            path = contained(ROOT / 'models' / model['key'] / name, ROOT / 'models')
            if path.stat().st_size != size:
                raise ValueError(f'Wrong model size: {name}')
            checksum = hashlib.sha1() if kind == 'git' else hashlib.sha256()
            if kind == 'git':
                checksum.update(f'blob {size}\0'.encode())
            with path.open('rb') as file:
                for chunk in iter(lambda: file.read(4 * 1024**2), b''):
                    checksum.update(chunk)
            if checksum.hexdigest() != digest:
                raise ValueError(f'Wrong model hash: {name}')
    return models


def environment():
    allowed = {'SYSTEMROOT', 'WINDIR', 'SYSTEMDRIVE', 'COMSPEC', 'PATH', 'TEMP', 'TMP'}
    env = {key: value for key, value in os.environ.items() if key.upper() in allowed}
    env.update(HF_HUB_OFFLINE='1', TRANSFORMERS_OFFLINE='1', HF_HUB_DISABLE_TELEMETRY='1',
               TORCH_FORCE_WEIGHTS_ONLY_LOAD='1', PYTHONUTF8='1', PYTHONIOENCODING='utf-8',
               OMP_NUM_THREADS='4', MKL_NUM_THREADS='4', OPENBLAS_NUM_THREADS='4',
               NUMBA_CACHE_DIR=str(EXPERIMENT / 'numba-cache'),
               HF_HOME=str(EXPERIMENT / 'hf-cache'), MPLCONFIGDIR=str(EXPERIMENT / 'mpl-cache'),
               TORCH_HOME=str(EXPERIMENT / 'torch-cache'))
    return env


def fixed_chinese_segments(text, default_lang=''):
    # This audition has only Chinese fixtures, not general mixed-language input.
    # Upstream language detection can download fastText even for all_zh.
    if default_lang != 'zh' or not re.fullmatch(r'[\u4e00-\u9fff，。？！、；：…\s]+', text):
        raise ValueError('Only Chinese audition fixtures are supported')
    return [{'lang': 'zh', 'text': text}]


def worker(precision, check_imports):
    faulthandler.enable()
    print('AUDITION_STAGE=isolated-imports', flush=True)
    # -I omits user paths; only the isolated audition dependencies are added.
    sys.path.insert(0, str(contained(SITE, EXPERIMENT)))
    os.chdir(contained(SOURCE, EXPERIMENT))
    sys.path[:0] = [str(SOURCE / 'GPT_SoVITS'), str(SOURCE)]

    def deny_network(event, _args):
        if event in {'socket.connect', 'socket.bind', 'socket.getaddrinfo'}:
            raise RuntimeError('Network is disabled during the local audition')
    sys.addaudithook(deny_network)

    import numpy as np
    import psutil
    print('AUDITION_STAGE=torch-import', flush=True)
    import torch
    print('AUDITION_STAGE=torch-ready', flush=True)
    import jieba
    import jieba.posseg
    # Same Jieba tokenizer/POS API, pure-Python distribution with Windows wheels.
    # Avoid requiring an unrelated local C++ compiler for jieba_fast.
    sys.modules['jieba_fast'] = jieba
    sys.modules['jieba_fast.posseg'] = jieba.posseg
    torch.set_num_threads(4)
    torch.set_num_interop_threads(2)
    if not torch.cuda.is_available():
        raise RuntimeError('Audition CUDA unavailable; no silent CPU substitution')

    import sv
    print('AUDITION_STAGE=speaker-verifier-imported', flush=True)
    sv.sv_path = str(ROOT / 'models/gpt-sovits/sv/pretrained_eres2netv2w24s4ep4.ckpt')
    from text.g2pw import onnx_api
    g2pw_path = ROOT / 'models/gpt-sovits-g2pw/text/G2PWModel'
    def installed_g2pw(_unused):
        return str(contained(g2pw_path, ROOT / 'models'))
    onnx_api.download_and_decompress = installed_g2pw
    os.environ['bert_path'] = str(ROOT / 'models/gpt-sovits/chinese-roberta-wwm-ext-large')
    from TTS_infer_pack.TTS import TTS, TTS_Config
    from text.LangSegmenter import LangSegmenter
    LangSegmenter.getTexts = staticmethod(fixed_chinese_segments)
    print('AUDITION_STAGE=engine-imported', flush=True)
    if check_imports:
        print(json.dumps({'imports': True, 'torch': torch.__version__,
                          'device': torch.cuda.get_device_name(), 'restrictedWeights': True}), flush=True)
        return

    artifacts_root = FRONTEND / 'artifacts/companion-voice'
    artifacts_root.mkdir(parents=True, exist_ok=True)
    artifacts = artifacts_root / f'gpt-sovits-v2proplus-{precision}-{time.time_ns()}'
    artifacts.mkdir()
    process, done = psutil.Process(), threading.Event()
    peaks = {'rssBytes': process.memory_info().rss}
    def monitor():
        while not done.wait(.1):
            peaks['rssBytes'] = max(peaks['rssBytes'], process.memory_info().rss)
    threading.Thread(target=monitor, daemon=True).start()
    report = {'model': 'GPT-SoVITS v2ProPlus', 'sourceRevision': SOURCE_REVISION,
              'precision': precision, 'device': torch.cuda.get_device_name(),
              'referenceText': REFERENCE_TEXT, 'offline': True, 'microphone': False,
              'languageMode': 'fixed-Chinese-fixtures-no-detection',
              'playbackMeasured': False, 'emotionLabelsAreTestWordingOnly': True, 'samples': []}
    try:
        config = TTS_Config({'custom': {
            'version': 'v2ProPlus', 'device': 'cuda', 'is_half': precision == 'fp16',
            't2s_weights_path': str(ROOT / 'models/gpt-sovits/s1v3.ckpt'),
            'vits_weights_path': str(ROOT / 'models/gpt-sovits/v2Pro/s2Gv2ProPlus.pth'),
            'bert_base_path': str(ROOT / 'models/gpt-sovits/chinese-roberta-wwm-ext-large'),
            'cnhuhbert_base_path': str(ROOT / 'models/gpt-sovits/chinese-hubert-base'),
        }})
        config.configs_path = str(artifacts / 'inference-config.yaml')
        started = time.perf_counter()
        engine = TTS(config)
        torch.cuda.synchronize()
        report['modelLoadSeconds'] = time.perf_counter() - started
        print(json.dumps({'modelLoadSeconds': report['modelLoadSeconds']}), flush=True)
        for label, text in CASES:
            started, chunks, rate = time.perf_counter(), [], None
            for sr, samples in engine.run({
                'text': text, 'text_lang': 'all_zh', 'prompt_lang': 'all_zh',
                'prompt_text': REFERENCE_TEXT,
                'ref_audio_path': str(ROOT / 'models/voice-reference-cosyvoice/zero_shot_prompt.wav'),
                'text_split_method': 'cut0', 'batch_size': 1, 'seed': 803,
                'top_k': 15, 'top_p': 1, 'temperature': 1, 'speed_factor': 1,
                'parallel_infer': True, 'streaming_mode': False, 'super_sampling': False,
            }):
                if sr != 32000 or samples.ndim != 1 or samples.dtype != np.int16:
                    raise ValueError('Unexpected audition PCM format')
                rate = sr
                chunks.append(samples)
                if sum(chunk.size for chunk in chunks) > 20 * sr:
                    raise ValueError('Audition output exceeds 20 seconds')
            torch.cuda.synchronize()
            elapsed = time.perf_counter() - started
            pcm = np.concatenate(chunks) if chunks else np.zeros(0, dtype=np.int16)
            if not rate or pcm.size < rate / 2 or not np.isfinite(pcm).all():
                raise ValueError('Invalid audition audio')
            normalized = pcm.astype(np.float32) / 32768
            rms = float(np.sqrt(np.mean(normalized ** 2)))
            if rms < .001:
                raise ValueError('Audition audio is silent')
            with wave.open(str(artifacts / f'{label}.wav'), 'wb') as output:
                output.setnchannels(1)
                output.setsampwidth(2)
                output.setframerate(rate)
                output.writeframes(pcm.astype('<i2', copy=False).tobytes())
            sample = {'label': label, 'text': text, 'seconds': elapsed,
                      'duration': pcm.size / rate, 'rtf': elapsed / (pcm.size / rate), 'rms': rms}
            report['samples'].append(sample)
            print(json.dumps(sample, ensure_ascii=False), flush=True)
        report['ok'] = True
    except Exception as error:
        report['ok'] = False
        report['failureType'] = type(error).__name__
        raise
    finally:
        done.set()
        report.update(peaks)
        report['cudaPeakAllocatedBytes'] = torch.cuda.max_memory_allocated()
        report['cudaPeakReservedBytes'] = torch.cuda.max_memory_reserved()
        (artifacts / 'measurements.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
        print(f'ARTIFACTS={artifacts}', flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--precision', choices=['fp16', 'fp32'], default='fp16')
    parser.add_argument('--check-imports', action='store_true')
    parser.add_argument('--worker', action='store_true')
    args = parser.parse_args()
    if args.worker:
        worker(args.precision, args.check_imports)
        return
    revision = subprocess.check_output(['git', '-C', str(SOURCE), 'rev-parse', 'HEAD'], text=True).strip()
    if revision != SOURCE_REVISION:
        raise ValueError('Unexpected upstream source revision')
    safe_source = contained(SOURCE / 'GPT_SoVITS/text/g2pw/g2pw.py', SOURCE)
    if hashlib.sha256(safe_source.read_bytes()).hexdigest() != SAFE_G2PW_SHA256:
        raise ValueError('Reviewed G2PW no-pickle/literal-only patch is missing or changed')
    if not args.check_imports:
        verify_assets()
    # Target the actual base interpreter, not the Windows venv redirector.
    interpreter = contained(ROOT / 'python/cpython-3.12-windows-x86_64-none/python.exe', ROOT / 'python')
    command = [str(interpreter), '-I', '-u', '-X', 'utf8', str(Path(__file__).resolve()),
               '--worker', '--precision', args.precision]
    if args.check_imports:
        command.append('--check-imports')
    with subprocess.Popen(command, env=environment(), cwd=EXPERIMENT, stdout=subprocess.PIPE,
                          stderr=subprocess.STDOUT, text=True, encoding='utf-8', errors='replace',
                          creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0) as child:
        timer = threading.Timer(240, child.kill)
        timer.start()
        try:
            for line in child.stdout:
                print(line, end='', flush=True)
            if child.wait() != 0:
                raise RuntimeError('Owned audition worker failed; inspect stage output above')
        finally:
            timer.cancel()
            if child.poll() is None:
                child.kill()
                child.wait(timeout=10)


if __name__ == '__main__':
    main()
