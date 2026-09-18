"""Synthetic same-line audition and ten warm CPU rounds; never captures microphone."""
import json
import argparse
from pathlib import Path
import statistics
import sys
import threading
import time
import wave

REPO = Path(__file__).resolve().parents[2]
ROOT = REPO.parent.parent / '.local/companion-voice'
sys.path.insert(0, str(REPO / 'src/main/modules/companion/adapters/companion-voice'))
from kokoro import create_kokoro, synthesize, VOICES
import psutil

parser = argparse.ArgumentParser()
parser.add_argument('--threads', type=int, choices=[1, 2, 4, 8], default=2)
parser.add_argument('--rounds', type=int, choices=[0, 1, 2, 10], default=10)
parser.add_argument('--precision', choices=['int8', 'fp32'], default='int8')
args = parser.parse_args()
ARTIFACTS = REPO / f'artifacts/companion-voice/kokoro-{args.precision}-{args.threads}-threads'
ARTIFACTS.mkdir(parents=True, exist_ok=True)
process = psutil.Process()
peak = process.memory_info().rss
done = threading.Event()


def monitor():
    global peak
    while not done.wait(.05):
        peak = max(peak, process.memory_info().rss)


threading.Thread(target=monitor, daemon=True).start()
records = []
started = time.perf_counter()
tts = create_kokoro(ROOT, args.threads, args.precision)
load_seconds = time.perf_counter() - started
print(json.dumps({'loadSeconds': load_seconds, 'speakers': tts.num_speakers, 'rate': tts.sample_rate}), flush=True)
short = '欢迎回来。故事还在等你继续。'
long = '欢迎回来。现在是午后两点，你可以继续创作刚才的故事。如果暂时没有灵感，我们就从眼前最清晰的画面开始，一起慢慢把这个世界写完整。'
try:
    for voice in VOICES:
        start = time.perf_counter()
        pcm, duration = synthesize(tts, short, voice)
        seconds = time.perf_counter() - start
        with wave.open(str(ARTIFACTS / (voice + '.wav')), 'wb') as file:
            file.setnchannels(1)
            file.setsampwidth(2)
            file.setframerate(24000)
            file.writeframes(pcm)
        records.append({'kind': 'audition', 'voice': voice, 'seconds': seconds, 'duration': duration, 'rtf': seconds / duration})
        print(json.dumps(records[-1]), flush=True)
    for round_id in range(args.rounds):
        voice = list(VOICES)[round_id % 2]
        start = time.perf_counter()
        arrivals = []
        pcm, duration = synthesize(tts, long, voice, lambda pcm: arrivals.append(time.perf_counter() - start))
        seconds = time.perf_counter() - start
        records.append({'kind': 'warm', 'round': round_id, 'voice': voice, 'seconds': seconds, 'duration': duration, 'rtf': seconds / duration, 'firstAudioChunkSeconds': arrivals[0] if arrivals else None, 'chunks': len(arrivals)})
        print(json.dumps(records[-1]), flush=True)
finally:
    done.set()
    times = [record['seconds'] for record in records if record['kind'] == 'warm']
    result = {'model': f'Kokoro v1.1 zh {args.precision} CPU {args.threads} threads', 'loadSeconds': load_seconds,
              'peakProcessRssBytes': peak, 'device': 'cpu', 'microphoneUsed': False,
              'playbackMeasured': False, 'text': long, 'records': records,
              'p50Seconds': statistics.median(times) if times else None,
              'p95Seconds': sorted(times)[-1] if times else None}
    (ARTIFACTS / 'measurements.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'peakRssBytes': peak, 'p50': result['p50Seconds'], 'p95': result['p95Seconds']}), flush=True)
