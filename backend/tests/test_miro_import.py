"""End-to-end importer runs over the hand-made board dumps in tests/fixtures/miro."""

import math
from pathlib import Path

import pytest

from app.importers.miro.config import ImportConfig
from app.importers.miro.fetch import load_raw
from app.importers.miro.notes import LevelReading, NoteInterpreter
from app.importers.miro.pipeline import run_import
from app.importers.miro.report import ImportReport
from app.schema.io import dump_scene
from app.schema.scene import Scene
from app.schema.shell import Opening, Wall

FIXTURES = Path(__file__).parent / "fixtures" / "miro"
VALID = ["two_rooms_door", "l_house", "rotated", "exterior_door", "levels", "frame_relative"]


def run(name: str, interpreter: NoteInterpreter | None = None) -> ImportReport:
    raw = load_raw(FIXTURES / f"{name}.json")
    return run_import(
        raw, ImportConfig(), project=name, source=f"{name}.json", interpreter=interpreter
    )


def scene_of(name: str) -> Scene:
    report = run(name)
    assert report.error is None, report.error
    assert report.scene is not None
    return report.scene


def opening_centre(wall: Wall, op: Opening) -> tuple[float, float]:
    t = (op.offset + op.width / 2) / wall.length
    return (wall.a[0] + t * (wall.b[0] - wall.a[0]), wall.a[1] + t * (wall.b[1] - wall.a[1]))


def test_every_fixture_is_covered() -> None:
    names = {p.stem for p in FIXTURES.glob("*.json")}
    assert names == {*VALID, "missing_scale", "two_scales"}


@pytest.mark.parametrize("name", VALID)
def test_fixture_gives_a_valid_scene(name: str) -> None:
    scene = scene_of(name)
    assert Scene.model_validate_json(dump_scene(scene)) == scene
    assert scene.roof.type == "flat"
    assert {"mat_floor_default", "mat_wall_default", "mat_facade_default"} <= set(scene.materials)


@pytest.mark.parametrize(
    ("name", "message"),
    [("missing_scale", "No scale bar found"), ("two_scales", "Found 2 scale bars")],
)
def test_fixture_fails_with_documented_error(name: str, message: str) -> None:
    report = run(name)
    assert report.scene is None
    assert report.error is not None and message in report.error


# --- the irregular L of five rooms ---

L_INTERIOR = {
    frozenset(p)
    for p in [
        ("r_room_1", "r_room_2"),
        ("r_room_1", "r_corridor"),
        ("r_room_2", "r_corridor"),
        ("r_entrance_hall", "r_room_1"),
        ("r_entrance_hall", "r_corridor"),
        ("r_entrance_hall", "r_gym"),
        ("r_corridor", "r_gym"),
    ]
}
# kind, centre on the wall (plan metres), rooms on either side
L_DOORS = [
    ("door", (0.0, 9.6), {"r_entrance_hall"}),
    ("door", (4.0, 9.5), {"r_entrance_hall", "r_corridor"}),
    ("door", (6.5, 8.0), {"r_room_1", "r_corridor"}),
    ("door", (24.5, 8.0), {"r_room_2", "r_corridor"}),
    ("door", (10.5, 11.0), {"r_corridor", "r_gym"}),
    ("passage", (8.0, 16.0), {"r_entrance_hall", "r_gym"}),
]


def test_l_house_rooms_and_outline() -> None:
    scene = scene_of("l_house")
    rooms = {r.id: r for r in scene.shell.rooms}
    assert set(rooms) == {"r_entrance_hall", "r_room_1", "r_room_2", "r_corridor", "r_gym"}
    assert rooms["r_room_1"].ceiling_height == 3.0 and rooms["r_gym"].ceiling_height == 4.5
    assert rooms["r_room_1"].tags == ["classroom"] and rooms["r_corridor"].tags == ["corridor"]
    assert len(rooms["r_entrance_hall"].polygon) == 6  # two rectangles merged into an L
    assert scene.shell.outline == [
        (28.0, 0.0),
        (0.0, 0.0),
        (0.0, 20.0),
        (15.95, 20.0),
        (15.95, 11.0),
        (28.0, 11.0),
    ]


def test_l_house_wall_counts() -> None:
    walls = scene_of("l_house").shell.walls
    interior = [w for w in walls if w.kind == "interior"]
    exterior = [w for w in walls if w.kind == "exterior"]
    assert len(interior) == 8 and len(exterior) == 10
    # the hall meets the corridor twice: along x = 4 and along y = 11
    assert {frozenset(w.room_ids) for w in interior} == L_INTERIOR
    assert all(w.thickness == 0.12 for w in interior)
    assert all(w.thickness == 0.30 and w.right_room_id is None for w in exterior)


def test_l_house_every_door_on_the_right_wall_within_2_cm() -> None:
    scene = scene_of("l_house")
    placed = [(w, op) for w in scene.shell.walls for op in w.openings if op.kind != "window"]
    assert len(placed) == len(L_DOORS)
    for kind, centre, rooms in L_DOORS:
        wall, op = min(placed, key=lambda wo: math.dist(opening_centre(*wo), centre))
        assert op.kind == kind
        assert math.dist(opening_centre(wall, op), centre) <= 0.02
        assert set(wall.room_ids) == rooms


def test_l_house_openings_sizes() -> None:
    ops = {op.id: op for w in scene_of("l_house").shell.walls for op in w.openings}
    entrance = ops["op_entrance_hall_west_door"]
    assert (entrance.width, entrance.height, entrance.sill) == (1.2, 2.2, 0.0)
    assert ops["op_room_2_east_window"].sill == 1.0 and ops["op_room_2_east_window"].height == 1.2
    windows = [op for op in ops.values() if op.kind == "window"]
    assert len(windows) == 5 and all(op.width == 2.0 for op in windows)


def test_l_house_snapping_notes_and_ignored_items() -> None:
    report = run("l_house")
    snapped = [text for cat, text in report.warnings if cat == "Snapped gaps"]
    assert len(snapped) == 2 and any("Entrance hall" in t and "Corridor" in t for t in snapped)
    assert not [text for cat, text in report.warnings if cat == "Openings"]
    assert report.scene is not None
    room_1 = next(r for r in report.scene.shell.rooms if r.id == "r_room_1")
    assert room_1.notes == ["green oil paint up to 1.5 m — Ania"]
    notes = {n.text: n.room_ids for n in report.scene.notes}
    assert notes == {
        "Corridor floor: terrazzo": ["r_corridor"],
        "The whole building smelled of floor polish — Bartek": [],
    }
    reasons = {i.reason for i in report.ignored}
    assert reasons >= {"outside the plan frame", "shape type 'triangle' is not used"}
    assert report.part_counts["r_entrance_hall"] == 2


# --- the other fixtures ---


def test_two_rooms_share_one_wall_with_the_door() -> None:
    scene = scene_of("two_rooms_door")
    (shared,) = [w for w in scene.shell.walls if w.kind == "interior"]
    (door,) = shared.openings
    assert (shared.a, shared.b) == ((4.0, 3.0), (4.0, 0.0))  # Room A's edge, A on the left
    assert (door.kind, door.offset, door.width, door.height) == ("door", 1.1, 0.9, 2.0)
    assert {shared.left_room_id, shared.right_room_id} == {"r_room_a", "r_room_b"}


def test_rotated_building_keeps_sizes() -> None:
    scene = scene_of("rotated")
    for room in scene.shell.rooms:
        xs = [math.dist(room.polygon[i], room.polygon[i - 1]) for i in range(4)]
        assert sorted(round(x, 2) for x in xs) == [3.0, 3.0, 4.0, 4.0]
    ops = {
        op.kind + ("_out" if w.kind == "exterior" else ""): op
        for w in scene.shell.walls
        for op in w.openings
    }
    assert ops["door"].width == pytest.approx(0.9, abs=0.01)
    assert ops["door_out"].width == pytest.approx(1.0, abs=0.01)
    assert ops["window_out"].width == pytest.approx(2.0, abs=0.01)


def test_exterior_door() -> None:
    scene = scene_of("exterior_door")
    assert all(w.kind == "exterior" for w in scene.shell.walls) and len(scene.shell.walls) == 4
    ops = {op.kind: (w, op) for w in scene.shell.walls for op in w.openings}
    wall, door = ops["door"]
    assert wall.id == "w_shop_south" and door.height == 2.4 and door.width == pytest.approx(1.2)
    assert ops["window"][0].id == "w_shop_west" and ops["window"][1].sill == 0.9


def test_level_note_and_step_note() -> None:
    report = run("levels")
    assert report.scene is not None
    rooms = {r.id: r for r in report.scene.shell.rooms}
    assert rooms["r_gym"].floor_level == -0.3 and rooms["r_stage"].floor_level == 0.0
    (steps,) = report.scene.shell.transitions
    assert (steps.opening_id, steps.steps, steps.rise_total, steps.host_room_id) == (
        "op_hall_gym_door",
        2,
        0.3,
        "r_gym",
    )
    assert any("was not understood" in text for _, text in report.warnings)
    assert [n.reader for n in report.level_notes] == ["grammar", "grammar", "not understood"]


def test_llm_notes_reading_is_applied_and_reported() -> None:
    calls: list[list[str]] = []

    def fake_claude(texts: list[str]) -> list[LevelReading]:
        calls.append(texts)
        return [LevelReading(note=0, level_m=0.5, steps=3, explanation="three steps up")]

    report = run("levels", interpreter=fake_claude)
    assert calls == [["three steps up, the floor is higher"]]
    assert report.scene is not None
    stage = next(r for r in report.scene.shell.rooms if r.id == "r_stage")
    assert stage.floor_level == 0.5
    passage = next(
        t for t in report.scene.shell.transitions if t.opening_id == "op_hall_stage_passage"
    )
    assert (passage.steps, passage.rise_total, passage.host_room_id) == (3, 0.5, "r_hall")
    row = report.level_notes[-1]
    assert row.reader.startswith("Claude") and row.explanation == "three steps up"


def test_items_in_a_frame_use_relative_coordinates() -> None:
    report = run("frame_relative")
    assert report.scene is not None and report.plan_frame == "Plan"
    kitchen = next(r for r in report.scene.shell.rooms if r.name == "Kitchen")
    assert sorted(kitchen.polygon) == [(0.0, 0.0), (0.0, 3.0), (4.0, 0.0), (4.0, 3.0)]
    assert [r.name for r in report.scene.shell.rooms] == ["Kitchen", "Pantry"]
    assert [i.reason for i in report.ignored] == ["outside the plan frame"]


def test_free_ended_scale_line_is_explained() -> None:
    report = run("missing_scale")
    assert any(cat == "Scale" and "not attached to a shape" in t for cat, t in report.warnings)
