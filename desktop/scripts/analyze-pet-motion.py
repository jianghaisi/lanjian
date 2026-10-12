"""Estimate numeric motion vectors between authored frames; never write/edit artwork.

Dev-only dependency: pip install --target artifacts/pet-analysis-deps opencv-python-headless==4.13.0.92
The renderer consumes the bounded vector fields; Python/OpenCV are not product dependencies.
"""
import hashlib
import argparse
import json
import sys
from pathlib import Path
root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / 'artifacts/pet-analysis-deps'))
import cv2
import numpy as np

assets = root / 'src/renderer/assets/visuals/pet-sequences'
metadata = json.loads((assets / 'registration.json').read_text())
grid = 32
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--clips', nargs='+', help='Only regenerate the named clips; other assets stay byte-identical')
args = parser.parse_args()
if args.clips and set(args.clips) - metadata.keys():
    parser.error('Unknown clip')
for name, sheet in metadata.items():
    if args.clips and name not in args.clips:
        continue
    pages = [(page, cv2.imdecode(np.fromfile(assets / page['file'], dtype=np.uint8), cv2.IMREAD_UNCHANGED))
             for page in sheet.get('pages', [{'file': f'{name}.png', 'origin': [0, 0]}])]
    samples = []
    for frame in sheet['frames']:
        x, y, w, h = frame['rect']
        page, image = next((page, image) for page, image in pages
            if page['origin'][0] <= x and page['origin'][1] <= y and x+w <= page['origin'][0]+image.shape[1] and y+h <= page['origin'][1]+image.shape[0])
        origin = page['origin']
        x -= origin[0]
        y -= origin[1]
        ax, ay = frame['anchor']
        density = page.get('density', sheet['density'])
        # Temporary normalized analysis planes. Original RGBA files stay intact.
        transform = np.float32([[1/density, 0, 256-ax/density], [0, 1/density, 486-ay/density]])
        plane = cv2.warpAffine(image[y:y+h, x:x+w], transform, (512,512))
        gray = cv2.cvtColor(plane[:,:,:3], cv2.COLOR_BGR2GRAY).astype(np.float32)
        alpha = plane[:,:,3].astype(np.float32)/255
        samples.append(np.uint8(gray*alpha + 210*(1-alpha)))
    count = len(samples)
    packed = np.full((grid*count*2, grid, 4), 128, dtype=np.uint8)
    packed[:,:,2] = 0
    packed[:,:,3] = 255
    for index in range(count):
        following = (index+1) % count
        for direction, (a,b) in enumerate([(index,following),(following,index)]):
            flow = cv2.calcOpticalFlowFarneback(samples[a], samples[b], None, .5, 5, 35, 5, 7, 1.5, 0)
            flow = cv2.resize(flow, (grid,grid), interpolation=cv2.INTER_AREA)
            packed[(index*2+direction)*grid:(index*2+direction+1)*grid,:,:2] = np.uint8(np.clip(np.rint(flow)+128, 0, 255))
    payload = packed.tobytes()
    (assets / f'{name}.flow').write_bytes(payload)
    sheet['flowSha256'] = hashlib.sha256(payload).hexdigest()
    print(name, len(packed.tobytes()), flush=True)
(assets / 'registration.json').write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
