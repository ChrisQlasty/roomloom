"""2D polygon helpers in Miro plan coordinates `(x, y)`, where y points south (down the board).

Winding convention: polygons are stored counter-clockwise **as seen from above** (as drawn on
the Miro board, north up). Because the plan's y axis points down, that is a *negative* shoelace
area in raw `(x, y)`. With this winding the polygon interior lies on the left of every edge.
`CCW_FROM_ABOVE_SIGN` is the only place that encodes this choice.
"""

from collections.abc import Sequence

from shapely.geometry import Polygon as ShapelyPolygon

Point = tuple[float, float]

CCW_FROM_ABOVE_SIGN = -1.0


def signed_area(points: Sequence[Point]) -> float:
    """Shoelace area in raw plan coordinates (positive means mathematically counter-clockwise)."""
    total = 0.0
    for (x1, y1), (x2, y2) in zip(points, [*points[1:], points[0]], strict=True):
        total += x1 * y2 - x2 * y1
    return total / 2.0


def is_ccw_from_above(points: Sequence[Point]) -> bool:
    """True if the ring winds counter-clockwise as seen from above (the stored convention)."""
    return signed_area(points) * CCW_FROM_ABOVE_SIGN > 0


def open_ring(points: Sequence[Point]) -> list[Point]:
    """Drop consecutive duplicates and a repeated closing point (rings are implicitly closed)."""
    ring: list[Point] = []
    for p in points:
        if not ring or ring[-1] != p:
            ring.append(p)
    if len(ring) > 1 and ring[0] == ring[-1]:
        ring.pop()
    return ring


def validate_simple_ring(points: Sequence[Point]) -> list[Point]:
    """Return `points` as an open ring; raise ValueError if degenerate or self-intersecting."""
    ring = open_ring(points)
    if len(ring) < 3:
        raise ValueError("a polygon needs at least 3 distinct points")
    shape = ShapelyPolygon(ring)
    if not shape.is_valid or not shape.exterior.is_simple:
        raise ValueError("polygon is self-intersecting")
    if shape.area <= 0:
        raise ValueError("polygon has zero area")
    return ring


def normalise_polygon(points: Sequence[Point]) -> list[Point]:
    """Validate a simple ring and orient it counter-clockwise as seen from above."""
    ring = validate_simple_ring(points)
    return ring if is_ccw_from_above(ring) else ring[::-1]
