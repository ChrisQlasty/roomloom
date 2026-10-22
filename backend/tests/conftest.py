"""Shared fixtures: keep every test independent of the developer's shell and `.env`."""

import json
import shutil
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest

from app.config import Settings, get_settings
from app.store.projects import ProjectStore
from tests.paths import EXAMPLE_PROJECT


@pytest.fixture
def example_scene_dict() -> dict[str, Any]:
    """A fresh, mutable copy of the example scene as plain JSON data."""
    return json.loads((EXAMPLE_PROJECT / "scene.json").read_text(encoding="utf-8"))


@pytest.fixture
def projects_root(tmp_path: Path) -> Path:
    """A projects folder holding a private copy of the example project."""
    root = tmp_path / "projects"
    shutil.copytree(EXAMPLE_PROJECT, root / EXAMPLE_PROJECT.name)
    return root


@pytest.fixture
def store(projects_root: Path) -> ProjectStore:
    """A project store over `projects_root`."""
    return ProjectStore(projects_root)


@pytest.fixture(autouse=True)
def isolated_settings(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    """Clear env vars that would override Settings, and reset the cached instance."""
    for name in Settings.model_fields:
        monkeypatch.delenv(name.upper(), raising=False)
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()
