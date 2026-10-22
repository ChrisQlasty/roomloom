"""Read the short annotations written on the board.

A deterministic grammar covers `Room 3A #classroom h=3.2`, `sill=0.9 h=1.4`, `level -0.3`,
`steps 2` and a trailing `— Author`. Level notes in free text ("two steps down") can optionally
be interpreted by Claude with a strict JSON schema (`--llm-notes`).
"""

import re
from collections.abc import Callable
from dataclasses import dataclass, field

import anthropic
from pydantic import BaseModel, Field

from app.config import Settings
from app.importers.miro import MiroImportError
from app.schema.ids import slugify

_NUM = r"[+-]?\d+(?:[.,]\d+)?"
_UNIT = r"\s*(cm|m)?(?![\w.,])"
_H = re.compile(rf"\bh\s*[=:]\s*({_NUM}){_UNIT}", re.IGNORECASE)
_SILL = re.compile(rf"\bsill\s*[=:]\s*({_NUM}){_UNIT}", re.IGNORECASE)
_LEVEL = re.compile(rf"\blevel\s*[=:]?\s*({_NUM}){_UNIT}", re.IGNORECASE)
_STEPS = re.compile(r"\bsteps?\s*[=:]?\s*(\d+)\b|\b(\d+)\s*steps?\b", re.IGNORECASE)
_TAG = re.compile(r"(?<![\w#])#([^\s#,;]+)")
_AUTHOR = re.compile(r"(?:^|\s)(?:—|–|--)\s*([^\W\d_][^\n—–]{0,60}?)\s*$")
_MINUS = str.maketrans({"−": "-", "‒": "-"})


@dataclass
class ParsedText:
    """What the grammar found in one text; `rest` is whatever text is left over."""

    rest: str
    tags: list[str] = field(default_factory=list)
    h: float | None = None
    sill: float | None = None
    level: float | None = None
    steps: int | None = None
    author: str | None = None


def _metres(number: str, unit: str | None) -> float:
    value = float(number.replace(",", "."))
    return value / 100 if (unit or "").lower() == "cm" else value


def _take(pattern: re.Pattern[str], text: str) -> tuple[re.Match[str] | None, str]:
    """First match of `pattern` and the text with that match removed."""
    match = pattern.search(text)
    if match is None:
        return None, text
    return match, text[: match.start()] + " " + text[match.end() :]


def split_author(text: str) -> tuple[str, str | None]:
    """`("green paint", "Ania")` for `green paint — Ania`; the text is otherwise unchanged."""
    match, body = _take(_AUTHOR, text)
    if match is None:
        return text.strip(), None
    return " ".join(body.split()), match.group(1).strip()


def parse_text(text: str) -> ParsedText:
    """Apply the annotation grammar to one item's plain text."""
    text, author = split_author(text.translate(_MINUS))
    parsed = ParsedText(rest="", author=author)
    match, text = _take(_H, text)
    if match:
        parsed.h = _metres(match.group(1), match.group(2))
    match, text = _take(_SILL, text)
    if match:
        parsed.sill = _metres(match.group(1), match.group(2))
    match, text = _take(_LEVEL, text)
    if match:
        parsed.level = _metres(match.group(1), match.group(2))
    match, text = _take(_STEPS, text)
    if match:
        parsed.steps = int(match.group(1) or match.group(2))
    for raw_tag in _TAG.findall(text):
        tag = slugify(raw_tag)
        if tag and tag not in parsed.tags:
            parsed.tags.append(tag)
    text = _TAG.sub(" ", text)
    parsed.rest = " ".join(text.split()).strip(" ,;:-")
    return parsed


def with_author(text: str, author: str | None) -> str:
    """Note text with its author appended the way it was written on the board."""
    return f"{text} — {author}" if author else text


# --- optional Claude interpretation of free-text level notes ---


class LevelReading(BaseModel):
    """Claude's reading of one free-text level note."""

    note: int = Field(description="Index of the note in the request, starting at 0.")
    level_m: float | None = Field(
        description=(
            "Floor height of the room in metres relative to the entrance level (0); negative "
            "means lower. Null if the note says nothing about the floor height."
        )
    )
    steps: int | None = Field(description="Number of steps at the door, or null.")
    explanation: str = Field(description="One short sentence: how the note was read.")


class LevelReadings(BaseModel):
    """All readings of one request."""

    readings: list[LevelReading]


NoteInterpreter = Callable[[list[str]], list[LevelReading]]

_SYSTEM = """\
You read annotations from a hand-drawn floor plan of a single-storey building.
Each note sits in a room or next to a door and may describe a floor level change or steps.
For every note, report:
- level_m: the room's floor height in metres relative to the entrance level 0 (lower is
  negative). "floor 30 cm lower" gives -0.3. If only steps are given, estimate 0.17 m per step
  in the stated direction and say that it is an estimate.
- steps: the number of steps at the door, if stated.
Use null for anything the note does not say. Never invent values without a cue in the note.
The notes may be in any language."""


def claude_interpreter(
    settings: Settings, client: anthropic.Anthropic | None = None
) -> NoteInterpreter:
    """An interpreter that sends all free-text level notes to Claude in one request."""

    def interpret(texts: list[str]) -> list[LevelReading]:
        api = client or anthropic.Anthropic(api_key=settings.anthropic_api_key or None)
        numbered = "\n".join(f"{i}: {t}" for i, t in enumerate(texts))
        try:
            response = api.messages.parse(
                model=settings.anthropic_model,
                max_tokens=4000,
                system=_SYSTEM,
                messages=[{"role": "user", "content": f"Notes:\n{numbered}"}],
                output_format=LevelReadings,
            )
        except anthropic.APIError as e:
            raise MiroImportError(f"Claude could not read the level notes: {e}") from e
        if response.stop_reason == "refusal" or response.parsed_output is None:
            raise MiroImportError("Claude returned no reading for the level notes")
        return [r for r in response.parsed_output.readings if 0 <= r.note < len(texts)]

    return interpret
