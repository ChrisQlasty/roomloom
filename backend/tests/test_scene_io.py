import os
import stat
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.schema.io import dump_scene, load_scene, save_scene
from app.store import atomic
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


def test_number_like_text_in_strings_is_not_reformatted(tmp_path: Path) -> None:
    scene = load_scene(EXAMPLE_SCENE)
    note = "sizes [1,2] and [3,   4]"
    scene.shell.rooms[0].notes.append(note)
    target = tmp_path / "scene.json"
    save_scene(scene, target)
    assert load_scene(target).shell.rooms[0].notes[-1] == note


def test_new_file_gets_umask_mode_and_existing_file_keeps_its_mode(tmp_path: Path) -> None:
    umask = os.umask(0)
    os.umask(umask)
    target = tmp_path / "scene.json"
    save_scene(load_scene(EXAMPLE_SCENE), target)
    assert stat.S_IMODE(target.stat().st_mode) == 0o666 & ~umask
    target.chmod(0o640)
    save_scene(load_scene(EXAMPLE_SCENE), target)
    assert stat.S_IMODE(target.stat().st_mode) == 0o640


def test_invalid_scene_is_not_saved(tmp_path: Path) -> None:
    target = tmp_path / "scene.json"
    target.write_text("old")
    scene = load_scene(EXAMPLE_SCENE)
    scene.shell.rooms[0].ceiling_height = 1.0  # below its door; assignment is not validated
    with pytest.raises(ValidationError, match="ceiling_height 1.0"):
        save_scene(scene, target)
    assert target.read_text() == "old"
    assert [p.name for p in tmp_path.iterdir()] == ["scene.json"]


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

    monkeypatch.setattr(atomic.os, "replace", fail)
    with pytest.raises(OSError, match="disk full"):
        save_scene(load_scene(EXAMPLE_SCENE), target)
    assert target.read_text() == "old"
    assert [p.name for p in tmp_path.iterdir()] == ["scene.json"]
