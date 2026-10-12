"""Bounded private pipe; pinned yt-dlp acquisition and faster-whisper CPU ASR.

No product server, browser cookies, provider keys, or book-write capability.
"""
import contextlib
import hashlib
import importlib.metadata
import io
import ipaddress
import json
import os
import re
from pathlib import Path
import shutil
import socket
import sys
import urllib.parse
import urllib.request
import sysconfig
import zipfile

SCRIPT = Path(__file__).resolve().parent
ROOT = Path(sys.argv[1]).resolve(strict=True)
LOCK = json.loads((SCRIPT / "runtime-lock.json").read_text(encoding="utf-8"))


def contained(path):
    candidate = Path(path).resolve()
    if not candidate.is_relative_to(ROOT):
        raise ValueError("RUNTIME_PATH")
    return candidate


def frame(value):
    print(json.dumps(value, ensure_ascii=False), flush=True)


def write_json(path, value):
    destination = contained(path)
    staging = contained(destination.with_name(destination.name + ".tmp"))
    staging.write_text(json.dumps(value, ensure_ascii=False), encoding="utf-8")
    os.replace(staging, destination)


def environment():
    site = contained(ROOT / "env" / "Lib" / "site-packages")
    sys.path.insert(0, str(site))
    sys.path.insert(0, str(contained(ROOT / "yt-dlp")))
    os.environ["HF_HOME"] = str(contained(ROOT / "cache"))
    os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
    return site


def model_verified(full=False):
    for item in LOCK["model"]["files"]:
        path = contained(ROOT / "model" / item["name"])
        if not path.is_file() or path.stat().st_size != item["bytes"]:
            return False
        if full:
            algorithm = "sha256" if "sha256" in item else "sha1"
            digest = hashlib.new(algorithm)
            if algorithm == "sha1":
                digest.update(f"blob {item['bytes']}\0".encode())
            with path.open("rb") as stream:
                while data := stream.read(4 * 1024 * 1024):
                    digest.update(data)
            if digest.hexdigest() != item.get("sha256", item.get("gitBlob")):
                return False
    return True


def prepared():
    try:
        environment()
        marker = json.loads((ROOT / "ready.json").read_text(encoding="utf-8"))
        if marker != hashlib.sha256((SCRIPT / "runtime-lock.json").read_bytes()).hexdigest():
            return False
        return all(importlib.metadata.version(p["name"]) == p["version"] for p in LOCK["packages"]) and model_verified()
    except Exception:
        return False


def prepare():
    if sys.version_info[:2] != (3, 12):
        raise ValueError("PYTHON_VERSION")
    frame({"stage": "dependencies", "progress": 5})
    site = environment()
    site.mkdir(parents=True, exist_ok=True)
    # The verified CPython archive supplies its own pip wheel. Import it in this
    # process; no ensurepip child can survive a cancelled preparation.
    wheels = list((Path(sysconfig.get_path("stdlib")) / "ensurepip" / "_bundled").glob("pip-*.whl"))
    if len(wheels) != 1:
        raise ValueError("PIP_BOOTSTRAP")
    sys.path.insert(0, str(wheels[0]))
    # Invoke the prepared environment's pip in this owned process. Cancellation
    # cannot orphan an installer child or accidentally touch system packages.
    from pip._internal.cli.main import main as pip_main
    with contextlib.redirect_stdout(sys.stderr):
        code = pip_main(["install", "--require-hashes", "--no-deps", "--only-binary=:all:", "--target", str(contained(ROOT / "env" / "Lib" / "site-packages")), "--upgrade", "--disable-pip-version-check", "--timeout", "30", "--retries", "1", "-r", str(SCRIPT / "requirements.lock")])
    if code:
        raise ValueError("DEPENDENCIES_UNAVAILABLE")
    frame({"stage": "downloader", "progress": 40})
    request = urllib.request.Request(LOCK["ytDlp"]["url"], headers={"User-Agent": "Lanjian-Inspiration"})
    with urllib.request.urlopen(request, timeout=30) as response:
        raw = response.read(16 * 1024 * 1024 + 1)
    if len(raw) > 16 * 1024 * 1024 or hashlib.sha256(raw).hexdigest() != LOCK["ytDlp"]["sha256"]:
        raise ValueError("DOWNLOADER_HASH")
    target = contained(ROOT / "yt-dlp")
    target.mkdir(exist_ok=True)
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        for entry in archive.infolist():
            parts = Path(entry.filename).parts[1:]
            if not parts or parts[0] not in ["yt_dlp", "LICENSE"] or entry.is_dir():
                continue
            path = contained(target.joinpath(*parts))
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(archive.read(entry))
    frame({"stage": "model", "progress": 55})
    from huggingface_hub import snapshot_download
    snapshot_download(LOCK["model"]["repo"], revision=LOCK["model"]["revision"], local_dir=str(contained(ROOT / "model")), allow_patterns=["config.json", "model.bin", "tokenizer.json", "vocabulary.*"])
    if not model_verified(full=True):
        raise ValueError("MODEL_HASH")
    (ROOT / "ready.json").write_text(json.dumps(hashlib.sha256((SCRIPT / "runtime-lock.json").read_bytes()).hexdigest()), encoding="utf-8")
    frame({"ok": True, "ready": prepared()})


def network_url(url):
    parsed = urllib.parse.urlparse(url)
    host = parsed.hostname or ""
    domains = ("bilibili.com", "bilivideo.com", "bilivideo.cn", "hdslb.com", "douyin.com", "douyinvod.com", "amemv.com", "snssdk.com", "bytecdn.cn", "byteimg.com", "ibytedtos.com")
    if parsed.scheme != "https" or parsed.username or parsed.password or parsed.port or not any(host == d or host.endswith("." + d) for d in domains):
        raise ValueError("NETWORK_URL")
    addresses = socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)
    if not addresses or any(not ipaddress.ip_address(a[4][0]).is_global for a in addresses):
        raise ValueError("NETWORK_ADDRESS")


def acquire(url, job):
    if not prepared() or not model_verified(full=True):
        raise ValueError("RUNTIME_NOT_READY")
    import yt_dlp
    from yt_dlp.networking import _urllib as network
    original_redirect = network.RedirectHandler
    class CheckedRedirect(original_redirect):
        max_redirections = 4
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            network_url(newurl)
            return super().redirect_request(req, fp, code, msg, headers, newurl)
    # This isolated worker installs only the urllib request backend. Validation
    # happens before every redirect, not after an unsafe destination was read.
    network.RedirectHandler = CheckedRedirect
    from faster_whisper import WhisperModel

    class PrivateDownloader(yt_dlp.YoutubeDL):
        def urlopen(self, request):
            network_url(request.url if hasattr(request, "url") else request)
            response = super().urlopen(request)
            network_url(response.url)
            return response

    class Quiet:
        def debug(self, message): pass
        def warning(self, message): pass
        def error(self, message): pass

    folder = contained(ROOT / "media" / job)
    folder.mkdir(parents=True, exist_ok=False)
    def progress(data):
        total = data.get("total_bytes") or data.get("total_bytes_estimate") or 0
        size = data.get("downloaded_bytes", 0)
        if size > 128 * 1024 * 1024 or total > 128 * 1024 * 1024:
            raise ValueError("MEDIA_SIZE")
    try:
        network_url(url)
        with PrivateDownloader({"format": "bestaudio/best", "outtmpl": str(folder / "audio.%(ext)s"), "noplaylist": True, "playlist_items": "1", "max_filesize": 128 * 1024 * 1024, "socket_timeout": 30, "retries": 1, "fragment_retries": 1, "concurrent_fragment_downloads": 1, "cachedir": False, "enable_file_urls": False, "proxy": "", "quiet": True, "logger": Quiet(), "progress_hooks": [progress], "match_filter": lambda info, **kw: "VIDEO_DURATION" if not info.get("duration") or info["duration"] > 3600 else None}) as downloader:
            info = downloader.extract_info(url, download=True)
            if not info or info.get("_type") in ["playlist", "multi_video"]:
                raise ValueError("SINGLE_VIDEO_REQUIRED")
            filename = contained(downloader.prepare_filename(info))
        metadata = {"title": str(info.get("title") or "视频语音")[:300], "author": str(info.get("uploader") or "")[:300], "duration": info["duration"], "url": url, "platform": "bilibili" if "bilibili.com" in urllib.parse.urlparse(url).hostname else "douyin", "language": "unknown"}
        (folder / "metadata.json").write_text(json.dumps(metadata, ensure_ascii=False), encoding="utf-8")
        frame({"stage": "transcribing", "progress": 45})
        model = WhisperModel(str(contained(ROOT / "model")), device="cpu", compute_type="int8", cpu_threads=2, local_files_only=True)
        segments, details = model.transcribe(str(filename), beam_size=5, vad_filter=True)
        timed = []
        last_progress = 45
        for segment in segments:
            if len(timed) >= 10000:
                raise ValueError("SEGMENT_LIMIT")
            timed.append({"start": segment.start, "end": segment.end, "text": segment.text})
            percent = min(98, 45 + int(53 * segment.end / max(info["duration"], 1)))
            if percent >= last_progress + 2:
                frame({"stage": "transcribing", "progress": percent})
                last_progress = percent
            # Completed speech survives failure/cancel; main owns publication.
            write_json(folder / "transcript.partial.json", timed)
        frame({"ok": True, "title": str(info.get("title") or "视频语音")[:300], "author": str(info.get("uploader") or "")[:300], "duration": info["duration"], "language": details.language, "timed": timed})
    finally:
        # Only this resolved, freshly-created job's acquired media is cleaned.
        # Partial transcript stays in its private job folder for explicit review.
        for file in folder.glob("audio.*"):
            path = contained(file)
            if path.is_file() and not file.is_symlink():
                path.unlink()


def failure_code(error):
    # Classify locally; never return library text, signed URLs or transcripts.
    text = str(error).lower()
    if "runtime_not_ready" in text:
        return "RUNTIME_NOT_READY"
    if "media_size" in text or "max-filesize" in text:
        return "MEDIA_SIZE"
    if "video_duration" in text:
        return "VIDEO_DURATION"
    if re.search(r"\b(?:429|412)\b", text) or any(word in text for word in ("too many requests", "rate limit")):
        return "PLATFORM_RATE_LIMIT"
    if re.search(r"\b403\b", text) or any(word in text for word in ("cookie", "login", "log in", "sign in", "permission", "captcha")):
        return "PLATFORM_AUTH_REQUIRED"
    if re.search(r"\b404\b", text) or any(word in text for word in ("not found", "deleted", "removed", "private video")):
        return "VIDEO_UNAVAILABLE"
    if any(word in text for word in ("timed out", "timeout", "connection", "resolve", "network_address")):
        return "VIDEO_NETWORK"
    if "network_url" in text:
        return "MEDIA_ADDRESS_UNSUPPORTED"
    return "VIDEO_READ_FAILED"


try:
    request = json.loads(sys.stdin.readline(8192))
    if request["action"] == "probe":
        frame({"ok": True, "ready": prepared()})
    elif request["action"] == "prepare":
        prepare()
    elif request["action"] == "acquire":
        import uuid
        acquire(request["url"], str(uuid.UUID(request["jobId"])))
    else:
        raise ValueError("ACTION")
except Exception as error:
    # Library exceptions may contain signed media URLs or original transcripts.
    frame({"ok": False, "code": failure_code(error)})
    sys.exit(1)
