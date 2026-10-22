import re

from app.schema.ids import PREFIXES, id_pattern, new_id, slugify


def test_slugify() -> None:
    assert slugify("Room 3A") == "room_3a"
    assert slugify("  Hall -- (east) ") == "hall_east"


def test_new_id_readable_then_suffixed() -> None:
    assert new_id("room", set(), "Room 3A") == "r_room_3a"
    assert new_id("room", {"r_room_3a"}, "Room 3A") == "r_room_3a_2"
    assert new_id("room", {"r_room_3a", "r_room_3a_2"}, "Room 3A") == "r_room_3a_3"


def test_new_id_numbered_without_hint() -> None:
    assert new_id("object", set()) == "obj_1"
    assert new_id("object", {"obj_1", "obj_2"}) == "obj_3"
    assert new_id("pin", set(), "!!!") == "pin_1"


def test_every_generated_id_matches_its_pattern() -> None:
    for kind in PREFIXES:
        assert re.fullmatch(id_pattern(kind), new_id(kind, set(), "Some Name 1"))
        assert re.fullmatch(id_pattern(kind), new_id(kind, set()))
    assert not re.fullmatch(id_pattern("room"), "w_room")
