from types import SimpleNamespace
from typing import Any

import anthropic
import httpx
import pytest

from app.config import Settings
from app.importers.miro import MiroImportError
from app.importers.miro.notes import (
    LevelReading,
    LevelReadings,
    claude_interpreter,
    parse_text,
    split_author,
    with_author,
)


@pytest.mark.parametrize(
    ("text", "fields"),
    [
        ("Room 3A #classroom h=3.2", {"rest": "Room 3A", "tags": ["classroom"], "h": 3.2}),
        ("Sala #Sala_Gimnastyczna #gym", {"rest": "Sala", "tags": ["sala_gimnastyczna", "gym"]}),
        ("h = 3,5 Hall", {"rest": "Hall", "h": 3.5}),
        ("sill=0.9 h=1.4", {"rest": "", "sill": 0.9, "h": 1.4}),
        ("h=210cm", {"h": 2.1}),
        ("level -0.3", {"rest": "", "level": -0.3}),
        ("level: −30 cm", {"level": -0.3}),
        ("level +0.5 steps 3", {"level": 0.5, "steps": 3}),
        ("2 steps", {"rest": "", "steps": 2}),
        ("Kitchen — Ania", {"rest": "Kitchen", "author": "Ania"}),
        ("Hall -- Bartek Nowak", {"rest": "Hall", "author": "Bartek Nowak"}),
        ("level -0.3", {"author": None}),
        ("two steps down, floor lower", {"rest": "two steps down, floor lower", "steps": None}),
        ("Hall h=3.2, #gym", {"rest": "Hall", "tags": ["gym"], "h": 3.2}),
        ("level -0.3, steps 2", {"rest": "", "level": -0.3, "steps": 2}),
        ("sill=0.9, h=1.4", {"sill": 0.9, "h": 1.4}),
        ("Hall h=3.2.", {"rest": "Hall", "h": 3.2}),
        ("h=3,5x", {"h": None}),
        ("h=3.2.1", {"h": None}),
    ],
)
def test_parse_text(text: str, fields: dict[str, Any]) -> None:
    parsed = parse_text(text)
    for name, value in fields.items():
        assert getattr(parsed, name) == value, name


@pytest.mark.parametrize(
    ("text", "rest"),
    [
        ("Kitchen – dining", "Kitchen – dining"),
        ("Level 2 Office", "Level 2 Office"),
        ("Gym 2 steps up", "Gym 2 steps up"),
        ("Room 3A #classroom h=3.2", "Room 3A"),
    ],
)
def test_room_labels_only_read_tags_and_height(text: str, rest: str) -> None:
    parsed = parse_text(text, room_label=True)
    assert parsed.rest == rest
    assert (parsed.level, parsed.steps, parsed.author) == (None, None, None)


def test_split_author_keeps_the_rest_of_the_text() -> None:
    assert split_author("3 steps to the stage\n— Ania") == ("3 steps to the stage", "Ania")
    assert split_author("no author") == ("no author", None)
    assert with_author("paint", "Ania") == "paint — Ania" and with_author("paint", None) == "paint"


class FakeMessages:
    def __init__(self, result: object) -> None:
        self.result = result
        self.calls: list[dict[str, Any]] = []

    def parse(self, **kwargs: Any) -> object:
        self.calls.append(kwargs)
        if isinstance(self.result, Exception):
            raise self.result
        return self.result


def fake_client(result: object) -> Any:
    return SimpleNamespace(messages=FakeMessages(result))


def settings() -> Settings:
    return Settings(_env_file=None, anthropic_model="claude-test")  # type: ignore[call-arg]


def test_claude_interpreter_sends_numbered_notes_with_a_strict_schema() -> None:
    readings = LevelReadings(
        readings=[
            LevelReading(note=1, level_m=-0.34, steps=2, explanation="two steps down"),
            LevelReading(note=7, level_m=1.0, steps=None, explanation="out of range"),
        ]
    )
    client = fake_client(SimpleNamespace(stop_reason="end_turn", parsed_output=readings))
    result = claude_interpreter(settings(), client)(["nothing", "two steps down"])
    assert [r.note for r in result] == [1]
    (call,) = client.messages.calls
    assert call["model"] == "claude-test" and call["output_format"] is LevelReadings
    assert call["messages"][0]["content"] == "Notes:\n0: nothing\n1: two steps down"


def test_claude_interpreter_reports_api_errors_and_refusals() -> None:
    error = anthropic.APIConnectionError(request=httpx.Request("POST", "https://example.invalid"))
    with pytest.raises(MiroImportError, match="could not read"):
        claude_interpreter(settings(), fake_client(error))(["x"])
    refusal = SimpleNamespace(stop_reason="refusal", parsed_output=None)
    with pytest.raises(MiroImportError, match="no reading"):
        claude_interpreter(settings(), fake_client(refusal))(["x"])
