"""Build web-only image/audio derivatives; never modify desktop masters."""
import argparse
import hashlib
import json
import subprocess
import zipfile
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--ffmpeg', required=True)
    parser.add_argument('--music-zip', type=Path)
    args = parser.parse_args()
    output = ROOT / 'web/media'
    output.mkdir(parents=True, exist_ok=True)
    mapping, report = {}, []
    sources = list((ROOT / 'desktop/src/renderer/assets/visuals').rglob('*.png'))
    sources += list((ROOT / 'web/src/portal/assets').glob('*.webp'))
    sources += list((ROOT / 'web/src/login/assets').glob('*.png'))
    for source in sources:
        if source.stat().st_size < 70000:
            continue
        relative = source.relative_to(ROOT).as_posix()
        target = output / 'images' / (hashlib.sha256(relative.encode()).hexdigest()[:12] + '.webp')
        target.parent.mkdir(parents=True, exist_ok=True)
        with Image.open(source) as image:
            # Atlas/login coordinates are part of their runtime contract.
            if 'pet-sequences' not in relative and '/login/' not in relative:
                image.thumbnail((1600, 1600), Image.Resampling.LANCZOS)
            image.save(target, 'WEBP', quality=78, method=4)
        mapping[relative] = target.relative_to(ROOT / 'web').as_posix()
        report.append({'source': relative, 'before': source.stat().st_size, 'after': target.stat().st_size})
    def transcode(source, target, bitrate):
        target.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run([args.ffmpeg, '-v', 'error', '-y', '-i', str(source), '-map_metadata', '-1', '-vn', '-c:a', 'libmp3lame', '-b:a', bitrate, '-ar', '44100', str(target)], check=True)
        report.append({'source': str(source.name), 'before': source.stat().st_size, 'after': target.stat().st_size})
    for source in (ROOT / 'desktop/public/sounds/v1').glob('*.wav'):
        transcode(source, output / 'public/sounds/web-v1' / source.with_suffix('.mp3').name, '96k')
    if args.music_zip:
        with zipfile.ZipFile(args.music_zip) as archive:
            groups = {'Quiet Wonder': 'reveal', 'Suspended in Time': 'welcome'}
            for title, group in groups.items():
                tracks = sorted(name for name in archive.namelist() if title in name and name.endswith('.mp3'))
                if len(tracks) != 2:
                    raise ValueError('Expected exactly two tracks per scene')
                for index, name in enumerate(tracks, 1):
                    source = ROOT / '.local/hosted-music-originals' / Path(name).name
                    source.parent.mkdir(parents=True, exist_ok=True)
                    source.write_bytes(archive.read(name))
                    transcode(source, output / f'music/{group}-{index}.mp3', '128k')
    (output / 'image-map.json').write_text(json.dumps(mapping, indent=2), encoding='utf-8')
    (output / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'files': len(report), 'before': sum(r['before'] for r in report), 'after': sum(r['after'] for r in report)}))

if __name__ == '__main__':
    main()
