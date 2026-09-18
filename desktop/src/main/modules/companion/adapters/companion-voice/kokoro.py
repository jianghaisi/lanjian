"""Fixed sherpa-onnx Kokoro CPU profile; no online fallback or voice cloning."""
from pathlib import Path
import os

VOICES = {'zf_001': 3, 'zf_002': 4}
MODEL_DIRECTORY = 'kokoro-int8-multi-lang-v1_1'


def create_kokoro(root, threads=2, precision='int8'):
    import sherpa_onnx
    model = (Path(root) / 'models' / MODEL_DIRECTORY).resolve(strict=True)
    if not model.is_relative_to(Path(root).resolve(strict=True)):
        raise ValueError('model containment')
    # eSpeak's Windows C runtime cannot open UTF-8 absolute paths containing Chinese.
    # The dedicated worker is single-job; a fixed cwd and ASCII relative data paths
    # preserve the original E: directory without a global alias or duplicate copy.
    os.chdir(Path(root).resolve(strict=True))
    model = Path('models') / MODEL_DIRECTORY
    if precision not in ('int8', 'fp32') or threads not in (1, 2, 4, 8):
        raise ValueError('invalid fixed profile')
    weights = model / 'model.int8.onnx' if precision == 'int8' else Path('models/kokoro-fp32/model.onnx')
    config = sherpa_onnx.OfflineTtsConfig(
        model=sherpa_onnx.OfflineTtsModelConfig(
            kokoro=sherpa_onnx.OfflineTtsKokoroModelConfig(
                model=str(weights), voices=str(model / 'voices.bin'),
                tokens=str(model / 'tokens.txt'), data_dir=str(model / 'espeak-ng-data'),
                lexicon=','.join(str(model / name) for name in ('lexicon-us-en.txt', 'lexicon-zh.txt'))),
            num_threads=threads, provider='cpu', debug=False),
        rule_fsts=','.join(str(model / name) for name in ('date-zh.fst', 'number-zh.fst', 'phone-zh.fst')),
        max_num_sentences=1)
    if not config.validate():
        raise ValueError('invalid Kokoro configuration')
    return sherpa_onnx.OfflineTts(config)


def synthesize(tts, text, voice, on_chunk=None):
    import numpy as np
    if voice not in VOICES or not isinstance(text, str) or not text.strip() or len(text) > 180:
        raise ValueError('invalid speech request')
    samples_sent = 0

    def callback(samples, _progress):
        nonlocal samples_sent
        chunk = np.asarray(samples, dtype=np.float32).reshape(-1)
        samples_sent += len(chunk)
        if samples_sent > 30 * 24000 or not np.isfinite(chunk).all():
            raise ValueError('audio chunk limit')
        if on_chunk and len(chunk):
            on_chunk((np.clip(chunk, -1, 1) * 32767).astype('<i2').tobytes())
        # sherpa-onnx v1.13.8 offline-tts-play.py: 1 continues; 0 stops.
        return 1

    generated = tts.generate(text=text, sid=VOICES[voice], speed=1.0, callback=callback)
    wave = np.asarray(generated.samples, dtype=np.float32).reshape(-1)
    if generated.sample_rate != 24000 or not 2400 <= len(wave) <= 30 * 24000 or not np.isfinite(wave).all():
        raise ValueError('invalid generated audio')
    return (np.clip(wave, -1, 1) * 32767).astype('<i2').tobytes(), len(wave) / 24000
