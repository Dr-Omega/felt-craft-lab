"""Exercise imported routes with isolated storage; never contact remote services."""
import importlib
import io
import sys
from pathlib import Path

from flask import Flask
from PIL import Image
import pytest


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_ENV", "development")
    monkeypatch.setenv("PLAZA_DB_PATH", str(tmp_path / "plaza.db"))
    monkeypatch.setenv("PLAZA_UPLOAD_DIR", str(tmp_path / "uploads"))
    sys.modules.pop("services.plaza_routes", None)
    routes = importlib.import_module("services.plaza_routes")
    app = Flask(__name__)
    app.register_blueprint(routes.app)
    return app.test_client()


def register(client, name):
    response = client.post("/api/plaza/auth/register", json={"username": name, "password": "testpass", "role": "child"})
    assert response.status_code == 201
    return response.json["result"]


def test_account_publish_read_withdraw_and_owner_isolation(client):
    first, second = register(client, "accountA"), register(client, "accountB")
    auth = {"Authorization": "Bearer " + first["token"]}
    other = {"Authorization": "Bearer " + second["token"]}
    assert client.get("/api/plaza/posts").status_code == 401
    assert client.get("/api/plaza/posts", headers=auth).json["result"]["posts"] == []
    image = io.BytesIO()
    Image.new("RGBA", (16, 16), "orange").save(image, format="PNG")
    image.seek(0)
    response = client.post("/api/plaza/posts", headers=auth, data={
        "projectId": "work-1", "title": "测试作品", "file": (image, "preview.png")
    })
    assert response.status_code == 201
    post = response.json["result"]["post"]
    assert post["userId"] == first["user"]["userId"]
    assert client.get(post["previewMediaPath"], headers=other).status_code == 200
    assert client.delete("/api/plaza/posts/by-project/work-1", headers=other).status_code == 404
    assert client.get("/api/plaza/posts/mine/project-ids", headers=other).json["result"]["projectIds"] == []
    assert client.get("/api/plaza/posts/mine/project-ids", headers=auth).json["result"]["projectIds"] == ["work-1"]
    assert client.delete("/api/plaza/posts/by-project/work-1", headers=auth).status_code == 200
    assert client.get("/api/plaza/posts", headers=auth).json["result"]["posts"] == []


def test_room_route_uses_authenticated_account_and_conflict_version(client):
    a, b = register(client, "roomA"), register(client, "roomB")
    auth = {"Authorization": "Bearer " + a["token"]}
    other = {"Authorization": "Bearer " + b["token"]}
    body = {"character": "小猫", "furniture": "樱花粉", "revision": 0}
    assert client.put("/api/rewards/bear/room", json=body).status_code == 401
    assert client.put("/api/rewards/bear/room", headers=auth, json=body).status_code == 200
    assert client.put("/api/rewards/bear/room", headers=auth, json=body).status_code == 409
    assert client.get("/api/rewards/dashboard", headers=auth).json["result"]["room"]["character"] == "小猫"
    assert client.get("/api/rewards/dashboard", headers=other).json["result"]["room"]["character"] == "小熊"


def test_bad_login_and_shared_wallet_identity(client):
    first = register(client, "accountA")
    assert client.post("/api/plaza/auth/login", json={"username": "accountA", "password": "wrong"}).status_code == 401
    login = client.post("/api/plaza/auth/login", json={"username": "accountA", "password": "testpass"}).json["result"]
    assert login["user"]["userId"] == first["user"]["userId"]
    dashboard = client.get("/api/rewards/dashboard", headers={"Authorization": "Bearer " + login["token"]})
    assert dashboard.status_code == 200
    assert dashboard.json["result"]["user"]["userId"] == first["user"]["userId"]


def test_payment_disabled_and_private_workspace_routes(client):
    from services.workspace_sync import TABLES
    a,b=register(client,'syncA'),register(client,'syncB')
    auth={'Authorization':'Bearer '+a['token']}; other={'Authorization':'Bearer '+b['token']}
    assert client.get('/api/payments/capabilities',headers=auth).json['result']['available'] is False
    assert client.post('/api/payments/orders',headers=auth,json={'packageId':'diamonds_10','requestId':'repeat-1'}).status_code==503
    assert client.post('/api/rewards/recharge',headers=auth,json={'yuan':1,'requestId':'repeat-1'}).status_code==403
    assert client.get('/api/workspace').status_code==401
    document={'schema':'account-workspace/1','userId':a['user']['userId'],'tables':{k:[] for k in TABLES},'recolor':{},'files':[]}
    assert client.put('/api/workspace',headers=auth,json={'revision':0,'document':document}).json['result']['revision']==1
    assert client.put('/api/workspace',headers=auth,json={'revision':0,'document':document}).status_code==409
    assert client.get('/api/workspace',headers=other).json['result']['document'] is None
