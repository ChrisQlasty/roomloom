from pathlib import Path

import pytest

from app.schema import io
from app.schema.io import dump_scene, load_scene, save_scene
from tests.paths import EXAMPLE_PROJECT

EXAMPLE_SCENE = EXAMPLE_PROJECT / "scene.json"


def test_round_trip_is_byte_identical(tmp_path: Path) -> None:
    scene = load_scene(EXAMPLE_SCENE)
    target = tmp_path / "scene.json"
    save_scene(scene, target)
    assert target.read_bytes() == EXAMPLE_SCENE.read_bytes()
    save_scene(load_scene(target), target)
    assert target.read_bytes() == EXAMPLE_SCENE.read_bytes()


def test_vectors_are_inline_and_indent_is_two_spaces() -> None:
    text = dump_scene(load_scene(EXAMPLE_SCENE))
    assert '\n  "shell": {' in text
    assert "[0.0, 20.0]" in text
    assert text.endswith("}\n")


def test_save_replaces_existing_file_and_leaves_no_temp_files(tmp_path: Path) -> None:
    target = tmp_path / "scene.json"
    target.write_text("old")
    save_scene(load_scene(EXAMPLE_SCENE), target)
    assert target.read_bytes() == EXAMPLE_SCENE.read_bytes()
    assert [p.name for p in tmp_path.iterdir()] == ["scene.json"]


def test_failed_save_keeps_old_file(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    target = tmp_path / "scene.json"
    target.write_text("old")

    def fail(*_args: object) -> None:
        raise OSError("disk full")

    monkeypatch.setattr(io.os, "replace", fail)
    with pytest.raises(OSError, match="disk full"):
        save_scene(load_scene(EXAMPLE_SCENE), target)
    assert target.read_text() == "old"
    assert [p.name for p in tmp_path.iterdir()] == ["scene.json"]
