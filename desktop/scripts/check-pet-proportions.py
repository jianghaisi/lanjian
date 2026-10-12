"""Read-only proportion regression check for this character's bundled artwork.

Measure the largest warm skin component in the upper half of each registered
cell. This character-specific estimate catches scale drift, not anatomy quality;
occluded/turned faces still need visual review. Never edit source PNGs.
"""
import argparse
import hashlib
import json
from pathlib import Path
from statistics import median
import sys

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / 'artifacts/pet-analysis-deps'))
import cv2
import numpy as np
from PIL import Image

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--assets', type=Path, default=root / 'src/renderer/assets/visuals/pet-sequences')
parser.add_argument('--output', type=Path, help='Optional JSON report; no image is written')
parser.add_argument('--check', action='store_true', help='Fail on clip/page median face-size drift')
args = parser.parse_args()
registration = json.loads((args.assets / 'registration.json').read_text(encoding='utf-8'))
clips = {}
for name, asset in registration.items():
    pages = asset.get('pages', [{'file': name + '.png', 'origin': [0, 0], 'size': asset['size']}])
    sources = [(page, np.asarray(Image.open(args.assets / page['file']).convert('RGBA'))) for page in pages]
    frames = []
    for index, frame in enumerate(asset['frames']):
        x, y, w, h = frame['rect']
        page, pixels = next((p, image) for p, image in sources
            if x >= p['origin'][0] and y >= p['origin'][1]
            and x+w <= p['origin'][0]+image.shape[1] and y+h <= p['origin'][1]+image.shape[0])
        ox, oy = page['origin']
        cell = pixels[y-oy:y-oy+h, x-ox:x-ox+w]
        red, green, blue, alpha = [cell[:, :, c].astype(np.int16) for c in range(4)]
        skin = (red > 180) & (green > 120) & (blue > 100) & (red-green > 8) & (red-blue > 12) & (alpha > 200)
        skin[int(h*.5):] = False
        _, _, components, _ = cv2.connectedComponentsWithStats(skin.astype(np.uint8), 8)
        if len(components) <= 1:
            raise ValueError(f'{name}/{index}: no face component; review the changed palette manually')
        face = components[1:][np.argmax(components[1:, 4])]
        density = page.get('density', asset['density'])
        frames.append({'index': index, 'page': page['file'], 'face': [int(v) for v in face[:4]],
            'faceWidth': float(face[2] / density),
            'figureHeight': (frame['bounds'][3]-frame['bounds'][1]) / density})
    clips[name] = {'density': asset['density'], 'faceWidth': median(f['faceWidth'] for f in frames),
        'pages': [{'file': page['file'], 'sha256': hashlib.sha256((args.assets/page['file']).read_bytes()).hexdigest(),
            'faceWidth': median(f['faceWidth'] for f in frames if f['page'] == page['file'])} for page in pages],
        'frames': frames}

reference = median(clip['faceWidth'] for clip in clips.values())
failures = []
for name, clip in clips.items():
    if abs(clip['faceWidth']/reference-1) > .075:
        failures.append(f'{name}: median face width {clip["faceWidth"]:.1f} differs from catalog {reference:.1f} by more than 7.5%')
    widths = [p['faceWidth'] for p in clip['pages']]
    if max(widths)/min(widths) > 1.05:
        failures.append(f'{name}: page medians differ by more than 5% ({widths})')
report = {'referenceFaceWidth': reference, 'clips': clips, 'failures': failures}
if args.output:
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
print(json.dumps({'faceWidths': {k: round(v['faceWidth'], 2) for k, v in clips.items()}, 'failures': failures}))
if args.check and failures:
    sys.exit(1)
