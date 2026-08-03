"""TTS cache bounds + atomic write."""

from __future__ import annotations

import sys
import tempfile
import time
import unittest
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from services.tts_cache import (  # noqa: E402
    MAX_TTS_AUDIO_BYTES,
    atomic_write_bytes,
    enforce_tts_audio_size,
    prune_tts_cache,
)


class TtsCacheTests(unittest.TestCase):
    def test_enforce_size(self):
        self.assertTrue(enforce_tts_audio_size(b"abc"))
        self.assertFalse(enforce_tts_audio_size(b""))
        self.assertFalse(enforce_tts_audio_size(b"x" * (MAX_TTS_AUDIO_BYTES + 1)))

    def test_atomic_write_and_prune(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for i in range(5):
                p = root / f"{i}.mp3"
                atomic_write_bytes(p, b"data" + bytes([i]))
                # age older files
                past = time.time() - (10 - i) * 1000
                Path(p).touch()
                import os

                os.utime(p, (past, past))

            # Force tiny limits
            import services.tts_cache as tc

            old_files, old_bytes, old_ttl = tc._MAX_FILES, tc._MAX_TOTAL_BYTES, tc._TTL_SEC
            try:
                tc._MAX_FILES = 3
                tc._MAX_TOTAL_BYTES = 10_000
                tc._TTL_SEC = 7 * 24 * 3600
                prune_tts_cache(root)
                left = list(root.glob("*.mp3"))
                self.assertLessEqual(len(left), 3)
            finally:
                tc._MAX_FILES, tc._MAX_TOTAL_BYTES, tc._TTL_SEC = old_files, old_bytes, old_ttl


if __name__ == "__main__":
    unittest.main()
