# Hosted media derivatives

These files belong to the hosted build only. Desktop PNG/WAV masters remain unchanged.

Run `scripts/prepare-hosted-media.py --ffmpeg <ffmpeg executable> --music-zip <Suno_4_Songs.zip>` from the repository root to reproduce the derivatives (Python/Pillow and FFmpeg with libmp3lame). `image-map.json` maps original source paths to WebP assets; preserve atlas and login eye coordinates. `report.json` records before/after byte counts, not measured download times.

Music supplied by the user on 2026-10-06:
- WELCOME: Suspended in Time, originals 7388a502 and 7ecd0a21.
- Reveal: Quiet Wonder, originals d7249f8a and 70e74505. The user explicitly confirmed this group.

All four tracks are full-length stereo MP3 at 128 kbit/s, metadata stripped, without changing melody or timing. Each scene selects one variant per visit. Public music never gates animation readiness. UI sounds use 96 kbit/s MP3 in `sounds/web-v1`; V01 retains its existing MP3.

The build resolves original renderer imports to derivatives and includes these assets in release manifests. Never replace desktop master paths or publish original ZIP contents as arbitrary files.
