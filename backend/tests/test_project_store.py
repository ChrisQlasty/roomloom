import asyncio
import json
from datetime import UTC, datetime
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.schema.io import load_scene
from app.schema.project import Project
from app.store.projects import ProjectExists, ProjectNotFound, ProjectStore, is_valid_slug
from tests.images import jpeg, open_bytes

SLUG = "example-l-house"


def new_project(slug: str = "new-house") -> Project:
    return Project(
        id=slug, slug=slug, name="New house", created_at=datetime(2026, 1, 1, tzinfo=UTC)
    )


@pytest.mark.parametrize("slug", ["a", "old-school", "x1-2"])
def test_valid_slugs(slug: str) -> None:
    assert is_valid_slug(slug)


@pytest.mark.parametrize("slug", ["", "..", "../x", "a/b", "Big", "a_b", "-a", "a-", "a--b", "a\n"])
def test_invalid_slugs(slug: str) -> None:
    assert not is_valid_slug(slug)


def test_get_and_list(store: ProjectStore) -> None:
    assert store.get(SLUG).name == "Example L-house"
    (summary,) = store.list()
    assert summary.slug == SLUG
    assert summary.updated_at == summary.created_at
    assert summary.has_thumbnail is False


def test_list_skips_stray_and_broken_folders(store: ProjectStore, projects_root: Path) -> None:
    (projects_root / "notes").mkdir()
    (projects_root / "broken").mkdir()
    (projects_root / "broken" / "project.json").write_text("{}")
    (projects_root / ".hidden").mkdir()
    assert [s.slug for s in store.list()] == [SLUG]


def test_list_of_missing_root_is_empty(tmp_path: Path) -> None:
    assert ProjectStore(tmp_path / "nope").list() == []


@pytest.mark.parametrize("slug", ["missing", "../projects", "Example"])
def test_get_unknown_or_malformed_slug(store: ProjectStore, slug: str) -> None:
    with pytest.raises(ProjectNotFound):
        store.get(slug)


def test_create_commits_seq_1_imported(store: ProjectStore) -> None:
    scene = store.load_scene(SLUG).model_copy(update={"version": 0})
    entry = asyncio.run(store.create(new_project(), scene))
    assert (entry.seq, entry.description, entry.source, entry.scene_version) == (
        1,
        "Imported",
        "import",
        1,
    )
    folder = store.require("new-house")
    assert json.loads((folder / "project.json").read_text())["slug"] == "new-house"
    assert load_scene(folder / "scene.json").version == 1
    assert store.history.list("new-house") == [entry]
    assert store.list()[0].slug == "new-house"  # most recently edited first
    assert store.list()[0].updated_at == entry.ts


def test_create_refuses_an_existing_project(store: ProjectStore) -> None:
    with pytest.raises(ProjectExists):
        asyncio.run(store.create(new_project(SLUG), store.load_scene(SLUG)))
    assert store.get(SLUG).name == "Example L-house"


def test_create_with_invalid_scene_leaves_nothing(store: ProjectStore, projects_root: Path) -> None:
    bad = store.load_scene(SLUG)
    bad.shell.rooms[0].ceiling_height = 1.0
    with pytest.raises(ValidationError):
        asyncio.run(store.create(new_project(), bad))
    assert not (projects_root / "new-house").exists()


def test_thumbnail_is_stored_as_small_jpeg(store: ProjectStore) -> None:
    store.save_thumbnail(SLUG, jpeg((1280, 720), gps=True))
    img = open_bytes(store.thumbnail_path(SLUG).read_bytes())
    assert img.format == "JPEG" and img.size == (640, 360)
    assert store.summary(SLUG).has_thumbnail
