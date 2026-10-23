"""Download a board through the Miro REST API v2 and keep the raw dump on disk."""

import json
import time
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.parse import quote

import httpx

from app.importers.miro import MiroImportError
from app.store.atomic import write_atomic

API_BASE = "https://api.miro.com/v2"
PAGE_LIMIT = 50  # the API maximum
MAX_RETRIES = 6
MAX_WAIT_S = 60.0

RawBoard = dict[str, Any]


def _wait_seconds(response: httpx.Response, attempt: int) -> float:
    """How long to back off: Retry-After, else the rate-limit reset time, else exponential."""
    retry_after = response.headers.get("retry-after")
    if retry_after and retry_after.replace(".", "", 1).isdigit():
        return min(float(retry_after), MAX_WAIT_S)
    reset = response.headers.get("x-ratelimit-reset")
    if reset and reset.isdigit():
        return min(max(int(reset) - time.time(), 1.0), MAX_WAIT_S)
    return min(2.0**attempt, MAX_WAIT_S)


def _get(
    client: httpx.Client, path: str, params: dict[str, Any], sleep: Callable[[float], None]
) -> dict[str, Any]:
    """GET one page, retrying on rate limits (429) and server errors."""
    for attempt in range(MAX_RETRIES + 1):
        try:
            response = client.get(path, params=params)
        except httpx.TransportError as e:
            if attempt == MAX_RETRIES:
                raise MiroImportError(f"cannot reach the Miro API: {e}") from e
            sleep(min(2.0**attempt, MAX_WAIT_S))
            continue
        retryable = response.status_code == 429 or response.status_code >= 500
        if retryable and attempt < MAX_RETRIES:
            sleep(_wait_seconds(response, attempt))
            continue
        if response.status_code in (401, 403):
            raise MiroImportError(
                f"Miro refused access ({response.status_code}): check MIRO_TOKEN in .env "
                "and that the token may read this board (scope boards:read)"
            )
        if response.status_code == 404:
            raise MiroImportError("Miro board not found (404): check the board id")
        if response.status_code >= 400:
            raise MiroImportError(f"Miro API error {response.status_code}: {response.text[:300]}")
        return response.json()
    raise AssertionError("unreachable")


def _all_pages(
    client: httpx.Client, path: str, sleep: Callable[[float], None]
) -> list[dict[str, Any]]:
    """Follow `cursor` until the last page."""
    results: list[dict[str, Any]] = []
    cursor: str | None = None
    while True:
        params: dict[str, Any] = {"limit": PAGE_LIMIT}
        if cursor:
            params["cursor"] = cursor
        page = _get(client, path, params, sleep)
        results.extend(page.get("data", []))
        cursor = page.get("cursor")
        if not cursor or not page.get("data"):
            return results


def fetch_board(
    board_id: str,
    token: str,
    *,
    transport: httpx.BaseTransport | None = None,
    sleep: Callable[[float], None] = time.sleep,
) -> RawBoard:
    """All items and connectors of a board, as the API returns them."""
    if not token:
        raise MiroImportError("MIRO_TOKEN is not set in .env")
    if not board_id:
        raise MiroImportError("no board id: pass --board or set MIRO_BOARD_ID in .env")
    board_path = f"/boards/{quote(board_id, safe='')}"
    headers = {"Authorization": f"Bearer {token}", "Accept": "application/json"}
    with httpx.Client(
        base_url=API_BASE, headers=headers, timeout=30.0, transport=transport
    ) as client:
        items = _all_pages(client, f"{board_path}/items", sleep)
        connectors = _all_pages(client, f"{board_path}/connectors", sleep)
    return {
        "source": "miro-api-v2",
        "fetched_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "items": items,
        "connectors": connectors,
    }


def load_raw(path: Path) -> RawBoard:
    """A saved dump: `{items, connectors}`, or a bare API page `{data}` or item list."""
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        raise MiroImportError(f"cannot read board dump {path}: {e}") from e
    if isinstance(data, list):
        return {"items": data, "connectors": []}
    if isinstance(data, dict) and "items" not in data and "data" in data:
        return {"items": data["data"], "connectors": []}
    if not isinstance(data, dict) or not isinstance(data.get("items"), list):
        raise MiroImportError(f"{path} is not a Miro board dump (no 'items' list)")
    return {**data, "connectors": data.get("connectors", [])}


def save_raw(raw: RawBoard, path: Path) -> None:
    """Write the dump for debugging (atomically, pretty-printed), creating its folder."""
    path.parent.mkdir(parents=True, exist_ok=True)
    write_atomic(path, (json.dumps(raw, indent=1, ensure_ascii=False) + "\n").encode())
