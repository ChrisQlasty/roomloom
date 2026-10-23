import json
from pathlib import Path

import httpx
import pytest

from app.importers.miro import MiroImportError
from app.importers.miro.fetch import fetch_board, load_raw, save_raw


def handler_for(pages: dict[str, list[dict]], failures: list[int] | None = None):
    """A fake Miro API: `pages` maps an endpoint to its pages; `failures` are served first."""
    failures = list(failures or [])
    seen: list[httpx.Request] = []

    def handle(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        if failures:
            status = failures.pop(0)
            return httpx.Response(status, headers={"retry-after": "3"}, json={"message": "slow"})
        endpoint = request.url.path.rsplit("/", 1)[-1]
        index = int(request.url.params.get("cursor", "0"))
        page = pages[endpoint][index]
        more = index + 1 < len(pages[endpoint])
        body = {"data": page, "size": len(page), "limit": 50}
        if more:
            body["cursor"] = str(index + 1)
        return httpx.Response(200, json=body)

    return handle, seen


def test_fetch_follows_cursors_for_items_and_connectors() -> None:
    pages = {
        "items": [[{"id": "1"}, {"id": "2"}], [{"id": "3"}]],
        "connectors": [[{"id": "c"}]],
    }
    handle, seen = handler_for(pages)
    raw = fetch_board(
        "uXjV/abc=", "tok", transport=httpx.MockTransport(handle), sleep=lambda s: None
    )
    assert [i["id"] for i in raw["items"]] == ["1", "2", "3"]
    assert [c["id"] for c in raw["connectors"]] == ["c"]
    first = seen[0]
    assert first.headers["authorization"] == "Bearer tok"
    assert first.url.raw_path.startswith(b"/v2/boards/uXjV%2Fabc%3D/items")
    assert first.url.params["limit"] == "50"
    assert "board_id" not in raw and "tok" not in json.dumps(raw)


def test_fetch_backs_off_on_rate_limits_and_server_errors() -> None:
    handle, _ = handler_for({"items": [[]], "connectors": [[]]}, failures=[429, 503])
    waits: list[float] = []
    fetch_board("b", "tok", transport=httpx.MockTransport(handle), sleep=waits.append)
    assert waits == [3.0, 3.0]


@pytest.mark.parametrize(
    ("status", "message"), [(401, "refused access"), (404, "not found"), (400, "error 400")]
)
def test_fetch_errors_are_readable(status: int, message: str) -> None:
    transport = httpx.MockTransport(lambda r: httpx.Response(status, text="nope"))
    with pytest.raises(MiroImportError, match=message):
        fetch_board("b", "tok", transport=transport, sleep=lambda s: None)


def test_fetch_needs_a_token_and_a_board() -> None:
    with pytest.raises(MiroImportError, match="MIRO_TOKEN"):
        fetch_board("b", "")
    with pytest.raises(MiroImportError, match="board id"):
        fetch_board("", "tok")


def test_load_raw_accepts_dumps_pages_and_item_lists(tmp_path: Path) -> None:
    path = tmp_path / "dump.json"
    for content, items in [
        ({"items": [{"id": "1"}], "connectors": []}, ["1"]),
        ({"items": [{"id": "1"}]}, ["1"]),
        ({"data": [{"id": "2"}], "cursor": None}, ["2"]),
        ([{"id": "3"}], ["3"]),
    ]:
        path.write_text(json.dumps(content))
        raw = load_raw(path)
        assert [i["id"] for i in raw["items"]] == items and raw["connectors"] == []


@pytest.mark.parametrize("content", ["{not json", '{"nothing": 1}', '"text"'])
def test_load_raw_rejects_other_files(tmp_path: Path, content: str) -> None:
    path = tmp_path / "dump.json"
    path.write_text(content)
    with pytest.raises(MiroImportError):
        load_raw(path)


def test_save_raw_round_trips(tmp_path: Path) -> None:
    raw = {"items": [{"id": "1", "data": {"content": "<p>Sala ł</p>"}}], "connectors": []}
    path = tmp_path / "import" / "miro_raw.json"
    save_raw(raw, path)
    assert load_raw(path) == raw
