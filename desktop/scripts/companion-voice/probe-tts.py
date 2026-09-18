"""Developer hardware probe with fixed synthetic speech. Never captures a microphone."""
import json
import os
from pathlib import Path
import sys
import time

root = Path(__file__).resolve().parents[4] / '.local/companion-voice'
output = Path(__file__).resolve().parents[2] / 'artifacts/companion-voice'
output.mkdir(parents=True, exist_ok=True)
os.environ.update(HF_HUB_OFFLINE='1', TRANSFORMERS_OFFLINE='1', HF_HOME=str(root/'cache/hf'),
                  NUMBA_CACHE_DIR=str(root/'cache/numba'))
started = time.perf_counter()
import torch
import numpy as np
import soundfile as sf
import psutil
from qwen_tts import Qwen3TTSModel
torch.set_num_threads(2)
profile = 'fp32-eager' if '--fp32' in sys.argv else 'fp16-eager'
print('imported', time.perf_counter()-started, profile, flush=True)
records = []
try:
    model = Qwen3TTSModel.from_pretrained(str(root/'models/tts'), device_map='cuda:0',
        dtype=torch.float32 if '--fp32' in sys.argv else torch.float16,
        attn_implementation='eager', local_files_only=True)
    print('loaded', time.perf_counter()-started, flush=True)
    for voice in ('Vivian', 'Serena'):
        began = time.perf_counter()
        torch.cuda.reset_peak_memory_stats()
        waves, rate = model.generate_custom_voice(text='欢迎回来。故事还在等你继续。', language='Chinese', speaker=voice,
            max_new_tokens=180, do_sample=False, subtalker_dosample=False)
        torch.cuda.synchronize()
        wave = np.asarray(waves[0])
        record = dict(profile=profile, voice=voice, seconds=time.perf_counter()-began, duration=len(wave)/rate,
            finite=bool(np.isfinite(wave).all()), peakGpuBytes=torch.cuda.max_memory_allocated(), rss=psutil.Process().memory_info().rss)
        records.append(record); print(json.dumps(record), flush=True)
        if record['finite']:
            sf.write(str(output/f'{profile}-{voice}.wav'), wave, rate)
except Exception as error:
    records.append(dict(profile=profile, error=type(error).__name__, message=str(error)[:500]))
    print(json.dumps(records[-1]), flush=True)
finally:
    (output/f'{profile}.json').write_text(json.dumps(records, indent=2), encoding='utf-8')
