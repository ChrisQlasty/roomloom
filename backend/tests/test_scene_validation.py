"""Every scene validator rejects a crafted bad scene derived from the example project."""

from collections.abc import Callable
from typing import Any

import pytest
from pydantic import ValidationError

from app.geometry.polygon import is_ccw_from_above
from app.schema.scene import Scene

Data = dict[str, Any]


def room(d: Data, room_id: str) -> Data:
    return next(r for r in d["shell"]["rooms"] if r["id"] == room_id)


def wall(d: Data, wall_id: str) -> Data:
    return next(w for w in d["shell"]["walls"] if w["id"] == wall_id)


def obj(d: Data, obj_id: str) -> Data:
    return next(o for o in d["objects"] if o["id"] == obj_id)


def set_in(target: Data, key: str, value: object) -> None:
    target[key] = value


def gym_ceiling_ruled_by_door(d: Data, height: float) -> None:
    """Lower the gym windows so the door (measured from the hall floor) needs the most room."""
    for wall_id in ("w_gym_south", "w_gym_east"):
        for op in wall(d, wall_id)["openings"]:
            op["sill"] = 1.0
    room(d, "r_gym")["ceiling_height"] = height


def inside_wide_opening(d: Data) -> None:
    """Add a wide window spanning both room 1 north windows (1.0-8.0 vs 1.5-3.5 and 5.5-7.5)."""
    openings = wall(d, "w_room_1_north")["openings"]
    openings.append({**openings[0], "id": "op_wide", "offset": 1.0, "width": 7.0})


BAD_SCENES: dict[str, tuple[Callable[[Data], None], str]] = {
    # unique ids
    "duplicate object id": (
        lambda d: set_in(obj(d, "obj_column"), "id", "obj_bench"),
        "duplicate id obj_bench",
    ),
    "duplicate opening id across walls": (
        lambda d: set_in(wall(d, "w_gym_east")["openings"][0], "id", "op_main_entrance"),
        "duplicate id op_main_entrance",
    ),
    # references
    "object in unknown room": (
        lambda d: set_in(obj(d, "obj_bench"), "room_id", "r_nowhere"),
        "unknown room r_nowhere",
    ),
    "wall bounds unknown room": (
        lambda d: set_in(wall(d, "w_room_1_room_2"), "left_room_id", "r_nowhere"),
        "unknown room r_nowhere",
    ),
    "note about unknown room": (
        lambda d: set_in(d["notes"][0], "room_ids", ["r_nowhere"]),
        "unknown room r_nowhere",
    ),
    "room surface with unknown material": (
        lambda d: set_in(room(d, "r_gym")["surfaces"], "floor", "mat_nowhere"),
        "unknown material mat_nowhere",
    ),
    "wall face override with unknown material": (
        lambda d: set_in(wall(d, "w_hall_west")["face_overrides"], "left", "mat_nowhere"),
        "unknown material mat_nowhere",
    ),
    "object slot with unknown material": (
        lambda d: set_in(obj(d, "obj_column")["materials"], "main", "mat_nowhere"),
        "unknown material mat_nowhere",
    ),
    "roof with unknown material": (
        lambda d: set_in(d["roof"], "material", "mat_nowhere"),
        "unknown material mat_nowhere",
    ),
    "pin with unknown asset": (
        lambda d: set_in(d["pins"][0], "asset_id", "ast_nowhere"),
        "unknown asset ast_nowhere",
    ),
    "material texture with unknown asset": (
        lambda d: set_in(d["materials"]["mat_column"], "texture_asset", "ast_nowhere"),
        "unknown asset ast_nowhere",
    ),
    "transition through unknown opening": (
        lambda d: set_in(d["shell"]["transitions"][0], "opening_id", "op_nowhere"),
        "unknown opening op_nowhere",
    ),
    "transition in unknown room": (
        lambda d: set_in(d["shell"]["transitions"][0], "host_room_id", "r_nowhere"),
        "unknown room r_nowhere",
    ),
    # polygons
    "self-intersecting room polygon": (
        lambda d: set_in(room(d, "r_gym"), "polygon", [[4, 10], [12, 20], [12, 10], [4, 20]]),
        "self-intersecting",
    ),
    "room polygon with two points": (
        lambda d: set_in(room(d, "r_gym"), "polygon", [[4, 10], [12, 20]]),
        "at least 3",
    ),
    "self-intersecting outline": (
        lambda d: set_in(d["shell"], "outline", [[0, 0], [30, 20], [30, 0], [0, 20]]),
        "self-intersecting",
    ),
    "clockwise outline (gable edge indices would shift if reversed)": (
        lambda d: set_in(d["shell"], "outline", d["shell"]["outline"][::-1]),
        "must wind counter-clockwise",
    ),
    "self-intersecting extrusion profile": (
        lambda d: set_in(
            obj(d, "obj_bench"),
            "geometry",
            {"type": "extrusion", "profile": [[0, 0], [1, 1], [1, 0], [0, 1]], "depth": 1},
        ),
        "self-intersecting",
    ),
    # positive dimensions
    "zero-length wall": (
        lambda d: set_in(wall(d, "w_hall_south"), "b", [0, 20]),
        "zero length",
    ),
    "zero wall thickness": (
        lambda d: set_in(wall(d, "w_hall_south"), "thickness", 0),
        "greater than 0",
    ),
    "zero opening width": (
        lambda d: set_in(wall(d, "w_hall_north")["openings"][0], "width", 0),
        "greater than 0",
    ),
    "negative box size": (
        lambda d: set_in(obj(d, "obj_bench")["geometry"], "size", [3, -0.45, 0.35]),
        "greater than 0",
    ),
    "zero cylinder radius": (
        lambda d: set_in(obj(d, "obj_column")["geometry"], "radius", 0),
        "greater than 0",
    ),
    "zero scale": (
        lambda d: set_in(obj(d, "obj_column")["transform"], "scale", [1, 0, 1]),
        "greater than 0",
    ),
    "zero texture tile size": (
        lambda d: set_in(d["materials"]["mat_gym_floor"], "tile_size_m", [0, 1]),
        "greater than 0",
    ),
    # roof pitch
    "roof pitch above 70": (
        lambda d: set_in(d["roof"], "pitch_deg", 70.5),
        "less than or equal to 70",
    ),
    "negative roof pitch": (
        lambda d: set_in(d["roof"], "pitch_deg", -1),
        "greater than or equal to 0",
    ),
    "gable edge outside the outline": (
        lambda d: d["roof"].update(type="gable", pitch_deg=30, gable_edges=[0, 6]),
        "gable edge 6",
    ),
    # ceiling heights
    "ceiling below a door": (
        lambda d: set_in(room(d, "r_entrance_hall"), "ceiling_height", 2.34),
        "r_entrance_hall: ceiling_height 2.34",
    ),
    "ceiling below a passage on the other room's side": (
        lambda d: set_in(room(d, "r_corridor"), "ceiling_height", 2.4),
        "r_corridor: ceiling_height 2.4",
    ),
    "lower room ceiling below the threshold-based door top": (
        lambda d: gym_ceiling_ruled_by_door(d, 2.58),
        "r_gym: ceiling_height 2.58",
    ),
    "ceiling above 8 m": (
        lambda d: set_in(room(d, "r_gym"), "ceiling_height", 8.1),
        "less than or equal to 8",
    ),
    # openings fit in their wall
    "opening past the wall end": (
        lambda d: set_in(wall(d, "w_hall_corridor")["openings"][0], "offset", 1.5),
        "op_corridor_passage extends past the end of wall w_hall_corridor",
    ),
    "overlapping openings": (
        lambda d: set_in(wall(d, "w_room_1_north")["openings"][1], "offset", 3.0),
        "openings op_room_1_window_1 and op_room_1_window_2 overlap",
    ),
    "opening inside an earlier, wider opening": (
        inside_wide_opening,
        "openings op_wide and op_room_1_window_2 overlap",
    ),
    # transitions
    "transition rise does not match levels": (
        lambda d: set_in(d["shell"]["transitions"][0], "rise_total", 0.5),
        "rise_total 0.5 does not match the floor level difference 0.340",
    ),
    "transition host room not beside the opening": (
        lambda d: set_in(d["shell"]["transitions"][0], "host_room_id", "r_room_1"),
        "host room r_room_1 is not beside the opening",
    ),
    # wall-room adjacency
    "exterior wall with two rooms": (
        lambda d: set_in(wall(d, "w_hall_west"), "right_room_id", "r_gym"),
        "exterior wall w_hall_west must bound exactly one room",
    ),
    "exterior wall with no room": (
        lambda d: set_in(wall(d, "w_hall_south"), "left_room_id", None),
        "exterior wall w_hall_south must bound exactly one room",
    ),
    "interior wall with one room": (
        lambda d: set_in(wall(d, "w_room_1_room_2"), "right_room_id", None),
        "interior wall w_room_1_room_2 must bound two different rooms",
    ),
    "interior wall with one room hosting a transition": (
        lambda d: set_in(wall(d, "w_hall_gym_north"), "left_room_id", None),
        "interior wall w_hall_gym_north must bound two different rooms",
    ),
    "interior wall with the same room twice": (
        lambda d: set_in(wall(d, "w_room_1_room_2"), "right_room_id", "r_room_2"),
        "interior wall w_room_1_room_2 must bound two different rooms",
    ),
    # field formats
    "unknown key": (lambda d: set_in(room(d, "r_gym"), "height", 3), "Extra inputs"),
    "id with wrong prefix": (
        lambda d: set_in(obj(d, "obj_bench"), "id", "w_bench"),
        "should match pattern",
    ),
    "tag with hash": (lambda d: set_in(room(d, "r_gym"), "tags", ["#sport"]), "match pattern"),
    "uppercase colour": (
        lambda d: set_in(d["materials"]["mat_column"], "color", "#D8D2C4"),
        "match pattern",
    ),
    "unknown primitive type": (
        lambda d: set_in(obj(d, "obj_bench"), "geometry", {"type": "torus", "radius": 1}),
        "does not match any of the expected tags",
    ),
}


@pytest.mark.parametrize("case", BAD_SCENES)
def test_bad_scene_is_rejected(example_scene_dict: Data, case: str) -> None:
    mutate, message = BAD_SCENES[case]
    mutate(example_scene_dict)
    with pytest.raises(ValidationError, match=message):
        Scene.model_validate(example_scene_dict)


def test_boundary_values_are_accepted(example_scene_dict: Data) -> None:
    room(example_scene_dict, "r_entrance_hall")["ceiling_height"] = 2.45  # passage 2.4 + 0.05
    gym_ceiling_ruled_by_door(example_scene_dict, 2.59)  # door top 2.2 above 0, + 0.05 + 0.34
    example_scene_dict["roof"].update(type="shed", pitch_deg=70, slope_direction_deg=180)
    Scene.model_validate(example_scene_dict)


def test_clockwise_polygon_is_normalised(example_scene_dict: Data) -> None:
    gym = room(example_scene_dict, "r_gym")
    gym["polygon"] = [[4, 10], [12, 10], [12, 20], [4, 20], [4, 10]]  # clockwise, closed
    scene = Scene.model_validate(example_scene_dict)
    polygon = next(r for r in scene.shell.rooms if r.id == "r_gym").polygon
    assert len(polygon) == 4
    assert is_ccw_from_above(polygon)


def test_coordinates_are_rounded_to_millimetres(example_scene_dict: Data) -> None:
    obj(example_scene_dict, "obj_column")["transform"]["position"] = [9.00049, -0.0001, 5.1234]
    scene = Scene.model_validate(example_scene_dict)
    position = next(o for o in scene.objects if o.id == "obj_column").transform.position
    assert position == (9.0, 0.0, 5.123)
    assert str(position[1]) == "0.0"
