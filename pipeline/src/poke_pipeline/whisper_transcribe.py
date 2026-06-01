"""Alternative transcript path: download audio via yt-dlp, transcribe with
local faster-whisper.

Use this when:
  - YouTube's timedtext endpoint is IP-blocking
    `youtube-transcript-api`, or
  - The video has captions disabled (creators can opt out — Whisper just
    transcribes the audio regardless).

Trade-offs vs the `youtube_captions` path:
  - **Slower**: ~1x-2x realtime on Apple Silicon CPU with the `small`
    model. A 20-min video takes 10-40 min depending on hardware.
  - **No API key, no recurring cost.**
  - **Per-video audio download still goes through yt-dlp**, so a hard IP
    block on the player endpoint can still block this path. The player-
    client fallback (`tv_embedded`/`android`/`mediaconnect`) plus the
    cookies/proxy settings apply equally here.
  - **First run downloads a model** to `~/.cache/huggingface` (244 MB
    for `small`, 1.5 GB for `medium`, 3 GB for `large-v3`).

The module's public surface is `transcribe(video_id, settings)`. It
returns the same `(status, payload)` tuple shape as the captions path
so `transcripts._record` writes the row identically.
"""

from __future__ import annotations

import json
import logging
import tempfile
from pathlib import Path
from typing import Any

from yt_dlp import YoutubeDL  # type: ignore[import-untyped]

from poke_pipeline.config import Settings

log = logging.getLogger(__name__)


# Player clients for audio download. `android` and `mediaconnect` expose
# full audio format ranges; `tv_embedded` is the bot-wall-busting choice
# we use for metadata but it serves only low-bitrate video formats with
# no separate audio track. Order matters: yt-dlp tries left-to-right.
_AUDIO_PLAYER_CLIENTS = ["android", "mediaconnect", "tv_embedded"]


# Process-wide model cache so we don't reload from disk on every call. The
# faster-whisper model is several hundred MB even for `small` and takes a
# few seconds to load — the savings add up across a 100-video batch.
_MODEL_CACHE: dict[tuple[str, str, str], Any] = {}


def get_model(
    model_size: str,
    device: str,
    compute_type: str,
) -> Any:
    """Lazily construct (or reuse) a `WhisperModel`. First call for a
    given `(model_size, device, compute_type)` triple downloads the model
    if missing.
    """
    key = (model_size, device, compute_type)
    cached = _MODEL_CACHE.get(key)
    if cached is not None:
        return cached
    # Imported lazily so the unit-test runner doesn't pay the import cost
    # (faster-whisper pulls in CTranslate2 + tokenizers — multi-second).
    from faster_whisper import WhisperModel  # type: ignore[import-untyped]

    log.info(
        "whisper: loading model %s on %s (%s) — first run may download",
        model_size,
        device,
        compute_type,
    )
    model = WhisperModel(
        model_size,
        device=device,
        compute_type=compute_type,
    )
    _MODEL_CACHE[key] = model
    return model


def transcribe(
    video_id: str,
    settings: Settings,
) -> tuple[str, dict[str, Any]]:
    """Download audio for `video_id` via yt-dlp and transcribe locally.

    Returns the same `(status, payload)` tuple shape as the captions
    path. `status` is `'ok' | 'error'` — we don't produce `'missing'`
    here because Whisper transcribes whatever audio it gets, even from
    videos with disabled captions.
    """
    with tempfile.TemporaryDirectory(prefix="poke-whisper-") as tmp:
        try:
            audio_path = _download_audio(video_id, Path(tmp), settings)
        except Exception as exc:
            log.exception("whisper: audio download failed for %s", video_id)
            return "error", {
                "language": None,
                "text": None,
                "segments_json": None,
                "error_msg": f"whisper audio download failed: {type(exc).__name__}: {exc}",
            }

        try:
            text, segments, language = _run_whisper(audio_path, settings)
        except Exception as exc:
            log.exception("whisper: transcription failed for %s", video_id)
            return "error", {
                "language": None,
                "text": None,
                "segments_json": None,
                "error_msg": f"whisper transcription failed: {type(exc).__name__}: {exc}",
            }

    return "ok", {
        "language": language,
        "text": text,
        "segments_json": json.dumps(segments),
        "error_msg": None,
    }


# ─── audio download ─────────────────────────────────────────────────────────


def _download_audio(
    video_id: str,
    out_dir: Path,
    settings: Settings,
) -> Path:
    """Pull the smallest sensible audio stream to a temp file. Returns
    the path of the downloaded file (yt-dlp picks the extension).
    """
    url = f"https://www.youtube.com/watch?v={video_id}"
    out_template = str(out_dir / f"{video_id}.%(ext)s")
    opts: dict[str, Any] = {
        # Audio-only stream when one is exposed; fall back to the smallest
        # combined audio+video stream when (e.g. the tv_embedded client
        # in the fallback chain doesn't separate audio out). Whisper only
        # reads the audio track either way.
        "format": (
            "worstaudio[abr<=128]/bestaudio[abr<=128]/bestaudio/worst"
        ),
        "outtmpl": out_template,
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
        "ignoreerrors": False,
        "extractor_args": {
            "youtube": {
                "player_client": list(_AUDIO_PLAYER_CLIENTS),
                "player_skip": ["webpage", "configs"],
            },
        },
    }
    # Honor the same cookies/proxy envs that the captions path uses —
    # both transcript methods benefit from auth or different IPs.
    if settings.yt_transcript_cookies_path:
        opts["cookiefile"] = settings.yt_transcript_cookies_path
    if settings.yt_transcript_proxy_url:
        opts["proxy"] = settings.yt_transcript_proxy_url

    with YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=True)
    if not isinstance(info, dict):
        raise RuntimeError("yt-dlp returned no info for audio download")

    # yt-dlp chose the extension based on the format selector; locate the
    # one file it just wrote.
    candidates = sorted(out_dir.glob(f"{video_id}.*"))
    if not candidates:
        raise FileNotFoundError(f"audio file for {video_id} not found after download")
    return candidates[0]


# ─── transcription ──────────────────────────────────────────────────────────


def _run_whisper(
    audio_path: Path,
    settings: Settings,
) -> tuple[str, list[dict[str, Any]], str]:
    """Returns `(joined_text, segments_list, detected_language)`. The
    `segments_list` shape matches what the captions path stores so
    the UI / mention extractor can treat them interchangeably.
    """
    model = get_model(
        settings.whisper_model_size,
        settings.whisper_device,
        settings.whisper_compute_type,
    )
    # `language=None` auto-detects; could be overridden per-source later.
    segments_iter, info = model.transcribe(
        str(audio_path),
        language=None,
        vad_filter=True,  # skip silence — meaningful speedup on long videos
        beam_size=1,  # greedy decode is plenty for talking-head content
    )
    segments: list[dict[str, Any]] = []
    text_parts: list[str] = []
    for seg in segments_iter:
        segments.append(
            {
                "text": seg.text.strip(),
                "start": float(seg.start),
                "duration": float(seg.end - seg.start),
            }
        )
        text_parts.append(seg.text.strip())
    text = "\n".join(t for t in text_parts if t)
    return text, segments, info.language
