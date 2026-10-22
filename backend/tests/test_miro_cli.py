import json
from pathlib import Path

import httpx
import pytest

import app.importers.miro.__main__ as cli
from app.config import Settings
from app.importers.miro.fetch import load_raw
from app.importers.miro.notes import LevelReading
from app.store.projects import ProjectStore

FIXTURES = Path(__file__).parent / "fixtures" / "miro"


@pytest.fixture
def projects(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """An empty projects folder; settings never read the real .env; no network at all."""
    root = tmp_path / "projects"
    settings = Settings(  # type: ignore[call-arg]
        _env_file=None, projects_dir=root, miro_token="tok", miro_board_id="board-from-env"
    )
    monkeypatch.setattr(cli, "get_settings", lambda: settings)

    def no_network(*args: object, **kwargs: object) -> None:
        raise AssertionError("the importer tried to use the network")

    monkeypatch.setattr(httpx.Client, "send", no_network)
    return root


def run(*args: str) -> int:
    return cli.main(list(args))


def from_json(name: str, slug: str = "l-house", *extra: str) -> int:
    return run("--project", slug, "--from-json", str(FIXTURES / f"{name}.json"), *extra)


def test_import_creates_a_project(projects: Path, capsys: pytest.CaptureFixture[str]) -> None:
    assert from_json("l_house") == 0
    folder = projects / "l-house"
    for name in ["project.json", "scene.json", "import_config.yaml", "history/index.jsonl"]:
        assert (folder / name).is_file(), name
    raw = json.loads((folder / "import" / "miro_raw.json").read_text())
    assert raw["items"] == load_raw(FIXTURES / "l_house.json")["items"]
    report = (folder / "import" / "import_report.md").read_text()
    assert report.startswith("# Miro import report: L House") and "## Warnings" in report
    store = ProjectStore(projects)
    assert len(store.load_scene("l-house").shell.rooms) == 5
    assert [e.description for e in store.history.list("l-house")] == ["Imported"]
    out = capsys.readouterr().out
    assert "Imported 'L House'" in out and "5 rooms, 18 walls (10 exterior, 8 interior)" in out


def test_existing_project_needs_force(projects: Path, capsys: pytest.CaptureFixture[str]) -> None:
    assert from_json("l_house") == 0
    assert from_json("two_rooms_door") == 1
    assert "already exists" in capsys.readouterr().err
    assert len(ProjectStore(projects).load_scene("l-house").shell.rooms) == 5

    assert from_json("two_rooms_door", "l-house", "--force", "--name", "Renamed") == 0
    store = ProjectStore(projects)
    assert len(store.load_scene("l-house").shell.rooms) == 2
    assert store.get("l-house").name == "Renamed"
    history = [e.description for e in store.history.list("l-house")]
    assert history == ["Imported", "Re-imported from Miro"]


def test_dry_run_prints_colours_and_creates_no_project(
    projects: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    assert from_json("l_house", "l-house", "--dry-run") == 0
    out = capsys.readouterr().out
    assert "| shape fill | `#f24726` | 5 | door |" in out and "## Rooms" in out
    folder = projects / "l-house"
    assert not (folder / "project.json").exists()
    assert (folder / "import_config.yaml").is_file()
    assert (folder / "import" / "import_report.md").is_file()


def test_failed_import_writes_the_report_only(
    projects: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    assert from_json("missing_scale", "broken") == 1
    assert "No scale bar found" in capsys.readouterr().err
    folder = projects / "broken"
    assert not (folder / "project.json").exists()
    assert "**Import failed.**" in (folder / "import" / "import_report.md").read_text()
    assert from_json("two_scales", "broken", "--dry-run") == 1


def test_llm_notes_use_claude(projects: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    seen: list[list[str]] = []

    def fake(texts: list[str]) -> list[LevelReading]:
        seen.append(texts)
        return [LevelReading(note=0, level_m=0.5, steps=3, explanation="up")]

    monkeypatch.setattr(cli, "claude_interpreter", lambda settings: fake)
    assert from_json("levels", "school", "--llm-notes") == 0
    assert seen == [["three steps up, the floor is higher"]]
    scene = ProjectStore(projects).load_scene("school")
    assert {r.name: r.floor_level for r in scene.shell.rooms}["Stage"] == 0.5
    assert "Claude (--llm-notes): up" in (projects / "school/import/import_report.md").read_text()


def test_without_from_json_the_board_is_fetched(
    projects: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls: list[tuple[str, str]] = []

    def fake_fetch(board: str, token: str) -> dict:
        calls.append((board, token))
        return load_raw(FIXTURES / "exterior_door.json")

    monkeypatch.setattr(cli, "fetch_board", fake_fetch)
    assert run("--project", "shop") == 0
    assert run("--project", "shop2", "--board", "explicit") == 0
    assert calls == [("board-from-env", "tok"), ("explicit", "tok")]


@pytest.mark.parametrize("slug", ["Bad Slug", "../x"])
def test_invalid_slug(projects: Path, slug: str, capsys: pytest.CaptureFixture[str]) -> None:
    assert from_json("l_house", slug) == 1
    assert "invalid project slug" in capsys.readouterr().err
    assert not projects.exists()
