"""Image upload validation and Flask endpoint tests."""

from __future__ import annotations

import io
import os
import sys
import tempfile
import unittest
import uuid
from pathlib import Path
from unittest import mock

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))
os.environ.setdefault("APP_ENV", "development")
os.environ.setdefault("AI_SESSION_HMAC_SECRET", "test-session-hmac-secret-not-for-prod")

from services.image_upload import ImageUploadError, save_uploaded_image  # noqa: E402

PNG_BYTES = b"\x89PNG\r\n\x1a\n" + b"minimal-test-data"


class ImageUploadUnitTests(unittest.TestCase):
    def test_saves_supported_image_with_generated_name(self):
        with tempfile.TemporaryDirectory() as tmp:
            result = save_uploaded_image(
                io.BytesIO(PNG_BYTES),
                filename="我的照片.png",
                mime_type="image/png",
                upload_dir=Path(tmp),
            )
            files = list(Path(tmp).glob("*.png"))
            self.assertEqual(len(files), 1)
            self.assertEqual(files[0].read_bytes(), PNG_BYTES)
            self.assertEqual(result["originalName"], "我的照片.png")
            self.assertNotIn("我的照片", files[0].name)

    def test_rejects_content_that_does_not_match_mime(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(ImageUploadError) as raised:
                save_uploaded_image(
                    io.BytesIO(b"not-an-image"),
                    filename="fake.png",
                    mime_type="image/png",
                    upload_dir=Path(tmp),
                )
            self.assertEqual(raised.exception.code, "IMAGE_INVALID_CONTENT")
            self.assertEqual(list(Path(tmp).iterdir()), [])


class ImageUploadEndpointTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from app import app

        cls.app_module = sys.modules["app"]
        cls.client = app.test_client()

    def _auth_headers(self) -> dict[str, str]:
        installation_id = str(uuid.uuid4())
        response = self.client.post("/api/session/token", json={"installationId": installation_id})
        token = response.get_json()["result"]["token"]
        return {
            "Authorization": f"Bearer {token}",
            "X-Felt-Installation-Id": installation_id,
        }

    def test_upload_requires_session(self):
        response = self.client.post(
            "/api/images/upload",
            data={"file": (io.BytesIO(PNG_BYTES), "photo.png", "image/png")},
        )
        self.assertEqual(response.status_code, 401)

    def test_upload_saves_image_and_returns_metadata(self):
        with tempfile.TemporaryDirectory() as tmp, mock.patch.object(
            self.app_module, "IMAGE_UPLOAD_DIR", Path(tmp)
        ):
            response = self.client.post(
                "/api/images/upload",
                headers=self._auth_headers(),
                data={"file": (io.BytesIO(PNG_BYTES), "photo.png", "image/png")},
            )
            self.assertEqual(response.status_code, 201)
            body = response.get_json()
            self.assertTrue(body["ok"])
            self.assertEqual(body["result"]["originalName"], "photo.png")
            self.assertEqual(body["result"]["mimeType"], "image/png")
            self.assertEqual(len(list(Path(tmp).glob("*.png"))), 1)


if __name__ == "__main__":
    unittest.main()
