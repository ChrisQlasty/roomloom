"""The starter board drawn by scripts/make_starter_board.py imports cleanly."""

import itertools
from typing import Any

import pytest

from app.importers.miro.board import parse_board
from app.importers.miro.config import ImportConfig
from app.importers.miro.pipeline import run_import
from app.importers.miro.report import ImportReport
from scripts import make_starter_board as starter

_KINDS = {"shapes": "shape", "sticky_notes": "sticky_note", "texts": "text", "frames": "frame"}


class FakeMiro(starter.Miro):
    """Records created items in the shape GET /items returns them (offline)."""

    def __init__(self) -> None:
        self.board_id = "board"
        self.items: list[dict[str, Any]] = []
        self._ids = itertools.count(1)

    def post(self, path: str, body: dict[str, Any]) -> dict[str, Any]:
        kind = _KINDS[path.rsplit("/", 1)[-1]]
        relative = "parent_top_left" if "parent" in body else "canvas_center"
        geometry = dict(body.get("geometry", {}))
        if kind == "sticky_note":  # Miro sets a square sticky's height from its width
            geometry["height"] = geometry["width"]
        item = {
            **body,
            "id": str(next(self._ids)),
            "type": kind,
            "position": {**body["position"], "origin": "center", "relativeTo": relative},
            "geometry": geometry,
        }
        self.items.append(item)
        return item


@pytest.fixture(scope="module")
def drawn() -> FakeMiro:
    miro = FakeMiro()
    starter.draw_board(miro)
    return miro


@pytest.fixture(scope="module")
def report(drawn: FakeMiro) -> ImportReport:
    raw = {"items": drawn.items, "connectors": []}
    return run_import(raw, ImportConfig(), project="starter", source="starter board")


def test_starter_board_imports_without_warnings(report: ImportReport) -> None:
    assert report.error is None and report.warnings == []
    assert report.scale is not None and report.metres_per_unit == pytest.approx(0.01)
    scene = report.scene
    assert scene is not None
    assert [r.name for r in scene.shell.rooms] == ["Room A", "Room B", "Corridor", "Gym", "Wing"]
    kinds = [w.kind for w in scene.shell.walls]
    assert (kinds.count("interior"), kinds.count("exterior")) == (5, 13)
    openings = [op.kind for w in scene.shell.walls for op in w.openings]
    assert sorted(openings) == ["door"] * 5 + ["passage"] + ["window"] * 5


def test_starter_board_levels_and_notes(report: ImportReport) -> None:
    scene = report.scene
    assert scene is not None
    (steps,) = scene.shell.transitions
    assert (steps.opening_id, steps.steps, steps.host_room_id) == (
        "op_corridor_gym_door",
        2,
        "r_gym",
    )
    room_a = next(r for r in scene.shell.rooms if r.name == "Room A")
    assert room_a.ceiling_height == 3.2 and room_a.notes[0].endswith("— Ania")
    assert {n.text: n.room_ids for n in scene.notes}["Corridor floor: terrazzo"] == ["r_corridor"]


def test_steps_sticky_touches_its_door(drawn: FakeMiro) -> None:
    items = parse_board({"items": drawn.items}).items
    (plan,) = [i for i in items if i.type == "frame" and i.text == "Plan"]
    (steps,) = [i for i in items if i.text == "steps 2" and i.parent_id == plan.id]
    doors = [i for i in items if i.color == starter.DOOR and i.parent_id == steps.parent_id]
    top = steps.center[1] - steps.height / 2
    assert any(
        abs(d.center[0] - steps.center[0]) < d.width / 2 + steps.width / 2
        and d.center[1] - d.height / 2 <= top <= d.center[1] + d.height / 2
        for d in doors
    )


def test_legend_is_ignored(report: ImportReport) -> None:
    legend = [i for i in report.ignored if i.reason == "outside the plan frame"]
    assert len(legend) >= 20  # every legend sample, including the scale-bar sample
