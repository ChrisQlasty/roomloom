import pytest

from app.importers.miro.board import html_to_text, parse_board


def shape(item_id: str, x: float, y: float, w: float, h: float, **extra: object) -> dict:
    return {
        "id": item_id,
        "type": "shape",
        "data": {"content": "", "shape": "rectangle"},
        "style": {"fillColor": "#FFFFFF"},
        "geometry": {"width": w, "height": h, "rotation": extra.pop("rotation", 0.0)},
        "position": {"x": x, "y": y, "origin": "center", "relativeTo": "canvas_center"},
        **extra,
    }


@pytest.mark.parametrize(
    ("html", "text"),
    [
        ("<p>Room 3A</p>", "Room 3A"),
        ("<p>green paint</p><p>— Ania</p>", "green paint\n— Ania"),
        ("<p>a&nbsp;&amp;&nbsp;b<br/>c</p>", "a & b\nc"),
        ("<p><strong>Gym</strong>   #gym</p>", "Gym #gym"),
        ("", ""),
    ],
)
def test_html_to_text(html: str, text: str) -> None:
    assert html_to_text(html) == text


def test_items_in_a_frame_are_relative_to_its_top_left() -> None:
    frame = {
        "id": "f",
        "type": "frame",
        "data": {"title": "Plan"},
        "geometry": {"width": 1000, "height": 600},
        "position": {"x": 2000, "y": -500, "origin": "center", "relativeTo": "canvas_center"},
    }
    child = shape("c", 100, 50, 20, 10, parent={"id": "f"})
    child["position"]["relativeTo"] = "parent_top_left"
    board = parse_board({"items": [child, frame]})
    items = {i.id: i for i in board.items}
    assert items["c"].center == (1600.0, -750.0)
    assert items["c"].parent_id == "f" and items["f"].text == "Plan"
    assert items["c"].color == "#ffffff"


def test_rotation_is_clockwise_on_screen() -> None:
    (item,) = parse_board({"items": [shape("r", 0, 0, 20, 10, rotation=90)]}).items
    corners = [(round(x, 6) + 0.0, round(y, 6) + 0.0) for x, y in item.corners()]
    # the top-left corner (-10, -5) turns clockwise (y down) to (5, -10)
    assert corners[0] == (5.0, -10.0)
    assert item.contains((0.0, 9.0)) and not item.contains((9.0, 0.0))
    assert (item.long_side, item.short_side) == (20, 10)


def test_connector_runs_between_its_anchor_points() -> None:
    raw = {
        "items": [shape("a", 0, 0, 10, 10), shape("b", 300, 0, 10, 10)],
        "connectors": [
            {
                "id": "k",
                "shape": "straight",
                "startItem": {"id": "a", "position": {"x": "100%", "y": "50%"}},
                "endItem": {"id": "b", "position": {"x": "0%", "y": "50%"}},
                "captions": [{"content": "<p>3 m</p>"}],
            },
            {"id": "dangling", "startItem": {"id": "a"}, "endItem": {"id": "gone"}},
        ],
    }
    board = parse_board(raw)
    (line,) = board.lines
    assert (line.a, line.b, line.text, line.shape) == ((5.0, 0.0), (295.0, 0.0), "3 m", "straight")
    assert line.length == 290.0
    assert [(loose.id, loose.text) for loose in board.loose_lines] == [("dangling", "")]


def test_sticky_without_height_is_square_and_text_has_no_shape() -> None:
    sticky = {
        "id": "s",
        "type": "sticky_note",
        "data": {"content": "<p>level -0.3</p>", "shape": "square"},
        "style": {"fillColor": "orange"},
        "geometry": {"width": 80},
        "position": {"x": 0, "y": 0},
    }
    (item,) = parse_board({"items": [sticky]}).items
    assert (item.width, item.height, item.shape, item.color) == (80.0, 80.0, None, "orange")
    assert item.describe() == 'sticky_note "level -0.3" (s)'
