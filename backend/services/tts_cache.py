"""服务端 TTS 磁盘缓存：有界容量 / 条目 / TTL + 原子写入。"""

from __future__ import annotations

import os
import time
from pathlib import Path

MAX_TTS_AUDIO_BYTES = int(os.getenv("AI_MAX_TTS_AUDIO_BYTES", str(2 * 1024 * 1024)))
_MAX_FILES = int(os.getenv("AI_TTS_CACHE_MAX_FILES", "200"))
_MAX_TOTAL_BYTES = int(os.getenv("AI_TTS_CACHE_MAX_BYTES", str(100 * 1024 * 1024)))
_TTL_SEC = float(os.getenv("AI_TTS_CACHE_TTL_SEC", str(7 * 24 * 3600)))


def enforce_tts_audio_size(audio_bytes: bytes) -> bool:
    return 0 < len(audio_bytes) <= MAX_TTS_AUDIO_BYTES


def atomic_write_bytes(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_bytes(data)
    tmp.replace(path)


def prune_tts_cache(cache_dir: Path) -> None:
    cache_dir.mkdir(parents=True, exist_ok=True)
    now = time.time()
    entries: list[tuple[float, int, Path]] = []
    for p in cache_dir.glob("*.mp3"):
        try:
            st = p.stat()
        except OSError:
            continue
        age = now - st.st_mtime
        if age > _TTL_SEC:
            try:
                p.unlink(missing_ok=True)
            except OSError:
                pass
            continue
        entries.append((st.st_mtime, st.st_size, p))

    entries.sort(key=lambda x: x[0])  # oldest first
    total = sum(size for _, size, _ in entries)
    while entries and (len(entries) > _MAX_FILES or total > _MAX_TOTAL_BYTES):
        _, size, path = entries.pop(0)
        total -= size
        try:
            path.unlink(missing_ok=True)
        except OSError:
            pass
