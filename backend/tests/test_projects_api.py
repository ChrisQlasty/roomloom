import shutil
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

from app.api import projects as projects_api
from app.config import Settings
from app.main import create_app
from tests.images import jpeg, open_bytes

BASE = "/api/projects/example-l-house"


@pytest.fixture
def client(projects_root: Path) -> TestClient:
    return TestClient(create_app(Settings(_env_file=None, projects_dir=projects_root)))


def upload(
    client: TestClient, data: bytes, name: str = "hall.jpg", path: str = "/assets"
) -> httpx.Response:
    return client.post(BASE + path, files={"file": (name, data, "image/jpeg")})


def test_list_and_get_project(client: TestClient) -> None:
    (card,) = client.get("/api/projects").json()
    assert card["slug"] == "example-l-house" and card["has_thumbnail"] is False
    assert "updated_at" in card
    assert client.get(BASE).json()["name"] == "Example L-house"


def test_get_scene(client: TestClient) -> None:
    scene = client.get(BASE + "/scene").json()
    assert scene["schema_version"] == 1 and "ast_entrance_hall_photo" in scene["assets"]


@pytest.mark.parametrize("path", ["/api/projects/missing", "/api/projects/Bad_Slug/scene"])
def test_unknown_project_is_404(client: TestClient, path: str) -> None:
    assert client.get(path).status_code == 404


def test_upload_adds_asset_via_a_user_change_set_and_dedupes(client: TestClient) -> None:
    first = upload(client, jpeg(gps=True), "Old hall.jpg")
    assert first.status_code == 200
    body = first.json()
    assert body["id"] == "ast_old_hall" and body["created"] is True
    assert body["asset"]["kind"] == "photo"
    scene = client.get(BASE + "/scene").json()
    assert scene["assets"]["ast_old_hall"] == body["asset"]
    history = client.get(BASE + "/history").json()
    assert [(e["seq"], e["source"], e["description"]) for e in history] == [
        (1, "import", "Imported"),
        (2, "user", "Upload photo Old hall.jpg"),
    ]
    again = upload(client, jpeg(gps=True), "copy.jpg").json()
    assert again["id"] == "ast_old_hall" and again["created"] is False
    assert again["asset"] == body["asset"]  # the stored entry, not one named copy.jpg
    assert len(client.get(BASE + "/history").json()) == 2


def test_get_asset_and_thumbnail(client: TestClient) -> None:
    asset_id = upload(client, jpeg((1000, 500), gps=True)).json()["id"]
    full = client.get(f"{BASE}/assets/{asset_id}")
    assert full.status_code == 200 and full.headers["content-type"] == "image/jpeg"
    assert open_bytes(full.content).size == (1000, 500)
    assert not open_bytes(full.content).getexif()
    thumb = client.get(f"{BASE}/assets/{asset_id}", params={"thumb": 1})
    assert open_bytes(thumb.content).size == (320, 160)
    assert client.get(f"{BASE}/assets/ast_nope").status_code == 404


@pytest.mark.parametrize("thumb", [0, 1])
def test_asset_with_missing_file_is_404(
    client: TestClient, projects_root: Path, thumb: int
) -> None:
    shutil.rmtree(projects_root / "example-l-house" / "assets")
    response = client.get(f"{BASE}/assets/ast_entrance_hall_photo", params={"thumb": thumb})
    assert response.status_code == 404


def test_bad_uploads(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    assert upload(client, b"not an image").status_code == 422
    monkeypatch.setattr(projects_api, "MAX_UPLOAD_BYTES", 10)
    assert upload(client, jpeg()).status_code == 413
    assert len(client.get(BASE + "/history").json()) == 0


def test_restore_and_label(client: TestClient) -> None:
    upload(client, jpeg())
    restored = client.post(BASE + "/history/1/restore")
    assert restored.status_code == 200
    assert restored.json()["description"] == "Restored to #1"
    assert restored.json()["source"] == "restore"
    assert "ast_hall" not in client.get(BASE + "/scene").json()["assets"]
    labelled = client.post(BASE + "/history/1/label", json={"label": "As imported"})
    assert labelled.json()["label"] == "As imported"
    assert client.get(BASE + "/history").json()[0]["label"] == "As imported"
    cleared = client.post(BASE + "/history/1/label", json={"label": None})
    assert cleared.json()["label"] is None
    assert client.post(BASE + "/history/42/restore").status_code == 404
    assert client.post(BASE + "/history/42/label", json={"label": "x"}).status_code == 404


def test_project_thumbnail(client: TestClient) -> None:
    assert client.get(BASE + "/thumbnail").status_code == 404
    assert upload(client, jpeg((1280, 720)), "t.jpg", "/thumbnail").status_code == 204
    image = client.get(BASE + "/thumbnail")
    assert open_bytes(image.content).size == (640, 360)
    assert client.get("/api/projects").json()[0]["has_thumbnail"] is True
