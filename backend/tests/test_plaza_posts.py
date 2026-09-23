import io
from pathlib import Path

import pytest

from services.plaza_auth import register_user
from services.plaza_db import PlazaDb
from services.plaza_posts import publish_post


PNG_BYTES = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01"
    b"\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89"
    b"\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00\x05\x00\x01"
    b"\r\n-\xdb\x00\x00\x00\x00IEND\xaeB`\x82"
)


@pytest.fixture()
def plaza_db(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_ENV", "development")
    return PlazaDb(tmp_path / "plaza.db")


def test_publish_once_per_project(plaza_db, tmp_path):
    user = register_user(plaza_db, "作者A", "secret12")
    upload_root = tmp_path / "uploads"
    post = publish_post(
        plaza_db,
        user_id=user.user_id,
        author_name=user.username,
        project_id="proj_1",
        title="春天的小兔",
        preview_stream=io.BytesIO(PNG_BYTES),
        preview_filename="preview.png",
        preview_mime="image/png",
        upload_root=upload_root,
    )
    assert post.title == "春天的小兔"
    with pytest.raises(ValueError, match="PROJECT_ALREADY_SHARED"):
        publish_post(
            plaza_db,
            user_id=user.user_id,
            author_name=user.username,
            project_id="proj_1",
            title="重复",
            preview_stream=io.BytesIO(PNG_BYTES),
            preview_filename="preview.png",
            preview_mime="image/png",
            upload_root=upload_root,
        )
