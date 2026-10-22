"""Raw board dump → validated Scene plus an import report. No file or network access here."""

import math
import re
from collections.abc import Callable

from pydantic import ValidationError
from shapely.geometry import Polygon as ShapelyPolygon

from app.importers.miro import MiroImportError
from app.importers.miro.board import Point, parse_board
from app.importers.miro.classify import Classified, Ignored, classify
from app.importers.miro.config import ImportConfig
from app.importers.miro.drafts import OpeningDraft, RoomDraft
from app.importers.miro.fetch import RawBoard
from app.importers.miro.geometry import (
    Part,
    SnapMove,
    WallSegment,
    attach_opening,
    derive_walls,
    merge_rooms,
    outline_of,
    resolve_overlaps,
    room_rings,
    snap_parts,
)
from app.importers.miro.levels import (
    ShellView,
    build_transitions,
    ceiling_heights,
    read_level_notes,
)
from app.importers.miro.notes import NoteInterpreter, parse_text, split_author, with_author
from app.importers.miro.report import ImportReport
from app.schema.defaults import default_materials, default_roof
from app.schema.ids import new_id
from app.schema.scene import Note, Scene
from app.schema.shell import Opening, Room, Shell, Wall, WallThickness

COMPASS = ["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"]


def run_import(
    raw: RawBoard,
    config: ImportConfig,
    *,
    project: str,
    source: str,
    interpreter: NoteInterpreter | None = None,
) -> ImportReport:
    """Interpret a board dump. The report holds the scene, or the error that stopped it."""
    found = classify(parse_board(raw), config)
    report = ImportReport(
        project=project,
        source=source,
        plan_frame=found.plan_frame.text if found.plan_frame else None,
        ignored=list(found.ignored),
        colors=found.colors,
        warnings=list(found.warnings),
    )
    try:
        report.scene = _build(found, config, interpreter, report)
    except MiroImportError as e:
        report.error = str(e)
    return report


def _scale(found: Classified, report: ImportReport) -> float:
    """Metres per board unit, from the single scale bar."""
    if not found.scale_bars:
        raise MiroImportError(
            "No scale bar found. Draw a thin rectangle labelled with its real length, e.g. "
            '"5 m", next to the plan (exactly one).'
        )
    if len(found.scale_bars) > 1:
        bars = ", ".join(f'"{b.label}" ({b.source} {b.ref})' for b in found.scale_bars)
        raise MiroImportError(
            f"Found {len(found.scale_bars)} scale bars: {bars}. Keep exactly one."
        )
    bar = found.scale_bars[0]
    report.scale, report.metres_per_unit = bar, bar.length_m / bar.length_units
    return report.metres_per_unit


def _room_drafts(found: Classified, report: ImportReport) -> list[RoomDraft]:
    """Group room rectangles by name and read their text (`Name #tag h=3.2`)."""
    texts = list(found.texts)
    drafts: dict[str, RoomDraft] = {}
    unnamed = 0
    for part in found.room_parts:
        text = part.text
        if not text:  # a separate text item placed on the rectangle names it
            label = next((t for t in texts if part.contains(t.center)), None)
            if label is not None:
                texts.remove(label)
                text = label.text
        parsed = parse_text(text)
        name = " ".join(parsed.rest.split())
        if not name:
            unnamed += 1
            name = f"Unnamed room {unnamed}"
        draft = drafts.setdefault(name.casefold(), RoomDraft(name))
        draft.parts.append(part)
        draft.tags += [t for t in parsed.tags if t not in draft.tags]
        if parsed.h is not None:
            if draft.ceiling is not None and abs(draft.ceiling - parsed.h) > 1e-6:
                report.warn("Rooms", f'"{name}" has two ceiling heights; used the larger one.')
            draft.ceiling = max(draft.ceiling or 0.0, parsed.h)
    if unnamed:
        report.warn(
            "Rooms",
            f"{unnamed} room rectangle(s) have no name and were called Unnamed room 1…{unnamed}. "
            "Write the room name inside each rectangle.",
        )
    report.ignored += [Ignored(t.describe(), "text outside rooms and notes areas") for t in texts]
    if not drafts:
        where = " inside the plan frame" if found.plan_frame else ""
        raise MiroImportError(f"No room rectangles found{where}.")
    return list(drafts.values())


def _plan_transform(drafts: list[RoomDraft], scale: float) -> Callable[[Point], Point]:
    """Board point → plan metres, with the building's north-west corner at (0, 0)."""
    corners = [c for d in drafts for part in d.parts for c in part.corners()]
    ox = round(min(x for x, _ in corners) * scale, 3)
    oy = round(min(y for _, y in corners) * scale, 3)
    return lambda p: (p[0] * scale - ox, p[1] * scale - oy)


def _snap_warnings(moves: list[SnapMove], drafts: list[RoomDraft], report: ImportReport) -> None:
    worst: dict[tuple[int, int], float] = {}
    for move in moves:
        key = (min(move.room, move.other_room), max(move.room, move.other_room))
        worst[key] = max(worst.get(key, 0.0), move.distance)
    for (a, b), distance in sorted(worst.items()):
        report.warn(
            "Snapped gaps",
            f'Closed a gap or overlap of up to {distance:.2f} m between "{drafts[a].name}" and '
            f'"{drafts[b].name}".',
        )


def _compass(seg: WallSegment) -> str:
    """Direction an exterior wall faces: its right side as seen from above (y points south)."""
    nx, ny = -(seg.b[1] - seg.a[1]), seg.b[0] - seg.a[0]
    bearing = math.degrees(math.atan2(nx, -ny)) % 360
    return COMPASS[round(bearing / 45) % 8]


def _wall_ids(segments: list[WallSegment], drafts: list[RoomDraft], taken: set[str]) -> list[str]:
    ids = []
    for seg in segments:
        left = drafts[seg.left].id.removeprefix("r_")
        hint = (
            f"{left} {_compass(seg)}"
            if seg.right is None
            else f"{left} {drafts[seg.right].id.removeprefix('r_')}"
        )
        ids.append(new_id("wall", taken, hint))
        taken.add(ids[-1])
    return ids


def _openings(
    found: Classified,
    segments: list[WallSegment],
    drafts: list[RoomDraft],
    config: ImportConfig,
    to_plan: Callable[[Point], Point],
    scale: float,
    report: ImportReport,
) -> list[OpeningDraft]:
    """Attach every opening rectangle to the wall it crosses; drop ones that fit nowhere."""
    per_wall: dict[int, list[OpeningDraft]] = {}
    for kind, item in found.openings:
        corners = [to_plan(c) for c in item.corners()]
        label = f"{kind.capitalize()} {item.describe()}"
        att = attach_opening(corners, segments)
        if att is None:
            report.warn(
                "Openings",
                f"{label} does not cross any wall and was ignored. Place it across the edge "
                "between two rooms, or between a room and the outside.",
            )
            continue
        seg = segments[att.wall]
        if att.gap > 0:
            report.warn(
                "Openings",
                f"{label} does not cross a wall; attached to the nearest one "
                f"({att.gap:.2f} m away).",
            )
        drawn = item.long_side * scale
        if att.width < drawn - 0.05:
            report.warn(
                "Openings",
                f"{label} reaches past the end of its wall; width cut from {drawn:.2f} to "
                f"{att.width:.2f} m.",
            )
        if kind == "window" and seg.right is not None:
            report.warn(
                "Openings",
                f'{label} is on an interior wall ("{drafts[seg.left].name}" ↔ '
                f'"{drafts[seg.right].name}").',
            )
        parsed = parse_text(item.text)
        defaults = getattr(config.defaults, kind)
        offset = round(att.offset, 3)
        width = round(att.width, 3)
        if offset + width > seg.length:  # never past the wall end after rounding
            width = math.floor((seg.length - offset) * 1000) / 1000
        per_wall.setdefault(att.wall, []).append(
            OpeningDraft(
                kind=kind,
                item=item,
                wall=att.wall,
                offset=offset,
                width=width,
                height=parsed.h if parsed.h is not None else defaults.height,
                sill=parsed.sill if parsed.sill is not None else defaults.sill,
                rect=ShapelyPolygon(corners),
            )
        )
    kept: list[OpeningDraft] = []
    for wall in sorted(per_wall):
        end = 0.0
        for op in sorted(per_wall[wall], key=lambda o: o.offset):
            if op.offset < end - 1e-6:
                report.warn(
                    "Openings",
                    f"{op.kind.capitalize()} {op.item.describe()} overlaps another opening in "
                    "the same wall and was ignored.",
                )
                continue
            kept.append(op)
            end = op.offset + op.width
    return kept


def _room_notes(found: Classified, view: ShellView, report: ImportReport) -> list[str]:
    """Put memory stickies on their rooms; return the ones outside any room."""
    homeless = []
    for item in found.memory_notes:
        body, author = split_author(item.text)
        if not body:
            continue
        room = view.room_at(view.to_plan(item.center))
        if room is None:
            report.warn(
                "Notes", f'Memory note "{body}" is not inside a room; kept as a building note.'
            )
            homeless.append(with_author(body, author))
        else:
            view.rooms[room].notes.append(with_author(body, author))
    return homeless


def _building_notes(
    found: Classified, extra: list[str], drafts: list[RoomDraft], taken: set[str]
) -> list[Note]:
    """Notes-area content as scene notes, linked to the rooms whose names they mention."""
    texts = [with_author(*split_author(item.text)) for item in found.building_notes] + extra
    notes = []
    for text in texts:
        if not text.strip():
            continue
        room_ids = [
            d.id
            for d in drafts
            if re.search(rf"(?<!\w){re.escape(d.name)}(?!\w)", text, re.IGNORECASE)
        ]
        note_id = new_id("note", taken)
        taken.add(note_id)
        notes.append(Note(id=note_id, text=text, room_ids=room_ids))
    return notes


def _build(
    found: Classified,
    config: ImportConfig,
    interpreter: NoteInterpreter | None,
    report: ImportReport,
) -> Scene:
    scale = _scale(found, report)
    drafts = _room_drafts(found, report)
    names = [d.name for d in drafts]
    to_plan = _plan_transform(drafts, scale)
    parts = [
        Part(i, [to_plan(c) for c in item.corners()])
        for i, d in enumerate(drafts)
        for item in d.parts
    ]
    parts, moves = snap_parts(parts, config.snap_tolerance_m)
    _snap_warnings(moves, drafts, report)
    polygons, overlaps = resolve_overlaps(merge_rooms(parts, names), names)
    for ov in overlaps:
        report.warn(
            "Overlaps",
            f'"{names[ov.trimmed]}" and "{names[ov.kept]}" overlapped by {ov.area:.2f} m²; the '
            f'overlap now belongs to "{names[ov.kept]}" (the smaller room).',
        )
    rings = room_rings(polygons, names)
    outline = outline_of(rings, names)
    segments, edge_warnings = derive_walls(rings, outline, names)
    for text in edge_warnings:
        report.warn("Rooms", text)

    taken: set[str] = set()
    for d in drafts:
        d.id = new_id("room", taken, d.name)
        taken.add(d.id)
    report.part_counts = {d.id: len(d.parts) for d in drafts}
    wall_ids = _wall_ids(segments, drafts, taken)
    openings = _openings(found, segments, drafts, config, to_plan, scale, report)
    for op in openings:
        op.id = new_id("opening", taken, f"{wall_ids[op.wall].removeprefix('w_')} {op.kind}")
        taken.add(op.id)

    view = ShellView(drafts, [ShapelyPolygon(r) for r in rings], segments, openings, to_plan)
    steps_at = read_level_notes(found.level_notes, view, interpreter, report)
    transitions = build_transitions(view, steps_at, taken, report)
    ceilings = ceiling_heights(view, config.defaults.ceiling_height, report)
    homeless = _room_notes(found, view, report)
    notes = _building_notes(found, homeless, drafts, taken)

    thickness = WallThickness()
    walls = [
        Wall(
            id=wall_ids[i],
            a=seg.a,
            b=seg.b,
            thickness=thickness.exterior if seg.right is None else thickness.interior,
            kind="exterior" if seg.right is None else "interior",
            left_room_id=drafts[seg.left].id,
            right_room_id=drafts[seg.right].id if seg.right is not None else None,
            openings=[
                Opening(
                    id=op.id,
                    kind=op.kind,
                    offset=op.offset,
                    width=op.width,
                    height=op.height,
                    sill=op.sill,
                )
                for op in openings
                if op.wall == i
            ],
        )
        for i, seg in enumerate(segments)
    ]
    rooms = [
        Room(
            id=d.id,
            name=d.name,
            tags=d.tags,
            polygon=ring,
            floor_level=d.level,
            ceiling_height=ceiling,
            notes=d.notes,
        )
        for d, ring, ceiling in zip(drafts, rings, ceilings, strict=True)
    ]
    try:
        return Scene(
            schema_version=1,
            version=0,
            shell=Shell(
                outline=outline,
                default_ceiling_height=config.defaults.ceiling_height,
                wall_thickness=thickness,
                rooms=rooms,
                walls=walls,
                transitions=transitions,
            ),
            roof=default_roof(),
            materials=default_materials(),
            notes=notes,
        )
    except ValidationError as e:
        raise MiroImportError(
            f"The imported scene failed validation (importer bug, please report): {e}"
        ) from e
