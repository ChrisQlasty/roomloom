"""Turn room rectangles (in plan metres) into a clean shell: rooms, outline, walls, openings.

Steps: snap nearly touching rectangle edges together, merge same-named parts, subtract overlaps,
build the outline, then derive walls from the room boundaries and attach openings to them.
Plan coordinates are metres with y pointing south, like the board; see `app.geometry.polygon`
for the winding convention (rooms are counter-clockwise as seen from above, interior on the
left of every edge).
"""

import math
from collections.abc import Sequence
from dataclasses import dataclass

import shapely
from shapely.geometry import LineString, MultiPolygon
from shapely.geometry import Polygon as ShapelyPolygon

from app.geometry.polygon import Point, normalise_polygon
from app.importers.miro import MiroImportError

GRID = 0.001  # snap-rounding grid for boolean operations: 1 mm
VERTEX_MERGE = 0.002  # vertices closer than this are the same point
ANGLE_TOL_DEG = 0.5  # edges this close to parallel share an orientation
OVERLAP_WARN_M2 = 0.01  # overlaps larger than 10 x 10 cm are reported
OPENING_MAX_GAP = 0.3  # an opening that misses every wall attaches to one this close
MIN_OPENING_WIDTH = 0.05


@dataclass
class Part:
    """One room rectangle: the index of its room and its four corners."""

    room: int
    corners: list[Point]

    @property
    def area(self) -> float:
        """Area in m²."""
        return ShapelyPolygon(self.corners).area


@dataclass(frozen=True)
class SnapMove:
    """A rectangle edge of `room` moved by `distance` metres to line up with `other_room`."""

    room: int
    other_room: int
    distance: float


@dataclass(frozen=True)
class SnapMiss:
    """Parallel edges of `room` and `other_room` were within the tolerance but are still
    `distance` metres apart after snapping (snapping both would move one too far)."""

    room: int
    other_room: int
    distance: float


@dataclass(frozen=True)
class Overlap:
    """Two rooms overlapped by `area` m²; the overlap was removed from `trimmed`."""

    trimmed: int
    kept: int
    area: float


@dataclass(frozen=True)
class WallSegment:
    """A straight wall from a to b; `left` is the room on the left as seen from above."""

    a: Point
    b: Point
    left: int
    right: int | None

    @property
    def length(self) -> float:
        """Length in metres."""
        return math.dist(self.a, self.b)


@dataclass(frozen=True)
class Attachment:
    """Where an opening sits: wall index, offset from wall end a, width along the wall."""

    wall: int
    offset: float
    width: float
    gap: float  # 0 when the rectangle crosses the wall, else the distance to it


# --- small vector helpers ---


def _dot(u: Point, v: Point) -> float:
    return u[0] * v[0] + u[1] * v[1]


def _sub(u: Point, v: Point) -> Point:
    return (u[0] - v[0], u[1] - v[1])


def _cross(u: Point, v: Point) -> float:
    return u[0] * v[1] - u[1] * v[0]


def _unit(angle_deg: float) -> Point:
    rad = math.radians(angle_deg)
    return (math.cos(rad), math.sin(rad))


def _key(p: Point) -> Point:
    """A point rounded to the mm grid, usable as a dict key."""
    return (round(p[0], 3) + 0.0, round(p[1], 3) + 0.0)


# --- snapping ---


@dataclass
class _Edge:
    part: int
    index: int  # edge k runs from corner k to corner k+1
    orientation: int
    offset: float
    lo: float
    hi: float


def _normal_angle(p: Point, q: Point) -> float:
    """Direction of the edge's normal, folded into [0, 180) degrees."""
    return (math.degrees(math.atan2(q[1] - p[1], q[0] - p[0])) + 90.0) % 180.0


def _orientation(angle: float, reps: list[float]) -> int:
    """Index of the representative orientation within ANGLE_TOL_DEG, adding one if needed."""
    for i, rep in enumerate(reps):
        diff = abs(angle - rep) % 180.0
        if min(diff, 180.0 - diff) <= ANGLE_TOL_DEG:
            return i
    reps.append(angle)
    return len(reps) - 1


def _linked(e: _Edge, f: _Edge, tol: float) -> bool:
    """True for parallel edges of different parts that lie within `tol` of each other."""
    if e.part == f.part or e.orientation != f.orientation:
        return False
    gap = max(e.lo, f.lo) - min(e.hi, f.hi)
    return abs(e.offset - f.offset) <= tol and gap <= tol


def _groups(edges: list[_Edge], tol: float) -> list[list[int]]:
    """Edges that snap onto one line; the first edge of each group is its anchor.

    Parts are placed largest first. Each edge joins the group with the nearest anchor within
    `tol` that holds an edge it is linked to; otherwise it starts a new group. A group takes at
    most one edge per part, and a part's edges choose nearest first, so a part thinner than
    `tol` keeps its width.
    """
    groups: list[list[int]] = []

    def options(i: int) -> list[tuple[float, int]]:
        """(distance to anchor, group index) of the groups edge `i` may join, nearest first."""
        e = edges[i]
        return sorted(
            (abs(edges[g[0]].offset - e.offset), n)
            for n, g in enumerate(groups)
            if abs(edges[g[0]].offset - e.offset) <= tol
            and any(_linked(e, edges[j], tol) for j in g)
        )

    for part in dict.fromkeys(e.part for e in edges):
        choices = {i: options(i) for i, e in enumerate(edges) if e.part == part}
        joined: set[int] = set()
        for i in sorted(choices, key=lambda i: choices[i][0][0] if choices[i] else math.inf):
            n = next((n for _, n in choices[i] if n not in joined), None)
            if n is None:
                groups.append([i])
            else:
                groups[n].append(i)
                joined.add(n)
    return groups


def snap_parts(parts: list[Part], tol: float) -> tuple[list[Part], list[SnapMove], list[SnapMiss]]:
    """Line up rectangle edges that are parallel and within `tol` of each other.

    Each group of nearby parallel edges moves onto the edge of the largest rectangle in the
    group, so gaps and small overlaps close while rectangles stay rectangles. An edge never
    moves further than `tol`; nearby edges of different rooms that therefore stay apart are
    returned as misses.
    """
    order = sorted(range(len(parts)), key=lambda i: -parts[i].area)
    reps: list[float] = []
    edges: list[_Edge] = []
    for i in order:  # largest first, so big rooms define the orientations and the anchors
        c = parts[i].corners
        for k in range(4):
            p, q = c[k], c[(k + 1) % 4]
            o = _orientation(_normal_angle(p, q), reps)
            n = _unit(reps[o])
            t = (-n[1], n[0])
            tp, tq = _dot(t, p), _dot(t, q)
            edges.append(_Edge(i, k, o, (_dot(n, p) + _dot(n, q)) / 2, min(tp, tq), max(tp, tq)))
    offsets = {(e.part, e.index): (e.orientation, e.offset) for e in edges}
    moves: list[SnapMove] = []
    moved: set[int] = set()
    for group in _groups(edges, tol):
        anchor = edges[group[0]]
        for idx in group[1:]:
            e = edges[idx]
            delta = abs(anchor.offset - e.offset)
            offsets[(e.part, e.index)] = (e.orientation, anchor.offset)
            if delta > 0:
                moved.add(e.part)
            room, other = parts[e.part].room, parts[anchor.part].room
            if delta > GRID and room != other:
                moves.append(SnapMove(room, other, delta))
    misses = []
    for i, e in enumerate(edges):
        for f in edges[i + 1 :]:
            room, other = parts[e.part].room, parts[f.part].room
            if room == other or not _linked(e, f, tol):
                continue
            apart = abs(offsets[(e.part, e.index)][1] - offsets[(f.part, f.index)][1])
            if apart > GRID:
                misses.append(SnapMiss(room, other, apart))
    snapped = [
        Part(p.room, _rebuild(i, p.corners, offsets, reps)) if i in moved else p
        for i, p in enumerate(parts)
    ]
    return snapped, moves, misses


def _rebuild(
    part: int,
    corners: list[Point],
    offsets: dict[tuple[int, int], tuple[int, float]],
    reps: list[float],
) -> list[Point]:
    """Corner k is where the lines of edges k-1 and k meet."""
    out = []
    for k in range(4):
        o1, d1 = offsets[(part, (k - 1) % 4)]
        o2, d2 = offsets[(part, k)]
        n1, n2 = _unit(reps[o1]), _unit(reps[o2])
        det = _cross(n1, n2)
        if abs(det) < 1e-9:
            out.append(corners[k])
            continue
        out.append(((d1 * n2[1] - d2 * n1[1]) / det, (n1[0] * d2 - n2[0] * d1) / det))
    return out


# --- rooms and outline ---


def _single_polygon(geom: shapely.Geometry, what: str) -> ShapelyPolygon:
    """`geom` as one polygon without holes; slivers under OVERLAP_WARN_M2 are dropped."""
    if isinstance(geom, MultiPolygon):
        pieces = [g for g in geom.geoms if g.area >= OVERLAP_WARN_M2]
        if len(pieces) != 1:
            raise MiroImportError(f"{what} falls apart into {len(pieces)} separate pieces")
        geom = pieces[0]
    if not isinstance(geom, ShapelyPolygon) or geom.is_empty:
        raise MiroImportError(f"{what} has no area")
    holes = [h for h in geom.interiors if ShapelyPolygon(h).area >= OVERLAP_WARN_M2]
    if holes:
        x, y = ShapelyPolygon(holes[0]).representative_point().coords[0]
        raise MiroImportError(
            f"{what} has a hole around ({x:.2f}, {y:.2f}) m. Courtyards and rooms fully inside "
            "other rooms are not supported; close gaps larger than the snap tolerance."
        )
    return ShapelyPolygon(geom.exterior)


def merge_rooms(parts: list[Part], names: Sequence[str]) -> list[ShapelyPolygon]:
    """Union the parts of each room into one polygon."""
    rooms = []
    for room, name in enumerate(names):
        pieces = [ShapelyPolygon(p.corners) for p in parts if p.room == room]
        union = shapely.union_all(pieces, grid_size=GRID)
        if isinstance(union, MultiPolygon) and len(pieces) > 1:
            raise MiroImportError(
                f'Room "{name}" is drawn as {len(pieces)} rectangles that do not touch; parts '
                "of one room must touch or overlap (or give them different names)"
            )
        rooms.append(_single_polygon(union, f'Room "{name}"'))
    return rooms


def resolve_overlaps(
    rooms: list[ShapelyPolygon], names: Sequence[str]
) -> tuple[list[ShapelyPolygon], list[Overlap]]:
    """Subtract the smaller room from the larger wherever two rooms overlap."""
    rooms = list(rooms)
    overlaps: list[Overlap] = []
    for i in range(len(rooms)):
        for j in range(i + 1, len(rooms)):
            shared = rooms[i].intersection(rooms[j], grid_size=GRID).area
            if shared <= GRID * GRID:
                continue
            big, small = (i, j) if rooms[i].area >= rooms[j].area else (j, i)
            trimmed = rooms[big].difference(rooms[small], grid_size=GRID)
            rooms[big] = _single_polygon(
                trimmed, f'Room "{names[big]}" after removing its overlap with "{names[small]}"'
            )
            if shared >= OVERLAP_WARN_M2:
                overlaps.append(Overlap(big, small, shared))
    return rooms, overlaps


def _drop_collinear(ring: list[Point]) -> list[Point]:
    """Remove vertices that lie (within 0.5 mm) on the straight line through their neighbours."""
    changed = True
    while changed and len(ring) > 3:
        changed = False
        for i in range(len(ring)):
            prev, cur, nxt = ring[i - 1], ring[i], ring[(i + 1) % len(ring)]
            span = math.dist(prev, nxt)
            if span == 0 or _dot(_sub(cur, prev), _sub(nxt, cur)) < 0:
                continue
            if abs(_cross(_sub(cur, prev), _sub(nxt, prev))) / span < 0.0005:
                del ring[i]
                changed = True
                break
    return ring


def _ring(poly: ShapelyPolygon) -> list[Point]:
    """Exterior ring as open, mm-rounded points."""
    return [_key((x, y)) for x, y in poly.exterior.coords[:-1]]


def _clean(ring: list[Point], what: str) -> list[Point]:
    """`ring` without collinear vertices, CCW from above; MiroImportError if it degenerates."""
    try:
        return normalise_polygon(_drop_collinear(ring))
    except ValueError as e:
        raise MiroImportError(f"{what} has an invalid shape after cleaning: {e}") from e


def _merge_vertices(rings: list[list[Point]]) -> list[list[Point]]:
    """Replace vertices of different rooms that are within VERTEX_MERGE by a single point."""
    reps: list[Point] = []

    def rep(p: Point) -> Point:
        for r in reps:
            if math.dist(p, r) <= VERTEX_MERGE:
                return r
        reps.append(p)
        return p

    merged = []
    for ring in rings:
        out: list[Point] = []
        for p in ring:
            q = rep(p)
            if not out or out[-1] != q:
                out.append(q)
        if len(out) > 1 and out[0] == out[-1]:
            out.pop()
        merged.append(out)
    return merged


def room_rings(rooms: list[ShapelyPolygon], names: Sequence[str]) -> list[list[Point]]:
    """Final room polygons: shared corners merged, collinear points removed, CCW from above."""
    rings = _merge_vertices([_ring(r) for r in rooms])
    return [_clean(ring, f'Room "{name}"') for ring, name in zip(rings, names, strict=True)]


def outline_of(rings: list[list[Point]], names: Sequence[str]) -> list[Point]:
    """The building footprint: the union of all rooms, CCW as seen from above."""
    union = shapely.union_all([ShapelyPolygon(r) for r in rings], grid_size=GRID)
    if isinstance(union, MultiPolygon):
        groups = []
        for piece in union.geoms:
            inside = [
                n
                for r, n in zip(rings, names, strict=True)
                if piece.contains(ShapelyPolygon(r).representative_point())
            ]
            groups.append(", ".join(inside) or "?")
        raise MiroImportError(
            "The rooms form separate buildings that do not touch: "
            + " | ".join(groups)
            + ". Close the gaps (only gaps up to the snap tolerance are closed automatically)."
        )
    return _clean(_ring(_single_polygon(union, "The building outline")), "The building outline")


# --- walls ---


def _on_segment(v: Point, p: Point, q: Point) -> float | None:
    """Parameter t in (0, 1) where `v` lies on segment p-q (within VERTEX_MERGE), else None."""
    d = _sub(q, p)
    length2 = _dot(d, d)
    if length2 == 0:
        return None
    t = _dot(_sub(v, p), d) / length2
    if t <= 0 or t >= 1:
        return None
    foot = (p[0] + t * d[0], p[1] + t * d[1])
    return t if math.dist(foot, v) <= VERTEX_MERGE else None


def _split_edges(rings: list[list[Point]]) -> list[list[tuple[Point, Point]]]:
    """Each room's edges, split at every vertex of any other room lying on them."""
    vertices = {v for ring in rings for v in ring}
    out = []
    for ring in rings:
        edges = []
        for k, p in enumerate(ring):
            q = ring[(k + 1) % len(ring)]
            on = sorted((t, v) for v in vertices if v not in (p, q) and (t := _on_segment(v, p, q)))
            points = [p, *(v for _, v in on), q]
            edges += list(zip(points, points[1:], strict=False))
        out.append(edges)
    return out


def _collinear(p: Point, q: Point, r: Point) -> bool:
    """True if p→q→r goes straight on (within ANGLE_TOL_DEG)."""
    d1, d2 = _sub(q, p), _sub(r, q)
    n1, n2 = math.hypot(*d1), math.hypot(*d2)
    if n1 == 0 or n2 == 0:
        return True
    return _dot(d1, d2) > 0 and abs(_cross(d1, d2)) / (n1 * n2) < math.sin(
        math.radians(ANGLE_TOL_DEG)
    )


def _runs(edges: list[tuple[Point, Point, int | None]]) -> list[tuple[Point, Point, int | None]]:
    """Merge consecutive collinear edges of a closed ring that border the same room."""

    def joins(e1: tuple[Point, Point, int | None], e2: tuple[Point, Point, int | None]) -> bool:
        return e1[2] == e2[2] and _collinear(e1[0], e1[1], e2[1])

    n = len(edges)
    start = next((i for i in range(n) if not joins(edges[i - 1], edges[i])), 0)
    runs: list[tuple[Point, Point, int | None]] = []
    for k in range(n):
        e = edges[(start + k) % n]
        if runs and joins(runs[-1], e):
            runs[-1] = (runs[-1][0], e[1], e[2])
        else:
            runs.append(e)
    return runs


def derive_walls(
    rings: list[list[Point]], outline: list[Point], names: Sequence[str]
) -> tuple[list[WallSegment], list[str]]:
    """Walls along every room edge: shared edges are interior, the rest exterior.

    Returns the walls and warnings about room edges that face neither a room nor the outside.
    """
    split = _split_edges(rings)
    owner = {(p, q): room for room, edges in enumerate(split) for p, q in edges}
    boundary = LineString([*outline, outline[0]])
    walls: list[WallSegment] = []
    warnings: list[str] = []
    for room, edges in enumerate(split):
        tagged = [(p, q, owner.get((q, p))) for p, q in edges]
        for a, b, other in _runs(tagged):
            if other is None:
                mid = shapely.Point((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
                if boundary.distance(mid) > VERTEX_MERGE:
                    warnings.append(
                        f'Room "{names[room]}": the edge ({a[0]:.2f}, {a[1]:.2f})-'
                        f"({b[0]:.2f}, {b[1]:.2f}) touches no other room but is not on the "
                        "outline either"
                    )
                walls.append(WallSegment(a, b, room, None))
            elif other > room:
                walls.append(WallSegment(a, b, room, other))
    return walls, warnings


# --- openings ---


def _wall_axis(wall: WallSegment) -> tuple[Point, float]:
    length = wall.length
    return ((wall.b[0] - wall.a[0]) / length, (wall.b[1] - wall.a[1]) / length), length


def _span_on(wall: WallSegment, points: Sequence[Point]) -> tuple[float, float]:
    """The [t0, t1] range the points cover along the wall, clipped to the wall."""
    axis, length = _wall_axis(wall)
    ts = [_dot(_sub(p, wall.a), axis) for p in points]
    return max(min(ts), 0.0), min(max(ts), length)


def attach_opening(corners: list[Point], walls: list[WallSegment]) -> Attachment | None:
    """Find the wall an opening rectangle crosses and its position along that wall.

    The wall with the longest stretch inside the rectangle wins. If the rectangle crosses no
    wall, it attaches to the nearest wall within OPENING_MAX_GAP that runs along its long side.
    """
    rect = ShapelyPolygon(corners)
    best: Attachment | None = None
    for i, wall in enumerate(walls):
        inside = rect.intersection(LineString([wall.a, wall.b]))
        if inside.is_empty or inside.length < MIN_OPENING_WIDTH:
            continue
        t0, t1 = _span_on(wall, [tuple(c) for c in shapely.get_coordinates(inside)])
        if best is None or t1 - t0 > best.width:
            best = Attachment(i, t0, t1 - t0, 0.0)
    if best is not None:
        return best
    long_edge = max(
        ((corners[0], corners[1]), (corners[1], corners[2])), key=lambda e: math.dist(*e)
    )
    direction = _sub(long_edge[1], long_edge[0])
    for i, wall in enumerate(walls):
        gap = rect.distance(LineString([wall.a, wall.b]))
        axis, _ = _wall_axis(wall)
        parallel = abs(_cross(axis, direction)) / math.hypot(*direction) < math.sin(
            math.radians(10)
        )
        if gap > OPENING_MAX_GAP or not parallel:
            continue
        t0, t1 = _span_on(wall, corners)
        if t1 - t0 >= MIN_OPENING_WIDTH and (best is None or gap < best.gap):
            best = Attachment(i, t0, t1 - t0, gap)
    return best
