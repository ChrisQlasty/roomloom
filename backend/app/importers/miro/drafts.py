"""Intermediate rooms and openings the pipeline fills in before it builds the scene."""

from dataclasses import dataclass, field

from shapely.geometry import Polygon as ShapelyPolygon

from app.importers.miro.board import BoardItem, Point
from app.importers.miro.classify import OpeningKind
from app.importers.miro.geometry import WallSegment


@dataclass
class RoomDraft:
    """A room as read from the board: its name, rectangles and annotations."""

    name: str
    parts: list[BoardItem] = field(default_factory=list)
    tags: list[str] = field(default_factory=list)
    ceiling: float | None = None
    id: str = ""
    level: float = 0.0
    level_note: str | None = None  # the note that set `level`, for conflict warnings
    notes: list[str] = field(default_factory=list)


@dataclass
class OpeningDraft:
    """An opening attached to a wall: position along it, size, and its board rectangle."""

    kind: OpeningKind
    item: BoardItem
    wall: int
    offset: float
    width: float
    height: float
    sill: float
    rect: ShapelyPolygon
    id: str = ""

    def centre(self, segment: WallSegment) -> Point:
        """Midpoint of the opening on its wall's centre line."""
        t = (self.offset + self.width / 2) / segment.length
        return (
            segment.a[0] + t * (segment.b[0] - segment.a[0]),
            segment.a[1] + t * (segment.b[1] - segment.a[1]),
        )
