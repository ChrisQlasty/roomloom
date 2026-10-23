"""CLI: import a Miro board into a new project (or re-import with --force).

uv run python -m app.importers.miro --board <id> --project <slug> [--name "..."]
    [--llm-notes] [--dry-run] [--force] [--from-json path]
"""

import argparse
import asyncio
import os
import sys
from datetime import UTC, datetime
from pathlib import Path

from app.config import Settings, get_settings
from app.importers.miro import MiroImportError
from app.importers.miro.config import CONFIG_FILE, load_config
from app.importers.miro.fetch import fetch_board, load_raw, save_raw
from app.importers.miro.notes import NoteInterpreter, claude_interpreter
from app.importers.miro.pipeline import run_import
from app.importers.miro.report import ImportReport, color_table, render
from app.schema.project import Project
from app.schema.scene import Scene
from app.store.atomic import write_atomic
from app.store.projects import ProjectStore, holds_project_data, is_valid_slug

IMPORT_DIR = Path("import")  # the board and report the current shell was built from
ATTEMPT_DIR = IMPORT_DIR / "attempt"  # dry runs and failed re-imports of an existing project
RAW_DUMP = "miro_raw.json"
REPORT = "import_report.md"


def _parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="python -m app.importers.miro",
        description="Create a RoomLoom project from a Miro board (see plan/miro-conventions.md).",
    )
    p.add_argument("--board", help="Miro board id (default: MIRO_BOARD_ID from .env)")
    p.add_argument("--project", required=True, help="project slug, e.g. old-school")
    p.add_argument("--name", help="display name (default: from the slug)")
    p.add_argument("--llm-notes", action="store_true", help="let Claude read free-text level notes")
    p.add_argument(
        "--dry-run", action="store_true", help="print colours and the report; create nothing"
    )
    p.add_argument(
        "--force", action="store_true", help="re-import an existing project (history is kept)"
    )
    p.add_argument("--from-json", type=Path, help="read a saved board dump instead of the API")
    return p


def _project(slug: str, name: str | None, existing: Project | None) -> Project:
    if existing is not None:
        return existing.model_copy(update={"name": name}) if name else existing
    return Project(
        id=slug,
        slug=slug,
        name=name or slug.replace("-", " ").title(),
        description="Imported from a Miro board.",
        created_at=datetime.now(UTC),
    )


def _write(store: ProjectStore, project: Project, scene: Scene, exists: bool) -> int:
    """Create or re-import the project; returns the committed scene version."""
    if not exists:
        return asyncio.run(store.create(project, scene)).scene_version
    old = store.load_scene(project.slug)
    scene = scene.model_copy(update={"assets": old.assets})  # uploaded photos stay listed
    return asyncio.run(store.reimport(project, scene, "Re-imported from Miro")).scene_version


def _keep_attempt(folder: Path) -> None:
    """A committed re-import: its board dump and report become the current ones."""
    for name in (RAW_DUMP, REPORT):
        os.replace(folder / ATTEMPT_DIR / name, folder / IMPORT_DIR / name)
    (folder / ATTEMPT_DIR).rmdir()


def _summary(report: ImportReport) -> str:
    scene = report.scene
    assert scene is not None
    shell = scene.shell
    exterior = sum(w.kind == "exterior" for w in shell.walls)
    openings = sum(len(w.openings) for w in shell.walls)
    return (
        f"{len(shell.rooms)} rooms, {len(shell.walls)} walls ({exterior} exterior, "
        f"{len(shell.walls) - exterior} interior), {openings} openings, "
        f"{len(shell.transitions)} step flights, {len(report.warnings)} warnings"
    )


def run(
    args: argparse.Namespace, settings: Settings, interpreter: NoteInterpreter | None = None
) -> int:
    """Run the import described by parsed CLI args; returns the process exit code."""
    slug = args.project
    if not is_valid_slug(slug):
        raise MiroImportError(f"invalid project slug {slug!r}: use lowercase words joined by '-'")
    store = ProjectStore(settings.projects_dir)
    folder = settings.projects_dir / slug
    exists = (folder / "project.json").is_file()
    if exists and not args.force and not args.dry_run:
        raise MiroImportError(
            f"project {slug!r} already exists. Use --force to re-import it (its history is kept, "
            "so the current version can still be restored)."
        )
    if not exists and not args.dry_run and holds_project_data(folder):
        raise MiroImportError(
            f"{folder} has a scene.json or history/ but no project.json. Restore project.json "
            "to re-import with --force, or move the folder away to start from scratch."
        )
    # an existing project keeps the record of its current import until a new one commits
    record = folder / (ATTEMPT_DIR if exists else IMPORT_DIR)
    config, created = load_config(folder)
    if created:
        print(f"Created {folder / CONFIG_FILE} with default colours; edit it if needed.")
    if args.from_json:
        raw, source = load_raw(args.from_json), f"file {args.from_json.name}"
    else:
        raw = fetch_board(args.board or settings.miro_board_id, settings.miro_token)
        source = "Miro REST API v2"
    save_raw(raw, record / RAW_DUMP)
    if interpreter is None and args.llm_notes:
        interpreter = claude_interpreter(settings)
    existing = store.get(slug) if exists else None
    project = _project(slug, args.name, existing)
    report = run_import(raw, config, project=project.name, source=source, interpreter=interpreter)
    text = render(report)
    write_atomic(record / REPORT, text.encode())
    if args.dry_run:
        print("\n".join(color_table(report.colors)), end="\n\n")
        print(text)
        return 1 if report.error else 0
    if report.error or report.scene is None:
        print(f"error: {report.error}", file=sys.stderr)
        print(f"Details: {record / REPORT}", file=sys.stderr)
        return 1
    version = _write(store, project, report.scene, exists)
    if exists:
        _keep_attempt(folder)
    verb = "Re-imported" if exists else "Imported"
    print(f"{verb} {project.name!r} into {folder} (scene version {version}): {_summary(report)}.")
    print(f"Report: {folder / IMPORT_DIR / REPORT}")
    return 0


def main(argv: list[str] | None = None) -> int:
    """Entry point; prints `error: ...` and returns 1 on any import problem."""
    args = _parser().parse_args(argv)
    try:
        return run(args, get_settings())
    except MiroImportError as e:
        print(f"error: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
