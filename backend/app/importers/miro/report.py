"""`import/import_report.md`: what the importer recognised, ignored and warned about."""

from collections import Counter
from dataclasses import dataclass, field
from datetime import UTC, datetime

from shapely.geometry import Polygon as ShapelyPolygon

from app.importers.miro.classify import ColorRow, Ignored, ScaleBar
from app.schema.scene import Scene
from app.schema.shell import Wall

# Warning categories, in the order the report lists them.
CATEGORIES = [
    "Board",
    "Scale",
    "Rooms",
    "Snapped gaps",
    "Overlaps",
    "Openings",
    "Levels and steps",
    "Ceilings",
    "Notes",
    "Colours",
]


@dataclass(frozen=True)
class LevelNoteRow:
    """How one level note was read, and by what (grammar or Claude)."""

    text: str
    room: str
    level: float | None
    steps: int | None
    reader: str
    explanation: str = ""


@dataclass
class ImportReport:
    """Everything the report shows. `scene` is None when the import failed (`error`)."""

    project: str
    source: str
    scene: Scene | None = None
    error: str | None = None
    plan_frame: str | None = None
    scale: ScaleBar | None = None
    metres_per_unit: float | None = None
    part_counts: dict[str, int] = field(default_factory=dict)
    level_notes: list[LevelNoteRow] = field(default_factory=list)
    warnings: list[tuple[str, str]] = field(default_factory=list)
    ignored: list[Ignored] = field(default_factory=list)
    colors: list[ColorRow] = field(default_factory=list)

    def warn(self, category: str, text: str) -> None:
        """Record a warning under one of CATEGORIES."""
        self.warnings.append((category, text))


def _m(value: float) -> str:
    return f"{value:.2f}"


def _table(header: list[str], rows: list[list[str]]) -> list[str]:
    cells = [[c.replace("|", "\\|").replace("\n", " ") for c in row] for row in rows]
    return [
        "| " + " | ".join(header) + " |",
        "|" + "|".join("---" for _ in header) + "|",
        *("| " + " | ".join(row) + " |" for row in cells),
    ]


def _rooms_section(report: ImportReport, scene: Scene) -> list[str]:
    rows = [
        [
            room.name,
            f"`{room.id}`",
            f"{ShapelyPolygon(room.polygon).area:.1f}",
            f"{room.floor_level:+.2f}" if room.floor_level else "0",
            _m(room.ceiling_height),
            ", ".join(f"#{t}" for t in room.tags) or "–",
            str(report.part_counts.get(room.id, 1)),
            str(len(room.notes)),
        ]
        for room in scene.shell.rooms
    ]
    header = ["Room", "Id", "Area m²", "Floor level m", "Ceiling m", "Tags", "Rectangles", "Notes"]
    return ["## Rooms", "", *_table(header, rows), ""]


def _wall_rooms(wall: Wall, names: dict[str, str]) -> str:
    rooms = [names[r] for r in wall.room_ids]
    return " ↔ ".join(rooms) if wall.kind == "interior" else f"{rooms[0]} ↔ outside"


def _openings_section(scene: Scene) -> list[str]:
    names = {r.id: r.name for r in scene.shell.rooms}
    rows = [
        [
            f"`{op.id}`",
            op.kind,
            _wall_rooms(wall, names),
            f"`{wall.id}`",
            _m(op.offset),
            _m(op.width),
            _m(op.height),
            _m(op.sill),
        ]
        for wall in scene.shell.walls
        for op in wall.openings
    ]
    if not rows:
        return ["## Openings", "", "No doors, windows or passages were found.", ""]
    header = ["Opening", "Kind", "Between", "Wall", "Offset m", "Width m", "Height m", "Sill m"]
    return ["## Openings", "", *_table(header, rows), ""]


def _levels_section(report: ImportReport, scene: Scene) -> list[str]:
    lines = ["## Floor levels and steps", ""]
    if report.level_notes:
        rows = [
            [
                n.text,
                n.room or "–",
                "–" if n.level is None else f"{n.level:+.2f}",
                "–" if n.steps is None else str(n.steps),
                n.reader + (f": {n.explanation}" if n.explanation else ""),
            ]
            for n in report.level_notes
        ]
        lines += _table(["Note", "Room", "Level m", "Steps", "Read by"], rows) + [""]
    names = {r.id: r.name for r in scene.shell.rooms}
    for tr in scene.shell.transitions:
        lines.append(
            f"- {tr.steps} step(s), {tr.rise_total:.2f} m in total, at `{tr.opening_id}` "
            f"(built in {names[tr.host_room_id]})"
        )
    if not report.level_notes and not scene.shell.transitions:
        lines.append("All rooms are at level 0; no steps.")
    return [*lines, ""]


def _notes_section(scene: Scene) -> list[str]:
    if not scene.notes:
        return []
    names = {r.id: r.name for r in scene.shell.rooms}
    lines = ["## Building notes", ""]
    for note in scene.notes:
        linked = ", ".join(names[r] for r in note.room_ids)
        lines.append(f"- {note.text}" + (f" (linked to {linked})" if linked else ""))
    return [*lines, ""]


def _warnings_section(report: ImportReport) -> list[str]:
    lines = ["## Warnings", ""]
    if not report.warnings:
        return [*lines, "None.", ""]
    order = {c: i for i, c in enumerate(CATEGORIES)}
    for category in sorted({c for c, _ in report.warnings}, key=lambda c: order.get(c, 99)):
        lines += [f"**{category}**", ""]
        lines += [f"- {text}" for c, text in report.warnings if c == category]
        lines.append("")
    return lines


def _ignored_section(report: ImportReport) -> list[str]:
    if not report.ignored:
        return []
    reasons = Counter(i.reason for i in report.ignored)
    lines = ["## Ignored items", "", f"{len(report.ignored)} board items were not used:", ""]
    lines += [f"- {n} × {reason}" for reason, n in reasons.most_common()]
    shown = [i for i in report.ignored if i.reason != "outside the plan frame"][:30]
    if shown:
        lines += ["", "<details><summary>Details</summary>", ""]
        lines += [f"- {i.item}: {i.reason}" for i in shown]
        lines += ["", "</details>"]
    return [*lines, ""]


def color_table(rows: list[ColorRow]) -> list[str]:
    """Markdown table of every fill and sticky colour found (also printed by --dry-run)."""
    if not rows:
        return ["No rectangles or sticky notes on the board."]
    return _table(
        ["Kind", "Colour", "Count", "Read as"],
        [[r.kind, f"`{r.color}`", str(r.count), r.meaning] for r in rows],
    )


def render(report: ImportReport, now: datetime | None = None) -> str:
    """The whole report as Markdown."""
    when = (now or datetime.now(UTC)).strftime("%Y-%m-%d %H:%M UTC")
    scene = report.scene
    lines = [f"# Miro import report: {report.project}", "", f"{when} · source: {report.source}", ""]
    if report.error or scene is None:
        lines += [
            "**Import failed.**",
            "",
            f"> {report.error}",
            "",
            "Nothing was written to the"
            " project. Fix the board (or `import_config.yaml`) and run the importer again.",
            "",
        ]
    else:
        exterior = sum(w.kind == "exterior" for w in scene.shell.walls)
        openings = Counter(op.kind for w in scene.shell.walls for op in w.openings)
        lines += [
            "## Summary",
            "",
            f"- **{len(scene.shell.rooms)} rooms**, footprint "
            f"{ShapelyPolygon(scene.shell.outline).area:.1f} m² "
            f"({len(scene.shell.outline)} outline corners)",
            f"- **{len(scene.shell.walls)} walls**: {exterior} exterior, "
            f"{len(scene.shell.walls) - exterior} interior",
            f"- **{sum(openings.values())} openings**: doors {openings['door']}, "
            f"windows {openings['window']}, passages {openings['passage']}",
            f"- step flights {len(scene.shell.transitions)}, building notes {len(scene.notes)}",
            f"- {len(report.warnings)} warnings, {len(report.ignored)} ignored board items",
            "",
        ]
    lines += ["## Scale", ""]
    if report.scale and report.metres_per_unit:
        lines.append(
            f'Scale bar "{report.scale.label}" ({report.scale.source}, '
            f"{report.scale.length_units:.0f} board units long): 1 board unit = "
            f"{report.metres_per_unit * 100:.3g} cm, so 100 board units = "
            f"{report.metres_per_unit * 100:.3g} m."
        )
    else:
        lines.append("No usable scale bar.")
    lines.append("")
    if report.plan_frame:
        lines += [f'Plan frame: "{report.plan_frame}".', ""]
    if scene is not None:
        lines += _rooms_section(report, scene)
        lines += _openings_section(scene)
        lines += _levels_section(report, scene)
        lines += _notes_section(scene)
    lines += _warnings_section(report)
    lines += _ignored_section(report)
    lines += ["## Colours found", "", *color_table(report.colors), ""]
    return "\n".join(lines).rstrip() + "\n"
