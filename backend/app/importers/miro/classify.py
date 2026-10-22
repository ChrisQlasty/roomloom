"""Decide what every board item is: room part, opening, note, scale bar or ignored."""

import re
from collections import Counter
from dataclasses import dataclass, field
from typing import Literal

from app.importers.miro.board import Board, BoardItem, BoardLine
from app.importers.miro.config import ImportConfig

OpeningKind = Literal["door", "window", "passage"]

RECTANGLES = {"rectangle", "round_rectangle", "square"}
SCALE_MIN_ASPECT = 3.0
_SCALE_LABEL = re.compile(
    r"^\s*(\d+(?:[.,]\d+)?)\s*(m|cm|metres?|meters?)\s*\.?\s*$", re.IGNORECASE
)


@dataclass(frozen=True)
class ScaleBar:
    """A board element that states a real length."""

    label: str
    length_m: float
    length_units: float
    source: str  # "rectangle" or "connector"
    ref: str


@dataclass(frozen=True)
class Ignored:
    """An item the importer did not use, and why."""

    item: str
    reason: str


@dataclass(frozen=True)
class ColorRow:
    """One line of the colour table printed by --dry-run."""

    kind: str  # "shape fill" or "sticky note"
    color: str
    count: int
    meaning: str


@dataclass
class Classified:
    """The board, sorted by role."""

    plan_frame: BoardItem | None = None
    room_parts: list[BoardItem] = field(default_factory=list)
    openings: list[tuple[OpeningKind, BoardItem]] = field(default_factory=list)
    level_notes: list[BoardItem] = field(default_factory=list)
    memory_notes: list[BoardItem] = field(default_factory=list)
    notes_areas: list[BoardItem] = field(default_factory=list)
    building_notes: list[BoardItem] = field(default_factory=list)
    texts: list[BoardItem] = field(default_factory=list)
    scale_bars: list[ScaleBar] = field(default_factory=list)
    ignored: list[Ignored] = field(default_factory=list)
    warnings: list[tuple[str, str]] = field(default_factory=list)  # (category, text)
    colors: list[ColorRow] = field(default_factory=list)


def scale_length_m(text: str) -> float | None:
    """`5` for labels such as `5 m`, `5m` or `500 cm`; None for any other text."""
    match = _SCALE_LABEL.match(text)
    if match is None:
        return None
    value = float(match.group(1).replace(",", "."))
    return value / 100 if match.group(2).lower() == "cm" else value


def _is_rectangle(item: BoardItem) -> bool:
    return item.type == "shape" and item.shape in RECTANGLES


def _scale_from_rectangle(item: BoardItem) -> ScaleBar | None:
    length = scale_length_m(item.text)
    if length is None or not _is_rectangle(item) or length <= 0:
        return None
    if item.short_side <= 0 or item.long_side / item.short_side < SCALE_MIN_ASPECT:
        return None
    return ScaleBar(item.text, length, item.long_side, "rectangle", item.id)


def _scale_from_line(line: BoardLine) -> ScaleBar | None:
    length = scale_length_m(line.text)
    if length is None or length <= 0 or line.shape != "straight" or line.length <= 0:
        return None
    return ScaleBar(line.text, length, line.length, "connector", line.id)


def _is_notes_area(item: BoardItem, config: ImportConfig) -> bool:
    if not _is_rectangle(item):
        return False
    if item.text.strip().casefold() == config.notes_label.casefold():
        return True
    return item.color in config.shape_colors.notes_area and not item.text.strip()


def _opening_kind(item: BoardItem, config: ImportConfig) -> OpeningKind | None:
    colors = config.shape_colors
    if item.color in colors.door:
        return "door"
    if item.color in colors.window:
        return "window"
    return "passage" if item.color in colors.passage else None


def _plan_frame(board: Board, config: ImportConfig, out: Classified) -> None:
    title = config.plan_frame.casefold()
    frames = [i for i in board.items if i.type == "frame" and i.text.casefold() == title]
    if not frames:
        out.warnings.append(
            (
                "Board",
                f'No frame titled "{config.plan_frame}": the whole board was read as the plan.',
            )
        )
        return
    frames.sort(key=lambda f: f.width * f.height, reverse=True)
    out.plan_frame = frames[0]
    if len(frames) > 1:
        out.warnings.append(
            (
                "Board",
                f'{len(frames)} frames are titled "{config.plan_frame}"; used the largest one.',
            )
        )


def _in_plan(item: BoardItem, frame: BoardItem | None) -> bool:
    return frame is None or item.parent_id == frame.id or frame.contains(item.center)


def _color_table(board: Board, out: Classified) -> list[ColorRow]:
    """Every rectangle fill and sticky colour, counted by what the importer read it as."""
    roles: dict[str, str] = {i.id: "room" for i in out.room_parts}
    roles |= {i.id: kind for kind, i in out.openings}
    roles |= {i.id: "notes area" for i in out.notes_areas}
    roles |= {b.ref: "scale bar" for b in out.scale_bars}
    roles |= {i.id: "building note" for i in out.building_notes}
    roles |= {i.id: "level note" for i in out.level_notes}
    roles |= {i.id: "room memory" for i in out.memory_notes}
    counts = Counter(
        (
            "shape fill" if i.type == "shape" else "sticky note",
            i.color or "none",
            roles.get(i.id, "ignored"),
        )
        for i in board.items
        if _is_rectangle(i) or i.type == "sticky_note"
    )
    return [ColorRow(kind, color, n, meaning) for (kind, color, meaning), n in counts.most_common()]


def _classify_in_plan(item: BoardItem, config: ImportConfig, out: Classified) -> None:
    if item.type == "shape":
        if item.shape not in RECTANGLES:
            out.ignored.append(Ignored(item.describe(), f"shape type '{item.shape}' is not used"))
        elif kind := _opening_kind(item, config):
            out.openings.append((kind, item))
        else:
            out.room_parts.append(item)
    elif item.type == "sticky_note":
        if item.color in config.sticky_colors.level:
            out.level_notes.append(item)
        elif item.color in config.sticky_colors.memory:
            out.memory_notes.append(item)
        else:
            out.ignored.append(Ignored(item.describe(), f"sticky colour '{item.color}' not mapped"))
            out.warnings.append(
                (
                    "Colours",
                    f"Sticky note {item.describe()} has colour '{item.color}', which is neither "
                    "a level nor a memory colour in import_config.yaml; it was ignored.",
                )
            )
    elif item.type == "text":
        out.texts.append(item)
    elif item.type == "image":
        out.ignored.append(Ignored(item.describe(), "images are not imported (use the Photos tab)"))
    else:
        out.ignored.append(Ignored(item.describe(), f"item type '{item.type}' is not used"))


def classify(board: Board, config: ImportConfig) -> Classified:
    """Sort the board's items by role. Never raises; problems become warnings or errors later."""
    out = Classified()
    _plan_frame(board, config, out)
    rest: list[BoardItem] = []
    for item in board.items:
        if item.type == "frame":
            if item is not out.plan_frame:
                out.ignored.append(Ignored(item.describe(), "frame other than the plan frame"))
        elif bar := _scale_from_rectangle(item):
            out.scale_bars.append(bar)
        elif _is_notes_area(item, config):
            out.notes_areas.append(item)
        else:
            rest.append(item)
    for item in rest:
        in_notes = any(area.contains(item.center) for area in out.notes_areas)
        if in_notes and item.text and item.type in ("sticky_note", "text", "shape"):
            out.building_notes.append(item)
        elif not _in_plan(item, out.plan_frame):
            out.ignored.append(Ignored(item.describe(), "outside the plan frame"))
        else:
            _classify_in_plan(item, config, out)
    for line in board.lines:
        if bar := _scale_from_line(line):
            out.scale_bars.append(bar)
        else:
            label = f' "{line.text}"' if line.text else ""
            out.ignored.append(Ignored(f"connector{label} ({line.id})", "connectors are not used"))
    out.colors = _color_table(board, out)
    return out
