"""Normalise a raw Miro REST v2 dump into board items with absolute geometry.

Miro facts this relies on (checked against the v2 API and a live board, 2026-10):
- `position` is the item's centre (`origin: "center"`). `relativeTo` is `canvas_center` (board
  coordinates) or `parent_top_left` (offset from the top-left corner of the parent frame).
- The board's y axis points down; `geometry.rotation` is in degrees, clockwise on screen.
- Shapes report `style.fillColor` as `#rrggbb`; sticky notes as a name such as `light_yellow`.
- Text lives in `data.content` as HTML; frames have a plain `data.title`.
- Connectors come from a separate endpoint and only reference the items they join
  (`startItem`/`endItem` with a `"x%"`, `"y%"` anchor inside each item's box). Freehand lines
  are not exposed by the API at all.
"""

import html
import math
import re
from dataclasses import dataclass
from typing import Any

Point = tuple[float, float]


@dataclass(frozen=True)
class BoardItem:
    """One board item with its centre in absolute board coordinates (y down)."""

    id: str
    type: str
    shape: str | None
    text: str
    color: str | None
    center: Point
    width: float
    height: float
    rotation: float
    parent_id: str | None

    def corners(self) -> list[Point]:
        """The four corners of the (rotated) bounding box, in board coordinates."""
        hw, hh = self.width / 2, self.height / 2
        return [self.to_board(dx, dy) for dx, dy in ((-hw, -hh), (hw, -hh), (hw, hh), (-hw, hh))]

    def to_board(self, dx: float, dy: float) -> Point:
        """Board point at offset (dx, dy) from the centre in the item's unrotated frame."""
        th = math.radians(self.rotation)
        c, s = math.cos(th), math.sin(th)
        return (self.center[0] + dx * c - dy * s, self.center[1] + dx * s + dy * c)

    def contains(self, p: Point) -> bool:
        """True if `p` lies inside the (rotated) bounding box."""
        th = math.radians(-self.rotation)
        dx, dy = p[0] - self.center[0], p[1] - self.center[1]
        lx = dx * math.cos(th) - dy * math.sin(th)
        ly = dx * math.sin(th) + dy * math.cos(th)
        return abs(lx) <= self.width / 2 and abs(ly) <= self.height / 2

    @property
    def long_side(self) -> float:
        """Length of the longer side."""
        return max(self.width, self.height)

    @property
    def short_side(self) -> float:
        """Length of the shorter side."""
        return min(self.width, self.height)

    def describe(self) -> str:
        """Short human label for reports, e.g. `shape "Hall" (3458…541)`."""
        label = f' "{_shorten(self.text)}"' if self.text else ""
        return f"{self.shape or self.type}{label} ({self.id})"


@dataclass(frozen=True)
class BoardLine:
    """A connector, reduced to the straight segment between its two anchor points."""

    id: str
    a: Point
    b: Point
    text: str
    shape: str

    @property
    def length(self) -> float:
        """Distance between the end points, in board units."""
        return math.dist(self.a, self.b)


@dataclass(frozen=True)
class Board:
    """All items and connectors of one board."""

    items: list[BoardItem]
    lines: list[BoardLine]


_BREAKS = re.compile(r"<\s*(br|/p|/li|/div|/h\d)\s*/?\s*>", re.IGNORECASE)
_TAGS = re.compile(r"<[^>]+>")


def html_to_text(content: str) -> str:
    """Plain text of Miro HTML content: paragraphs and breaks become newlines, tags go."""
    text = html.unescape(_TAGS.sub("", _BREAKS.sub("\n", content)))
    lines = (" ".join(line.split()) for line in text.replace("\xa0", " ").splitlines())
    return "\n".join(line for line in lines if line)


def _shorten(text: str, limit: int = 40) -> str:
    flat = " ".join(text.split())
    return flat if len(flat) <= limit else flat[: limit - 1] + "…"


def _percent(value: Any, default: float = 0.5) -> float:
    """Miro anchor strings like `"37.5%"` as a 0-1 fraction."""
    if isinstance(value, int | float):
        return float(value)
    if isinstance(value, str) and value.strip().endswith("%"):
        return float(value.strip()[:-1]) / 100
    return default


def _resolve_centres(raw_items: list[dict[str, Any]]) -> dict[str, Point]:
    """Absolute centre of every item, following `parent_top_left` positions up to the canvas."""
    by_id = {str(item["id"]): item for item in raw_items}
    centres: dict[str, Point] = {}

    def centre(item_id: str, depth: int = 0) -> Point:
        if item_id in centres:
            return centres[item_id]
        item = by_id[item_id]
        pos = item.get("position") or {}
        x, y = float(pos.get("x", 0.0)), float(pos.get("y", 0.0))
        parent_id = str((item.get("parent") or {}).get("id", ""))
        if pos.get("relativeTo") == "parent_top_left" and parent_id in by_id and depth < 10:
            px, py = centre(parent_id, depth + 1)
            geo = by_id[parent_id].get("geometry") or {}
            x += px - float(geo.get("width", 0.0)) / 2
            y += py - float(geo.get("height", 0.0)) / 2
        centres[item_id] = (x, y)
        return centres[item_id]

    for item_id in by_id:
        centre(item_id)
    return centres


def _item(raw: dict[str, Any], center: Point) -> BoardItem:
    data = raw.get("data") or {}
    style = raw.get("style") or {}
    geo = raw.get("geometry") or {}
    width = float(geo.get("width") or geo.get("height") or 0.0)
    height = float(geo.get("height") or width)
    item_type = str(raw.get("type", ""))
    text = data.get("title") if item_type == "frame" else data.get("content")
    color = style.get("fillColor")
    return BoardItem(
        id=str(raw["id"]),
        type=item_type,
        shape=data.get("shape") if item_type == "shape" else None,
        text=html_to_text(str(text or "")),
        color=str(color).strip().lower() if color else None,
        center=center,
        width=width,
        height=height,
        rotation=float(geo.get("rotation") or 0.0),
        parent_id=str(raw["parent"]["id"]) if raw.get("parent") else None,
    )


def _anchor(item: BoardItem, end: dict[str, Any]) -> Point:
    pos = end.get("position") or {}
    fx, fy = _percent(pos.get("x")), _percent(pos.get("y"))
    return item.to_board((fx - 0.5) * item.width, (fy - 0.5) * item.height)


def _line(raw: dict[str, Any], items: dict[str, BoardItem]) -> BoardLine | None:
    start, end = raw.get("startItem") or {}, raw.get("endItem") or {}
    a_item, b_item = items.get(str(start.get("id"))), items.get(str(end.get("id")))
    if a_item is None or b_item is None:
        return None
    captions = raw.get("captions") or []
    text = "\n".join(html_to_text(str(c.get("content", ""))) for c in captions).strip()
    return BoardLine(
        id=str(raw["id"]),
        a=_anchor(a_item, start),
        b=_anchor(b_item, end),
        text=text,
        shape=str(raw.get("shape", "curved")),
    )


def parse_board(raw: dict[str, Any]) -> Board:
    """Board items with absolute geometry, plus connectors joined to their items."""
    raw_items = [i for i in raw.get("items", []) if "id" in i]
    centres = _resolve_centres(raw_items)
    items = [_item(i, centres[str(i["id"])]) for i in raw_items]
    by_id = {i.id: i for i in items}
    lines = [line for c in raw.get("connectors", []) if (line := _line(c, by_id))]
    return Board(items=items, lines=lines)
