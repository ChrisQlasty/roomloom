import pytest

from app.importers.miro.board import Board, BoardItem, BoardLine
from app.importers.miro.classify import classify, scale_length_m
from app.importers.miro.config import ImportConfig


def item(
    item_id: str,
    kind: str = "shape",
    *,
    text: str = "",
    color: str | None = "#ffffff",
    at: tuple[float, float] = (0.0, 0.0),
    size: tuple[float, float] = (100.0, 100.0),
    shape: str | None = "rectangle",
    parent: str | None = None,
) -> BoardItem:
    return BoardItem(
        id=item_id,
        type=kind,
        shape=shape if kind == "shape" else None,
        text=text,
        color=color,
        center=at,
        width=size[0],
        height=size[1],
        rotation=0.0,
        parent_id=parent,
    )


@pytest.mark.parametrize(
    ("label", "metres"),
    [
        ("1m", 1.0),
        ("5 m", 5.0),
        ("2,5 m", 2.5),
        ("500 cm", 5.0),
        ("10 metres", 10.0),
        ("Hall", None),
    ],
)
def test_scale_length(label: str, metres: float | None) -> None:
    assert scale_length_m(label) == metres


def test_roles() -> None:
    board = Board(
        items=[
            item("frame", "frame", text="plan", color=None, at=(0, 0), size=(2000, 2000)),
            item("room", text="Hall", parent="frame"),
            item("door", color="#f24726", parent="frame"),
            item("window", color="#2d9bf0", parent="frame"),
            item("passage", color="#808080", parent="frame"),
            item("level", "sticky_note", text="level -0.3", color="orange", parent="frame"),
            item("memory", "sticky_note", text="paint", color="light_yellow", parent="frame"),
            item("pink", "sticky_note", text="?", color="pink", parent="frame"),
            item("label", "text", text="Kitchen", parent="frame"),
            item("circle", shape="circle", parent="frame"),
            item("photo", "image", color=None, parent="frame"),
            item("bar", text="5 m", size=(500, 10), at=(0, 900)),
            item("square-bar", text="5 m", size=(100, 100), parent="frame"),
            item("notes", text="Notes", color="#ffffff", at=(5000, 0), size=(1000, 1000)),
            item("note", "sticky_note", text="smells of polish", color="green", at=(5100, 0)),
            item("far", text="Shed", at=(9000, 9000)),
        ],
        lines=[BoardLine("arrow", (0, 0), (10, 0), "", "curved")],
    )
    out = classify(board, ImportConfig())
    assert out.plan_frame is not None and out.plan_frame.id == "frame"
    assert [i.id for i in out.room_parts] == ["room", "square-bar"]  # a square is no scale bar
    assert [(k, i.id) for k, i in out.openings] == [
        ("door", "door"),
        ("window", "window"),
        ("passage", "passage"),
    ]
    assert [i.id for i in out.level_notes] == ["level"]
    assert [i.id for i in out.memory_notes] == ["memory"]
    assert [i.id for i in out.texts] == ["label"]
    assert [b.ref for b in out.scale_bars] == ["bar"]
    assert [i.id for i in out.notes_areas] == ["notes"]
    assert [i.id for i in out.building_notes] == ["note"]
    reasons = {i.item.split()[0]: i.reason for i in out.ignored}
    assert reasons["circle"] == "shape type 'circle' is not used"
    assert reasons["image"].startswith("images are not imported")
    assert reasons["rectangle"] == "outside the plan frame"
    assert reasons["connector"] == "connectors are not used"
    assert [cat for cat, _ in out.warnings] == ["Colours"]  # the pink sticky
    colours = {(r.color, r.meaning): r.count for r in out.colors}
    assert colours[("#ffffff", "room")] == 2 and colours[("#ffffff", "scale bar")] == 1
    assert colours[("pink", "ignored")] == 1 and colours[("green", "building note")] == 1


def test_without_a_plan_frame_the_whole_board_is_read() -> None:
    out = classify(
        Board(items=[item("room", text="Hall", at=(9000, 9000))], lines=[]), ImportConfig()
    )
    assert out.plan_frame is None and [i.id for i in out.room_parts] == ["room"]
    assert out.warnings[0][0] == "Board"


def test_green_rectangle_with_a_name_is_a_room() -> None:
    board = Board(
        items=[
            item("kitchen", text="Kitchen", color="#8fd14f"),
            item("area", color="#8fd14f", at=(5000, 0)),
        ],
        lines=[],
    )
    out = classify(board, ImportConfig())
    assert [i.id for i in out.room_parts] == ["kitchen"]
    assert [i.id for i in out.notes_areas] == ["area"]


def test_captioned_straight_connector_is_a_scale_bar() -> None:
    board = Board(items=[], lines=[BoardLine("k", (0, 0), (300, 400), "5 m", "straight")])
    (bar,) = classify(board, ImportConfig()).scale_bars
    assert (bar.source, bar.length_m, bar.length_units) == ("connector", 5.0, 500.0)
