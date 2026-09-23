"""Publish and list plaza posts (preview image + metadata only)."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from services.image_upload import ImageUploadError, save_uploaded_image
from services.plaza_db import PlazaDb, PlazaPostRow

PLAZA_UPLOAD_DIR_NAME = "plaza"


def post_public_dict(post: PlazaPostRow) -> dict[str, Any]:
    return {
        "postId": post.post_id,
        "projectId": post.project_id,
        "title": post.title,
        "authorName": post.author_name,
        "previewMediaPath": f"/api/plaza/media/{post.preview_filename}",
        "createdAt": post.created_at,
        "userId": post.user_id,
    }


def save_plaza_preview(stream, *, filename: str | None, mime_type: str | None, upload_root: Path) -> str:
    plaza_dir = upload_root / PLAZA_UPLOAD_DIR_NAME
    result = save_uploaded_image(
        stream,
        filename=filename,
        mime_type=mime_type,
        upload_dir=plaza_dir,
    )
    ext = {
        "image/png": ".png",
        "image/jpeg": ".jpg",
        "image/bmp": ".bmp",
    }[str(result["mimeType"])]
    return f"{result['uploadId']}{ext}"


def publish_post(
    db: PlazaDb,
    *,
    user_id: str,
    author_name: str,
    project_id: str,
    title: str,
    preview_stream,
    preview_filename: str | None,
    preview_mime: str | None,
    upload_root: Path,
) -> PlazaPostRow:
    project_id = (project_id or "").strip()
    title = (title or "").strip()
    if not project_id:
        raise ValueError("PROJECT_ID_REQUIRED")
    if not title:
        raise ValueError("TITLE_REQUIRED")
    if len(title) > 80:
        raise ValueError("TITLE_TOO_LONG")

    try:
        stored_name = save_plaza_preview(
            preview_stream,
            filename=preview_filename,
            mime_type=preview_mime,
            upload_root=upload_root,
        )
    except ImageUploadError as exc:
        raise ValueError(exc.code) from exc

    try:
        return db.create_post(
            user_id=user_id,
            project_id=project_id,
            title=title,
            author_name=author_name,
            preview_filename=stored_name,
        )
    except ValueError:
        raise
    except Exception as exc:
        raise ValueError("PROJECT_ALREADY_SHARED") from exc
