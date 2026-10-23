"""Floor levels and steps from level notes, and ceilings high enough for every opening."""

import math
from collections.abc import Callable
from dataclasses import dataclass

from shapely.geometry import Point as ShapelyPoint
from shapely.geometry import Polygon as ShapelyPolygon

from app.importers.miro import MiroImportError
from app.importers.miro.board import BoardItem, Point
from app.importers.miro.drafts import OpeningDraft, RoomDraft
from app.importers.miro.geometry import WallSegment
from app.importers.miro.notes import NoteInterpreter, parse_text
from app.importers.miro.report import ImportReport, LevelNoteRow
from app.schema.checks import CEILING_CLEARANCE, LEVEL_TOLERANCE
from app.schema.ids import new_id
from app.schema.shell import MAX_CEILING_HEIGHT, Transition

STEP_RISE = 0.18  # assumed height of one step when the board gives no step count
MAX_LEVEL = 5.0


@dataclass
class ShellView:
    """The parts of the shell that level notes refer to."""

    rooms: list[RoomDraft]
    polygons: list[ShapelyPolygon]
    segments: list[WallSegment]
    openings: list[OpeningDraft]
    to_plan: Callable[[Point], Point]

    def room_at(self, p: Point) -> int | None:
        """Index of the room containing plan point `p`."""
        point = ShapelyPoint(p)
        return next((i for i, poly in enumerate(self.polygons) if poly.covers(point)), None)

    def label(self, op: OpeningDraft) -> str:
        """`door op_x (Hall ↔ Gym)` for messages."""
        seg = self.segments[op.wall]
        right = self.rooms[seg.right].name if seg.right is not None else "outside"
        return f"{op.kind} {op.id} ({self.rooms[seg.left].name} ↔ {right})"


@dataclass
class _StepsRequest:
    text: str
    room: int | None
    touched: list[int]
    centre: Point
    steps: int


def _interpret(
    free: list[tuple[int, str]], interpreter: NoteInterpreter | None, report: ImportReport
) -> dict[int, tuple[float | None, int | None, str]]:
    """Readings of free-text notes by Claude, keyed by note index; {} when not available."""
    if not free:
        return {}
    if interpreter is None:
        for _, text in free:
            report.warn(
                "Levels and steps",
                f'Level note "{text}" was not understood. Write "level -0.3" or "steps 2", or '
                "run the importer with --llm-notes.",
            )
        return {}
    try:
        readings = interpreter([text for _, text in free])
    except MiroImportError as e:
        report.warn("Levels and steps", f"{e}; {len(free)} free-text level notes were skipped.")
        return {}
    return {free[r.note][0]: (r.level_m, r.steps, r.explanation) for r in readings}


def _set_level(
    shell: ShellView, room: int | None, level: float, text: str, report: ImportReport
) -> None:
    if room is None:
        report.warn("Levels and steps", f'Level note "{text}" is not inside a room; ignored.')
        return
    if abs(level) > MAX_LEVEL:
        report.warn("Levels and steps", f'Level note "{text}": {level} m is out of range; ignored.')
        return
    draft = shell.rooms[room]
    if draft.level_note is not None and abs(draft.level - level) > LEVEL_TOLERANCE:
        report.warn(
            "Levels and steps",
            f'"{draft.name}" has two level notes ("{draft.level_note}" and "{text}"); '
            f"used {level:+.2f} m.",
        )
    draft.level, draft.level_note = round(level, 3), text


def read_level_notes(
    notes: list[BoardItem],
    shell: ShellView,
    interpreter: NoteInterpreter | None,
    report: ImportReport,
) -> dict[int, int]:
    """Apply `level` notes to rooms; return explicit step counts by opening index."""
    parsed = [parse_text(n.text) for n in notes]
    free = [
        (i, n.text)
        for i, (n, p) in enumerate(zip(notes, parsed, strict=True))
        if p.level is None and p.steps is None
    ]
    llm = _interpret(free, interpreter, report)
    requests: list[_StepsRequest] = []
    for i, (note, p) in enumerate(zip(notes, parsed, strict=True)):
        level, steps, reader, explanation = p.level, p.steps, "grammar", ""
        if i in llm:
            level, steps, explanation = llm[i]
            reader = "Claude (--llm-notes)"
        elif p.level is None and p.steps is None:
            reader = "not understood"
        centre = shell.to_plan(note.center)
        room = shell.room_at(centre)
        rect = ShapelyPolygon([shell.to_plan(c) for c in note.corners()])
        touched = [j for j, op in enumerate(shell.openings) if op.rect.intersects(rect)]
        report.level_notes.append(
            LevelNoteRow(
                note.text,
                shell.rooms[room].name if room is not None else "",
                level,
                steps,
                reader,
                explanation,
            )
        )
        if level is not None:
            _set_level(shell, room, level, note.text, report)
        if steps is not None and steps > 0:
            requests.append(_StepsRequest(note.text, room, touched, centre, steps))
    return _target_openings(requests, shell, report)


def _target_openings(
    requests: list[_StepsRequest], shell: ShellView, report: ImportReport
) -> dict[int, int]:
    """Pick the door each `steps N` note refers to: one it touches, else the nearest in its room.

    When two notes pick the same door, one touching it beats one only in the room; between
    equals the first wins. Conflicting counts are reported.
    """
    chosen: dict[int, tuple[_StepsRequest, bool]] = {}
    for req in requests:
        candidates = [j for j in req.touched if shell.openings[j].kind != "window"]
        touching = bool(candidates)
        if not candidates and req.room is not None:
            candidates = [
                j
                for j, op in enumerate(shell.openings)
                if op.kind != "window"
                and req.room in (shell.segments[op.wall].left, shell.segments[op.wall].right)
            ]
        if not candidates:
            report.warn(
                "Levels and steps",
                f'Steps note "{req.text}" has no door or passage nearby; ignored.',
            )
            continue
        target = min(
            candidates,
            key=lambda j: math.dist(
                req.centre, shell.openings[j].centre(shell.segments[shell.openings[j].wall])
            ),
        )
        previous = chosen.get(target)
        if previous is None:
            chosen[target] = (req, touching)
            continue
        kept = req if touching and not previous[1] else previous[0]
        if req.steps != previous[0].steps:
            report.warn(
                "Levels and steps",
                f'Steps notes "{previous[0].text}" and "{req.text}" both point at '
                f'{shell.label(shell.openings[target])}; used "{kept.text}".',
            )
        chosen[target] = (kept, touching or previous[1])
    return {j: req.steps for j, (req, _) in chosen.items()}


def build_transitions(
    shell: ShellView, steps_at: dict[int, int], taken: set[str], report: ImportReport
) -> list[Transition]:
    """Steps at every door or passage between rooms on different levels."""
    transitions = []
    for j, op in enumerate(shell.openings):
        if op.kind == "window":
            continue
        seg = shell.segments[op.wall]
        if seg.right is None:
            if j in steps_at or shell.rooms[seg.left].level:
                report.warn(
                    "Levels and steps",
                    f"{shell.label(op)} leads outside; steps outside the building are not built "
                    "(the ground is at level 0).",
                )
            continue
        left, right = shell.rooms[seg.left], shell.rooms[seg.right]
        rise = round(abs(left.level - right.level), 3)
        if rise <= LEVEL_TOLERANCE:
            if j in steps_at:
                report.warn(
                    "Levels and steps",
                    f"Steps at {shell.label(op)} were ignored: both rooms are on the same level.",
                )
            continue
        steps = steps_at.get(j)
        if steps is None:
            steps = max(1, math.ceil(rise / STEP_RISE - 1e-9))
            report.warn(
                "Levels and steps",
                f"No steps note at {shell.label(op)} ({rise:.2f} m difference); assumed {steps} "
                'step(s). Put "steps N" on an orange sticky touching the door to set it.',
            )
        host = seg.left if left.level < right.level else seg.right
        tr_id = new_id("transition", taken, op.id.removeprefix("op_"))
        taken.add(tr_id)
        transitions.append(
            Transition(
                id=tr_id,
                opening_id=op.id,
                steps=steps,
                rise_total=rise,
                host_room_id=shell.rooms[host].id,
            )
        )
    return transitions


def required_ceilings(shell: ShellView) -> dict[int, float]:
    """Lowest allowed ceiling per room: highest opening top in its walls + the clearance."""
    needed: dict[int, float] = {}
    for op in shell.openings:
        seg = shell.segments[op.wall]
        rooms = [r for r in (seg.left, seg.right) if r is not None]
        threshold = max(shell.rooms[r].level for r in rooms)
        top = threshold + op.sill + op.height
        for r in rooms:
            needed[r] = max(needed.get(r, 0.0), top + CEILING_CLEARANCE - shell.rooms[r].level)
    return needed


def ceiling_heights(shell: ShellView, default: float, report: ImportReport) -> list[float]:
    """Each room's ceiling: its `h=`, else the default, raised where an opening needs more."""
    needed = required_ceilings(shell)
    heights = []
    for i, room in enumerate(shell.rooms):
        height = room.ceiling or default
        if height > MAX_CEILING_HEIGHT:
            report.warn(
                "Ceilings", f'"{room.name}": h={height} is above {MAX_CEILING_HEIGHT} m; capped.'
            )
            height = MAX_CEILING_HEIGHT
        need = math.ceil(round(needed.get(i, 0.0), 6) * 100) / 100
        if height < need:
            if need > MAX_CEILING_HEIGHT:
                raise MiroImportError(
                    f'"{room.name}" has an opening too tall for any ceiling ({need:.2f} m needed)'
                )
            report.warn(
                "Ceilings",
                f'"{room.name}": ceiling raised from {height:.2f} to {need:.2f} m so that its '
                "tallest door or window fits.",
            )
            height = need
        heights.append(height)
    return heights
