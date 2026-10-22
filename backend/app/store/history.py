"""Full-snapshot history: every change set writes the whole scene to `history/<seq>.json.gz`.

A commit runs in three atomic steps: the snapshot, then `scene.json`, then the rewritten
`index.jsonl`. A crash between steps leaves at worst an orphan snapshot (overwritten by the next
commit) or a scene one version ahead of the index; `scene.json` itself is never half-written.
"""

from __future__ import annotations

import asyncio
import gzip
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING

from app.schema.history import ChangeSetMeta, ChangeSource
from app.schema.io import dump_scene, load_scene
from app.schema.scene import Scene
from app.store.atomic import write_atomic

if TYPE_CHECKING:
    from app.store.projects import ProjectStore

BASELINE_DESCRIPTION = "Imported"


class SnapshotNotFound(LookupError):
    """No change set with this seq in the project's history."""


def _index_path(project_dir: Path) -> Path:
    return project_dir / "history" / "index.jsonl"


def _snapshot_path(project_dir: Path, seq: int) -> Path:
    return project_dir / "history" / f"{seq}.json.gz"


def _read_index(project_dir: Path) -> list[ChangeSetMeta]:
    path = _index_path(project_dir)
    if not path.exists():
        return []
    lines = path.read_text(encoding="utf-8").splitlines()
    return [ChangeSetMeta.model_validate_json(line) for line in lines if line.strip()]


def _write_index(project_dir: Path, entries: list[ChangeSetMeta]) -> None:
    text = "".join(entry.model_dump_json() + "\n" for entry in entries)
    write_atomic(_index_path(project_dir), text.encode())


def _append(
    project_dir: Path,
    entries: list[ChangeSetMeta],
    text: str,
    scene_version: int,
    description: str,
    source: ChangeSource,
) -> ChangeSetMeta:
    """Write the snapshot for the next seq and return its (not yet indexed) entry."""
    seq = entries[-1].seq + 1 if entries else 1
    write_atomic(_snapshot_path(project_dir, seq), gzip.compress(text.encode(), mtime=0))
    return ChangeSetMeta(
        seq=seq,
        ts=datetime.now(UTC),
        source=source,
        description=description,
        scene_version=scene_version,
    )


def _commit_sync(
    project_dir: Path, new_scene: Scene, description: str, source: ChangeSource
) -> ChangeSetMeta:
    """Bump the version, then write snapshot, scene.json and index in that order."""
    project_dir.joinpath("history").mkdir(exist_ok=True)
    scene_path = project_dir / "scene.json"
    current = load_scene(scene_path) if scene_path.exists() else None
    version = (current.version if current else 0) + 1
    data = new_scene.model_dump(mode="json") | {"version": version}
    text = dump_scene(Scene.model_validate(data))
    entries = _read_index(project_dir)
    if current and not entries:
        # A project written without history (hand-made or older): record what is on disk first.
        baseline_text = dump_scene(current)
        entries = [
            _append(project_dir, [], baseline_text, current.version, BASELINE_DESCRIPTION, "import")
        ]
    entry = _append(project_dir, entries, text, version, description, source)
    write_atomic(scene_path, text.encode())
    _write_index(project_dir, [*entries, entry])
    return entry


class History:
    """Commits, lists, labels and restores change sets; one asyncio lock per project."""

    def __init__(self, store: ProjectStore) -> None:
        self._store = store
        self._locks: dict[str, asyncio.Lock] = {}

    def _lock(self, slug: str) -> asyncio.Lock:
        return self._locks.setdefault(slug, asyncio.Lock())

    def list(self, slug: str) -> list[ChangeSetMeta]:
        """All change sets, oldest first."""
        return _read_index(self._store.require(slug))

    def snapshot(self, slug: str, seq: int) -> Scene:
        """The scene as it was right after change set `seq`."""
        project_dir = self._store.require(slug)
        if all(entry.seq != seq for entry in _read_index(project_dir)):
            raise SnapshotNotFound(f"{slug}: no change set #{seq}")
        return Scene.model_validate_json(
            gzip.decompress(_snapshot_path(project_dir, seq).read_bytes())
        )

    async def commit(
        self, slug: str, new_scene: Scene, description: str, source: ChangeSource
    ) -> ChangeSetMeta:
        """Save `new_scene` as the next version and record it as one change set.

        `new_scene.version` is ignored: the stored version is the current one plus 1. A project
        that has a scene but no history first gets a baseline entry ("Imported") for that scene.
        """
        project_dir = self._store.require(slug)
        async with self._lock(slug):
            return await asyncio.to_thread(
                _commit_sync, project_dir, new_scene, description, source
            )

    async def apply(
        self,
        slug: str,
        change: Callable[[Scene], Scene | None],
        description: str,
        source: ChangeSource,
    ) -> ChangeSetMeta | None:
        """Read-modify-write under the project lock: `change` gets the current scene and returns
        the new one, or None for "nothing to do" (then nothing is committed)."""
        project_dir = self._store.require(slug)
        async with self._lock(slug):
            new_scene = change(load_scene(project_dir / "scene.json"))
            if new_scene is None:
                return None
            return await asyncio.to_thread(
                _commit_sync, project_dir, new_scene, description, source
            )

    async def restore(self, slug: str, seq: int) -> ChangeSetMeta:
        """Commit the snapshot of `seq` as a new change set; nothing is ever removed."""
        old = self.snapshot(slug, seq)
        return await self.commit(slug, old, f"Restored to #{seq}", "restore")

    async def label(self, slug: str, seq: int, text: str | None) -> ChangeSetMeta:
        """Set (or, with None or blank text, clear) the checkpoint label of change set `seq`."""
        project_dir = self._store.require(slug)
        label = text.strip() if text and text.strip() else None
        async with self._lock(slug):
            entries = _read_index(project_dir)
            for i, entry in enumerate(entries):
                if entry.seq == seq:
                    entries[i] = entry.model_copy(update={"label": label})
                    await asyncio.to_thread(_write_index, project_dir, entries)
                    return entries[i]
        raise SnapshotNotFound(f"{slug}: no change set #{seq}")
