import asyncio
import gzip
from pathlib import Path
from typing import Any

import pytest
from pydantic import ValidationError

from app.schema.io import load_scene
from app.schema.scene import Note, Scene
from app.store import history as history_module
from app.store.history import SnapshotNotFound
from app.store.projects import ProjectNotFound, ProjectStore

SLUG = "example-l-house"


def with_note(scene: Scene, n: int) -> Scene:
    """A copy of `scene` with one extra building note."""
    return scene.model_copy(update={"notes": [*scene.notes, Note(id=f"note_t{n}", text=f"n{n}")]})


def content(scene: Scene) -> dict[str, Any]:
    """Everything except the version counter."""
    return scene.model_dump(mode="json", exclude={"version"})


def disk_scene(store: ProjectStore) -> Scene:
    return load_scene(store.require(SLUG) / "scene.json")


def test_first_commit_records_the_existing_scene_as_imported_baseline(store: ProjectStore) -> None:
    original = store.load_scene(SLUG)
    assert store.history.list(SLUG) == []
    entry = asyncio.run(store.history.commit(SLUG, with_note(original, 1), "Add a note", "user"))
    first, second = store.history.list(SLUG)
    assert (first.seq, first.description, first.source) == (1, "Imported", "import")
    assert first.scene_version == original.version
    assert store.history.snapshot(SLUG, 1) == original
    assert entry == second
    assert (second.seq, second.source, second.scene_version) == (2, "user", original.version + 1)
    assert disk_scene(store).version == original.version + 1
    assert store.history.snapshot(SLUG, 2) == disk_scene(store)


def test_commit_ignores_the_incoming_version_and_bumps_the_stored_one(store: ProjectStore) -> None:
    scene = store.load_scene(SLUG).model_copy(update={"version": 99})
    asyncio.run(store.history.commit(SLUG, scene, "x", "agent"))
    asyncio.run(store.history.commit(SLUG, scene, "y", "agent"))
    assert [e.scene_version for e in store.history.list(SLUG)] == [1, 2, 3]
    assert disk_scene(store).version == 3


def test_snapshots_are_gzipped_scene_json(store: ProjectStore) -> None:
    asyncio.run(store.history.commit(SLUG, store.load_scene(SLUG), "x", "user"))
    raw = (store.require(SLUG) / "history" / "2.json.gz").read_bytes()
    assert gzip.decompress(raw) == (store.require(SLUG) / "scene.json").read_bytes()


def test_concurrent_commits_serialize(store: ProjectStore) -> None:
    base = store.load_scene(SLUG)

    async def run() -> None:
        await asyncio.gather(
            *(store.history.commit(SLUG, with_note(base, n), f"c{n}", "agent") for n in range(12))
        )

    asyncio.run(run())
    entries = store.history.list(SLUG)
    assert [e.seq for e in entries] == list(range(1, 14))
    assert [e.scene_version for e in entries] == list(range(1, 14))
    for e in entries:
        assert store.history.snapshot(SLUG, e.seq).version == e.scene_version
    assert disk_scene(store) == store.history.snapshot(SLUG, 13)


def test_concurrent_apply_loses_no_update(store: ProjectStore) -> None:
    async def run() -> None:
        await asyncio.gather(
            *(
                store.history.apply(SLUG, lambda s, n=n: with_note(s, n), f"a{n}", "user")
                for n in range(10)
            )
        )

    asyncio.run(run())
    assert {f"note_t{n}" for n in range(10)} <= {note.id for note in disk_scene(store).notes}
    assert len(store.history.list(SLUG)) == 11


def test_apply_returning_none_commits_nothing(store: ProjectStore) -> None:
    assert asyncio.run(store.history.apply(SLUG, lambda _s: None, "noop", "user")) is None
    assert store.history.list(SLUG) == []


def test_restore_creates_a_new_entry(store: ProjectStore) -> None:
    original = store.load_scene(SLUG)
    asyncio.run(store.history.commit(SLUG, with_note(original, 1), "Add note", "user"))
    entry = asyncio.run(store.history.restore(SLUG, 1))
    assert (entry.seq, entry.source, entry.description) == (3, "restore", "Restored to #1")
    assert entry.scene_version == original.version + 2
    assert content(disk_scene(store)) == content(original)
    assert len(store.history.list(SLUG)) == 3


def test_restore_to_any_seq_and_back_reproduces_the_scene_exactly(store: ProjectStore) -> None:
    scene = store.load_scene(SLUG)
    for n in range(3):
        scene = with_note(scene, n)
        asyncio.run(store.history.commit(SLUG, scene, f"c{n}", "user"))
    for seq in range(1, 5):
        before = disk_scene(store)
        latest = store.history.list(SLUG)[-1].seq
        asyncio.run(store.history.restore(SLUG, seq))
        assert content(disk_scene(store)) == content(store.history.snapshot(SLUG, seq))
        asyncio.run(store.history.restore(SLUG, latest))
        assert content(disk_scene(store)) == content(before)


def test_restore_of_unknown_seq_fails(store: ProjectStore) -> None:
    with pytest.raises(SnapshotNotFound):
        asyncio.run(store.history.restore(SLUG, 7))


def test_label_set_and_clear(store: ProjectStore) -> None:
    asyncio.run(store.history.commit(SLUG, store.load_scene(SLUG), "x", "user"))
    assert asyncio.run(store.history.label(SLUG, 1, "  Before furniture ")).label == (
        "Before furniture"
    )
    assert store.history.list(SLUG)[0].label == "Before furniture"
    assert store.history.list(SLUG)[1].label is None
    assert asyncio.run(store.history.label(SLUG, 1, " ")).label is None
    assert store.history.list(SLUG)[0].label is None
    with pytest.raises(SnapshotNotFound):
        asyncio.run(store.history.label(SLUG, 9, "x"))


def test_invalid_scene_is_rejected_before_anything_is_written(store: ProjectStore) -> None:
    folder = store.require(SLUG)
    before = (folder / "scene.json").read_bytes()
    bad = store.load_scene(SLUG)
    bad.shell.rooms[0].ceiling_height = 1.0  # below its doors
    with pytest.raises(ValidationError):
        asyncio.run(store.history.commit(SLUG, bad, "bad", "user"))
    assert (folder / "scene.json").read_bytes() == before
    assert store.history.list(SLUG) == []


@pytest.mark.parametrize("failing_call", [1, 2, 3, 4, 5])
def test_crash_between_steps_never_corrupts_scene_json(
    store: ProjectStore, monkeypatch: pytest.MonkeyPatch, failing_call: int
) -> None:
    """Writes are baseline snapshot, baseline index, new snapshot, scene.json, index; fail each
    one in turn."""
    asyncio.run(store.history.commit(SLUG, store.load_scene(SLUG), "warm-up", "user"))
    (store.require(SLUG) / "history" / "index.jsonl").unlink()  # force a baseline write again
    before = disk_scene(store)
    real = history_module.write_atomic
    calls: list[Path] = []

    def flaky(path: Path, data: bytes) -> None:
        calls.append(path)
        if len(calls) == failing_call:
            raise RuntimeError("killed")
        real(path, data)

    monkeypatch.setattr(history_module, "write_atomic", flaky)
    with pytest.raises(RuntimeError, match="killed"):
        asyncio.run(store.history.commit(SLUG, with_note(before, 1), "change", "user"))
    monkeypatch.setattr(history_module, "write_atomic", real)

    after = disk_scene(store)  # always loads and validates
    changed = (after.version, content(after)) == (before.version + 1, content(with_note(before, 1)))
    assert after == before if failing_call <= 4 else changed
    # The store keeps working: the next commit gets a fresh seq and a higher version.
    entry = asyncio.run(store.history.commit(SLUG, with_note(before, 2), "next", "user"))
    assert entry.seq == store.history.list(SLUG)[-1].seq
    assert disk_scene(store).version == entry.scene_version > after.version
    assert store.history.snapshot(SLUG, entry.seq) == disk_scene(store)
    # The baseline is the scene from before the crashed commit, never the half-committed one.
    assert store.history.list(SLUG)[0].description == "Imported"
    assert store.history.snapshot(SLUG, 1) == before
    assert not list(store.require(SLUG).rglob("*.tmp"))


def test_apply_parses_the_scene_once(store: ProjectStore, monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[Path] = []
    real = history_module.load_scene

    def counting(path: Path) -> Scene:
        calls.append(path)
        return real(path)

    monkeypatch.setattr(history_module, "load_scene", counting)
    asyncio.run(store.history.apply(SLUG, lambda s: with_note(s, 1), "x", "user"))
    assert len(calls) == 1


def test_apply_change_mutating_the_scene_keeps_the_baseline(store: ProjectStore) -> None:
    original = store.load_scene(SLUG)

    def mutate(scene: Scene) -> Scene:
        scene.notes.append(Note(id="note_mut", text="in place"))
        return scene

    asyncio.run(store.history.apply(SLUG, mutate, "x", "user"))
    assert store.history.snapshot(SLUG, 1) == original


def test_unknown_project(store: ProjectStore) -> None:
    with pytest.raises(ProjectNotFound):
        store.history.list("missing")
    with pytest.raises(ProjectNotFound):
        asyncio.run(store.history.commit("../x", store.load_scene(SLUG), "x", "user"))
