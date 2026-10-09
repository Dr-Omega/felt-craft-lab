import os

import pytest

from services.plaza_auth import authenticate_user, issue_user_token, register_user, verify_user_token
from services.plaza_db import PlazaDb


@pytest.fixture()
def plaza_db(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_ENV", "development")
    return PlazaDb(tmp_path / "plaza.db")


def test_register_login_and_verify_token(plaza_db):
    user = register_user(plaza_db, "小星星", "secret12")
    assert user.username == "小星星"
    authed = authenticate_user(plaza_db, "小星星", "secret12")
    assert authed is not None
    token = issue_user_token(authed)
    claims = verify_user_token(token)
    assert claims is not None
    assert claims.user_id == user.user_id
    assert claims.username == "小星星"
