"""Importer rules for levels, steps, ceilings, openings and notes, on small inline boards."""

import itertools
from typing import Any

from app.importers.miro.config import ImportConfig
from app.importers.miro.pipeline import TEXT_NOT_USED, run_import
from app.importers.miro.report import ImportReport, render
from app.schema.scene import Scene

_ids = itertools.count()
DOOR, WINDOW = "#f24726", "#2d9bf0"


def rect(x0: float, y0: float, x1: float, y1: float, text: str = "", fill: str = "#ffffff") -> dict:
    """A rectangle given in metres (1 m = 100 board units)."""
    return {
        "id": f"s{next(_ids)}",
        "type": "shape",
        "data": {"content": f"<p>{text}</p>", "shape": "rectangle"},
        "style": {"fillColor": fill},
        "geometry": {"width": (x1 - x0) * 100, "height": (y1 - y0) * 100},
        "position": {"x": (x0 + x1) * 50, "y": (y0 + y1) * 50, "relativeTo": "canvas_center"},
    }


def sticky(x: float, y: float, text: str, color: str = "orange", size: float = 0.6) -> dict:
    return {
        "id": f"n{next(_ids)}",
        "type": "sticky_note",
        "data": {"content": f"<p>{text}</p>"},
        "style": {"fillColor": color},
        "geometry": {"width": size * 100, "height": size * 100},
        "position": {"x": x * 100, "y": y * 100, "relativeTo": "canvas_center"},
    }


def text(x: float, y: float, content: str) -> dict:
    return {
        "id": f"t{next(_ids)}",
        "type": "text",
        "data": {"content": f"<p>{content}</p>"},
        "geometry": {"width": 100},
        "position": {"x": x * 100, "y": y * 100, "relativeTo": "canvas_center"},
    }


def run(*items: dict[str, Any]) -> ImportReport:
    raw = {"items": [rect(0, 20, 1, 20.1, "1 m", "#000000"), *items]}
    return run_import(raw, ImportConfig(), project="test", source="inline")


def scene(report: ImportReport) -> Scene:
    assert report.error is None, report.error
    assert report.scene is not None
    return report.scene


def warnings(report: ImportReport, category: str) -> list[str]:
    return [t for c, t in report.warnings if c == category]


TWO_ROOMS = [rect(0, 0, 4, 4, "Hall"), rect(4, 0, 8, 4, "Gym")]


def test_missing_steps_are_assumed_from_the_level_difference() -> None:
    report = run(*TWO_ROOMS, rect(3.9, 1, 4.1, 2, "", DOOR), sticky(6, 3, "level -0.4"))
    (tr,) = scene(report).shell.transitions
    assert (tr.steps, tr.rise_total, tr.host_room_id) == (3, 0.4, "r_gym")
    assert any("assumed 3 step(s)" in t for t in warnings(report, "Levels and steps"))


def test_steps_note_inside_a_room_goes_to_its_nearest_door() -> None:
    report = run(
        rect(0, 0, 4, 4, "Hall"),
        rect(4, 0, 8, 4, "Gym"),
        rect(0, 4, 4, 8, "Office"),
        rect(3.9, 1, 4.1, 2, "", DOOR),  # hall - gym
        rect(1, 3.9, 2, 4.1, "", DOOR),  # hall - office
        sticky(6, 2, "level -0.3"),
        sticky(5, 1.5, "steps 1"),  # in the gym, near its only door
        sticky(1.5, 6, "level -0.2 steps 1"),  # in the office
    )
    steps = {t.opening_id: (t.steps, t.rise_total) for t in scene(report).shell.transitions}
    assert steps == {"op_hall_gym_door": (1, 0.3), "op_hall_office_door": (1, 0.2)}
    assert warnings(report, "Levels and steps") == []


def test_level_problems_are_reported() -> None:
    report = run(
        *TWO_ROOMS,
        rect(3.9, 1, 4.1, 2, "", DOOR),
        sticky(3.9, 1.5, "steps 2"),  # touches the door
        sticky(1, 1, "level -0.2"),
        sticky(2.5, 1, "level -0.3"),  # second level note in the hall
        sticky(12, 12, "level 1"),  # outside every room
    )
    texts = " ".join(warnings(report, "Levels and steps"))
    assert "two level notes" in texts and "is not inside a room" in texts
    hall = next(r for r in scene(report).shell.rooms if r.name == "Hall")
    assert hall.floor_level == -0.3
    (tr,) = scene(report).shell.transitions
    assert (tr.steps, tr.rise_total, tr.host_room_id) == (2, 0.3, "r_hall")


def test_steps_on_level_floors_are_ignored() -> None:
    report = run(*TWO_ROOMS, rect(3.9, 1, 4.1, 2, "", DOOR), sticky(3.9, 1.5, "steps 2"))
    assert scene(report).shell.transitions == []
    assert any("same level" in t for t in warnings(report, "Levels and steps"))


def test_outside_door_of_a_sunken_room_is_reported() -> None:
    report = run(
        rect(0, 0, 4, 4, "Cellar"), rect(-0.1, 1, 0.1, 2, "", DOOR), sticky(2, 2, "level -0.5")
    )
    assert scene(report).shell.transitions == []
    assert any("leads outside" in t for t in warnings(report, "Levels and steps"))


def test_ceiling_is_raised_for_tall_openings() -> None:
    report = run(rect(0, 0, 4, 4, "Hall h=2.5"), rect(-0.1, 1, 0.1, 2.2, "h=2.8", DOOR))
    (hall,) = scene(report).shell.rooms
    assert hall.ceiling_height == 2.85
    assert warnings(report, "Ceilings") == [
        '"Hall": ceiling raised from 2.50 to 2.85 m so that its tallest door or window fits.'
    ]


def test_opening_problems_are_reported() -> None:
    report = run(
        *TWO_ROOMS,
        rect(3.9, 1, 4.1, 2, "", DOOR),
        rect(3.9, 1.5, 4.1, 2.5, "", DOOR),  # overlaps the first door
        rect(3.9, 3, 4.1, 3.8, "", WINDOW),  # window on an interior wall
        rect(2, 2, 2.2, 3, "", DOOR),  # in the middle of the hall
        rect(1, -0.35, 2, -0.15, "", WINDOW),  # 15 cm north of the hall
    )
    texts = " ".join(warnings(report, "Openings"))
    assert "overlaps another opening" in texts and "on an interior wall" in texts
    assert "does not cross any wall" in texts and "attached to the nearest one" in texts
    kinds = sorted(op.kind for w in scene(report).shell.walls for op in w.openings)
    assert kinds == ["door", "window", "window"]


def test_door_past_a_wall_end_is_cut() -> None:
    report = run(rect(0, 0, 4, 4, "Hall"), rect(3.5, 3.9, 4.5, 4.1, "", DOOR))
    (op,) = [op for w in scene(report).shell.walls for op in w.openings]
    assert op.width == 0.5
    assert any("width cut from 1.00 to 0.50" in t for t in warnings(report, "Openings"))


def test_room_names_from_text_items_and_unnamed_rooms() -> None:
    report = run(
        rect(0, 0, 4, 4),
        text(2, 2, "Kitchen #kitchen"),
        rect(4, 0, 8, 4),
        text(30, 30, "stray label"),
    )
    rooms = scene(report).shell.rooms
    assert [(r.name, r.tags) for r in rooms] == [("Kitchen", ["kitchen"]), ("Unnamed room 1", [])]
    assert any("no name" in t for t in warnings(report, "Rooms"))
    assert [i.reason for i in report.ignored] == [TEXT_NOT_USED]


def test_memory_outside_rooms_becomes_a_building_note() -> None:
    report = run(
        *TWO_ROOMS,
        sticky(2, 2, "parquet — Ola", "yellow"),
        sticky(12, 12, "Gym was cold", "yellow"),
    )
    s = scene(report)
    assert next(r for r in s.shell.rooms if r.name == "Hall").notes == ["parquet — Ola"]
    assert [(n.text, n.room_ids) for n in s.notes] == [("Gym was cold", ["r_gym"])]
    assert warnings(report, "Notes")


def test_report_lists_everything_needed() -> None:
    report = run(*TWO_ROOMS, rect(3.9, 1, 4.1, 2, "", DOOR), sticky(6, 3, "level -0.3 steps 2"))
    md = render(report)
    for heading in [
        "## Summary",
        "## Scale",
        "## Rooms",
        "## Openings",
        "## Floor levels",
        "## Colours found",
    ]:
        assert heading in md
    assert "1 board unit = 1 cm" in md and "| Gym | `r_gym` | 16.0 | -0.30 |" in md
    assert "2 step(s), 0.30 m in total, at `op_hall_gym_door` (built in Gym)" in md


def test_report_of_a_failed_import() -> None:
    raw = {"items": [rect(0, 0, 4, 4, "Hall")]}
    report = run_import(raw, ImportConfig(), project="test", source="inline")
    md = render(report)
    assert "**Import failed.**" in md and "No scale bar found" in md and "## Rooms" not in md
