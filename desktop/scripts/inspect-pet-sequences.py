"""Read-only pixel inspection; writes registration metadata, never edits images."""
import argparse
import hashlib
import json
import math
from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parents[1] / 'src/renderer/assets/visuals/pet-sequences'
result = json.loads((root / 'registration.json').read_text(encoding='utf-8'))
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--clips', nargs='+', help='Only register these clips; keep other registrations unchanged')
parser.add_argument('--rows', type=int, choices=range(1, 9), help='Rows per four-column page; retained in metadata')
parser.add_argument('--sole-band', type=int, choices=range(1, 13), help='Verified sole strip in source pixels')
parser.add_argument('--sole-range', nargs=2, type=float, help='Verified horizontal foot region as cell-width fractions')
parser.add_argument('--pages', nargs='+', help='Ordered PNG filenames for exactly one selected clip')
parser.add_argument('--frame-order', nargs='+', type=int, help='One-use permutation of original cells for one selected clip')
parser.add_argument('--face-width', nargs=2, type=float, metavar=('SOURCE', 'TARGET'), help='Verified face spans for one clip-wide density, e.g. a seated pose')
args = parser.parse_args()
if args.sole_range and not (0 <= args.sole_range[0] < args.sole_range[1] <= 1):
    parser.error('Sole range must be increasing fractions within [0, 1]')
if args.clips and set(args.clips) - result.keys():
    parser.error('Unknown clip')
if (args.pages or args.frame_order) and (not args.clips or len(args.clips) != 1):
    parser.error('--pages/--frame-order requires exactly one --clips entry')
if args.face_width and (not args.clips or len(args.clips) != 1 or not all(math.isfinite(v) and v > 0 for v in args.face_width)):
    parser.error('--face-width requires one clip and two finite positive spans')
if args.pages and any(name not in {path.name for path in root.glob('*.png')} for name in args.pages):
    parser.error('Unknown page')


def inspect_page(path, columns, rows, sole_band, sole_range):
    image = Image.open(path).convert('RGBA')
    alpha = image.getchannel('A')
    solid_image = alpha.point(lambda a: 255 if a > 100 else 0)
    # Find actual low-ink gutters rather than cutting a generated hair lock.
    row_edges = [0]
    for boundary in range(1, rows):
        expected = image.height * boundary / rows
        radius = image.height / rows * .08
        row_edges.append(min(range(round(expected-radius), round(expected+radius)),
            key=lambda yy: (sum(solid_image.getpixel((xx, yy)) > 0 for xx in range(image.width)), abs(yy-expected))))
    row_edges.append(image.height)
    frames = []
    for index in range(columns * rows):
        y, bottom = row_edges[index // columns:index // columns+2]
        separators = [0]
        for boundary in range(1, columns):
            expected = image.width * boundary / columns
            separators.append(min(range(round(expected-60), round(expected+60)),
                key=lambda xx: (sum(solid_image.getpixel((xx, yy)) > 0 for yy in range(y, bottom)), abs(xx-expected))))
        separators.append(image.width)
        x, right = separators[index % columns:index % columns+2]
        cell = alpha.crop((x, y, right, bottom))
        solid = cell.point(lambda a: 255 if a > 100 else 0)
        bounds = solid.getbbox()
        if not bounds:
            raise ValueError(f'{path.name} empty frame {index}')
        # Both strip depth and horizontal region must exclude robe hems.
        foot_left, foot_right = [round(cell.width * fraction) for fraction in sole_range]
        center = solid.crop((foot_left, round(cell.height * .65), foot_right, cell.height))
        feet = center.getbbox()
        floor = round(cell.height * .65) + feet[3] if feet else bounds[3]
        row = [xx for xx in range(foot_left, foot_right)
               if any(solid.getpixel((xx, yy)) for yy in range(max(0, floor-sole_band), floor))]
        anchor_x = (min(row) + max(row)) / 2 if row else cell.width / 2
        frames.append({'rect': [x, y, right-x, bottom-y], 'anchor': [anchor_x, floor], 'bounds': list(bounds)})
    return frames, list(image.size), hashlib.sha256(path.read_bytes()).hexdigest()


# The registration keys own the clip catalog; a second page is not a new action.
for name, previous in list(result.items()):
    if args.clips and name not in args.clips:
        continue
    columns, rows = previous.get('layout', [4, 2])
    rows = args.rows or rows
    sole_band = args.sole_band or previous.get('soleBand', 6)
    sole_range = args.sole_range or previous.get('soleRange', [.30, .75])
    files = args.pages or [page['file'] for page in previous.get('pages', [{'file': f'{name}.png'}])]
    frames, pages, width, height = [], [], 0, 0
    for filename in files:
        page_frames, size, digest = inspect_page(root / filename, columns, rows, sole_band, sole_range)
        pages.append({'file': filename, 'origin': [0, height], 'size': size, 'sha256': digest,
                      'density': (page_frames[0]['bounds'][3]-page_frames[0]['bounds'][1]) / 440})
        for frame in page_frames:
            frame['rect'][1] += height
        frames.extend(page_frames)
        width = max(width, size[0])
        height += size[1]
    order = args.frame_order or previous.get('frameOrder')
    if order:
        if sorted(order) != list(range(len(frames))):
            parser.error('Frame order must use every original cell exactly once')
        frames = [frames[index] for index in order]
    face_width = args.face_width or previous.get('faceWidth')
    density = face_width[0] / face_width[1] if face_width else (frames[0]['bounds'][3]-frames[0]['bounds'][1]) / 440
    value = {'layout': [columns, rows], 'soleBand': sole_band, 'soleRange': sole_range,
             'size': [width, height], 'density': density,
             'frames': frames, 'sha256': pages[0]['sha256']}
    if face_width:
        value['faceWidth'] = face_width
    if len(pages) > 1:
        if face_width:
            parser.error('--face-width is only supported for single-page clips')
        value['pages'] = pages
    if order:
        value['frameOrder'] = order
    result[name] = value
(root / 'registration.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps({name: {'size': value['size'], 'frames': len(value['frames'])} for name, value in result.items()}))
