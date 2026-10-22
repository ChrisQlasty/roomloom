"""Shared fixtures: keep every test independent of the developer's shell and `.env`."""

import json
from collections.abc import Iterator
from typing import Any

import pytest

from app.config import Settings, get_settings
from tests.paths import EXAMPLE_PROJECT


@pytest.fixture
def example_scene_dict() -> dict[str, Any]:
    """A fresh, mutable copy of the example scene as plain JSON data."""
    return json.loads((EXAMPLE_PROJECT / "scene.json").read_text(encoding="utf-8"))


@pytest.fixture(autouse=True)
def isolated_settings(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    """Clear env vars that would override Settings, and reset the cached instance."""
    for name in Settings.model_fields:
        monkeypatch.delenv(name.upper(), raising=False)
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()
