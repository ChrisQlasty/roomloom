import math

import pytest
from shapely import unary_union
from shapely.geometry import Polygon as ShapelyPolygon

from app.geometry.polygon import is_ccw_from_above
from app.importers.miro import MiroImportError
from app.importers.miro.geometry import (
    Part,
    WallSegment,
    attach_opening,
    derive_walls,
    merge_rooms,
    outline_of,
    resolve_overlaps,
    room_rings,
    snap_parts,
)


def rect(room: int, x0: float, y0: float, x1: float, y1: float) -> Part:
    return Part(room, [(x0, y0), (x1, y0), (x1, y1), (x0, y1)])


def shell(parts: list[Part], names: list[str]) -> tuple[list, list, list[WallSegment]]:
    rooms, _ = resolve_overlaps(merge_rooms(parts, names), names)
    rings = room_rings(rooms, names)
    outline = outline_of(rings, names)
    walls, warnings = derive_walls(rings, outline, names)
    assert warnings == []
    return rings, outline, walls


def test_snap_closes_gaps_and_small_overlaps_onto_the_larger_room() -> None:
    parts = [rect(0, 0, 0, 10, 5), rect(1, 0, 5.1, 4, 8), rect(2, 4, 4.95, 10, 8)]
    snapped, moves = snap_parts(parts, 0.15)
    assert snapped[0].corners == parts[0].corners  # the largest rectangle never moves
    ys = {round(y, 6) for p in snapped[1:] for _, y in p.corners}
    assert ys == {5.0, 8.0}
    assert {(m.room, m.other_room) for m in moves} == {(1, 0), (2, 0)}
    assert max(m.distance for m in moves) == pytest.approx(0.1)


def test_snap_leaves_gaps_beyond_the_tolerance() -> None:
    parts = [rect(0, 0, 0, 10, 5), rect(1, 0, 5.3, 10, 8)]
    snapped, moves = snap_parts(parts, 0.15)
    assert snapped[1].corners == parts[1].corners and moves == []


def test_snap_works_for_rotated_rectangles() -> None:
    c, s = math.cos(math.radians(30)), math.sin(math.radians(30))

    def turned(room: int, x0: float, x1: float) -> Part:
        pts = [(x0, 0.0), (x1, 0.0), (x1, 3.0), (x0, 3.0)]
        return Part(room, [(x * c - y * s, x * s + y * c) for x, y in pts])

    snapped, moves = snap_parts([turned(0, 0, 4), turned(1, 4.1, 8)], 0.15)
    assert [round(m.distance, 6) for m in moves] == [0.1]
    union = unary_union([ShapelyPolygon(p.corners) for p in snapped])
    assert isinstance(union, ShapelyPolygon) and union.area == pytest.approx(
        3 * 8
    )  # the gap is closed, not filled


def test_two_rooms_give_one_interior_and_six_exterior_walls() -> None:
    rings, outline, walls = shell([rect(0, 0, 0, 4, 3), rect(1, 4, 0, 8, 3)], ["A", "B"])
    assert is_ccw_from_above(outline) and len(outline) == 4
    interior = [w for w in walls if w.right is not None]
    assert len(interior) == 1 and len(walls) == 7
    (w,) = interior
    assert {w.a, w.b} == {(4.0, 0.0), (4.0, 3.0)} and (w.left, w.right) == (0, 1)
    # the left room is on the left of a→b as seen from above (y points south)
    assert w.a == (4.0, 3.0)


def test_t_junction_splits_walls_and_collinear_edges_merge() -> None:
    # a long room on top, two rooms below it: the long room's south edge splits in two walls
    parts = [rect(0, 0, 0, 10, 4), rect(1, 0, 4, 6, 8), rect(2, 6, 4, 10, 8)]
    _, outline, walls = shell(parts, ["Top", "Left", "Right"])
    pairs = sorted((w.left, w.right) for w in walls if w.right is not None)
    assert pairs == [(0, 1), (0, 2), (1, 2)]
    south = [w for w in walls if w.right is None and w.a[1] == w.b[1] == 8.0]
    assert len(south) == 2  # same line, but different rooms
    assert len(outline) == 4


def test_same_named_parts_merge_and_overlaps_go_to_the_smaller_room() -> None:
    parts = [rect(0, 0, 0, 4, 8), rect(0, 4, 4, 8, 8), rect(1, 3, 0, 8, 4)]
    rooms, overlaps = resolve_overlaps(merge_rooms(parts, ["Hall", "Office"]), ["Hall", "Office"])
    assert len(overlaps) == 1 and overlaps[0].trimmed == 0 and overlaps[0].area == pytest.approx(4)
    assert rooms[0].area == pytest.approx(48 - 4) and rooms[1].area == pytest.approx(20)


@pytest.mark.parametrize(
    ("parts", "message"),
    [
        ([rect(0, 0, 0, 2, 2), rect(0, 5, 5, 7, 7)], "do not touch"),
        ([rect(0, 0, 0, 2, 2), rect(1, 5, 5, 7, 7)], "separate buildings"),
        ([rect(0, 0, 0, 10, 10), rect(1, 3, 3, 6, 6)], "hole"),
        (
            [rect(0, 0, 0, 9, 3), rect(1, 0, 3, 3, 6), rect(2, 6, 3, 9, 6), rect(3, 0, 6, 9, 9)],
            "hole",
        ),
    ],
)
def test_unsupported_layouts_are_clear_errors(parts: list[Part], message: str) -> None:
    names = [f"Room {i}" for i in range(4)][: max(p.room for p in parts) + 1]
    with pytest.raises(MiroImportError, match=message):
        shell(parts, names)


def test_attach_opening_crossing_a_wall() -> None:
    walls = [WallSegment((4, 3), (4, 0), 0, 1), WallSegment((0, 0), (0, 3), 0, None)]
    att = attach_opening([(3.9, 1.0), (4.1, 1.0), (4.1, 1.9), (3.9, 1.9)], walls)
    assert att is not None and att.wall == 0 and att.gap == 0
    assert (round(att.offset, 6), round(att.width, 6)) == (1.1, 0.9)


def test_attach_opening_near_a_wall_and_far_from_all() -> None:
    walls = [WallSegment((0, 0), (10, 0), 0, None)]
    near = attach_opening([(2, 0.1), (3, 0.1), (3, 0.3), (2, 0.3)], walls)
    assert near is not None and near.gap == pytest.approx(0.1) and near.width == pytest.approx(1)
    assert attach_opening([(2, 1), (3, 1), (3, 1.2), (2, 1.2)], walls) is None
    across = attach_opening([(2, 0.1), (2.2, 0.1), (2.2, 1.1), (2, 1.1)], walls)
    assert across is None  # its long side does not run along the wall


def test_door_at_a_corner_picks_the_wall_it_mostly_crosses() -> None:
    walls = [WallSegment((0, 0), (10, 0), 0, None), WallSegment((0, 5), (0, 0), 0, None)]
    att = attach_opening([(-0.05, -0.1), (1.0, -0.1), (1.0, 0.1), (-0.05, 0.1)], walls)
    assert att is not None and att.wall == 0 and att.offset == 0.0
    assert att.width == pytest.approx(1.0)
